import { createHash, timingSafeEqual } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { HttpProblem } from "./problem.js";

// Decides whether a request comes from an administrator. Login (F01) will replace
// the recognizer below with a session check; endpoints keep using requireAdmin.
export type AdminRecognizer = (request: Request) => boolean | Promise<boolean>;

const BEARER_PATTERN = /^Bearer (\S+)$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function requireAdmin(recognizer: AdminRecognizer): RequestHandler {
  return async (request, response, next) => {
    try {
      if (await recognizer(request)) {
        next();
        return;
      }
      response.setHeader("WWW-Authenticate", "Bearer");
      next(
        new HttpProblem(
          401,
          "Unauthorized",
          "Administrator credentials are required.",
        ),
      );
    } catch (error) {
      next(error);
    }
  };
}

// Stopgap until F01: a static bearer token. With no token configured nobody is an
// administrator. Digests have a fixed length, so the comparison never depends on
// the length of what the caller sent.
export function createBearerTokenRecognizer(
  token: string | undefined,
): AdminRecognizer {
  const expected = token === undefined ? undefined : digest(token);
  return (request) => {
    const match = BEARER_PATTERN.exec(request.get("authorization") ?? "");
    if (expected === undefined || match?.[1] === undefined) {
      return false;
    }
    return timingSafeEqual(digest(match[1]), expected);
  };
}
