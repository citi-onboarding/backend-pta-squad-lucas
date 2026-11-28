## Context

See `proposal.md` (Why) for motivation and `specs/user-authentication/spec.md` for the required behavior.

Current state on `develop` (`53aea63`):

- `User` stores `email` (unique), `passwordHash` (bcrypt, cost 10), `role` (`SELLER`, `MANAGER`, `FINANCE`, `ADMIN`), `erpSellerName` (unique, optional) and `lastLoginAt` (optional).
- `Session` stores `id` (uuid), `userId`, `createdAt`, `lastUsedAt` and `endedAt`. It has no column able to hold a credential digest.
- `src/shared/security/password.ts` exposes `hashPassword` and `verifyPassword` (bcryptjs). The seed creates the 8 prototype users with lowercase emails, but nothing in the data model guarantees it: `User.email` is `String @unique`, created by `20261125115933_s1_01_data_model` as `TEXT NOT NULL` with a plain, case-sensitive unique index (`users_email_key`), and `user-account-storage` only requires uniqueness. Emails that differ only in letter case or surrounding whitespace can therefore coexist.
- HTTP conventions: routes under `/api/v1`, Zod schemas registered in `openApiRegistry`, `validate()` middleware, `HttpProblem` + `problemHandler` producing RFC 9457 Problem Details, `openapi.json` generated and checked by `pnpm openapi:check`.
- Logging: `pino-http` serializes only request id, method, URL and status; the logger redacts `authorization`, `cookie`, `set-cookie`, `password`, `token` and `accessToken`.
- CORS already allows credentials from the configured origin list; Helmet is active; a global rate limit of 100 requests/minute applies outside tests.
- No cookie-parsing middleware is installed. Express 5 can set and clear cookies natively.

The `s1-01-data-model` change (F02, owned by Benjamim) is merged but not archived; it is not edited here.

## Goals / Non-Goals

**Goals:**

- An authentication module that depends only on `src/shared`, with its persistence, clock, password verifier and token generator injected through interfaces so that the use cases are unit-testable without a database.
- A credential model whose leak from the database alone does not allow impersonation.
- One contract for both clients, differing only in how the credential travels.

**Non-Goals:**

- A reusable authentication guard for other modules (RBAC belongs to a later change; see D11 for the boundary it must respect).
- Enforcing an absolute session maximum (see D9).
- Cleaning up expired session rows.

## Decisions

### D1. Opaque random token bound to a `Session` row (credential type decided by João)

The S1-04 card foresaw `jsonwebtoken`. On 2026-11-27, choosing between "JWT with `Session`" and "opaque token with `Session`", João wrote "vamos usar token opaco". That decision covers the credential type only; the rest of this design is still a proposal (see ADR 0004).
Sign-in creates a `Session` row and a credential of 32 bytes from `crypto.randomBytes` (256 bits), encoded as base64url (43 characters). The credential carries no data; the server resolves it to a session on every request.
_Rejected:_ JWT with `Session` — sliding inactivity and immediate revocation still require reading (and renewing) the `Session` row on every request, so a signed token would not remove the database lookup; it would add a signing key to manage, a dependency (`jsonwebtoken`), algorithm and claim validation, and readable claims in the token, for no gain in this flow. _Rejected:_ stateless JWT without `Session` — cannot be revoked immediately without a deny list. _Rejected:_ using `Session.id` (uuid) as the credential — a database read leak would hand out live credentials, and uuid v4 has only 122 random bits.

### D2. Store only a SHA-256 digest of the credential

The session row keeps `tokenDigest = SHA-256(credential)` as hex, unique and indexed. Lookup is by digest; the credential itself is never persisted.
_Rejected:_ bcrypt/argon2 for the credential — they exist to slow down guessing of low-entropy secrets; a 256-bit random value cannot be guessed, and a salted slow hash prevents indexed lookup (every request would scan sessions). _Rejected:_ HMAC with a server secret — adds secret management for no gain at this entropy level; can be adopted later without contract change.

### D3. Client type is declared in the sign-in body

`POST /api/v1/auth/login` takes `{ email, password, client }` with `client` ∈ `web` | `mobile` (strict object). `web` → credential only in a cookie; `mobile` → credential in the body.
_Rejected:_ inferring the client from `User-Agent` or `Origin` — fragile and untestable. _Rejected:_ two sign-in endpoints — duplicates validation, errors and documentation for one difference.

### D4. Web cookie

