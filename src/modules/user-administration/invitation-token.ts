import { createHash, randomBytes } from "node:crypto";

const INVITATION_TOKEN_BYTES = 32;

// Opaque token with 256 bits from the operating system CSPRNG.
export function createInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

// Only this digest is stored; the token itself is never persisted.
export function digestInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
