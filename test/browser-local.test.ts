import { ProductIdSchema } from '../src/domain/index.js';
import { z } from 'zod';
import type { StorefrontSession } from '../src/session/browser.js';
import { double } from '../test-support/assertions.js';
import { chromium } from 'playwright';
import { CartClient, StorefrontClient } from '../src/clients/storefront.js';
import { parseProductForm } from '../src/parsers/cart.js';

import assert from 'node:assert/strict';
import test from 'node:test';

test('local Chromium extracts current form properties before pure validation', {
  skip: process.env.CONTINENTE_LOCAL_BROWSER_TEST !== '1' && 'Opt in with CONTINENTE_LOCAL_BROWSER_TEST=1; uses only fulfilled local routes',
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
      <input name="productID"><input class="add-to-cart-url"><input name="csrf_token">
      <div class="ct-tile-quantity-update" data-measure-options='{"primaryunit":"un"}'></div>
      <script>
        document.querySelector('[name="productID"]').value = '00123';
        document.querySelector('.add-to-cart-url').value = '/Cart-AddProduct';
        document.querySelector('[name="csrf_token"]').value = 'local-dynamic-token';
      </script>` }));
    const page = await context.newPage();
    const session = { async ensureReady() { return { page, context }; } };
    const response = await new CartClient(new StorefrontClient(double<StorefrontSession>(session))).fetchProductForm('00123');
    assert.equal(response.ok, true);
    assert.equal(z.object({ csrf: z.string() }).parse(response.value).csrf, 'local-dynamic-token');
    assert.equal((await page.content()).includes('value="local-dynamic-token"'), false);
    const form = parseProductForm(response.value, ProductIdSchema.parse('00123'));
    assert.equal(form.ok, true);
    assert.equal(form.value.sale.rules.saleUnit, 'un');
  } finally { await browser.close(); }
});