Name `__Host-session`; attributes `HttpOnly; Secure; SameSite=Strict; Path=/`; no `Domain`; no `Max-Age` (a browser-session cookie — expiry is enforced by the server, D6). Sign-out answers `Set-Cookie` with the same name and attributes and an expiry in the past. The `__Host-` prefix makes browsers refuse the cookie unless it is `Secure`, has `Path=/` and no `Domain`. Modern browsers treat `http://localhost` as a secure context, so local development keeps working.
The `Cookie` request header is parsed by a small function inside the module (no new dependency); only `__Host-session` is read and validated with Zod.

### D5. Credential resolution order

If an `Authorization` header is present, it is the only source: it must match `Bearer <43 base64url chars>` (scheme case-insensitive), otherwise `401`. Without the header, the `__Host-session` cookie is used. Neither → `401`. Resolution never falls back from a bad header to the cookie, so a client cannot be authenticated by an unintended credential.

### D6. Sliding 8-hour expiry, computed and renewed atomically

A session is valid when `endedAt IS NULL` and `now - lastUsedAt < 8h` (spec: exactly 8 h is expired). Renewal is a single conditional update — `UPDATE sessions SET last_used_at = now WHERE token_digest = $1 AND ended_at IS NULL AND last_used_at > now - 8h` returning the user — so validation and renewal cannot race with a concurrent sign-out. Zero affected rows → `401`. Expired rows are not rewritten (consistent with `s1-01-data-model` D6: expiry is computed, not stored). The idle limit is a constant of the module, not configuration. Time comes from an injected `Clock`, so tests control it.
_Accepted trade-off:_ one write per authenticated request. Throttling renewals (e.g., at most once per minute) is a later optimisation that does not change the contract.

### D7. Identical `401` and timing equalisation

All sign-in failures throw the same `HttpProblem(401, "Unauthorized", "Email or password is incorrect.")`. All me/logout failures throw `HttpProblem(401, "Unauthorized", "Authentication is required.")` and send `WWW-Authenticate: Bearer`. When the email is unknown, the service still runs `verifyPassword` against a fixed dummy bcrypt hash of the same cost, so response time does not reveal whether the email exists. Failures are not logged with the email.

### D8. Sign-in writes and `lastLoginAt`

Sign-in looks the user up by the submitted email exactly as received (no case folding, no trimming), verifies the password and, in one transaction, creates the session (`createdAt = lastUsedAt = now`, `tokenDigest`) and sets `User.lastLoginAt = now`. `me` and `logout` only touch `Session.lastUsedAt`/`endedAt`, never `lastLoginAt`.
Exact lookup is not a product decision about variants: it is only the behavior the literal scenarios need. Tests MUST NOT assert any outcome for letter-case or whitespace variants until the pending decision below is resolved; if normalisation is chosen, its collision rule must be decided too, and the spec updated first. Whatever response the implementation happens to give for a variant (for example a `400` from the email format check or a `401` from the exact lookup) is unspecified and may change when the decision arrives.

### D9. Absolute 24-hour maximum is a follow-up

`Session.createdAt` is kept, so an absolute limit can be added later as one more condition in D6 plus a configuration value. Whether and how it is activated depends on Lucas and the client; this change neither enforces nor promises it.

### D10. HTTP contract

| Route                      | Auth          | Success                                                                       | Errors       |
| -------------------------- | ------------- | ----------------------------------------------------------------------------- | ------------ |
| `POST /api/v1/auth/login`  | none          | `200` `{ user }` + cookie (web) / `{ user, accessToken, tokenType }` (mobile) | `400`, `401` |
| `GET /api/v1/auth/me`      | cookie/Bearer | `200` `user`                                                                  | `401`        |
| `POST /api/v1/auth/logout` | cookie/Bearer | `204` (+ expired cookie for web)                                              | `401`        |

`user` = strict `{ id: uuid, name, email, role: enum, erpSellerName: string | null }`. `tokenType` is the literal `"Bearer"`. Every response is parsed by its Zod schema before sending; the same schemas are registered in `openApiRegistry` (including `cookieAuth` and `bearerAuth` security schemes) and `openapi.json` is regenerated. `200` instead of `201` for sign-in: the session is not an addressable resource.
Responses carrying a credential or identity set `Cache-Control: no-store`.

### D11. Module layout and boundaries

