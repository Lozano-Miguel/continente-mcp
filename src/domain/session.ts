import { z } from 'zod';

export const BrowserStatusSchema = z.strictObject({
  browser: z.enum(['closed', 'starting', 'ready', 'unknown']),
  credentials: z.strictObject({ hasEmail: z.boolean().nullable(), hasPassword: z.boolean().nullable() }),
  savedCookies: z.enum(['available', 'missing', 'unavailable', 'unknown']),
  authentication: z.strictObject({ state: z.enum(['authenticated', 'unauthenticated', 'unknown']), checkedAt: z.iso.datetime({ offset: true }).nullable() }),
});
export type BrowserStatus = z.infer<typeof BrowserStatusSchema>;
export const FavoritesStatusSchema = z.strictObject({
  state: z.enum(['missing', 'fresh', 'stale', 'unavailable']), fetchedAt: z.iso.datetime({ offset: true }).nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(), empty: z.boolean().nullable(),
});
export type FavoritesStatus = z.infer<typeof FavoritesStatusSchema>;
export const UpdateStatusSchema = z.strictObject({
  currentVersion: z.string().nullable(), latestVersion: z.string().nullable(), available: z.boolean(),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
