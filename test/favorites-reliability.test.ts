import { ProductIdSchema, parseProductReference } from '../src/domain/index.js';
import type { FavoritesCache } from '../src/domain/index.js';
import type { FavoritesGateway, FavoritesStore } from '../src/ports.js';

import { present, valueOf, fixture, ok, fail, pages } from '../test-support/helpers.js';
import { FavoritesService } from '../src/services/catalog.js';
import { parseFavoritesPages, parseProductSearchPage, rankProductsByFavorites } from '../src/parsers/catalog.js';
import { formatProductSearchResults } from '../src/mcp/shopping.js';

import assert from 'node:assert/strict';
import test from 'node:test';

test('favorites refresh preserves the exact last valid snapshot for HTTP, auth, extraction and completeness failures', async () => {
  const original: FavoritesCache = { schemaVersion: 2 as const, accountScope: 'test', fetchedAt: '2026-10-14T00:00:00Z', favorites: valueOf(parseFavoritesPages([fixture('favorites')])) };
  let saved = original; let saves = 0;
  const store: FavoritesStore = { async load() { return ok(saved); }, async save(value) { saves++; saved = value; return ok(); } };
  const client: FavoritesGateway = { async fetchFavorites() { return fail(); } };
  const service = new FavoritesService(client, store, { now: () => new Date('2026-10-14T12:00:00Z') }, 'test', () => {});
  const bad = [fail(), fail('not_authenticated'), ok(pages(fixture('favorites-unrecognized'))), ok(pages('<main><a href="/produto/leite-00123.html">Recommendation</a></main>')),
    ok(pages(fixture('favorites').replace('["00123","456"]', '["00123","456","789"]'))),
    ok(pages(fixture('favorites').replace('banana-456', 'unrecognized'))), ok(pages(fixture('favorites').replace('Banana Madeira', ''))),
    ok(pages(fixture('favorites').replace('["00123","456"]', 'not-json')))];
  for (const response of bad) {
    client.fetchFavorites = async () => response;
    assert.equal((await service.refreshFavorites()).ok, false);
    assert.equal(saved, original); assert.equal(saves, 0);
  }
  client.fetchFavorites = async () => ok(pages(fixture('favorites-empty')));
  assert.deepEqual(valueOf((await service.refreshFavorites())).favorites, []);
  assert.equal(saves, 1);
});
test('favorite grid membership excludes recommendations and accepts only proven empty grids', () => {
  const external = '<a href="/produto/advertisement-999.html">Recommended product</a>';
  assert.equal(valueOf(parseFavoritesPages([external + fixture('favorites')])).length, 2);
  const encoded = valueOf(parseFavoritesPages([fixture('favorites').replaceAll('leite-00123.html', 'produto-%3C-3kg-00123.html')]))[0];
  assert.equal(present(encoded).productId, '00123'); assert.equal(present(encoded).productSlug, null); assert.match(present(encoded).url, /%3C/);
  for (const html of ['<div class="favorites-list"></div>', '<div class="favorites-list"><div class="favorite-grid"></div></div>',
    fixture('favorites-empty').replace('[]', '["123"]')] as const) assert.equal(parseFavoritesPages([html]).ok, false);
});
test('exact favorites come first; similar names do not reorder the website relevance order', () => {
  const template = present(valueOf(parseProductSearchPage(fixture('catalog'))).products[0]);
  const exact = { ...template, productId: ProductIdSchema.parse('00123'), name: 'Renamed item' };
  const fuzzy = { ...template, productId: ProductIdSchema.parse('999'), name: 'Milk whole fresh dairy' };
  for (const reference of ['00123', 'leite-00123', 'leite-00123.html'] as const) {
    const saved = { ...template, ...valueOf(parseProductReference(reference)), name: 'Old favorite name' };
    const favorites = [saved, ...['Milk', 'whole', 'fresh', 'dairy'].map((name, i) => ({ ...template, productId: ProductIdSchema.parse(String(i + 1)), name }))];
    const ranked = rankProductsByFavorites([{ ...fuzzy, productId: ProductIdSchema.parse('998') }, fuzzy, exact], favorites);
    assert.deepEqual(ranked.map(p => p.productId), ['00123', '998', '999']);
    assert.equal(present(ranked[0]).favorite, true); assert.equal(present(ranked[1]).favorite, false);
    const output = formatProductSearchResults(ranked);
    assert.match(output, /Renamed item ⭐ favorite/); assert.doesNotMatch(output, /Milk whole fresh dairy ⭐/);
  }
});
