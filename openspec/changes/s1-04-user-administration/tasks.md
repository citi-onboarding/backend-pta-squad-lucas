## 1. SDD (specification)

- [x] 1.1 João reviews and accepts `proposal.md`, the four delta specs and `design.md` before any test is written.
  - Accepted by João on 2026-11-28, including the Portuguese texts and the grouped cycles.
- [x] 1.2 Run `./node_modules/.bin/openspec validate s1-04-user-administration --strict --no-interactive` and confirm it passes.
  - `openspec validate s1-04-user-administration --strict --no-interactive` → `Change 's1-04-user-administration' is valid` (2026-11-28).
- [ ] 1.3 João notifies Benjamim, owner of the schema, of the additive migration of design D1 (nullable `users.password_hash` and the `user_invitations` table) when the change is finished, before the pull request (decided by João on 2026-11-28). The review of the pull request is his acceptance; if he objects, update the spec through `/openspec-update-change` and add a corrective migration.
- [ ] 1.4 Ask Benjamim whether filling `Customer.sellerId` belongs to the ERP synchronization (proposal, Non-goals). Not blocking.

## Rules for every cycle

- A test is Red only when it exercises a spec scenario whose behavior is still missing and fails on its assertion. Run each Red against the unchanged implementation. A test that already passes is recorded as regression coverage, not as Red. A failure for the wrong reason (import error, missing fixture, environment) is not Red evidence. Never introduce a defect to obtain a failure.
- The developer writes the tests of each Red step. Fake only the clock and external dependencies.
- During a cycle, run only the tests of that cycle plus `pnpm typecheck`. Full gates run once, in Consolidation.
- Evidence: under each task, record the command and its summary line (for example `Tests 12 passed (12)` or the first failing assertion), and anything not covered by an automated test. No narrative.
- Refactor: propose a change only when it brings a concrete gain; otherwise record the dispensation in one line.

## 2. Cycle 1 — Sign-in ignores email letter case

- [x] 2.1 Red: tests for "Uppercase variant signs in", "Uppercase variant with a wrong password" and "Surrounding whitespace is not removed" (service unit tests with in-memory fakes; one PostgreSQL integration test for the uppercase variant).
  - `./node_modules/.bin/vitest run src/modules/authentication/authentication.service.test.ts` → `Tests 1 failed | 6 passed (7)`; Red: "signs in an uppercase variant of the registered email and returns the stored email" fails with `HttpProblem: Email or password is incorrect.` (401 instead of the identity).
  - Regression coverage (already passes): "rejects an uppercase variant with a wrong password like an unknown email"; "does not remove surrounding whitespace from the submitted email".
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts -t "uppercase variant"` → `Tests 1 failed | 27 skipped (28)`; Red: `AssertionError: expected 401 to be 200` at the status assertion.
  - `./node_modules/.bin/tsc --noEmit` (before node-cron was installed) → only `TS2307 Cannot find module 'node-cron'`; no errors in the new tests.
- [x] 2.2 Green: lowercase the submitted email before the lookup (design D6); run the tests plus the whole `authentication` integration file.
  - `./node_modules/.bin/vitest run src/modules/authentication` → `Test Files 4 passed (4)`, `Tests 44 passed (44)`.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Tests 28 passed (28)`.
  - `./node_modules/.bin/tsc --noEmit` → exit 0.
- [x] 2.3 Refactor or dispensation.
  - Dispensed by João on 2026-11-28: the Green is a single `toLowerCase()` call in `signIn`; no concrete gain.

## 3. Cycle 2 — Administrator side

