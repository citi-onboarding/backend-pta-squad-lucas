import type { CookieOptions } from "express";

import { sessionTokenSchema } from "./authentication.schemas.js";

export const SESSION_COOKIE_NAME = "__Host-session";

// The __Host- prefix requires Secure, Path=/ and no Domain. Without Max-Age the
// cookie lasts for the browser session; expiry is enforced by the server.
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
};

export function readSessionCookie(
  header: string | undefined,
): string | undefined {
  const prefix = `${SESSION_COOKIE_NAME}=`;
  const pair = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  const parsed = sessionTokenSchema.safeParse(pair?.slice(prefix.length));
  return parsed.success ? parsed.data : undefined;
}
