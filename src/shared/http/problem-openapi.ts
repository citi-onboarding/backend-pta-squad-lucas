import { z } from "./openapi-zod.js";
import { openApiRegistry } from "./openapi.js";

// Mirrors the body written by problemHandler. "errors" is sent only for request
// validation failures. This module is the single registration of the component.
export const problemSchema = openApiRegistry.register(
  "Problem",
  z.object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
    requestId: z.string(),
    errors: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
);

export const problemContent = {
  "application/problem+json": { schema: problemSchema },
};