- [x] 3.1 Red: tests for "Users without a password cannot sign in", every scenario of "User list with account status", "User registration with an invitation", "New invitation for a user without a password" and "Available ERP seller names", "Only the digest is stored", and the modified `role-authorization` scenarios (service unit tests with a controlled clock; router tests for `400`/`404`/`409` mapping, `conflictField` and `Cache-Control: no-store`; PostgreSQL integration tests for persistence, lowercase storage, unique violations and the 47 h / 48 h statuses; the existing role-authorization integration and OpenAPI test files).
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-user-administration.integration.test.ts src/app/create-app-role-authorization.integration.test.ts` → `Tests 43 failed | 18 passed (61)`; every failure is an assertion (`expected 404 to be 201/200/400/409/403`, or `[404...] to deeply equal [401...]`), since the routes do not exist yet. The 18 passing are the existing synchronization tests.
  - `./node_modules/.bin/vitest run src/app/create-app-role-authorization.openapi.test.ts src/modules/authentication/authentication.service.test.ts` → `Tests 7 failed | 10 passed (17)`; failures: `expected undefined to be defined` (6 OpenAPI operations) and `Expected the promise to be rejected.` (user without password at the service).
  - `./node_modules/.bin/tsc --noEmit` → exit 0.
  - Not covered by an automated test in this Red: service unit tests of the new `user-administration` service (module does not exist; no empty production file created) and router-level tests (the HTTP tests above exercise the mapping through `createApp`); HTTP refusal of a replaced token and OpenAPI of the invitation routes depend on cycle 3 (4.1/4.2).
  - Fixtures that need the D1 migration (rows in `user_invitations`): "Stores only the digest", "Revokes the previous invitation" read the table; they fail today at the earlier `201` assertion and are confirmed only after the Green.
  - João accepted on 2026-11-28 the absence of unit tests for the new `user-administration` service; its behavior is covered by the HTTP tests with PostgreSQL.
- [x] 3.2 Green: the D1 migration and Prisma schema change (client regenerated); the `null` hash path at sign-in (D6); the `user-administration` module with injected store/clock/hasher/token generator, admin router mounted at `/api/v1/users` with the injected admin guard, OpenAPI registration and regenerated `openapi.json` (D2–D5, D8, D9); run the tests until they pass.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-user-administration.integration.test.ts src/app/create-app-role-authorization.integration.test.ts` → `Test Files 2 passed (2)`, `Tests 61 passed (61)`.
  - `./node_modules/.bin/vitest run src/app/create-app-role-authorization.openapi.test.ts src/modules/authentication/authentication.service.test.ts` → `Tests 2 failed | 15 passed (17)`; the 2 failures are the invitation lookup/accept OpenAPI assertions, expected until cycle 3 (4.2).
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts src/shared/database/user-account-storage.integration.test.ts` → `Tests 41 passed (41)`.
  - `./node_modules/.bin/vitest run src/modules/authentication` → `Tests 45 passed (45)`.
  - `./node_modules/.bin/tsc --noEmit` → exit 0. `node --import tsx scripts/generate-openapi.ts` then `node --import tsx scripts/check-openapi.ts` → no error.
- [x] 3.3 Refactor or dispensation. Propose here, with its benefit, whether to promote the opaque-token helpers to `src/shared/security` (D5).
  - Refactor accepted by João (2026-11-28): `created_by_id` removed from the migration `20261128120000_s1_04_user_invitations` (column and `user_invitations_created_by_id_fkey`), from `schema.prisma` (field and relations) and the client regenerated; the repository and service never used it. No test and no behavior changed.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-user-administration.integration.test.ts src/app/create-app-role-authorization.integration.test.ts src/modules/authentication/authentication.integration.test.ts src/shared/database/user-account-storage.integration.test.ts` → `Test Files 4 passed (4)`, `Tests 102 passed (102)`.
  - `./node_modules/.bin/vitest run src/app/create-app-role-authorization.openapi.test.ts src/modules/authentication/authentication.service.test.ts` → `Tests 2 failed | 15 passed (17)` (the 2 invitation OpenAPI assertions, expected until 4.2).
  - `./node_modules/.bin/tsc --noEmit` → exit 0; `node --import tsx scripts/generate-openapi.ts` then `scripts/check-openapi.ts` → no error.
  - Dispensed by João: promoting the opaque-token helpers to `src/shared/security`; a separate public router now (it belongs to cycle 3); moving `serialize` to `src/shared/http` (would touch erp-sync).

