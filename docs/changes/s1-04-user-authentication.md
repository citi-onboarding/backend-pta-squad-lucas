---
change_id: s1-04-user-authentication
date: 2026-11-27
status: in-progress
owners: [João]
tags: [security, authentication, session, api, sprint-1]
related_adrs: [ADR-0004]
openspec_change: openspec/changes/s1-04-user-authentication/
---

# User authentication (F01, backend, first part)

## Objective

Let a registered user sign in with email and password, read the identity of the current session and sign out, backed by a revocable opaque token bound to a stored session. This is the backend authentication part of F01 (card S1-04) only: no RBAC, screens, invitations or user administration.

## Change made

- New `authentication` module with `POST /api/v1/auth/login`, `GET /api/v1/auth/me` and `POST /api/v1/auth/logout`, wired in `src/app/create-app.ts`.
- Additive migration `20261127120000_s1_04_session_token_digest`: nullable, unique `sessions.token_digest`. João relayed Benjamim's authorization to create it. No applied migration was edited.
- A 256-bit random credential; only its SHA-256 digest is stored.
- Sign-in opens the session and records `lastLoginAt` in one transaction; the date only moves forward.
- Session use is checked and renewed by conditional atomic updates with an injected clock. They are parameterized raw SQL, because Prisma cannot express `GREATEST`.
- Unknown emails are compared against a public dummy bcrypt hash of the same cost.
- Shared change, affecting every route: the problem handler turns an unparseable JSON body into a `400` Problem Details and no longer logs that error, which carried the raw body.
- `openapi.json` documents the three routes, `bearerAuth`, `cookieAuth` and the response headers. The authentication `400`/`401` responses reference the shared `Problem` component (`src/shared/http/problem-openapi.ts`), its single registration.

## Resulting behavior

- Valid credentials, with the email exactly as registered, open a distinct session and record the last login date.
- `client: "web"` receives the identity and the `__Host-session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`); the body has no credential.
- `client: "mobile"` receives the identity and a Bearer credential, without a cookie.
- A present `Authorization` header is the only credential source; otherwise the cookie is used.
- Unknown email and wrong password receive the same `401`. Invalid or unparseable sign-in bodies receive `400`.
- `me` returns id, name, email, role and the ERP seller name (`null` without one), from local data.
- A session expires 8 hours after its last use; each authenticated request renews it.
- Sign-out ends only the current session at once; it clears the cookie only when the cookie authenticated the request.
- `401` responses of `me` and sign-out carry `WWW-Authenticate: Bearer`; successful sign-in and `me` responses carry `Cache-Control: no-store`.

## Impact

- **API:** three new routes; no existing route changes its contract. Unparseable JSON on any route now receives `400` instead of `500`.
- **Database:** one new column and unique index. Rollback needs a corrective migration and ends open sessions.
- **Clients:** web and mobile were not changed. `SameSite=Strict` assumes that web and API share a registrable domain.
- **Security:** a script already running in the web page could request the `mobile` variant. Sign-in has only the global rate limit.
- **Operations:** one database write per authenticated request; expired session rows accumulate.

## Validations executed

**Update after the OpenAPI fix (task 8.1):** its Red failed `4` of `4` cases. After the Green, the focused OpenAPI tests reported `5 passed`, and `pnpm verify` (unit `59 passed (59)`) and `pnpm format:check` passed. The other rows below predate this metadata change and were not rerun.

Run on 2026-11-27 on branch `S1-04-auth-roles` (base `53aea63`, uncommitted tree), with Docker available.

