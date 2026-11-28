import { z } from "../../shared/http/openapi-zod.js";
import { openApiRegistry } from "../../shared/http/openapi.js";
import { problemContent } from "../../shared/http/problem-openapi.js";
import {
  mobileSignInResponseSchema,
  sessionIdentitySchema,
  signInRequestSchema,
  webSignInResponseSchema,
} from "./authentication.schemas.js";
import { SESSION_COOKIE_NAME } from "./session-cookie.js";

const cookieAuth = openApiRegistry.registerComponent(
  "securitySchemes",
  "cookieAuth",
  {
    type: "apiKey",
    in: "cookie",
    name: SESSION_COOKIE_NAME,
    description:
      "Session cookie set by web sign-in. Ignored when an Authorization header is sent.",
  },
);

const cacheControlHeader = {
  description: "Identity and credential responses are never cached.",
  schema: { type: "string" as const, enum: ["no-store"] },
};

const bearerAuth = openApiRegistry.registerComponent(
  "securitySchemes",
  "bearerAuth",
  {
    type: "http",
    scheme: "bearer",
    description: "Opaque session credential returned by mobile sign-in.",
  },
);

openApiRegistry.register("SessionIdentity", sessionIdentitySchema);
openApiRegistry.register("MobileSignInResponse", mobileSignInResponseSchema);
openApiRegistry.register("WebSignInResponse", webSignInResponseSchema);

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/auth/login",
  tags: ["Authentication"],
  summary: "Sign in with email and password",
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: signInRequestSchema } },
    },
  },
  responses: {
    200: {
      description:
        "Session opened. Web: identity only, credential in the cookie. Mobile: identity and Bearer credential, no cookie.",
      headers: {
        "Cache-Control": cacheControlHeader,
        "Set-Cookie": {
          description: `Web only: ${SESSION_COOKIE_NAME} with HttpOnly, Secure, SameSite=Strict and Path=/, without Domain.`,
          schema: { type: "string" as const },
        },
      },
      content: {
        "application/json": {
          schema: z.union([
            webSignInResponseSchema,
            mobileSignInResponseSchema,
          ]),
        },
      },
    },
    400: { description: "Invalid request", content: problemContent },
    401: {
      description: "Email or password is incorrect",
      content: problemContent,
    },
  },
});

const unauthorizedSessionResponse = {
  description: "Authentication is required",
  content: problemContent,
  headers: {
    "WWW-Authenticate": {
      description: "Authentication scheme expected by the route.",
      schema: { type: "string" as const, enum: ["Bearer"] },
    },
  },
};

openApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/auth/me",
  tags: ["Authentication"],
  summary: "Read the identity of the current session",
  security: [{ [bearerAuth.name]: [] }, { [cookieAuth.name]: [] }],
  responses: {
    200: {
      description: "Session identity",
      headers: { "Cache-Control": cacheControlHeader },
      content: { "application/json": { schema: sessionIdentitySchema } },
    },
    401: unauthorizedSessionResponse,
  },
});

openApiRegistry.registerPath({
  method: "post",
  path: "/api/v1/auth/logout",
  tags: ["Authentication"],
  summary: "End the current session",
  security: [{ [bearerAuth.name]: [] }, { [cookieAuth.name]: [] }],
  responses: {
    204: {
      description: "Session ended",
      headers: {
        "Set-Cookie": {
          description:
            "Sent only when the cookie authenticated the request: expires the session cookie.",
          schema: { type: "string" as const },
        },
      },
    },
    401: unauthorizedSessionResponse,
  },
});