## 4. Cycle 3 — Public invitation

- [x] 4.1 Red: tests for every scenario of "Invitation lookup", "Invitation acceptance" and the remaining scenarios of "Invitation token secrecy" (controlled clock for 47h59min and exactly 48 h; concurrent acceptance in PostgreSQL; log capture as in `create-app.sign-in-body.test.ts`).
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-invitation.integration.test.ts` → `Tests 18 failed (18)`; every failure is an assertion (`expected 404 to be 200/204/400`, `expected [ 404, 404 ] to deeply equal [ 204, 404 ]`, `expected { type: 'about:blank', …} to match object { title: 'Not Found', detail: 'Invitation link is invalid or expired.' }`), since the routes do not exist yet.
  - `./node_modules/.bin/tsc --noEmit` → exit 0.
  - Tests that expect `404` for an unusable invitation also assert the Problem Details `detail`, so an unregistered route cannot satisfy them.
  - Not covered: the two OpenAPI assertions of the invitation routes are in `create-app-role-authorization.openapi.test.ts` (already Red).
- [x] 4.2 Green: the public invitation router mounted at `/api/v1/invitations`, the conditional single-use update and the password rule (D7); OpenAPI without security for these routes; run the tests until they pass.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-invitation.integration.test.ts` → `Tests 1 failed | 17 passed (18)`; the failure is `expected 1 to be +0` at `expect(await testDatabase.database.session.count()).toBe(0)` (line 239) in "sets the password without opening a session…": the count includes the administrator session row that the test helper `adminToken()` inserts to register the invitation, so it is never 0. Test defect in the Red.
  - Corrected with João's authorization (2026-11-28): the count now filters `where: { user: { email: INVITED_EMAIL } }`, still `toBe(0)`; the global count included the administrator session of the test's own fixture. The spec scenario did not change. `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-invitation.integration.test.ts` → `Tests 18 passed (18)`.
  - Not covered by a test: the rollback path where the user already has a password when the invitation is accepted.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts` on the two `src/app` user/role files, `authentication.integration.test.ts` and `user-account-storage.integration.test.ts` → `Test Files 4 passed (4)`, `Tests 102 passed (102)`.
  - `./node_modules/.bin/vitest run src/app/create-app-role-authorization.openapi.test.ts src/modules/authentication/authentication.service.test.ts` → `Tests 17 passed (17)`.
  - `./node_modules/.bin/tsc --noEmit` → exit 0; `eslint src scripts` → no problems; `node --import tsx scripts/generate-openapi.ts` then `scripts/check-openapi.ts` → no error.
- [x] 4.3 Refactor or dispensation.
  - Dispensed by João (2026-11-28), small gain: a local `serialize` helper in `user-administration`, and replacing the `try/catch` in the repository `acceptInvitation`.

## 6. Cycle 4 — Review fixes (found by `citi-review-change` on 2026-11-28)

- [x] 6.1 Red: tests for "Concurrent new invitations", "New invitation concurrent with acceptance" (PostgreSQL), "ERP seller name with surrounding spaces", "Blank names are not offered" and "Conflict is part of the API description".
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-invitation-concurrency.integration.test.ts src/app/create-app-erp-seller-names.integration.test.ts` → `Tests 4 failed (4)`, every failure an assertion. Red: "Concurrent new invitations" (usable invitations per round `[ 3, 2, 3, 4, 4, … ]` instead of `1`; HTTP, 20 rounds of 5 parallel requests); "New invitation concurrent with acceptance" (`acceptance fulfilled, issue fulfilled, password set, usable 1`); "ERP seller name with surrounding spaces" (`expected 400 to be 201`); "Blank names are not offered" (`expected [ '   ', 'Bruno Reis' ] to deeply equal [ 'Bruno Reis' ]`).
  - `./node_modules/.bin/vitest run src/app/create-app-user-registration.openapi.test.ts` → `Tests 1 failed (1)`; Red: "Conflict is part of the API description" (`expected undefined to deeply equal [ 'email', 'erpSellerName' ]`).
  - Regression coverage: none of the five scenarios already passed. Within the surrounding-spaces test, listing the name unchanged already passes; the failure is at registration.
  - Reliability: the concurrency file run 10 times → both tests failed in 10 of 10 runs (acceptance race violated in 18 to 20 of the 20 rounds of each run).
  - The acceptance race uses the real service and repository on PostgreSQL with an instant injected password hasher; with bcrypt over HTTP the two transactions would not be expected to overlap (not measured).
  - `./node_modules/.bin/tsc --noEmit` → exit 0; `eslint src/app` and `prettier --check src/app` → no problems.