| Command                                                                                     | Result                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                         | `All matched files use Prettier code style!` (run before this document was written)                                                                                                 |
| `pnpm verify`                                                                               | No errors: `tsc --noEmit`, `eslint .`, unit `55 passed (55)`, architecture `3 passed (3)`, `openspec validate --all --strict` `3 passed, 0 failed`, `openapi:check`, `skills:check` |
| `pnpm test:coverage`                                                                        | `55 passed (55)`; statements 95.55%, branches 95.45%, functions 92.85%, lines 95.45%. The coverage configuration includes only `src/shared`, so it does not measure the module      |
| `pnpm test:integration`                                                                     | `Test Files 8 passed (8)`, `Tests 82 passed (82)`                                                                                                                                   |
| `pnpm test:container`                                                                       | `Production container smoke test passed.`; the 3 migrations were applied                                                                                                            |
| `pnpm build`                                                                                | `tsc --noEmit` and `tsc -p tsconfig.build.json` completed with no errors                                                                                                            |
| `./node_modules/.bin/openspec validate s1-04-user-authentication --strict --no-interactive` | `Change 's1-04-user-authentication' is valid`                                                                                                                                       |
| `pnpm openapi:check`                                                                        | No errors                                                                                                                                                                           |

Before the container test, no container or network with the script's fixed names, and no image with its two tags, existed. The script removes its containers and network; the images `node-boilerplate:smoke` and `node-boilerplate:migration-smoke` remain locally.

### Red evidence and regression coverage

Commands and outputs are in `tasks.md`.

- **Red:** seller session lifecycle; last login date is recorded; unparseable body is rejected without being logged; unknown email still performs a password comparison; rejections announce the authentication scheme; session used within 8 hours stays valid; session idle for 8 hours expires; renewal on successful sign-out (requirement text); web sign-in sets the cookie; successful responses forbid caching (reached through the mobile responses).
- **Blocked in the web Red at sign-in, later steps not reached until Green:** web client reads identity with the cookie; web sign-out clears the cookie; header precedence over a valid cookie.
- **Regression coverage (passed on the first run):** the other sign-in, rejection, validation and identity scenarios; activity beyond 8 hours; activity keeps the last login date; mobile delivery without a cookie; the four secrecy and ERP-independence scenarios.

Not asserted by an automated test: sign-in transaction atomicity and equality of its timestamps; forward-only updates and concurrency; rejection of an unknown user when the verifier returns `true`; absence of `WWW-Authenticate` on the sign-in `401`; absence of `Set-Cookie` on a Bearer sign-out. The ERP test intercepts only `fetch`; the project has no ERP client or configuration.

## Related artifacts

- [Proposal](../../openspec/changes/s1-04-user-authentication/proposal.md)
- [Specification](../../openspec/changes/s1-04-user-authentication/specs/user-authentication/spec.md)
- [Design](../../openspec/changes/s1-04-user-authentication/design.md)
- [Tasks](../../openspec/changes/s1-04-user-authentication/tasks.md)
- [ADR-0004](../adr/0004-opaque-session-authentication.md), status `proposed`

**ADR evaluation:** required (durable contract, new data column and security invariants), and covered by ADR-0004. Only the credential type was decided, by João; the rest has no recorded institutional acceptance, so the status stays `proposed`. The shared parser-error handling is a local security fix recorded here; no further ADR was created.

## Usage

Apply the migrations, then call sign-in with `{ "email", "password", "client": "web" | "mobile" }`. Web clients send requests with credentials so that the cookie is included; the mobile app sends `Authorization: Bearer <credential>`.

## Implementation notes

ADR number, resolved: `develop` on GitHub already uses `0001`, `0002` (ERP) and `0003` (synchronization), as checked by the coordinator with `gh` (not verified by the agent), so this ADR was renumbered to `0004` with its content and `proposed` status unchanged. This branch was not rebased or merged, and its ADR index does not copy the entries of `develop`.

Pending before archiving:

- **Acceptance:** task 1.1 (proposal, specification, design and ADR) has no recorded acceptance.
- **Product decision:** letter-case and surrounding-whitespace variants of the email (task 1.4).
- **Follow-up:** the configurable 24-hour absolute maximum is not enforced; its activation depends on Lucas and the client.
- Archiving requires its own explicit confirmation.
