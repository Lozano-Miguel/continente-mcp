import { present, valueOf, ok, fixture } from '../test-support/helpers.js';
import type { FavoritesCache } from '../src/domain/index.js';

import type { StorefrontClient } from '../src/clients/storefront.js';
import { double } from '../test-support/assertions.js';
import { CatalogClient, FavoritesClient } from '../src/clients/storefront.js';
import { CatalogService, FavoritesService } from '../src/services/catalog.js';
import { parseProductSearchPage, parseFavoritesPages, parseSearchPagination } from '../src/parsers/catalog.js';

import assert from 'node:assert/strict';
import test from 'node:test';

const searchPage = (ids: string[], next?: number) => ids.map(id => `<div class="ct-inner-tile-wrap"><a href="/produto/product-${id}.html">Product ${id}</a><span class="pwc-tile--price-primary">1,29 €</span></div>`).join('') +
  (next ? `<button data-url="/Search-UpdateGrid?start=${next}&amp;sz=2">More</button>` : '');
const favoritePage = (ids: string[], expected: string[], next?: number) => `<div class="favorites-list"><div class="favorite-grid" data-pids='${JSON.stringify(expected)}'>` +
  ids.map(id => `<div class="favoriteProductTile"><a href="/produto/product-${id}.html">Product ${id}</a></div>`).join('') + '</div>' +
  (next ? `<a rel="next" href="/conta/lista-produtos/?list=favorites&amp;start=${next}">Next</a>` : '') + '</div>';
function site(first: string, subsequent: (string | Error)[]) {
  const urls: string[] = [];
  return { urls, async html() { return ok(first); }, async io<T>(_lease: unknown, operation: () => Promise<T>) { return operation(); },
    session: { async ensureReady() { return { context: { request: { async get(url: string) {
      urls.push(url); const body = subsequent[urls.length - 1]; if (body instanceof Error) throw body;
      return { ok: () => true, status: () => 200, url: () => url, async text() { return present(body); } };
    } } } }; } } };
}
test('search scans enough explicit source pages for the limit regardless of cached favorites, deduplicates and retains prices', async () => {
  for (const favorites of [[], valueOf(parseFavoritesPages([fixture('favorites')]))] as const) {
    const source = site(searchPage(['1', '2'], 2), [searchPage(['2', '3'], 4), searchPage(['4', '5'])]);
    const service = new CatalogService(new CatalogClient(double<StorefrontClient>(source)), double<FavoritesService>({ async loadCachedFavorites() { return { favorites: [...favorites] }; } }));
    const result = valueOf((await service.searchProducts('milk', 4)));
    assert.equal(result.scanned, 5); assert.equal(result.page.items.length, 4); assert.equal(result.page.completeness, 'complete');
    assert.equal(result.page.nextCursor, null); assert.equal(source.urls.length, 2);
    assert.equal(present(present(result.page.items[0]).price).minorUnits, 129);
  }
});
test('search stops at requested limit and returns only a real remaining cursor; later failures retain successful products', async () => {
  const bounded = site(searchPage(['1', '2'], 2), []);
  const result = valueOf((await new CatalogClient(double<StorefrontClient>(bounded)).searchProducts('milk', 1)));
  assert.equal(bounded.urls.length, 0); assert.equal(result.completeness, 'unknown');
  assert.match(present(result.nextCursor), /start=2/);
  const capped = site(searchPage(['1'], 1), Array.from({ length: 5 }, (_, i) => searchPage([String(i + 2)], i + 2)));
  const cappedResult = valueOf((await new CatalogClient(double<StorefrontClient>(capped)).searchProducts('milk', 50)));
  assert.equal(cappedResult.pages.length, 5); assert.equal(capped.urls.length, 4); assert.match(present(cappedResult.nextCursor), /start=5/);
  for (const response of [new Error('timeout'), '<main>unrecognized</main>'] as const) {
    const source = site(searchPage(['1', '2'], 2), [response]);
    const partial = valueOf((await new CatalogClient(double<StorefrontClient>(source)).searchProducts('milk', 4)));
    assert.equal(partial.completeness, 'partial'); assert.equal(partial.pages.length, 1); assert.equal(partial.failures.length, 1);
    assert.match(present(partial.nextCursor), /start=2/);
  }
});
test('search empty recognition ignores recommendations and malformed continuations are never guessed', () => {
  assert.deepEqual(valueOf(parseProductSearchPage('<div class="search-noresults-wrapper"></div>' + searchPage(['1']))), []);
  assert.equal(parseProductSearchPage('<main>unrecognized</main>').ok, false);
  for (const action of ['/Search-UpdateGrid?sz=2', '/Search-UpdateGrid?start=2&sz=1.5', '/Search-UpdateGrid?start=2&sz=0',
    '/Cart-RemoveProduct?Search-UpdateGrid&start=2&sz=2', 'https://other.invalid/Search-UpdateGrid?start=2&sz=2'] as const) {
    assert.equal(parseSearchPagination(`<button data-url="${action}"></button>`).ok, false);
  }
});
test('favorites traverse explicit read-only next links before saving a complete snapshot', async () => {
  const source = site(favoritePage(['1'], ['1', '2'], 1), [favoritePage(['2'], ['1', '2'])]);
  let saved: FavoritesCache | undefined;
  const service = new FavoritesService(new FavoritesClient(double<StorefrontClient>(source)), { async load() { return ok(null); }, async save(value) { saved = value; return ok(); } },
    { now: () => new Date('2026-10-14T12:00:00Z') }, 'test', () => {});
  const result = await service.refreshFavorites();
  assert.equal(result.ok, true); assert.equal(present(saved).favorites.length, 2); assert.equal(present(saved).completeness, 'complete'); assert.equal(source.urls.length, 1);
});
test('favorites continuation failures, loops, missing products and mutation URLs never replace a valid snapshot', async () => {
  for (const mode of ['failure', 'loop', 'missing', 'write-url'] as const) {
    let first = favoritePage(['1'], ['1', '2'], 1);
    if (mode === 'write-url') first = first.replace('/conta/lista-produtos/?list=favorites&amp;start=1', '/Cart-RemoveProduct?uuid=secret');
    const source = site(first, [mode === 'failure' ? new Error('timeout') : mode === 'loop' ? first : favoritePage([], ['1', '2'])]);
    let saves = 0; const previous: FavoritesCache = { schemaVersion: 1, accountScope: 'test', fetchedAt: '2026-10-14T12:00:00Z', favorites: valueOf(parseFavoritesPages([fixture('favorites')])) };
    const service = new FavoritesService(new FavoritesClient(double<StorefrontClient>(source)), { async load() { return ok(previous); }, async save() { saves++; return ok(); } },
      { now: () => new Date() }, 'test', () => {});
    assert.equal((await service.refreshFavorites()).ok, false); assert.equal(saves, 0);
    if (mode === 'write-url') assert.equal(source.urls.length, 0);
  }
  const capped = site(favoritePage(['1'], ['1'], 1), Array.from({ length: 20 }, (_, i) => favoritePage(['1'], ['1'], i + 2)));
  const result = valueOf((await new FavoritesClient(double<StorefrontClient>(capped)).fetchFavorites()));
  assert.equal(result.pages.length, 20); assert.equal(capped.urls.length, 19); assert.equal(result.completeness, 'partial');
});
