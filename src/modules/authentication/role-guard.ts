import type { RequestHandler } from "express";

import type { Role } from "../../shared/database/generated/enums.js";
import { HttpProblem } from "../../shared/http/problem.js";
import { setRequestIdentity } from "../../shared/http/request-identity.js";
import type { AuthenticationService } from "./authentication.service.js";
import { challengeUnauthorized, readCredential } from "./session-credential.js";

// Authentication comes first and renews the session; the role is checked after,
// so a forbidden request still counts as session use.
export function createRoleGuard(
  service: Pick<AuthenticationService, "identify">,
) {
  return (...allowedRoles: [Role, ...Role[]]): RequestHandler =>
    async (request, response, next) => {
      try {
        const { id, role, erpSellerName } = await service.identify(
          readCredential(request).token,
        );
        if (!allowedRoles.includes(role)) {
          throw new HttpProblem(
            403,
            "Forbidden",
            "Your role does not allow this operation.",
          );
        }
        setRequestIdentity(response, { id, role, erpSellerName });
        next();
      } catch (error) {
        challengeUnauthorized(error, request, response, next);
      }
    };
}
