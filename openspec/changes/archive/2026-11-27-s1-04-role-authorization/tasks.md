## 1. SDD (specification)

- [x] 1.1 João accepts the proposal, spec and design, including that the static token stops granting access (design D1).
  - João approved the 2.1 Red including the rejection of the static token. At that time the whole acceptance was not recorded.
  - Later, after consolidation, João explicitly approved the complete `s1-04-role-authorization` specification. This accepts the change, not ADR 0003 or ADR 0004, which stay `proposed`.
- [x] 1.2 Run `./node_modules/.bin/openspec validate s1-04-role-authorization --strict --no-interactive`.
- [x] 1.3 João decides whether a `403` request renews the session (design, Pending Decisions). Required before 2.2; not required for 2.1.
  - João accepted the proposed Green with renewal, conditioned on the Red: "a ideia do red não é todos falharem? se não pode seguir". Under the project's Red rule only the new behavior must fail; passing tests are regression coverage. Recorded as design D7, in this spec, and as a clarification of the authentication spec.

## 2. Cycle 1 — Administrator session on the existing guard

- [x] 2.1 Red: the developer writes `src/app/create-app-role-authorization.integration.test.ts` with the real `createApp`, PostgreSQL and a service double only for the ERP service. For both operations: `ADMIN` (Bearer) gets `200`/`202`; `SELLER`, `MANAGER` and `FINANCE` get `403`; the configured static token gets `401`; no refused request reaches the service. Run `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-role-authorization.integration.test.ts` against unchanged production code and classify each assertion as Red or regression coverage.
  - Approved by João. Real `createApp`, PostgreSQL, invented users signed in through the API, countable ERP service fake (no ERP call possible), controlled `Date`. At João's request the missing/invalid/expired cases of 3.1 were included here. Nothing asserts renewal on `403`. Production code was not edited.
  - Evidence (agent run, Docker available): the command above → exit 1, `Tests 10 failed | 2 passed (12)`. For each of `GET /runs` and `POST /run`:
    - Red: the `ADMIN` session got `401` instead of `200`/`202`, with `0` service calls instead of `1`.
    - Red: `SELLER`, `MANAGER` and `FINANCE` got `401` instead of `403`. Their problem content type and zero service calls already held.
    - Red: the configured static token got `200`/`202` instead of `401`, and the service was called once.
    - Regression coverage: missing, malformed, unknown, signed-out and 8-hour-idle credentials already get `401` with `WWW-Authenticate: Bearer` and no service call. The current guard refuses every session, so this does not yet prove session validation.
  - Extended Red before any production edit, with a controlled clock: `403` renews `lastUsedAt` and keeps `lastLoginAt`; the idle session is not renewed. Same command → `10 failed | 2 passed (12)`; the six forbidden cases also showed `lastUsedAt` unchanged. The no-renewal assertion already passed (regression).
