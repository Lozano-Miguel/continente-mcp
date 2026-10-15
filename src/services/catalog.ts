import { requestIO, RequestStopped } from '../session/request.js';
import type { Clock, FavoritesGateway, FavoritesStore, CatalogGateway, Logger } from '../ports.js';
import type { FavoritesCache, FavoritesStatus, PageResult, Product, Result, ToolError } from '../domain/index.js';
import { parseProductReference } from '../domain/index.js';
import { parseProductDetails } from '../parsers/product.js';
import { success, failure } from '../domain/index.js';
import { parseFavoritesPages, parseProductSearchPage, rankProductsByFavorites, uniqueProducts } from '../parsers/catalog.js';
import type { RankedProduct } from '../parsers/catalog.js';

export const FAVORITES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface FavoritesSnapshot extends FavoritesCache {
  source: 'cache' | 'website'; freshness: 'fresh' | 'stale'; expiresAt: string; cacheState: 'empty' | 'populated';
}
export class FavoritesService {
  constructor(private readonly client: FavoritesGateway, private readonly store: FavoritesStore,
    private readonly clock: Clock, private readonly accountScope: string | (() => string), private readonly logger: Logger) {}
  private scope(): string { return typeof this.accountScope === 'function' ? this.accountScope() : this.accountScope; }
  private snapshot(cache: FavoritesCache, source: 'cache' | 'website'): FavoritesSnapshot {
    const fetched = Date.parse(cache.fetchedAt); const now = this.clock.now().getTime();
    return { ...cache, source, freshness: fetched <= now && now - fetched < FAVORITES_MAX_AGE_MS ? 'fresh' : 'stale',
      expiresAt: new Date(fetched + FAVORITES_MAX_AGE_MS).toISOString(), cacheState: cache.favorites.length ? 'populated' : 'empty' };
  }
  async loadCachedFavorites(): Promise<FavoritesCache | null> {
    const cached = await requestIO(() => this.store.load());
    if (!cached.ok) { this.logger('Could not read the favorites cache.'); return null; }
    return cached.value?.accountScope === this.scope() ? cached.value : null;
  }
  async getCacheStatus(): Promise<FavoritesStatus> {
    const unavailable: FavoritesStatus = { state: 'unavailable', fetchedAt: null, expiresAt: null, empty: null };
    try {
      const result = await requestIO(() => this.store.load());
      if (!result.ok) return unavailable;
      if (result.value === null) return { ...unavailable, state: 'missing' };
      if (result.value.accountScope !== this.scope()) return unavailable;
      const value = this.snapshot(result.value, 'cache');
      return { state: value.freshness, fetchedAt: value.fetchedAt, expiresAt: value.expiresAt, empty: value.cacheState === 'empty' };
    } catch (error) { if (error instanceof RequestStopped) throw error; return unavailable; }
  }
  async listFavorites(): Promise<Result<FavoritesSnapshot, ToolError>> {
    const cached = await this.loadCachedFavorites();
    return cached ? success(this.snapshot(cached, 'cache')) : this.refreshFavorites();
  }
  async refreshFavorites(): Promise<Result<FavoritesSnapshot, ToolError>> {
    const scope = this.scope();
    const response = await requestIO(() => this.client.fetchFavorites());
    if (!response.ok) return response;
    const [firstFailure] = response.value.failures;
    if (firstFailure) return { ok: false, error: firstFailure };
    const products = parseFavoritesPages(response.value.pages);
    if (!products.ok) return products;
    if (scope !== this.scope()) return failure('cache_unavailable', 'Favorites account/session changed during refresh');
    const cache: FavoritesCache = { schemaVersion: 1, accountScope: scope,
      fetchedAt: this.clock.now().toISOString(), favorites: products.value, completeness: 'complete' };
    const saved = await requestIO(() => this.store.save(cache));
    return saved.ok ? success(this.snapshot(cache, 'website')) : saved;
  }
}
export interface SearchResult {
  page: PageResult<RankedProduct>;
  scanned: number;
  favorites: FavoritesCache['favorites'];
}
export class CatalogService {
  constructor(private readonly client: CatalogGateway, private readonly favorites: FavoritesService) {}
  async getProduct(reference: string) {
    const parsed = parseProductReference(reference);
    if (!parsed.ok) return failure('invalid_input', 'Invalid product reference');
    if (!this.client.fetchProductDetails) return failure('upstream_unavailable', 'Product inspection is unavailable');
    const response = await requestIO(() => this.client.fetchProductDetails!(reference));
    return response.ok ? parseProductDetails(response.value.html, response.value.url, parsed.value.productId) : response;
  }
  async searchProducts(query: string, limit: number): Promise<Result<SearchResult, ToolError>> {
    const cache = await this.favorites.loadCachedFavorites();
    // Not wrapped in requestIO: the gateway handles cancellation per page so read pages survive.
    const response = await this.client.searchProducts(query, limit);
    if (!response.ok) return response;
    const products: Product[] = [];
    const failures = [...response.value.failures];
    for (const html of response.value.pages) {
      const parsed = parseProductSearchPage(html);
      if (!parsed.ok) {
        if (!products.length) return parsed;
        failures.push(parsed.error); break;
      }
      products.push(...parsed.value);
    }
    const unique = uniqueProducts(products);
    const favorites = cache?.favorites ?? [];
    return success({ scanned: unique.length, favorites, page: {
      items: rankProductsByFavorites(unique, favorites).slice(0, limit), nextCursor: response.value.nextCursor ?? null,
      completeness: failures.length ? 'partial' : response.value.completeness ?? 'unknown', failures,
    } });
  }
}
