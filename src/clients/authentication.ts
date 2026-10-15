import type { BrowserContext, Frame, Page } from 'playwright';
import type { Logger } from '../ports.js';
import type { CookieStore } from '../stores/files.js';
import { SessionCookiesSchema } from '../stores/files.js';
import type { BrowserLauncher } from '../session/browser.js';
import { browserUserAgent } from '../session/browser.js';
import { field } from '../parsers/records.js';
import { STOREFRONT_ORIGIN } from '../parsers/catalog.js';
import { isLoginUrl, responseStatus } from './policy.js';
import { CART_SUMMARY_URL } from './storefront.js';
import { requestIO, acquireResource, checkRequest } from '../session/request.js';

const LOGIN_ORIGIN = 'https://login.continente.pt';
const EMAIL_INPUT = '#userNameCC';
const PASSWORD_INPUT = '#password_input';
const CONSENT_BUTTON = /^permitir todos$/i;

export interface Credentials { readonly email: string; readonly password: string; }
export interface LoginOptions { readonly showBrowser?: boolean; }

/** Signs in through the website's login form and saves the resulting session cookies. */
export class AuthenticationClient {
  constructor(private readonly launch: BrowserLauncher, private readonly cookies: CookieStore,
    private readonly credentials: Credentials, private readonly logger: Logger, private readonly options: LoginOptions = {}) {}

  /** Ask the storefront whether this browser context belongs to a signed-in customer. */
  async isSignedIn(context: BrowserContext): Promise<boolean> {
    const response = await context.request.get(CART_SUMMARY_URL, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 });
    if (!responseStatus(response, response.url?.() ?? CART_SUMMARY_URL).ok) return false;
    const body: unknown = await response.json().catch(() => null);
    return field(body, 'resources', 'customerAuthenticated') === true;
  }

  /** The login form is served in a frame from the login origin; wait for it to load. */
  async loginFrame(page: Page): Promise<Frame> {
    const fromLoginOrigin = (frame: Frame) => {
      try { return new URL(frame.url()).origin === LOGIN_ORIGIN; } catch { return false; }
    };
    return page.frames().find(fromLoginOrigin) ?? page.waitForEvent('framenavigated', { predicate: fromLoginOrigin, timeout: 15000 });
  }

  private async submit(frame: Frame, input: string, value: string): Promise<void> {
    checkRequest();
    const field = frame.locator(input);
    await field.fill(value, { timeout: 15000 });
    const button = frame.locator('button[type="submit"]:visible').first();
    if (await button.count()) await button.click(); else await field.press('Enter');
  }

  async loginWithCredentials(): Promise<boolean> {
    const { email, password } = this.credentials;
    if (!email || !password) {
      this.logger('Login skipped: CONTINENTE_EMAIL and CONTINENTE_PASSWORD are required.');
      return false;
    }
    const browser = await acquireResource(() => this.launch({ headless: !this.options.showBrowser }), browser => browser.close());
    let closing: Promise<void> | undefined;
    const close = () => closing ??= browser.close();
    try {
      return await requestIO(async () => {
        const context = await acquireResource(() => browser.newContext({ userAgent: browserUserAgent(browser.version()), locale: 'pt-PT' }), context => context.close());
        const page = await acquireResource(() => context.newPage(), page => page.close());
        this.logger('Signing in.');
        await page.goto(`${STOREFRONT_ORIGIN}/login/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.getByRole('button', { name: CONSENT_BUTTON }).click({ timeout: 5000 }).catch(() => {});
        const frame = await this.loginFrame(page);
        await this.submit(frame, EMAIL_INPUT, email);
        const leftLogin = page.waitForURL(url => url.origin === STOREFRONT_ORIGIN && !isLoginUrl(url.href), { timeout: 20000 }).catch(() => {});
        await this.submit(frame, PASSWORD_INPUT, password);
        await leftLogin;
        checkRequest();
        if (!(await this.isSignedIn(context))) throw new Error('The website did not accept the login');
        const cookies = SessionCookiesSchema.safeParse(await context.cookies());
        if (!cookies.success) throw new Error('The website returned an unexpected session');
        await this.cookies.save(cookies.data);
        this.logger('Signed in; session saved.');
        return true;
      }, close);
    } finally { await close(); }
  }
}
