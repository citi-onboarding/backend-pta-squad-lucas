import { z } from "../../shared/http/openapi-zod.js";

export const syncKindSchema = z.enum(["AUTOMATIC", "MANUAL"]);

export const syncResultSchema = z.enum([
  "SUCCESS",
  "PARTIAL",
  "FAILED",
  "RATE_LIMITED",
]);

export const syncStatusSchema = z.strictObject({
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  running: z.boolean(),
  erpAvailable: z.boolean().nullable(),
});

export const syncRunSchema = z.strictObject({
  id: z.string(),
  kind: syncKindSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  result: syncResultSchema.nullable(),
  recordsRead: z.int().nonnegative(),
  recordsChanged: z.int().nonnegative(),
  errorDetail: z.string().nullable(),
});

export const syncRunListSchema = z.array(syncRunSchema);

export const startedSyncRunSchema = z.strictObject({
  id: z.string(),
  kind: syncKindSchema,
  startedAt: z.iso.datetime(),
});

export const syncRunsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
