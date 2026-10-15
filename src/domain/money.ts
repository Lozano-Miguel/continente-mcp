import { z } from 'zod';
import { invalidData } from './errors.js';
import type { ToolError } from './errors.js';
import type { Result } from './result.js';

export const MoneySchema = z.strictObject({
  currency: z.literal('EUR'),
  minorUnits: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});
export type Money = z.infer<typeof MoneySchema>;

/** The source of a price determines its basis; a line total is not a unit price. */
export const QuotedMoneySchema = z.strictObject({
  amount: MoneySchema.nullable(),
  basis: z.enum(['unit', 'line', 'unknown']),
});
export type QuotedMoney = z.infer<typeof QuotedMoneySchema>;

/** Convert decimal text through integer arithmetic; never round an unrecognized precision. */
export function parseMoneyAmount(input: unknown): Result<Money | null, ToolError> {
  if (input === null || input === undefined || input === '') return { ok: true, value: null };
  if (typeof input !== 'number' && typeof input !== 'string') {
    return { ok: false, error: invalidData('money amount') };
  }
  const text = String(input).trim();
  if (text.length > 100) return { ok: false, error: invalidData('money amount') };
  const match = text.match(/^(\d+)(?:[.,](\d{1,2}))?\s*€?$/);
  if (!match?.[1]) return { ok: false, error: invalidData('money amount') };
  const minorUnits = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, error: invalidData('money amount') };
  }
  return { ok: true, value: { currency: 'EUR', minorUnits: Number(minorUnits) } };
}