- [x] 2.2 Green: export the guard from the authentication module, sharing its credential resolution, and inject it in `create-app.ts`; rewrite the token expectations of `create-app-erp-sync.test.ts` as the superseded rule; run until green.
  - `admin-session-guard.ts` reuses `identify` and the credential resolution moved to `session-credential.ts`, also used by the router; `create-app.ts` injects it. In `create-app-erp-sync.test.ts` only the two static-token success expectations (and their titles) changed to `401` without a service call. `ADMIN_API_TOKEN` is still parsed and grants nothing. `require-admin.ts` is left for 2.3.
  - Evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-role-authorization.integration.test.ts src/modules/authentication/authentication.integration.test.ts src/modules/erp-sync/erp-sync.integration.test.ts` → `Test Files 3 passed (3)`, `Tests 47 passed (47)`. `pnpm verify` → no errors (unit `325 passed (325)`, architecture `3 passed (3)`, specs `6 passed, 0 failed`, `openapi:check`).
- [x] 2.3 Refactor: evaluate removing `require-admin.ts` and its tests, re-run the tests and `pnpm typecheck`.
  - Approved by João, including the deletion. The temporary copy under `/tmp` was lost; the coordinator reports restoring the post-Green state in a new worktree from the previous index plus the confirmed transcript edits, with the frozen lockfile and a regenerated OpenAPI. Before the deletion, the role integration file passed there (`12 passed (12)`).
  - Only `src/shared/http/require-admin.ts` and `require-admin.test.ts` were deleted; no code imported them besides that test. `ADMIN_API_TOKEN` parsing, the static-token rejection tests and the contracts are unchanged. Remaining mentions are historical documents and the design context.
  - Evidence (agent run, Docker available): the three-file integration command of 2.2 → `Test Files 3 passed (3)`, `Tests 47 passed (47)`. `pnpm verify` (includes `tsc --noEmit`) → no errors (unit `310 passed (310)` after removing the old guard tests, architecture `3 passed (3)`, specs `6 passed, 0 failed`, `openapi:check`).
  - The deleted file held the only test of "failure while authorizing answers `500`". The new guard has no such test until 3.1 ("Session lookup fails").

## 3. Cycle 2 — Refusals, cookie and failure

- [x] 3.1 Red: the developer writes tests for "Administrator with the session cookie", "Missing, invalid or expired session" (with `WWW-Authenticate`, controlled clock), "Invalid header is not replaced by the cookie" and "Session lookup fails"; run them and classify each. Passing tests are regression coverage; no defect is introduced.
  - Approved by João. No Red: everything is regression coverage on the first run, `0` behavior failures. Production code was not edited.
    - New, for both operations: "Administrator with the session cookie" (web sign-in, explicit `Cookie` header, `200`/`202`); "Invalid header is not replaced by the cookie" (`Basic` and an unknown Bearer, `401` with challenge, no service call); "Session lookup fails" (real `createApp` with a database double used only in this case: safe `500` Problem Details without the internal detail or the credential, no service call).
    - Reused: "Missing, invalid or expired session", already covered by the 2.1 test with the controlled clock. It now exercises session validation, since an `ADMIN` session is accepted.
  - Evidence (agent run, Docker available): the role integration file → `Tests 18 passed (18)`; the three-file integration command of 2.2 → `Tests 53 passed (53)`. The first `pnpm verify` failed at `eslint` (`no-unexpected-multiline`) on a line of the new test; after rewriting that call, with unchanged assertions, the three-file command → `53 passed (53)` and `pnpm verify` → no errors (unit `310 passed (310)`, architecture `3 passed (3)`, specs `6 passed, 0 failed`).
  - Not asserted: what the server logs on the lookup failure (the test app logs nothing).
- [x] 3.2 Green: implement only what a Red of 3.1 requires. Not applicable without a Red.
  - Not applicable: 3.1 found no Red.
- [x] 3.3 Refactor and re-run the tests.
  - Dispensed with João's approval: cycle 2 added only tests, with no production change. The suites were rerun in 5.1.

## 4. Cycle 3 — API description

- [x] 4.1 Red: the developer writes a test for "API description" on the generated document and runs it.
  - Run together with cycle 1, at João's request to keep the contract in the same Green, before any production edit: `./node_modules/.bin/vitest run src/app/create-app-role-authorization.openapi.test.ts` → `2 failed | 1 passed (3)`; both operations lacked security and the Problem `401`/`403`. The open status was regression coverage.
- [x] 4.2 Green: update the OpenAPI registration of the two operations and run `pnpm openapi:generate`.
  - Done and regenerated; the test passes within `pnpm verify`.
- [x] 4.3 Refactor and re-run the tests.
  - Dispensed with João's approval: the `Problem` component is already shared and the two operations reuse one security and error definition. No code change; the suites were rerun in 5.1.

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm test:integration`, `pnpm test:container` and `pnpm build`.
  - All passed (agent run): unit `310`, full integration `108` in `10` files, coverage above thresholds, container smoke test with `4` migrations (fake ERP settings, no real ERP) and build. Outputs are in the change summary.
- [x] 5.2 Run `pnpm typecheck` and `./node_modules/.bin/openspec validate s1-04-role-authorization --strict --no-interactive`.
  - No type errors; the change is valid.
- [x] 5.3 Write `docs/changes/s1-04-role-authorization.md`, update the manual usage that relies on `ADMIN_API_TOKEN`, evaluate an ADR and record the `admin-access` reconciliation (design D4).
  - Summary and index written; `.env.example` and the Usage section of the `s1-03-erp-sync` summary updated, other historical sections preserved. ADR evaluation: covered by ADR 0003 decision 8 and ADR 0004, no new ADR, no acceptance assumed. Reconciliation recorded in the summary; the ERP change was not edited.
  - Follow-up after the approval in 1.1, superseding the last sentence above: the `admin-access` delta of `s1-03-erp-sync` was reconciled in place (design D4). Only that specification changed in the ERP change; `erp-sync` had no conflicting rule. No production code, ADR or test history was edited.
- [x] 5.4 Archive only after explicit confirmation immediately before archiving.
  - On 2026-11-27, after João's explicit confirmation immediately before the action, the `role-authorization` delta was synced to `openspec/specs/` and the change was moved, after `s1-03-erp-sync`, to `openspec/changes/archive/2026-11-27-s1-04-role-authorization/`. Before archiving, strict validation of all items passed; `verify` (310), integration (108) and build results are those recorded in 5.1. ADRs 0003 and 0004 stay `proposed`.
