import { having } from '../test-support/assertions.js';
import { present, valueOf, errorOf, ok, fixture, ordersPage } from '../test-support/helpers.js';
import { load } from 'cheerio';
import { parseOrderQuantity, parseOrderLines, parseOrderHistory, parseOrderDetail, aggregatePurchaseFrequency } from '../src/parsers/orders.js';
import { OrderService, PurchaseHistoryService } from '../src/services/orders.js';

import assert from 'node:assert/strict';
import test from 'node:test';

test('order quantities preserve supported decimals and raw failure reasons without default amounts', () => {
  for (const [raw, value, unit] of [['2 un', 2, 'un'], ['1,25 kg', 1.25, 'kg'], ['0.125 l', 0.125, 'l'], ['250 g', 250, 'g'], ['500 ML', 500, 'ml'], ['0 un', 0, 'un']] as const) {
    assert.deepEqual(parseOrderQuantity(raw), { status: 'known', quantity: { value, unit } });
  }
  for (const [raw, reason] of [['', 'missing'], ['  ', 'missing'], ['2 box', 'unsupported_unit'], ['unknown', 'unrecognized_format'], ['2', 'unrecognized_format'], ['-1 un', 'unrecognized_format'], ['9'.repeat(400) + ' un', 'invalid_value']] as const) {
    const parsed = parseOrderQuantity(raw);
    assert.equal(parsed.status, 'unknown'); assert.equal(parsed.value, null); assert.equal(parsed.rawText, raw); assert.equal(parsed.reason, reason);
  }
});
test('unknown amounts preserve affected product warnings while known amounts and order frequency survive', () => {
  const lines = valueOf(parseOrderLines(fixture('order')));
  const unknown = { ...present(lines[0]), quantity: parseOrderQuantity('unreadable') };
  const products = valueOf(aggregatePurchaseFrequency([[present(lines[0]), unknown, present(lines[1])], [unknown]]));
  const milk = products.find(product => product.name === present(lines[0]).name);
  assert.deepEqual(present(milk).quantities, [{ value: 2, unit: 'un' }]); assert.equal(present(milk).orders, 2); assert.equal(present(milk).unknownQuantityLines, 2);
  assert.deepEqual(present(products.find(product => product.name === present(lines[1]).name)).quantities, [{ value: 1.2, unit: 'kg' }]);
  const missing = valueOf(parseOrderLines('<div class="product-line"><span class="product-name">Sal</span></div>'))[0];
  assert.equal(present(missing).name, 'Sal'); assert.equal(having(present(missing).quantity, 'reason').reason, 'missing');
});
test('summary containers keep identity when cards reorder or unrelated equal-count links precede them', () => {
  const $ = load(ordersPage); const cards = $('.ct-order-history--order-preview-item').toArray().reverse().map(e => $.html(e)).join('');
  const parsed = valueOf(parseOrderHistory('<a href="/detalhe-encomenda?id=unrelated">Unrelated</a>' + cards));
  assert.equal(present(parsed.entries[0]).order.orderNumber, '123456789_002'); assert.match(present(present(parsed.entries[0]).detailUrl), /id=second/);
  assert.equal(present(parsed.entries[1]).order.orderNumber, '123456789_001'); assert.match(present(present(parsed.entries[1]).detailUrl), /id=first/);
  const missing = valueOf(parseOrderHistory(ordersPage.replace('<a href="/detalhe-encomenda?id=first">Details</a>', '')));
  assert.equal(present(missing.entries[0]).detailUrl, null); assert.match(present(present(missing.entries[1]).detailUrl), /id=second/);
  assert.equal(present(present(missing.entries[0]).error).code, 'order_details_unavailable');
});
test('changed detail markup and identity mismatch are per-order failures; recognized empty detail is valid', async () => {
  const history = valueOf(parseOrderHistory(ordersPage));
  const expected = present(history.entries[0]).order;
  const empty = '<h2 class="order-list-title">Encomenda 123456789_001</h2><input name="orderLineItems" value="[]"><div class="ct-order-history--products-list-container"></div>';
  assert.deepEqual(valueOf(parseOrderDetail(empty, expected)), []);
  assert.equal(errorOf(parseOrderDetail('<main>Changed detail page</main>', expected)).code, 'order_details_unavailable');
  assert.equal(parseOrderDetail('<h2 class="order-list-title">Encomenda 123456789_002</h2>' + fixture('order'), expected).ok, false);
  assert.equal(parseOrderDetail('<div data-order-id="other"></div>' + fixture('order'), expected).ok, false);
  const client = { async fetchOrderHistory() { return ok(ordersPage); }, async fetchOrderLines(url: string) { return ok(url.includes('first') ? empty : '<main>Changed detail page</main>'); } };
  const result = valueOf((await new OrderService(client).listOrders(2)));
  assert.equal(result.completeness, 'partial'); assert.equal(present(result.items[0]).lines.status, 'available');
  assert.equal(present(result.items[1]).lines.status, 'unavailable'); assert.equal(result.failures.length, 1);
});
test('equal-count misplaced links are detected by detail numbers and unsupported raw dates remain visible', async () => {
  const wrongLinks = ordersPage.replace('id=first', 'id=swap').replace('id=second', 'id=first').replace('id=swap', 'id=second').replace('2 outubro 2026', 'Tomorrow?');
  const client = { async fetchOrderHistory() { return ok(wrongLinks); }, async fetchOrderLines(url: string) {
    return ok(`<h2 class="order-list-title">Encomenda 123456789_00${url.includes('first') ? 1 : 2}</h2>` + fixture('order'));
  } };
  const result = valueOf((await new OrderService(client).listOrders(2)));
  assert.equal(present(result.items[0]).date, null); assert.equal(present(result.items[0]).rawDate, 'Tomorrow?');
  assert.ok(result.items.every(order => order.lines.status === 'unavailable'));
  assert.equal(valueOf((await new PurchaseHistoryService(client).listFrequentlyBoughtProducts(2))).failed, 2);
});
