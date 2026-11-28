import type { ErrorRequestHandler, Request } from "express";

import { HttpProblem } from "../../shared/http/problem.js";
import { bearerAuthorizationSchema } from "./authentication.schemas.js";
import { authenticationRequired } from "./authentication.service.js";
import { readSessionCookie } from "./session-cookie.js";

// A present Authorization header, even an invalid one, is the only source: there
// is no fallback to the cookie.
export function readCredential(request: Request): {
  token: string;
  fromCookie: boolean;
} {
  const { authorization, cookie } = request.headers;
  if (authorization !== undefined) {
    const parsed = bearerAuthorizationSchema.safeParse(authorization);
    if (!parsed.success) throw authenticationRequired();
    return { token: parsed.data, fromCookie: false };
  }
  const token = readSessionCookie(cookie);
  if (!token) throw authenticationRequired();
  return { token, fromCookie: true };
}

export const challengeUnauthorized: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (error instanceof HttpProblem && error.status === 401) {
    response.set("WWW-Authenticate", "Bearer");
  }
  next(error);
};
