import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import {
  mobileSignInResponseSchema,
  sessionIdentitySchema,
  signInRequestSchema,
  webSignInResponseSchema,
} from "./authentication.schemas.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
} from "./session-cookie.js";
import type { AuthenticationService } from "./authentication.service.js";
import { challengeUnauthorized, readCredential } from "./session-credential.js";
import "./authentication.openapi.js";

export function createAuthenticationRouter(
  service: AuthenticationService,
): ExpressRouter {
  const router = Router();

  router.post("/login", async (request, response) => {
    // A ZodError reaches problemHandler and becomes the 400 validation problem.
    const input = signInRequestSchema.parse(request.body);
    const result = await service.signIn(input.email, input.password);
    if (input.client === "web") {
      const body = webSignInResponseSchema.parse({ user: result.user });
      response
        .cookie(SESSION_COOKIE_NAME, result.accessToken, SESSION_COOKIE_OPTIONS)
        .set("Cache-Control", "no-store")
        .json(body);
      return;
    }
    const body = mobileSignInResponseSchema.parse({
      ...result,
      tokenType: "Bearer",
    });
    response.set("Cache-Control", "no-store").json(body);
  });

  router.get("/me", async (request, response) => {
    const identity = await service.identify(readCredential(request).token);
    const body = sessionIdentitySchema.parse(identity);
    response.set("Cache-Control", "no-store").json(body);
  });

  router.post("/logout", async (request, response) => {
    const { token, fromCookie } = readCredential(request);
    await service.signOut(token);
    // A Bearer sign-out must not clear a cookie that may hold another session.
    if (fromCookie) {
      response.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
    }
    response.status(204).send();
  });

  // Only the session routes announce the scheme; sign-in failures do not.
  router.use(["/me", "/logout"], challengeUnauthorized);

  return router;
}
