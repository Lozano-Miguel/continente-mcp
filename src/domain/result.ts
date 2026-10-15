import type { ToolError, ToolErrorCode } from './errors.js';

/** External values remain unknown until a boundary parser validates them. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function success<T>(value: T): Result<T, ToolError> { return { ok: true, value }; }
export function failure(code: ToolErrorCode, message: string = code): { ok: false; error: ToolError } {
  return { ok: false, error: { code, message, retryable: false } };
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected result variant: ${String(value)}`);
}
