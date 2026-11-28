import type { Response } from "express";

import type { Role } from "../database/generated/enums.js";

// Who the role guard authorized, for the protected operation.
export interface RequestIdentity {
  id: string;
  role: Role;
  erpSellerName: string | null;
}

const LOCALS_KEY = "requestIdentity";

export function setRequestIdentity(
  response: Response,
  identity: RequestIdentity,
): void {
  response.locals[LOCALS_KEY] = identity;
}

// Throws when no role guard ran, so the operation fails instead of running
// without a user.
export function getRequestIdentity(response: Response): RequestIdentity {
  const identity = response.locals[LOCALS_KEY] as RequestIdentity | undefined;
  if (!identity) {
    throw new Error("No role guard ran for this operation.");
  }
  return identity;
}
