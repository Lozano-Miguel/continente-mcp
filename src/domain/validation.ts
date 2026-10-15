import type { z } from 'zod';
import { invalidData } from './errors.js';
import type { ToolError } from './errors.js';
import type { Result } from './result.js';

/** Do not cast external data into a domain type. Preserve failures without echoing payloads. */
export function parseValue<T>(schema: z.ZodType<T>, input: unknown, context: string): Result<T, ToolError> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: {
      ...invalidData(context),
      issues: result.error.issues.map(issue => ({
        path: issue.path.map(String).join('.'), code: issue.code,
      })),
    },
  };
}

export function parseJson<T>(schema: z.ZodType<T>, text: unknown, context: string): Result<T, ToolError> {
  if (typeof text !== 'string') return { ok: false, error: invalidData(context) };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, error: invalidData(context) };
  }
  return parseValue(schema, input, context);
}
