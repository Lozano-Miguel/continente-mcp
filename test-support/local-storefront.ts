import type { TestContext } from 'node:test';
import type { Browser, APIRequestContext } from 'playwright';
import type { FavoritesCache } from '../src/domain/index.js';

import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createShoppingServices } from '../src/runtime.js';
import { createSerialTaskQueue } from '../src/session/queue.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import assert from 'node:assert/strict';

interface FixtureState { writes: number; requests: { path: string; method: string }[]; cache: FavoritesCache | null; logins: number; }
interface FixtureResponse { status?: number; body: string; type?: string; headers?: Record<string, string>; }
type Resolver = (request: { url: URL; method: string; body: string | null; mutation: boolean; state: FixtureState }) => FixtureResponse | undefined | Promise<FixtureResponse | undefined>;
/** Browser requests are fulfilled; API requests are remapped exclusively to loopback. */
export async function localStorefront(t: TestContext, resolve: Resolver) {
  const state: FixtureState = { writes: 0, requests: [], cache: null, logins: 0 };
  const root = await mkdtemp(join(tmpdir(), 'continente-local-'));
  const respond = async (url: string, method: string, body: string | null) => {
    const path = new URL(url).pathname;
    const mutation = method === 'POST' || /Cart-(?:Add|Update|Remove)/.test(path);
    if (mutation) state.writes++;
    state.requests.push({ path, method });
    return await resolve({ url: new URL(url), method, body, mutation, state }) ?? { status: 404, body: 'Unknown local fixture' };
  };
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const value = await respond(`https://www.continente.pt${req.url}`, req.method ?? 'GET', Buffer.concat(chunks).toString());
      res.writeHead(value.status ?? 200, { 'Content-Type': value.type ?? 'text/html; charset=utf-8', ...value.headers }); res.end(value.body);
    } catch { res.writeHead(500); res.end('Local fixture failure'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser: Browser | undefined;
  t.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(); const value = await respond(request.url(), request.method(), request.postData());
    await route.fulfill({ status: value.status ?? 200, contentType: value.type ?? 'text/html; charset=utf-8', body: value.body, ...(value.headers ? { headers: value.headers } : {}) });
  });
  const page = await context.newPage();
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const forward = (method: 'get' | 'post'): APIRequestContext['get'] => async (url, options) => {
    const target = new URL(url); const local = `http://127.0.0.1:${address.port}${target.pathname}${target.search}`;
    const response = await context.request[method](local, options);
    return new Proxy(response, { get(object, key) { const value: unknown = key === 'url' ? () => String(url) : Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
  };
  const request = new Proxy(context.request, { get(object, key) { if (key === 'get' || key === 'post') return forward(key); const value: unknown = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
  const localContext = new Proxy(context, { get(object, key) { if (key === 'request') return request; const value: unknown = Reflect.get(object, key); return typeof value === 'function' ? value.bind(object) : value; } });
  const session = { run: createSerialTaskQueue(), async ensureReady() { return { page, context: localContext }; },
    async refreshAuthentication() { state.logins++; return false; }, async closeBrowserSession() {} };
  const services = createShoppingServices({ session, logger: () => {},
    env: { CONTINENTE_CREDENTIALS_FILE: join(root, 'absent.env'), CONTINENTE_DATA_DIR: root, CONTINENTE_EMAIL: '', CONTINENTE_PASSWORD: '' },
    favoritesStore: { async load() { return { ok: true, value: state.cache }; }, async save(value) { state.cache = value; return { ok: true, value: undefined }; } },
  });
  return { state, services, page };
}