- [x] 6.2 Green: the user row lock in both paths (D4), no trimming of the ERP seller name (D8), the `409` schema with `conflictField` and regenerated `openapi.json`, and the migration comment (D3); rerun all gates of 5.1 and 5.2.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/create-app-invitation-concurrency.integration.test.ts src/app/create-app-erp-seller-names.integration.test.ts` → `Test Files 2 passed (2)`, `Tests 4 passed (4)`; the concurrency file run 10 more times → `Tests 2 passed (2)` in 10 of 10. `./node_modules/.bin/vitest run src/app/create-app-user-registration.openapi.test.ts` → `Tests 1 passed (1)`. No test was changed.
  - `openapi.json` regenerated with `scripts/generate-openapi.ts`.
  - Gates as `npx -y pnpm@12.5.1 run <script>`: `format:check` → exit 0; `verify` → exit 0 (unit `321 passed (321)`, architecture `3 passed (3)`); `test:integration` → `Test Files 14 passed (14)`, `Tests 174 passed (174)`; `test:coverage` → `Tests 321 passed (321)`, `All files | 98.33 | 96.63 | 97.67 | 98.27`; `build` → exit 0.
  - `test:container` → exit 1, environment: `failed to bind host port 0.0.0.0:3001/tcp: address already in use` (backend of another session, not stopped). Images built and `All migrations have been successfully applied.`; the API health checks did not run.
  - `test:container` rerun on 2026-11-28 with the port free → exit 0, `All migrations have been successfully applied.`, `Production container smoke test passed.`
  - `./node_modules/.bin/openspec validate --all --strict --no-interactive` → `Totals: 9 passed, 0 failed (9 items)`.
- [x] 6.3 Refactor or dispensation.
  - Dispensed by João on 2026-11-28: no proposal with a concrete gain.

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify`, `pnpm test:integration`, `pnpm test:coverage`, `pnpm build` and, because a migration was added, `pnpm test:container`. Use `./node_modules/.bin/` if `pnpm` is unavailable, and record which command ran.
  - Run as `npx -y pnpm@12.5.1 run <script>`: `format:check` → `All matched files use Prettier code style!`; `verify` → exit 0 (typecheck, lint, unit tests, architecture, `openspec validate`, `openapi:check`, `skills:check`); `test:integration` → `Test Files 12 passed (12)`, `Tests 170 passed (170)`; `test:coverage` → `Tests 320 passed (320)`, `All files | 98.33 | 96.63 | 97.67 | 98.27`; `build` → exit 0; `test:container` → `Production container smoke test passed.` (the new migration applied).
- [x] 5.2 Run `./node_modules/.bin/openspec validate --all --strict --no-interactive`.
  - `./node_modules/.bin/openspec validate --all --strict --no-interactive` (via `pnpm run spec:validate` inside `verify`) → `Totals: 9 passed, 0 failed (9 items)`.
- [x] 5.3 Through `/citi-close-change`, write `docs/changes/s1-04-user-administration.md` and evaluate the ADR for the account activation model (design D1).
- [x] 5.4 Mark task 1.4 of `s1-04-user-authentication` as answered by this change, pointing to the `user-authentication` delta.
- [ ] 5.5 Archive only after `s1-04-user-authentication` is archived (design D10) and after João's explicit confirmation immediately before the move.
