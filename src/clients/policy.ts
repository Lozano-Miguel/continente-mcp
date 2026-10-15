import { STOREFRONT_ORIGIN, storefrontUrl } from '../parsers/catalog.js';
import { field } from '../parsers/records.js';
import { failure, success } from '../domain/index.js';

export function isLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.origin === 'https://login.continente.pt' ||
      (url.origin === STOREFRONT_ORIGIN && /^\/login(?:\/|$)/i.test(url.pathname)));
  } catch { return false; }
}
export interface HttpResponse {
  ok(): boolean; status(): number; url?(): string; headers?(): Record<string, string>;
}
/** Only known authentication evidence triggers recovery; arbitrary upstream failures do not. */
export function responseStatus(response: HttpResponse | null, finalUrl: string) {
  const status = response?.status();
  const location = response?.headers?.().location;
  let redirect = '';
  try { if (location) redirect = new URL(location, STOREFRONT_ORIGIN).href; }
  catch { return failure('invalid_data', 'Invalid response redirect'); }
  if (status === 401 || status === 403 || isLoginUrl(finalUrl) || (status && status >= 300 && status < 400 && isLoginUrl(redirect))) {
    return failure('not_authenticated');
  }
  if (!storefrontUrl(finalUrl)) return failure('invalid_data', 'Unexpected response origin');
  if (status === 404) return failure('not_found');
  return response?.ok() ? success(undefined) : failure('upstream_unavailable', `The website returned HTTP ${status ?? 'with no status'}`);
}
export function authenticatedPayload(input: unknown) {
  return field(input, 'resources', 'customerAuthenticated') === false ? failure('not_authenticated') : success(input);
}
