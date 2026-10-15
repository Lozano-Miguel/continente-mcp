export function record(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
}
export function field(input: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>((value, key) => record(value)?.[key], input);
}
export function finiteNumber(input: unknown): number | null {
  if (typeof input !== 'number' && (typeof input !== 'string' || !input.trim())) return null;
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}
