import { z } from "../../shared/http/openapi-zod.js";
import { openApiRegistry } from "../../shared/http/openapi.js";
import {
  problemContent,
  problemSchema,
} from "../../shared/http/problem-openapi.js";
import {
  acceptInvitationRequestSchema,
  availableErpSellerNamesSchema,
  invitationLookupSchema,
  invitationTokenRequestSchema,
  issuedInvitationSchema,
  registerUserRequestSchema,
  registeredUserSchema,
  userIdParamsSchema,
  userListItemSchema,
  userListSchema,
} from "./user-administration.schemas.js";

// The schemes are registered by the owner of authentication; only their names
// are referenced here.
const administratorSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }];
const administratorErrors = {
  401: {
    description: "Administrator credentials are required",
    content: problemContent,
  },
  403: {
    description: "Administrator role is required",
    content: problemContent,
  },
};
const noStore = {
  "Cache-Control": {
    description: "Responses that carry a token are never cached.",
    schema: { type: "string" as const, enum: ["no-store"] },
  },
};
const validationError = {
  description: "The request did not satisfy the expected contract",
  content: problemContent,
};

openApiRegistry.register("UserListItem", userListItemSchema);
const registrationConflictSchema = openApiRegistry.register(
  "RegistrationConflictProblem",
  problemSchema.extend({ conflictField: z.enum(["email", "erpSellerName"]) }),
);

openApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/users",
  tags: ["User administration"],
  summary: "List users with their account status (administrators only)",
  security: administratorSecurity,
  responses: {
    ...administratorErrors,
    200: {
      description: "Users ordered by name",
      content: { "application/json": { schema: userListSchema } },
    },
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/users",
  tags: ["User administration"],
  summary:
    "Register a user and issue the first invitation (administrators only)",
  security: administratorSecurity,
  request: {
    body: {
      content: { "application/json": { schema: registerUserRequestSchema } },
    },
  },
  responses: {
    ...administratorErrors,
    201: {
      description: "User registered; the token is shown only in this response",
      headers: noStore,
      content: { "application/json": { schema: registeredUserSchema } },
    },
    400: validationError,
    409: {
      description:
        "Email or ERP seller name already used; conflictField names which",
      content: {
        "application/problem+json": { schema: registrationConflictSchema },
      },
    },
  },
});

openApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/users/erp-seller-names",
  tags: ["User administration"],
  summary:
    "List ERP seller names not yet linked to a user (administrators only)",
  security: administratorSecurity,
  responses: {
    ...administratorErrors,
    200: {
      description: "Names in alphabetical order",
      content: {
        "application/json": { schema: availableErpSellerNamesSchema },
      },
    },
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/users/{userId}/invitations",
  tags: ["User administration"],
  summary:
    "Issue a new invitation for a user without a password (administrators only)",
  security: administratorSecurity,
  request: { params: userIdParamsSchema },
  responses: {
    ...administratorErrors,
    201: {
      description:
        "Invitation issued; earlier invitations stop working and the token is shown only here",
      headers: noStore,
      content: { "application/json": { schema: issuedInvitationSchema } },
    },
    400: validationError,
    404: { description: "User not found", content: problemContent },
    409: {
      description: "The user already has a password",
      content: problemContent,
    },
  },
});

const unusableInvitation = {
  description: "The invitation is unknown, used, replaced or expired",
  headers: noStore,
  content: problemContent,
};

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/invitations/lookup",
  tags: ["User invitation"],
  summary: "Look up an invitation by its token (public)",
  request: {
    body: {
      content: {
        "application/json": { schema: invitationTokenRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Usable invitation; it is not consumed",
      headers: noStore,
      content: { "application/json": { schema: invitationLookupSchema } },
    },
    400: validationError,
    404: unusableInvitation,
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/invitations/accept",
  tags: ["User invitation"],
  summary: "Accept an invitation by setting a password (public)",
  request: {
    body: {
      content: {
        "application/json": { schema: acceptInvitationRequestSchema },
      },
    },
  },
  responses: {
    204: {
      description: "Password set; no session is opened",
      headers: noStore,
    },
    400: validationError,
    404: unusableInvitation,
  },
});
