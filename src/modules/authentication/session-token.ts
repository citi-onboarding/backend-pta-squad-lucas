import { createHash, randomBytes } from "node:crypto";

const SESSION_TOKEN_BYTES = 32;

// Opaque credential with 256 bits from the operating system CSPRNG.
export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

// Only this digest is stored; the credential itself is never persisted.
export function digestSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
