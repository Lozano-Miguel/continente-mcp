import type { Result, ToolError } from '../domain/index.js';
import { checkRequest } from '../session/request.js';

/**
 * Retry once after a known authentication failure. Only pre-write failures use the outer
 * Result error; uncertain writes are successful Results with an unknown outcome, so they
 * are never replayed here.
 */
export async function withAuthenticationRecovery<T>(operation: () => Promise<Result<T, ToolError>>,
  refresh: () => Promise<boolean>): Promise<Result<T, ToolError>> {
  checkRequest();
  const first = await operation();
  if (first.ok || first.error.code !== 'not_authenticated') return first;
  checkRequest();
  if (!(await refresh())) return first;
  checkRequest();
  return operation();
}
