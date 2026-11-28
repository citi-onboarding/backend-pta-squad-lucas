## Context

See `proposal.md` (Why) and `specs/role-authorization/spec.md`. Base: `origin/develop` `b161161` plus the uncommitted authentication change.

- `createErpSyncRouter` receives `adminGuard: RequestHandler`; it guards only `GET /runs` and `POST /run`. `GET /status` is unguarded.
- `src/app/create-app.ts` builds the guard with `requireAdmin(createBearerTokenRecognizer(environment.ADMIN_API_TOKEN))` (`src/shared/http/require-admin.ts`). `AdminRecognizer` returns a boolean, so it cannot tell "unauthenticated" from "forbidden".
- A recognizer failure currently yields a generic `500` and the route is not reached.
- `ERP_SYNC_ENABLED=false` only stops the scheduler wiring; the routes stay mounted and a manual run stays available. This change keeps that.
- The authentication module resolves the Bearer or cookie credential inside its router and renews the session through `AuthenticationService.identify`.
- Consumers of `ADMIN_API_TOKEN`: `config/env.ts` (optional, at least 32 characters), the guard in `create-app.ts`, tests (`require-admin.test.ts`, `env.test.ts`, `create-app-erp-sync.test.ts`, `test-environment.ts`), `.env.example` and the manual usage in `docs/changes/s1-03-erp-sync.md`.

## Goals / Non-Goals

**Goals:** replace how the existing guard decides, without changing the ERP routes; one credential resolution for authentication and authorization.

**Non-Goals:** other routes, a general permission model, changes to the ERP module's behavior.

## Decisions

### D1. Replace the token recognizer; no coexistence

Recorded direction: `s1-03-erp-sync` design D4 ("Until F01 [...] F01 later swaps the recognizer for 'session user has role ADMIN' and changes no endpoint"), its risk "replaced by F01; documented as temporary", and ADR 0003 decision 8.
_Rejected:_ accepting both for a transition — keeps a shared, non-expiring, non-revocable secret and has no recorded end. If the team needs a transition for a consumer outside the repository, the spec changes first.

### D2. The authentication module exports the guard; `src/app` injects it

The module gains a factory that returns a `RequestHandler`: it reuses the same credential resolution as `me` (moved out of the router into the module, not duplicated), calls `identify`, and requires role `ADMIN`. `create-app.ts` passes it as `adminGuard`. The ERP module imports nothing new, and no module imports another.
`401` is the existing `authenticationRequired` problem plus `WWW-Authenticate: Bearer`; `403` is `HttpProblem(403, "Forbidden", "Administrator role is required.")`. Unexpected errors go to `next`, keeping the generic `500`.
_Rejected:_ extending `AdminRecognizer` to three outcomes in `src/shared` — shared code would still need the credential rules owned by the module. _Rejected:_ parsing the credential again in `src/app` — two rules that can diverge.

### D3. `require-admin.ts`

After the swap, production no longer uses it. Its removal, with its tests, is evaluated in the Refactor phase; the `s1-03-erp-sync` requirement "Replaceable recognition of administrators" stays satisfied by the injected guard.

### D4. Specification reconciliation

`admin-access` exists only in the active `s1-03-erp-sync`, as an `ADDED` delta, so a `MODIFIED` delta here would have no base. After João approved this specification, that delta was corrected in place: it now defers access, `401`, `403` and refusal secrecy to `role-authorization`, and keeps the requirements still in force (replaceable guard, startup validation and secrecy of `ADMIN_API_TOKEN`). No later `MODIFIED` delta is needed for this conflict. The `erp-sync` specification was checked and left unchanged: its `401` scenarios concern calls without credentials. The proposal, design, tasks and summary of `s1-03-erp-sync`, other than its Usage section, and ADR 0003 stay as historical evidence and still describe the static token.
_Constraint:_ archive `s1-03-erp-sync` and this change together or in that order, since `admin-access` refers to `role-authorization`.
_Rejected:_ waiting for the archive of `s1-03-erp-sync` — it would leave two conflicting specifications in force.

### D5. Tests

The ERP app tests that expect the token to work describe the superseded rule and are rewritten in the Red phase, keeping the service double and every non-credential assertion. New behavior is proven with the real `createApp` and PostgreSQL, with real users and sessions and a service double only for the ERP service. Cookie requests to `POST /run` rely on the existing `SameSite=Strict` and CORS posture.

### D6. ADR

Evaluated at consolidation: the change establishes a security invariant. ADR 0003 is not edited; ADR 0004 already records that `src/app` composes guards from the authentication module.

### D7. A `403` renews the session (approved by João)

Authentication succeeded, so the guard uses `identify` unchanged, which renews `lastUsedAt` and never touches `lastLoginAt`; the role is checked afterwards.
_Rejected:_ not renewing — it needs a second way to validate a session without renewing it.

## Risks / Trade-offs

- [A consumer outside the repository uses the token] → Not verifiable here; announce before release. Rollback is restoring the previous guard in `create-app.ts`.
- [No administrator user in a deployment] → The routes are unusable until one exists; user administration is out of scope, the seed has one test administrator.
- [`ADMIN_API_TOKEN` stays parsed but grants nothing] → May mislead operators; see Pending Decisions.

## Migration Plan

No database migration. Release the authentication change first or together, confirm an administrator can sign in, then release this guard.

## Pending Decisions

- **Fate of `ADMIN_API_TOKEN`** (remove the setting and its startup validation, or keep it ignored for a period). Not blocking: this change does not touch its parsing.
- **`GET /api/v1/sync/status` requiring a session:** recommended by `s1-03-erp-sync`, not decided here and not part of this change.
