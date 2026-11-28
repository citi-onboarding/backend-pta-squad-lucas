import { Role } from "../../shared/database/generated/enums.js";
import { z } from "../../shared/http/openapi-zod.js";

// The client type decides how the credential is delivered: only in a cookie for
// "web", in the response body for "mobile".
export const signInRequestSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
  client: z.enum(["web", "mobile"]),
});

// A 32-byte credential encoded as base64url has exactly 43 characters.
export const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const bearerAuthorizationSchema = z
  .string()
  .regex(/^Bearer [A-Za-z0-9_-]{43}$/i)
  .transform((header) => header.slice("Bearer ".length));

export const sessionIdentitySchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(Role),
  erpSellerName: z.string().nullable(),
});

export const webSignInResponseSchema = z.strictObject({
  user: sessionIdentitySchema,
});

export const mobileSignInResponseSchema = z.strictObject({
  user: sessionIdentitySchema,
  accessToken: z.string().min(1),
  tokenType: z.literal("Bearer"),
});

export type SignInInput = z.infer<typeof signInRequestSchema>;
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
