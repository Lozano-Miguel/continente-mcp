import { load } from 'cheerio';
import { FavoriteProductSchema, ProductSchema, parseMoneyAmount, parseProductReference, parseValue } from '../domain/index.js';
import type { FavoriteProduct, Product, Result, ToolError } from '../domain/index.js';
import { failure, success } from '../domain/index.js';

export const STOREFRONT_ORIGIN = 'https://www.continente.pt';
export function storefrontUrl(value: string): string | null {
  try { const url = new URL(value, STOREFRONT_ORIGIN); return url.origin === STOREFRONT_ORIGIN && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
const text = (value: string) => value.replace(/\s+/g, ' ').trim();
export function productReferenceFromUrl(href: string) {
  const url = storefrontUrl(href);
  const slug = url ? new URL(url).pathname.match(/^\/produto\/([^/]+)\.html$/)?.[1] : undefined;
  const parsed = parseProductReference(slug);
  // Slugs can contain encoded punctuation that tool inputs do not accept; fall back to the numeric ID.
  return parsed.ok ? parsed : parseProductReference(slug?.match(/-(\d+)(?:-master)?$/)?.[1]);
}

const SEARCH_EMPTY = '.search-noresults-wrapper, .search-no-results, [data-search-empty]';
const PRODUCT_LINK = 'a[href*="/produto/"]';

/** Text after "=" in labels such as "Quant. Mínima = 600 gr (3 un)". */
function minimumLabel(label: string): string | null {
  const [caption, ...rest] = label.split('=');
  return /m[ií]nim/i.test(caption ?? '') && rest.length ? text(rest.join('=')) || null : null;
}

export function parseProductSearchPage(html: string): Result<Product[], ToolError> {
  const $ = load(html);
  if ($(SEARCH_EMPTY).length) return success([]);
  const tiles = $($('.search-results-grid').length ? '.search-results-grid .ct-inner-tile-wrap' : '.ct-inner-tile-wrap').toArray();
  if (!tiles.length) return failure('invalid_data', 'The search results page was not recognised');
  const products: Product[] = [];
  for (const tile of tiles) {
    const card = $(tile);
    const links = card.find(PRODUCT_LINK).toArray().map(link => ({ href: $(link).attr('href'), label: text($(link).text()) }));
    const href = links[0]?.href;
    const name = links.map(link => link.label).find(Boolean);
    if (!href || !name) return failure('invalid_data', 'A search result was not recognised');
    const reference = productReferenceFromUrl(href);
    if (!reference.ok) return reference;
    const price = parseMoneyAmount(text(card.find('.pwc-tile--price-primary').first().text()) || null);
    if (!price.ok) return price;
    const product = parseValue(ProductSchema, { ...reference.value, name, price: price.value, url: storefrontUrl(href),
      unitPriceText: text(card.find('.pwc-tile--price-secondary').first().text()) || null,
      minimumText: minimumLabel(card.find('.pwc-tile--quantity').first().text()) }, 'product');
    if (!product.ok) return product;
    products.push(product.value);
  }
  return success(uniqueProducts(products));
}

export function parseFavoritesPageData(html: string): Result<{ items: FavoriteProduct[]; expectedIds: string[]; nextCursor: string | null }, ToolError> {
  const $ = load(html);
  const grids = $('.favorites-list .favorite-grid[data-pids]');
  if (grids.length !== 1) return failure('invalid_data', 'The favorites page was not recognised');
  const grid = grids.first();
  let rawIds: unknown;
  try { rawIds = JSON.parse(grid.attr('data-pids') ?? ''); } catch { return failure('invalid_data', 'The favorites product list is malformed'); }
  if (!Array.isArray(rawIds)) return failure('invalid_data', 'The favorites product list is malformed');
  const ids = rawIds.map(value => parseProductReference(value));
  if (ids.some(id => !id.ok)) return failure('invalid_data', 'The favorites product list is malformed');
  const expected = new Set(ids.flatMap(id => id.ok ? [id.value.productId] : []));
  const products: FavoriteProduct[] = [];
  let error: ToolError | undefined;
  grid.find('.favoriteProductTile').each((_, element) => {
    const card = $(element);
    const anchor = card.find('a[href*="/produto/"]').filter((_, element) => text($(element).text()).length > 0).first();
    const label = text(anchor.text());
    const href = anchor.attr('href') ?? '';
    const name = label.replace(/\d+[,.]\d+\s*€/g, '').trim();
    if (!name) { error = failure('invalid_data', 'A favorite product was not recognised').error; return; }
    const ref = productReferenceFromUrl(href);
    const rawPrice = text(card.find('.pwc-tile--price-primary').first().text()) || label.match(/(\d+[,.]\d+\s*€)/)?.[1];
    const price = parseMoneyAmount(rawPrice);
    if (!ref.ok) { error = ref.error; return; }
    if (!price.ok) { error = price.error; return; }
    const result = parseValue(FavoriteProductSchema, { ...ref.value, name, price: price.value, url: storefrontUrl(href) }, 'favorite');
    if (result.ok) products.push(result.value); else error = result.error;
  });
  if (error) return { ok: false, error };
  const unique = uniqueProducts(products);
  if (unique.some(product => !expected.has(product.productId))) {
    return failure('invalid_data', 'The favorites page lists products it does not show');
  }
  const next = parseFavoritesContinuation(html);
  return next.ok ? success({ items: unique, expectedIds: [...expected], nextCursor: next.value }) : next;
}
export function parseFavoritesContinuation(html: string): Result<string | null, ToolError> {
  const $ = load(html);
  const links = $('.favorites-list a[rel~="next"]');
  if (!links.length) return success(null);
  const href = storefrontUrl(links.first().attr('href') ?? '');
  const url = href ? new URL(href) : null;
  if (links.length !== 1 || !url || !(url.pathname.endsWith('/Wishlist-RenderGrid') ||
    (url.pathname === '/conta/lista-produtos/' && url.searchParams.get('list') === 'favorites'))) {
    return failure('invalid_data', 'Invalid favorites continuation');
  }
  return success(href);
}
export function parseFavoritesPages(pages: string[]): Result<FavoriteProduct[], ToolError> {
  if (!pages.length) return failure('invalid_data', 'The favorites page was not recognised');
  const expected = new Set<string>(); const items: FavoriteProduct[] = [];
  let next: string | null = null;
  for (const html of pages) {
    const parsed = parseFavoritesPageData(html);
    if (!parsed.ok) return parsed;
    parsed.value.expectedIds.forEach(id => expected.add(id)); items.push(...parsed.value.items); next = parsed.value.nextCursor;
  }
  const unique = uniqueProducts(items);
  // The source identity list proves an empty grid is genuinely empty rather than still loading.
  if (next || unique.length !== expected.size) return failure('invalid_data', 'Not every favorite could be read');
  return success(unique);
}

export function uniqueProducts<T extends FavoriteProduct>(products: T[]): T[] {
  const seen = new Set<string>();
  return products.filter(product => { if (seen.has(product.productId)) return false; seen.add(product.productId); return true; });
}
export interface RankedProduct extends Product {
  /** The exact product is in the saved favorites. */
  favorite: boolean;
  /** Highest word overlap (0–1) between this name and a favorite's name. */
  similarity: number;
}
const words = (name: string) => new Set(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .split(/[^a-z0-9]+/).filter(word => word.length > 1));
function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  const union = a.size + b.size - shared;
  return union ? shared / union : 0;
}
/** Favorites first, then names most similar to a favorite; otherwise keep the site's order. */
export function rankProductsByFavorites(products: Product[], favorites: FavoriteProduct[]): RankedProduct[] {
  const favoriteIds = new Set(favorites.map(product => product.productId));
  const favoriteNames = favorites.map(product => words(product.name));
  return products.map((product, position) => {
    const name = words(product.name);
    const similarity = Math.round(Math.max(0, ...favoriteNames.map(favorite => overlap(name, favorite))) * 100) / 100;
    return { product: { ...product, favorite: favoriteIds.has(product.productId), similarity }, position };
  }).sort((a, b) => Number(b.product.favorite) - Number(a.product.favorite) || b.product.similarity - a.product.similarity || a.position - b.position)
    .map(entry => entry.product);
}
export function parseSearchPagination(html: string): Result<{ url: string; start: number; size: number } | null, ToolError> {
  const actions = load(html)('[data-url*="Search-UpdateGrid"]');
  const action = actions.first().attr('data-url');
  if (!action) return success(null);
  const href = storefrontUrl(action);
  if (!href) return failure('invalid_data', 'Invalid search continuation');
  const url = new URL(href);
  const rawStart = url.searchParams.get('start') ?? ''; const rawSize = url.searchParams.get('sz') ?? '';
  const start = Number(rawStart); const size = Number(rawSize);
  return actions.length === 1 && url.pathname.endsWith('/Search-UpdateGrid') && /^\d+$/.test(rawStart) && /^\d+$/.test(rawSize) &&
    Number.isSafeInteger(start) && Number.isSafeInteger(size) && start >= 0 && size > 0 && size <= 200
    ? success({ url: href, start, size }) : failure('invalid_data', 'Invalid search continuation');
}
