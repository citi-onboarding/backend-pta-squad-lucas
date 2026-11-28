## Context

See `proposal.md` for motivation. Today `createAdminSessionGuard` (authentication module) calls `identify`, which authenticates and renews the session, then refuses any role other than `ADMIN` and discards the identity. `src/app/create-app.ts` injects it into the synchronization router and the user administration router. Modules must not import other modules, and `src/shared` must not import application layers.

## Goals / Non-Goals

**Goals:** one guard for any set of roles; a typed way for any module to read the identity without importing `authentication`.

**Non-Goals:** permissions finer than roles, portfolio filtering, and changes to routers' injection options.

## Decisions

### D1. A guard factory built once in `src/app`

`createRoleGuard(authenticationService)` returns `requireRole(...roles)`, which returns an Express handler. The parameter type requires at least one role, so an empty list does not compile. It stays in the `authentication` module and replaces `admin-session-guard.ts`; `create-app.ts` passes `requireRole("ADMIN")` to both existing routers, whose `adminGuard` option is unchanged. A future router receives its guard the same way.

Rejected: one named guard per role set (grows with every combination); moving the guard to `src/shared` (it needs the authentication service, and each router would have to build it).

### D2. Identity contract in `src/shared/http`

A new `src/shared/http/request-identity.ts` defines `RequestIdentity` (`id`, `role`, `erpSellerName: string | null`), a writer used only by the guard and `getRequestIdentity(response)` for handlers. The value lives in `response.locals`. The reader throws an unexpected error when the value is absent, which the problem handler turns into a generic `500`. Only these three fields are exposed: name and email are not needed to authorize and stay out of handler scope.

Rejected: augmenting the Express `Request` type, which would declare the identity present on every route, including public ones.

### D3. One neutral `403` detail

The detail becomes `Your role does not allow this operation.`; status and title are unchanged. The OpenAPI response descriptions of the six administrator operations stay, because they are still accurate, so `openapi.json` does not change. No client displays server text.

Rejected: a detail built from the allowed roles (tells a refused caller who is allowed, for no client need); keeping the administrator text for every guard (wrong for other roles).

### D4. How the Red avoids an import failure

The tests exercise an interface that does not exist yet, and a missing module is not a valid Red. The Red step adds only the two signatures, with bodies that always fail: the guard answers every request with an unexpected error and the identity reader throws. The tests then fail on their assertions. These stubs carry no behavior and are replaced in the Green.

Rejected: writing the tests against a missing module and counting the import error as Red.

### D5. How the new behavior is tested

No production operation is restricted to another role yet. The integration test builds a small Express application with the real `AuthenticationService` and repository on PostgreSQL, a controlled clock, test-only operations and the real problem handler. The existing administrator tests stay unchanged and cover the six real operations.

## Risks / Trade-offs

- [A handler is mounted without a guard and never reads the identity] → it stays public; the identity check cannot catch this. Each feature keeps its own `401`/`403` test.
- [The change grows pull request #15, already open] → it has no review yet; the change is small and has its own specification and evidence.
- [The contract list branch was written against no guard] → after the merge it rebases and uses `requireRole("MANAGER")`.

## Migration Plan

No deployment step and no database change. Rollback is a revert.
