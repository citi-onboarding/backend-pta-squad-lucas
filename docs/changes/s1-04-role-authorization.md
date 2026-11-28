---
change_id: s1-04-role-authorization
date: 2026-11-27
status: in-progress
owners: [João]
tags: [security, authorization, roles, erp-sync, sprint-1]
related_adrs: [ADR-0003, ADR-0004]
openspec_change: openspec/changes/archive/2026-11-27-s1-04-role-authorization/
---

# Role authorization for the administrator synchronization routes

## Objective

Replace the stopgap static token of the two administrator-only ERP routes with a signed-in session of a user with role `ADMIN`. This is a first slice of F01 authorization, not a general permission model.

## Change made

- `createAdminSessionGuard` in the authentication module is injected by `src/app/create-app.ts` as the ERP router's `adminGuard`; no module imports another.
- The credential resolution moved to `session-credential.ts`, shared by the authentication routes and the guard.
- `src/shared/http/require-admin.ts` and its tests were deleted.
- The OpenAPI of the two routes declares `bearerAuth`/`cookieAuth` and Problem Details `401` and `403`; `openapi.json` was regenerated.
- Usage instructions updated in `.env.example` and in the Usage section of the `s1-03-erp-sync` summary. No database migration.

## Resulting behavior

- `GET /api/v1/sync/runs` and `POST /api/v1/sync/run` run only for a valid `ADMIN` session, by Bearer or cookie. Success payloads, `400` and `409` are unchanged.
- A present `Authorization` header is the only source, even with a valid cookie.
- Missing, malformed, unknown, signed-out or expired credentials, and the legacy static token, get `401` with `WWW-Authenticate: Bearer`.
- `SELLER`, `MANAGER` and `FINANCE` get `403` and no synchronization operation runs. The request renews the session and does not change the last login date. Unauthenticated requests renew nothing.
- A failure while reading the session gets a generic `500` and no operation runs.
- `GET /api/v1/sync/status` stays public. `ERP_SYNC_ENABLED` and the scheduler are unchanged.

## Impact

- **Breaking:** callers using `ADMIN_API_TOKEN` must sign in as an administrator. No automated consumer was found in the repository; consumers outside it were not verified.
- **Configuration:** `ADMIN_API_TOKEN` is still parsed and validated at startup and grants nothing.
- **Operations:** a deployment needs an `ADMIN` user; user administration is not part of this change. Release together with, or after, `s1-04-user-authentication`.
- **Clients:** web and mobile were not changed.

## Validations executed

Run on 2026-11-27 in the integration worktree (`origin/develop` `b161161` plus the uncommitted authentication and authorization changes), with Docker available, before this documentation was written.

| Command                                                                                    | Result                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                        | `All matched files use Prettier code style!`                                                                                                             |
| `pnpm verify`                                                                              | No errors: `tsc --noEmit`, `eslint .`, unit `310 passed (310)`, architecture `3 passed (3)`, specs `6 passed, 0 failed`, `openapi:check`, `skills:check` |
| `pnpm test:coverage`                                                                       | `310 passed (310)`; statements 98.33%, branches 96.63%, functions 97.67%, lines 98.27% (coverage includes only `src/shared`)                             |
| `pnpm test:integration`                                                                    | `Test Files 10 passed (10)`, `Tests 108 passed (108)`                                                                                                    |
| `pnpm test:container`                                                                      | `Production container smoke test passed.`; 4 migrations applied, in order `..._s1_03_sync_result_rate_limited` then `..._s1_04_session_token_digest`     |
| `pnpm build` and `pnpm typecheck`                                                          | No errors                                                                                                                                                |
| `./node_modules/.bin/openspec validate s1-04-role-authorization --strict --no-interactive` | `Change 's1-04-role-authorization' is valid`                                                                                                             |

Before the container test no container or network with the script's fixed names existed. The two image tags already existed, left by the earlier authentication smoke test, and were rebuilt; the images remain locally. The script uses a fake ERP URL and key with synchronization disabled; no real ERP was called.

### Red evidence and regression coverage

Details are in `tasks.md`.

- **Red:** `ADMIN` access, `403` for the other roles with session renewal, refusal of the static token, and the API description.
- **Regression coverage:** `401` cases, public status, cookie access, header precedence and the safe `500` on session lookup failure.
- Not asserted: what is logged on the lookup failure.

## Related artifacts

- [Proposal](../../openspec/changes/archive/2026-11-27-s1-04-role-authorization/proposal.md)
- [Canonical specification](../../openspec/specs/role-authorization/spec.md)
- [Design](../../openspec/changes/archive/2026-11-27-s1-04-role-authorization/design.md)
- [Tasks](../../openspec/changes/archive/2026-11-27-s1-04-role-authorization/tasks.md)
- [ADR-0003](../adr/0003-erp-sync-strategy.md), status `proposed`
- [ADR-0004](../adr/0004-opaque-session-authentication.md), status `proposed`

**ADR evaluation (design D6):** the change touches a trigger, a security invariant. The decision is already recorded: ADR-0003 decision 8 states that F01 replaces the token with "the session user has role `ADMIN`" without changing the endpoints, and ADR-0004 records that `src/app` composes guards from the authentication module and that authenticated use renews the session. The `403` renewal applies that rule and is specified here. No further ADR was created and neither ADR was edited. Both remain `proposed`; no institutional acceptance is assumed. If the team prefers a dedicated authorization ADR, it needs its own confirmation.

## Usage

Sign in with an `ADMIN` user through `POST /api/v1/auth/login`, then call the two routes with the web cookie or with the Bearer credential of a `mobile` sign-in.

## Implementation notes

- **Specification reconciliation (design D4), done:** before archiving, the `admin-access` `ADDED` delta of `s1-03-erp-sync` was changed to defer access, `401`, `403` and refusal secrecy to `role-authorization`, and to keep the replaceable guard and the startup validation and secrecy of `ADMIN_API_TOKEN`. `erp-sync` needed no change. Historical documents and ADR 0003 still describe the token. Both changes were then archived on 2026-11-27, `s1-03-erp-sync` first, after the four capability specifications were synced to `openspec/specs/`.
- **Open product decisions:** whether `GET /api/v1/sync/status` will require a session; the fate of the `ADMIN_API_TOKEN` setting; email letter-case and whitespace variants (authentication task 1.4); the 24-hour absolute session maximum.
- **Out of scope:** other routes, a general permission model, seller portfolios, invitations, user administration, web and mobile.
- João explicitly approved the complete specification of this change (task 1.1); ADRs 0003 and 0004 stay `proposed`. Archiving was confirmed separately, immediately before it.
- **Pending from `s1-03-erp-sync`:** its task 6.5 (open the web task for the badge and administrator screen) was not done and stays open in the archived tasks.
