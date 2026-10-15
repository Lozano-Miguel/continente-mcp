import { z } from 'zod';
import { invalidData } from './errors.js';
import type { ToolError } from './errors.js';
import type { Result } from './result.js';
import { parseValue } from './validation.js';

export const MAX_REFERENCE_LENGTH = 200;
const opaqueIdentifier = z.string().min(1).max(MAX_REFERENCE_LENGTH).regex(/^[^\s\x00-\x1f\x7f]+$/);

interface SplitReference { productId: string; slug: string | null; }
/**
 * Split `00123`, `00123-master`, `leite-00123` or `leite-00123.html` into the numeric ID and
 * the human-readable slug. Returns null for anything else.
 */
function splitReference(input: string): SplitReference | null {
  if (!input || input.length > MAX_REFERENCE_LENGTH) return null;
  const base = input.endsWith('.html') ? input.slice(0, -'.html'.length) : input;
  const parts = base.split('-');
  if (!parts.every(part => /^[a-z0-9]+$/i.test(part))) return null;
  const idParts = parts.at(-1) === 'master' ? parts.slice(0, -1) : parts;
  const productId = idParts.at(-1);
  if (!productId || !/^\d+$/.test(productId)) return null;
  return { productId, slug: idParts.length > 1 ? base : null };
}
export const isProductReference = (input: string) => splitReference(input) !== null;

export const ProductIdSchema = z.string().min(1).max(MAX_REFERENCE_LENGTH).regex(/^\d+$/).brand<'ProductId'>();
export const ProductSlugSchema = z.string().max(MAX_REFERENCE_LENGTH)
  .refine(slug => !slug.endsWith('.html') && splitReference(slug)?.slug === slug).brand<'ProductSlug'>();
export const CartItemIdSchema = opaqueIdentifier.brand<'CartItemId'>();
export const OrderIdSchema = opaqueIdentifier.brand<'OrderId'>();
export const OrderNumberSchema = opaqueIdentifier.brand<'OrderNumber'>();

export type ProductId = z.infer<typeof ProductIdSchema>;
export type ProductSlug = z.infer<typeof ProductSlugSchema>;
export type CartItemId = z.infer<typeof CartItemIdSchema>;
export type OrderId = z.infer<typeof OrderIdSchema>;
export type OrderNumber = z.infer<typeof OrderNumberSchema>;

export const ProductReferenceSchema = z.strictObject({
  productId: ProductIdSchema,
  productSlug: ProductSlugSchema.nullable(),
}).refine(reference => reference.productSlug === null || splitReference(reference.productSlug)?.productId === reference.productId,
{ message: 'Product slug must identify the same product' });
export type ProductReference = z.infer<typeof ProductReferenceSchema>;

/** Accept a numeric ID or a product slug. Leading zeroes are kept. */
export function parseProductReference(input: unknown): Result<ProductReference, ToolError> {
  const split = typeof input === 'string' ? splitReference(input) : null;
  if (!split) return { ok: false, error: invalidData('product reference') };
  return parseValue(ProductReferenceSchema, { productId: split.productId, productSlug: split.slug }, 'product reference');
}
