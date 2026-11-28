import type { RequestHandler } from "express";

import { HttpProblem } from "../../shared/http/problem.js";
import type { AuthenticationService } from "./authentication.service.js";
import { challengeUnauthorized, readCredential } from "./session-credential.js";

// Authentication comes first and renews the session; the role is checked after,
// so a forbidden request still counts as session use.
export function createAdminSessionGuard(
  service: Pick<AuthenticationService, "identify">,
): RequestHandler {
  return async (request, response, next) => {
    try {
      const identity = await service.identify(readCredential(request).token);
      if (identity.role !== "ADMIN") {
        throw new HttpProblem(
          403,
          "Forbidden",
          "Administrator role is required.",
        );
      }
      next();
    } catch (error) {
      challengeUnauthorized(error, request, response, next);
    }
  };
}
