import { Role } from "../../shared/database/generated/enums.js";
import { z } from "../../shared/http/openapi-zod.js";

export const registerUserRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    email: z.email().max(254).toLowerCase(),
    role: z.enum(Role),
    // Not trimmed: the exact ERP text is the key that links the seller.
    erpSellerName: z
      .string()
      .refine((value) => value.trim().length > 0, {
        message: "The ERP seller name must not be blank.",
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.role === "SELLER" && value.erpSellerName === undefined) {
      context.addIssue({
        code: "custom",
        path: ["erpSellerName"],
        message: "An ERP seller name is required for a seller.",
      });
    }
    if (value.role !== "SELLER" && value.erpSellerName !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["erpSellerName"],
        message: "Only a seller has an ERP seller name.",
      });
    }
  });

export const userIdParamsSchema = z.strictObject({ userId: z.uuid() });

export const accountStatusSchema = z.enum([
  "ACTIVE",
  "INVITED",
  "INVITATION_EXPIRED",
]);

export const userListItemSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(Role),
  erpSellerName: z.string().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  status: accountStatusSchema,
  invitationExpiresAt: z.iso.datetime().nullable(),
});

export const userListSchema = z.array(userListItemSchema);

export const issuedInvitationSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.iso.datetime(),
});

export const registeredUserSchema = z.strictObject({
  user: userListItemSchema,
  invitation: issuedInvitationSchema,
});

export const availableErpSellerNamesSchema = z.array(z.string());

export const invitationTokenRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
});

export const acceptInvitationRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
  // bcrypt ignores bytes past 72, so the limit is in UTF-8 bytes.
  password: z
    .string()
    .min(8)
    .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
      message: "Password must be at most 72 bytes in UTF-8.",
    }),
});

export const invitationLookupSchema = z.strictObject({
  name: z.string(),
  email: z.string(),
  expiresAt: z.iso.datetime(),
});
