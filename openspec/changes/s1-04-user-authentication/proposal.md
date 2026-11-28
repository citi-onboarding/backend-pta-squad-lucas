## Why

Every Sprint 1 screen and the field app (F16) need to know who the user is before anything else can be built on top of it. The data model from `s1-01-data-model` already stores users, bcrypt password hashes, roles, the seller ERP name and sessions, but there is no way to sign in, ask "who am I" or sign out. This change delivers the first backend part of F01 (card S1-04): email/password sign-in, session identity and sign-out, backed by an opaque token bound to a stored session. The S1-04 card foresaw `jsonwebtoken`; João chose the opaque token with `Session` instead (credential type only; see ADR 0004).

## What Changes

- New endpoint `POST /api/v1/auth/login`: verifies email and password against the stored bcrypt hash, opens a session and delivers an opaque session credential.
  - The email is matched exactly as registered. The outcome for letter-case or surrounding-whitespace variants is a pending product decision (see `design.md`, Pending Decisions) and is not defined by this change.
  - Web clients receive the credential only in an `HttpOnly` cookie; the response body never contains it.
  - The mobile app (F16) receives the credential in the response body, to be sent back as `Authorization: Bearer <token>`.
  - An unknown email and a wrong password produce the same `401` Problem Details response.
  - A successful sign-in updates the user's last login date.
- New endpoint `GET /api/v1/auth/me`: returns the identity of the current session (id, name, email, role and, for sellers, the ERP seller name). A valid use renews the session's last use.
- New endpoint `POST /api/v1/auth/logout`: ends the current session immediately; the same credential is rejected afterwards. Web clients also get the cookie cleared.
- Sessions expire 8 hours after their last valid use; an expired, ended or unknown credential gets `401`.
- The credential is generated from a cryptographically secure random source; only its digest is stored; it never appears in logs or in web responses readable by JavaScript.
- No client and no part of this flow calls the ERP; the ERP seller name comes from the local user record.
- One new **additive** migration is planned to store the credential digest on `sessions` (to be aligned with Benjamim, the schema owner of `s1-01-data-model`). No applied migration is edited.
- Zod request/response schemas, Problem Details errors and the generated `openapi.json` are updated together.
- New ADR for the cross-cutting authentication decision (opaque session token, per-client delivery, digest storage, sliding expiry).

### Out of scope / Non-goals

- Invitations, user administration, password reset or change.
- RBAC: per-screen and per-endpoint role checks, and protecting existing or future business endpoints.
- Any change to the web or mobile clients; development of F21.
- The configurable absolute session maximum of 24 hours: it is a follow-up whose activation depends on Lucas and the client. This change does not enforce it and makes no promise about its activation policy; it only keeps the data needed for it (session creation time).
- Login-specific throttling or account lockout beyond the existing global rate limit.
- Rewriting the Prisma schema, the seed or any applied migration from `s1-01-data-model`.
- Any ERP call.
- Deciding email normalisation (letter case, surrounding whitespace) or the rule for emails that would collide after it; this belongs to the product owner.

## Capabilities

### New Capabilities

- `user-authentication`: signing in with email and password, delivering a session credential suited to each client, reading the identity of the current session, sliding 8-hour session expiry and immediate sign-out.

### Modified Capabilities

None. `user-account-storage` (still an active change, `s1-01-data-model`) is reused as is and is not modified here.

## Impact

- **Business:** unblocks every Sprint 1 feature that needs a signed-in user; sellers see their identity and ERP seller link, which defines their portfolio.
- **API:** three new endpoints under `/api/v1/auth`, documented in `openapi.json`; no existing endpoint changes. Errors follow RFC 9457 Problem Details.
- **Database:** one new additive migration (new nullable, unique digest column on `sessions`), coordinated with Benjamim. Existing tables, columns and migrations are untouched. Rollback: a corrective migration that drops the column.
- **Security:** opaque random credential, digest-only storage, `HttpOnly`/`Secure`/`SameSite=Strict` cookie for web, Bearer for mobile, identical `401` for unknown email and wrong password, immediate revocation, sliding expiry. No new dependency (`bcryptjs` is already approved and present).
- **Observability:** no credential, cookie, authorization header, password or request body is logged; existing redaction and request serializers stay in force. Authentication failures are not logged with personal data.
- **Documentation:** ADR `0004`, change summary `docs/changes/s1-04-user-authentication.md` at consolidation.