`src/modules/authentication/` with kebab-case files: `authentication.schemas.ts`, `authentication.openapi.ts`, `authentication.router.ts`, `authentication.service.ts` (use cases: sign in, resolve session, sign out), `authentication.repository.ts` (Prisma; implements a `SessionStore`/`UserReader` interface declared in the module), `session-token.ts` (generate + digest), `session-cookie.ts` (parse/serialize). Wiring happens in `src/app/create-app.ts`. The module imports only `src/shared` (`password.ts`, `problem.ts`, `validate.ts`, `openapi*.ts`, the generated Prisma client types).
Future rule (recorded in ADR 0004): when other modules need the authenticated user, `src/app` will build the guard from this module and inject the resolved principal into the request context; other modules will never import `authentication`.

### D12. Logging and secrecy

No new log statements contain request data. The existing serializers keep headers and bodies out of request logs; the redaction list already covers `authorization`, `cookie`, `set-cookie` and `accessToken`. A test captures logs through `createLogger` with an in-memory destination and asserts that no secret appears (spec: Credential secrecy).

### D13. CSRF posture

The cookie is `SameSite=Strict`, sign-in requires a JSON body (`express.json`), sign-out is `POST`, and CORS only allows credentialed requests from the configured origins. No CSRF token is added in this change.

### D14. Tests

- Integration (Testcontainers, full `createApp`): the seller lifecycle, sign-in persistence (`lastLoginAt`, digest only), sliding expiry with a controlled clock, logout revocation, web cookie flow.
- Unit (service with in-memory fakes for store, clock, password verifier and token generator): identical 401, exact email lookup, renewal rules, resolution order.
- A scenario whose test already passes against the unchanged implementation is recorded as regression coverage, not as Red (see `tasks.md`).
- Router (Supertest with a service double): validation `400`, response shapes, cookie attributes, `WWW-Authenticate`.
- OpenAPI test that the three paths are registered and `openapi:check` passes.

## Risks / Trade-offs

- [Migration not yet agreed with Benjamim] → Red does not depend on it; Green of the first cycle does. The column is nullable and additive (see Migration Plan) to minimise impact on F02.
- [`SameSite=Strict` breaks if web and API are served on different sites] → Assumption: web and API share a registrable domain (true for `localhost` in development). If deployment differs, revisit with `SameSite=Lax`/`None` plus CSRF tokens in a new change.
- [A browser script can still request `client: "mobile"` and receive a body credential] → Only an attacker who already runs script in the page can do it; mitigated by Helmet CSP and CORS. Hardening (e.g., refusing `mobile` when an `Origin` header is present) is noted for review, not in scope.
- [One write per authenticated request] → Acceptable at Sprint 1 volume; throttle later without contract change.
- [Global rate limit only] → Brute-force protection on sign-in is limited to 100 requests/minute per IP; login-specific throttling is out of scope.
- [Expired session rows accumulate] → Harmless for correctness; a cleanup job can be added later.
- [Duplicate `Problem` OpenAPI registration with the example module] → Reuse the same component name and shape; if the generator rejects duplicates, move the Problem schema to `src/shared/http` in the Green phase and record it.

## Migration Plan

1. **Coordinate with Benjamim (schema owner of `s1-01-data-model`) before Green of the first cycle.** Proposal to align: add to `Session` the field `tokenDigest String? @unique @map("token_digest")`.
2. Create a new migration `prisma/migrations/<timestamp>_s1_04_session_token_digest/migration.sql` with `ALTER TABLE "sessions" ADD COLUMN "token_digest" TEXT;` and a unique index. The column is nullable, so the migration is additive and safe on databases that already applied `20261125115933_s1_01_data_model`; rows without a digest can never authenticate.
3. No applied migration, seed or existing model field is edited.
4. Rollback: a corrective migration dropping the index and the column; this invalidates every open session (users sign in again) and loses no business data.
5. Deploy order: migrate, then release the API. Clients start using the endpoints only after release.

## Open Questions

- Exact migration name and whether Benjamim prefers to author the migration file; neither changes the spec or the tasks.
- Final production domains of web and API (affects only the risk above, not this cycle).

## Pending Decisions

- **Email letter-case and surrounding-whitespace variants at sign-in** — owner: product owner. Not decided by this change and not blocking the literal scenarios. Options identified: (a) exact match only, variants treated like any other non-matching email; (b) normalise the submitted email (trim and/or case-fold) before lookup. Option (b) also requires a rule for stored emails that collide after normalisation (the case-sensitive unique index allows them) and possibly a corrective, additive migration agreed with Benjamim. Whichever is chosen, the spec is updated first through `/openspec-update-change`.
