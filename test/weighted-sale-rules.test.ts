// Sale rules of ten weighted products read from live product pages on 2026-10-15.
// Minimum, step and maximum are in kg; each product is sold in whole pieces.
import { readFileSync } from 'node:fs';
import { parseSaleRules, validateSaleQuantity, toStorefrontQuantity } from '../src/parsers/cart.js';
import { valueOf, errorOf } from '../test-support/helpers.js';

import assert from 'node:assert/strict';
import test from 'node:test';

interface Sample {
  productId: string; name: string; measureOptions: { minOrderQuantity: number; stepQuantity: number; maxNumberOfUnitsPerSale: number };
  expected: { minimumPieces: number; maximumPieces: number; kgPerPiece: number };
}
const samples = JSON.parse(readFileSync(new URL('../../test/fixtures/weighted-sale-rules.json', import.meta.url), 'utf8')) as Sample[];

test('weighted products have sale rules in whole pieces, including the maximum', () => {
  assert.equal(samples.length, 10);
  for (const { productId, measureOptions, expected } of samples) {
    const sale = valueOf(parseSaleRules(measureOptions));
    assert.deepEqual(sale.rules, { saleUnit: 'un', storefrontUnit: 'kg', storefrontUnitsPerSaleUnit: expected.kgPerPiece,
      minimum: { value: expected.minimumPieces, unit: 'un' }, maximum: { value: expected.maximumPieces, unit: 'un' },
      step: { value: 1, unit: 'un' } }, productId);
    assert.equal(sale.alternativeUnit, true);
    assert.equal(validateSaleQuantity(expected.maximumPieces, sale).ok, true, productId);
    assert.equal(errorOf(validateSaleQuantity(expected.maximumPieces + 1, sale)).code, 'invalid_input', productId);
    if (expected.minimumPieces > 1) assert.equal(errorOf(validateSaleQuantity(expected.minimumPieces - 1, sale)).code, 'quantity_below_minimum', productId);
    assert.equal(toStorefrontQuantity({ value: expected.maximumPieces, unit: 'un' }, sale), String(measureOptions.maxNumberOfUnitsPerSale), productId);
  }
});

test('a weighted maximum that is not a whole number of steps is still refused', () => {
  const chicken = samples.find(sample => sample.productId === '7069674');
  assert.ok(chicken);
  for (const maxNumberOfUnitsPerSale of [119, 118.5, 0.6]) {
    assert.equal(errorOf(parseSaleRules({ ...chicken.measureOptions, maxNumberOfUnitsPerSale })).code, 'sale_rules_unknown', String(maxNumberOfUnitsPerSale));
  }
});
