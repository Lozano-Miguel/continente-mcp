import { assertNever, ProductIdSchema } from '../src/domain/index.js';
import type { CartMutationResult, CartItemId, PageResult, ProductId, Quantity } from '../src/domain/index.js';

const productId: ProductId = ProductIdSchema.parse('00123');
// @ts-expect-error IDs must be parsed strings, not numbers.
const numericId: ProductId = 123;
// @ts-expect-error Product IDs cannot be confused with cart line IDs.
const lineId: CartItemId = productId;
// @ts-expect-error A Quantity must carry an explicit supported unit.
const missingUnit: Quantity = { value: 1 };
// @ts-expect-error Unknown units are observations, not trusted Quantities.
const unsupportedUnit: Quantity = { value: 1, unit: 'unknown' };

function confirmedAmount(result: CartMutationResult): number | null {
  switch (result.outcome) {
    case 'confirmed': return result.confirmedQuantity.value;
    case 'not_applied':
      // @ts-expect-error An unapplied write cannot have a confirmed amount.
      result.confirmedQuantity;
      return null;
    case 'unknown':
      const noReplay: false = result.recovery.automaticReplay;
      const notRetryable: false = result.error.retryable;
      void noReplay;
      void notRetryable;
      return null;
    default: return assertNever(result);
  }
}

const page: PageResult<ProductId> = { items: [productId], completeness: 'complete', failures: [], nextCursor: null };
// @ts-expect-error Generic pages retain the validated item type.
const invalidPage: PageResult<ProductId> = { ...page, items: [123] };
void [numericId, lineId, missingUnit, unsupportedUnit, confirmedAmount, invalidPage];
