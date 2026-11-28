---
change_id: s1-04-role-guard
date: 2026-11-28
status: in-progress
owners: [João]
tags: [security, authorization, roles, api, sprint-1]
related_adrs: [ADR-0004]
openspec_change: openspec/changes/s1-04-role-guard/
---

# Role guard for any set of roles

## Objective

The only role protection was fixed to `ADMIN` and did not tell the protected operation who was signed in. Give every feature one protection that accepts any declared roles and hands the operation the identity it authorized.

## Change made

- `createRoleGuard(authenticationService)` (`src/modules/authentication/role-guard.ts`) returns `requireRole(...roles)`. At least one role is required by the type. It replaces `admin-session-guard.ts`.
- New `src/shared/http/request-identity.ts`: the `RequestIdentity` type (`id`, `role`, `erpSellerName`), a writer used by the guard and `getRequestIdentity(response)` for operations, so a module reads the identity without importing `authentication`.
- `src/app/create-app.ts` passes `requireRole("ADMIN")` to the synchronization and user administration routers. The routers did not change.

## Resulting behavior

- An operation restricted to one or several roles runs only for a valid session of one of them, by Bearer credential or session cookie.
- Without a valid session: `401` with `WWW-Authenticate: Bearer`, and no session is renewed.
- Any other role: `403`, and the request renews the session without changing the last login date.
- When the session cannot be read: `500` without internal detail.
- An allowed operation receives the id, role and ERP seller name from the same session check. The ERP seller name is `null` for a user without one.
- An operation that reads the identity without a role restriction fails with `500`.

## Impact

- **Access:** unchanged. The six existing administrator operations still allow only `ADMIN`.
- **API:** the `403` detail changes from `Administrator role is required.` to `Your role does not allow this operation.` Status, title, payloads and `openapi.json` are unchanged.
- **Other features:** a future restricted router receives `requireRole(...)` from `src/app`. The contract list can use `requireRole("MANAGER")` after this is merged.
- **Risk:** the identity check protects only operations that read the identity. An operation mounted without a guard that never reads it stays public, so each feature still needs its own `401` and `403` tests.
- **Database, configuration and dependencies:** no change.

## Validations executed

Run on 2026-11-28 on branch `S1-04-auth-roles` (base `5ac8eb9`, uncommitted tree), with Docker available, as `npx -y pnpm@12.5.1 run <script>`.

| Command                                                                            | Result                                                                                                                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                | `All matched files use Prettier code style!`                                                                                                              |
| `pnpm verify`                                                                      | Exit 0: `tsc --noEmit`, `eslint .`, unit `321 passed (321)`, architecture `3 passed (3)`, OpenSpec `10 passed, 0 failed`, `openapi:check`, `skills:check` |
| `pnpm test:coverage`                                                               | `321 passed (321)`; all files: statements 95.69%, branches 95.04%, functions 93.33%, lines 95.55%, above the thresholds                                   |
| `pnpm test:integration`                                                            | `Test Files 15 passed (15)`, `Tests 184 passed (184)`; the existing administrator tests are unchanged                                                     |
| `pnpm build`                                                                       | Exit 0                                                                                                                                                    |
| `./node_modules/.bin/openspec validate s1-04-role-guard --strict --no-interactive` | `Change 's1-04-role-guard' is valid`                                                                                                                      |

`openapi.json` has no difference. `pnpm test:container` was not run: no migration, health check, Docker or delivery change.

Coverage measures only `src/shared` with the unit suite. It is lower than before this change (98.33% statements) because the new `request-identity.ts` is exercised only by the integration test.

**Red:** with only the two signatures in place, `Tests 10 failed (10)`, every failure an assertion. **Green:** `Tests 10 passed (10)` without changing the test. **Refactor:** dispensed, no duplication was introduced. Details are in `tasks.md`.

## Related artifacts

- [Proposal](../../openspec/changes/s1-04-role-guard/proposal.md)
- [Specification delta](../../openspec/changes/s1-04-role-guard/specs/role-authorization/spec.md)
- [Design](../../openspec/changes/s1-04-role-guard/design.md)
- [Tasks](../../openspec/changes/s1-04-role-guard/tasks.md)
- [ADR-0004](../adr/0004-opaque-session-authentication.md), status `proposed`

**ADR evaluation:** `Not applicable` for a new ADR. The change touches a security invariant and a boundary between modules, but both were already decided: ADR-0004 states that other modules never import `authentication`, and that `src/app` composes its guard and puts the resolved principal in the request context. This change applies that rule to any set of roles and introduces no new data contract, dependency or invariant. The shape of the helper and the `403` text are local, reversible choices recorded in the design.

## Usage

```ts
// src/app/create-app.ts
createContractRouter({ service, managerGuard: requireRole("MANAGER") });

// in a restricted operation
const { id, role, erpSellerName } = getRequestIdentity(response);
```

`createContractRouter` is an example of a future router and does not exist yet.

## Implementation notes

- Filtering a seller's data by portfolio (RN-08) is not part of this change, and `Customer.sellerId` is still not filled.
- Not archived: it depends on the code of `s1-04-user-authentication` and `s1-04-user-administration`, both still active, and archiving needs its own confirmation.
