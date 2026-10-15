import type { FavoritesCache } from '../src/domain/index.js';

import type { TestContext } from 'node:test';
import { present, valueOf, errorOf, ok, fixture, pages } from '../test-support/helpers.js';
import { mkdtemp, writeFile, readFile, stat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FavoritesService } from '../src/services/catalog.js';
import { FileFavoritesStore, writePrivateJson } from '../src/stores/files.js';
import { favoritesScope } from '../src/config.js';

import assert from 'node:assert/strict';
import test from 'node:test';

const cache = (scope = 'account-a'): FavoritesCache => ({ schemaVersion: 2 as const, accountScope: scope, fetchedAt: '2026-10-14T12:00:00.000Z', favorites: [], completeness: 'complete' as const });
async function directory(t: TestContext) { const dir = await mkdtemp(join(tmpdir(), 'favorites-cache-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('valid empty caches remain cache reads; stale and future-dated snapshots expose freshness without implicit refresh', async () => {
  let data = cache(); let now = new Date('2026-10-14T13:00:00Z'); let fetches = 0;
  const service = new FavoritesService({ async fetchFavorites() { fetches++; return ok(pages(fixture('favorites-empty'))); } },
    { async load() { return ok(data); }, async save(value) { data = value; return ok(); } }, { now: () => now }, 'account-a', () => {});
  const fresh = valueOf((await service.listFavorites()));
  assert.equal(fresh.source, 'cache'); assert.equal(fresh.cacheState, 'empty'); assert.equal(fresh.freshness, 'fresh');
  assert.equal(fresh.expiresAt, '2026-10-15T12:00:00.000Z'); assert.equal(fetches, 0);
  now = new Date('2026-10-15T12:00:00Z');
  assert.equal(valueOf((await service.listFavorites())).freshness, 'stale'); assert.equal(fetches, 0);
  now = new Date('2026-10-14T00:00:00Z');
  assert.equal(valueOf((await service.listFavorites())).freshness, 'stale');
  assert.equal(valueOf((await service.refreshFavorites())).source, 'website'); assert.equal(fetches, 1);
});
test('changed account or cookie contents invalidate snapshots even in the same service instance', async t => {
  const file = join(await directory(t), 'session.json'); await writeFile(file, '["session-a"]');
  const login = { email: 'account-a@example.invalid', cookieFile: file };
  const scope = () => favoritesScope(login);
  const firstScope = scope(); let data = cache(firstScope); let fetches = 0;
  const service = new FavoritesService({ async fetchFavorites() { fetches++; return ok(pages(fixture('favorites-empty'))); } },
    { async load() { return ok(data); }, async save(value) { data = value; return ok(); } }, { now: () => new Date('2026-10-14T12:00:00Z') }, scope, () => {});
  await service.listFavorites(); assert.equal(fetches, 0);
  await writeFile(file, '["session-b"]'); assert.notEqual(scope(), firstScope);
  assert.equal(valueOf((await service.listFavorites())).source, 'website'); assert.equal(fetches, 1);
  login.email = 'account-b@example.invalid';
  assert.equal(valueOf((await service.listFavorites())).source, 'website'); assert.equal(fetches, 2);
});
test('atomic replacement preserves valid JSON and private modes; corrupt primary recovers from validated same-scope backup', async t => {
  const dir = await directory(t); const file = join(dir, 'favorites.json'); const store = new FileFavoritesStore(file, 'account-a');
  assert.equal((await store.save(cache())).ok, true);
  const before = await readFile(file, 'utf8');
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  await assert.rejects(writePrivateJson(file, cyclic));
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual((await readdir(dir)).sort(), ['favorites.json', 'favorites.json.bak']);
  await writeFile(`${file}.interrupted.tmp`, '{incomplete'); await writeFile(file, '{corrupt');
  assert.deepEqual(valueOf((await store.load())), cache());
  assert.equal((await new FileFavoritesStore(file, 'account-b').load()).ok, false);
  assert.equal((await store.save(cache('account-b'))).ok, false);
  await store.save({ ...cache(), fetchedAt: '2026-10-14T13:00:00.000Z' });
  assert.equal(present(valueOf((await store.load()))).fetchedAt, '2026-10-14T13:00:00.000Z');
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(`${file}.bak`)).mode & 0o777, 0o600);
  }
});
test('scope changes during fetch fail without saving a snapshot', async () => {
  let scope = 'a'; let saves = 0;
  const service = new FavoritesService({ async fetchFavorites() { scope = 'b'; return ok(pages(fixture('favorites-empty'))); } },
    { async load() { return ok(null); }, async save() { saves++; return ok(); } }, { now: () => new Date() }, () => scope, () => {});
  assert.equal(errorOf((await service.refreshFavorites())).code, 'cache_unavailable'); assert.equal(saves, 0);
});
