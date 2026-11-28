## 1. SDD (specification)

- [x] 1.1 João reviews and accepts `proposal.md`, `specs/user-authentication/spec.md`, `design.md` and `docs/adr/0004-opaque-session-authentication.md` before any test is written.
  - Accepted by João on 2026-11-28, after the implementation, not before the first test as this task planned.
- [x] 1.2 Run `./node_modules/.bin/openspec validate s1-04-user-authentication --strict --no-interactive` and confirm it passes.
- [x] 1.3 Align with Benjamim the additive migration that adds the nullable, unique `token_digest` column to `sessions` (design, Migration Plan). Required before Green of cycle 1; not required for its Red.
  - João relayed Benjamim's answer: "benjamim confirmou que podemos criar". This authorizes F01 to create the new additive migration for an optional, unique `sessions.token_digest`.
- [x] 1.4 Record the product owner's decision on email letter-case and surrounding-whitespace variants (design, Pending Decisions). Not blocking: no cycle below asserts variant behavior; if a decision arrives, update the spec through `/openspec-update-change` before any test for it.
  - Answered by `s1-04-user-administration` (João, 2026-11-28), in the delta `specs/user-authentication` of that change: the email is converted to lowercase at sign-in and at registration, and surrounding whitespace is not removed.

## Red rule for every cycle

A test is Red only when it exercises a spec scenario whose behavior is still missing from the unchanged implementation and fails on its assertion. Each Red step below runs the new tests against the implementation as it stands, without touching production code:

- A test that fails on its assertion is Red evidence (command and output kept).
- A test that already passes is recorded as regression coverage (command and output kept), not as Red. Before declaring Red for the block, look for a real gap among the block's remaining scenarios.
- If every scenario of the block already passes, record that, and mark the block's Green as not applicable with that reason; its Refactor is optional.
- Never introduce, even temporarily, a defect in production code or tests to obtain a failure, and never present a failure for the wrong reason (import error, typo, missing fixture) as Red.

## 2. Cycle 1 — Seller session lifecycle (acceptance of the first cycle)

- [x] 2.1 Red: the developer writes the integration test `src/modules/authentication/authentication.integration.test.ts` for the scenario "Seller signs in, reads identity, signs out and is rejected afterwards" (mobile client, Bearer, email sent exactly as registered), using the full `createApp` and a seller created with a bcrypt hash and an ERP seller name; run `pnpm exec vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` and confirm it fails on the assertion expecting `200` from `POST /api/v1/auth/login`, because the route does not exist and the app answers `404`.
  - Red evidence (run by the coordinator, after restoring dependencies with `pnpm install --frozen-lockfile` and confirming Docker; isolated PostgreSQL via Testcontainers): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → exit 1, `AssertionError: expected 404 to be 200 // Object.is equality` at `authentication.integration.test.ts:58:27`, `1 test failed (1)`, 40.38s. The first assertion (`POST /api/v1/auth/login`) failed for the expected reason; later steps were not reached.
  - An earlier agent run failed before any assertion (`Cannot find package 'bcryptjs'`); it was an environment error and is not Red evidence.
- [x] 2.2 Green (after 1.3): add the `token_digest` migration agreed in 1.3 and the `Session.tokenDigest` field; create the `authentication` module (schemas, token generation and digest, service with injected store/clock/password verifier/token generator, Prisma repository, router, OpenAPI registration) and wire it in `src/app/create-app.ts`, with the minimum needed for sign-in (mobile), identity and sign-out; run the same command until it passes.
  - Implemented: additive migration `20261127120000_s1_04_session_token_digest` (nullable `token_digest` plus unique index) and `Session.tokenDigest`, with the Prisma client regenerated locally. The `authentication` module has an injected store, password verifier and token generator. No clock was needed yet, because no cycle-1 behavior depends on time.
  - The sign-in schema accepts only `client: "mobile"`. `web` is rejected with `400` until cycle 5 implements cookie delivery, so no web request receives a body credential. `openapi.json` was regenerated with the three routes and `bearerAuth`.
  - Green evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`, 7.74s. `./node_modules/.bin/tsc --noEmit` reported no errors. The unit suite reported `12 passed (12)` files and `45 passed (45)` tests. `prettier --check .` reported all files formatted.
  - Not run by the agent (approval denied): `eslint` and `scripts/check-openapi.ts`.
- [x] 2.3 Refactor: review names, boundaries (module imports only `src/shared`) and response validation; re-run the cycle test, `pnpm typecheck` and `pnpm test:architecture`.
  - Change approved by João (the coordinator's proposal): the login route no longer validates its body twice. The `validate({ body })` middleware was removed. The handler keeps a single `signInRequestSchema.parse(request.body)` at the boundary, so input is typed without a cast and a `ZodError` still reaches `problemHandler`. Response parsing is unchanged. The shared middleware and the `me`/`logout` routes were not touched.
  - Refactor evidence (agent run, Docker available):
    - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Test Files 1 passed (1)`, `Tests 1 passed (1)`, 7.64s.
    - `pnpm verify` ran typecheck, `eslint .`, the unit suite (`12 passed (12)` files, `45 passed (45)` tests), `test:architecture` (`3 passed (3)`), `openspec validate --all --strict` (`3 passed, 0 failed`), `openapi:check` and `skills:check`; it completed with no errors.
    - `pnpm format:check` reported all files formatted.
  - Preserved: the `sha256` of `openapi.json` (`dc38da34…c849`) and of `authentication.integration.test.ts` (`accc662d…930f`) are unchanged.
  - Not covered by an automated test yet: the `400` response to a malformed sign-in body. It belongs to cycle 2 ("Malformed request is rejected").

## 3. Cycle 2 — Sign-in rules and errors

- [x] 3.1 Red: the developer writes tests for "Valid credentials open a session", "Last login date is recorded", "Two sign-ins open two independent sessions", "Unknown email is rejected", "Wrong password is rejected", "Both rejections are indistinguishable" and "Malformed request is rejected" (unit tests for the service, router tests for `400`/`401`, integration for persistence); run them against the unchanged implementation and classify each as Red or regression coverage per the Red rule.
  - Final classification of the block: one Red ("Last login date is recorded") and six scenarios recorded as regression coverage. The remaining entries below keep the evidence in chronological order.
  - Red for "Last login date is recorded" (run first, before the other tests of this block were written):
    - Test: `records the sign-in time as the seller's last login date` in `src/modules/authentication/authentication.integration.test.ts`. It creates its own seller fixture (bcrypt hash, ERP seller name, `lastLoginAt` asserted `null`), signs in over HTTP as `mobile` with the email exactly as registered, expects `200`, then reads the user from PostgreSQL. It asserts that `lastLoginAt` is set and lies between the timestamps taken immediately before and after the call.
    - Red evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts -t "records the sign-in time as the seller's last login date"` → exit 1, `AssertionError: expected null not to be null` at `authentication.integration.test.ts:113:36`, `1 failed | 1 skipped (2)`. Sign-in returned `200`; the failure is the missing `lastLoginAt` update.
    - Whole file: same command without `-t` → exit 1, `1 failed | 1 passed (2)`; the cycle-1 lifecycle test stays green. `pnpm typecheck` reported no errors, and the test file is formatted.
  - Regression coverage (agent run with João's approval; all passed on the first run against the production code left by the `lastLoginAt` Green, which was not edited; no Red is claimed for them):

    | Scenario                                   | Service (in-memory fakes) | Router (service double) | Integration (PostgreSQL)          |
    | ------------------------------------------ | ------------------------- | ----------------------- | --------------------------------- |
    | Valid credentials open a session           | passed                    | Not applicable          | passed                            |
    | Two sign-ins open two independent sessions | passed                    | Not applicable          | passed                            |
    | Unknown email is rejected                  | passed                    | passed (`401` mapping)  | passed (no session, no update)    |
    | Wrong password is rejected                 | passed                    | passed (`401` mapping)  | passed (no session, no update)    |
    | Both rejections are indistinguishable      | passed                    | Not applicable          | passed (`requestId` not compared) |
    | Malformed request is rejected (4 forms)    | Not applicable            | passed                  | passed (no session, no update)    |
    - Invalid bodies covered: missing password, email without `@`, unknown client type (`desktop`) and unexpected property. No web-client or email-variant behavior is asserted.
    - `./node_modules/.bin/vitest run src/modules/authentication/authentication.service.test.ts src/modules/authentication/authentication.router.test.ts --reporter=verbose` → `Test Files 2 passed (2)`, `Tests 8 passed (8)`.
    - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts -t "sign-in rules with PostgreSQL" --reporter=verbose` → `Tests 9 passed | 2 skipped (11)`. Same command without `-t` → `Tests 11 passed (11)`.
    - The first `pnpm verify` failed at `eslint` with 5 `@typescript-eslint/require-await` errors in the fakes of `authentication.service.test.ts`. The fakes now return `Promise.resolve`, with unchanged assertions. Rerun: the 8 service and router tests passed; `pnpm typecheck`, `pnpm format:check` and `pnpm verify` completed with no errors (unit suite `14 passed (14)` files, `53 passed (53)` tests; architecture `3 passed (3)`; `openspec validate --all --strict` `3 passed, 0 failed`).
- [x] 3.2 Green: implement only what the Red tests of 3.1 require (for example the dummy-hash comparison for unknown emails, the single sign-in `401` problem, request validation, the `lastLoginAt` update in the sign-in transaction); run the tests until they pass. Not applicable if 3.1 found no Red.
  - The only Red of 3.1 ("Last login date is recorded") is green. No further Green is applicable to the six scenarios recorded as regression coverage, because their tests already pass. This dispensation covers those scenarios only; it does not close the open gaps listed below.
  - Green for "Last login date is recorded" (approved by João):
    - Change: the store operation `createSession` became `openSession`. In one Prisma transaction it creates the session (`tokenDigest`) and sets `User.lastLoginAt`, using the same instant for `createdAt`, `lastUsedAt` and `lastLoginAt`. The user update is conditional (`lastLoginAt` null or older), so a concurrent older sign-in that commits last cannot move the date backwards.
    - Green evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts -t "records the sign-in time as the seller's last login date"` → `1 passed | 1 skipped (2)`, 7.73s. Same command without `-t` → `Tests 2 passed (2)`, 6.97s.
    - Gates: `pnpm typecheck` and `pnpm format:check` reported no problems. `pnpm verify` completed with no errors: unit suite `45 passed (45)`, architecture `3 passed (3)`, `openspec validate --all --strict` `3 passed, 0 failed`, plus `eslint`, `openapi:check` and `skills:check`.
    - Not asserted by an automated test: the transaction's atomicity, the equality of the three timestamps and the forward-only update under concurrency.
  - Two gaps found afterwards (unparseable body; dummy-hash comparison) are not covered by this dispensation. They are tracked in 3.4 to 3.6.
- [x] 3.3 Refactor and re-run the tests.
  - Refactor of the `lastLoginAt` Green was dispensed with João's approval: the transaction stays in one short method.
  - Closed with João's agreement: this task covers the scenarios of 3.1 to 3.2. Besides that dispensed refactor, the other scenarios only gained tests, with no production change to refactor.
- [x] 3.4 Red (spec update and Red approved by João): the developer writes tests for "Unparseable body is rejected without being logged" and "Unknown email still performs a password comparison" and runs them against the unchanged production code.
  - `src/app/create-app.sign-in-body.test.ts` uses the real `createApp`, logger and error handling; only the log sink is redirected to memory. No database is used: the stub fails on any access. A positive control confirms that logs were captured. `src/modules/authentication/authentication.service.test.ts` uses an observable password verifier, with no latency measurement.
  - Red evidence: `./node_modules/.bin/vitest run src/app/create-app.sign-in-body.test.ts src/modules/authentication/authentication.service.test.ts` → exit 1, `Tests 2 failed | 3 passed (5)`.
    - Unparseable body: `expected 500 to be 400`, and the soft assertion that the logs do not contain the fictitious password failed (`expected true to be false`).
    - Unknown email: `expected "vi.fn()" to be called 1 times, but got 0 times`; the `401` assertion before it passed.
- [x] 3.5 Green: implement only what the 3.4 tests require; run them until they pass, with the authentication integration file.
  - Shared `problemHandler`: an `entity.parse.failed` error becomes a `400` Problem Details with a fixed detail and is not logged. This applies to every route; other errors are handled as before.
  - Sign-in: the same password verifier is now always called once; an absent user is rejected whatever it returns. For an unknown email it receives a fixed public dummy bcrypt literal (cost 10), as design D7 states.
  - Review correction: the first Green computed the dummy hash at module load, deviating from D7. It was replaced by the literal supplied with the review, described there as generated locally from a discarded random input. After the correction, the focused command below was rerun → `Tests 5 passed (5)`; `pnpm verify` (unit suite `55 passed (55)`) and `pnpm format:check` completed with no errors. The PostgreSQL integration result below predates the correction and was not rerun.
  - Green evidence (agent run, Docker available), tests unchanged since Red: `./node_modules/.bin/vitest run src/app/create-app.sign-in-body.test.ts src/modules/authentication/authentication.service.test.ts` → `Tests 5 passed (5)`. `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Tests 11 passed (11)`. `pnpm verify` completed with no errors (unit suite `55 passed (55)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`); `pnpm format:check` reported all files formatted.
  - Not asserted by an automated test: rejection of an absent user when the verifier returns `true`.
- [x] 3.6 Refactor the 3.5 change if useful, re-run the tests, `pnpm typecheck` and strict OpenSpec validation.
  - João accepted the 3.5 Green and agreed to dispense its refactor: the code stays as it is.
  - Reported by the coordinator, after the final dummy-hash correction (not run by this agent): the `11` PostgreSQL integration tests passed and strict OpenSpec validation was valid. This supersedes the "not rerun" note in 3.5.

## 4. Cycle 3 — Authentication required, identity and immediate sign-out

- [x] 4.1 Red: the developer writes tests for "Missing credential is rejected", "Unknown credential is rejected", "Sign-out without a valid credential is rejected", "Malformed authorization header is rejected", "Seller identity includes the ERP seller name", "Non-seller identity has no ERP seller name", "Identity never exposes secrets", "Ended session is rejected immediately" and "Repeated sign-out is rejected"; run them against the unchanged implementation and classify each per the Red rule.
  - Approved by João. The spec first gained the `WWW-Authenticate: Bearer` requirement and the scenario "Rejections announce the authentication scheme", from design D7. Production code was not edited.
  - Three tests added to the integration file. Two cover six invalid-credential cases on both `me` and `logout` (the ended-session sign-out is the repeated sign-out); no token appears in labels or compared values. The third covers the non-seller identity. The seller identity and its secret exclusion were already asserted by the cycle-1 exact-equality test.
  - Evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → exit 1, `Tests 1 failed | 13 passed (14)`; all 11 earlier tests stay green.
    - Red: "Rejections announce the authentication scheme" — all 12 cases expected `"Bearer"` and received `undefined`.
    - Regression coverage (passed on the first run): all other scenarios listed in this task. The cookie sent with the malformed header is currently ignored by every route, so that case does not yet prove the absence of a cookie fallback; revisit it in cycle 5.
- [x] 4.2 Green: implement only what the Red tests of 4.1 require (for example credential resolution order, the single `401` with `WWW-Authenticate: Bearer`, the strict identity schema); run the tests until they pass. Not applicable if 4.1 found no Red.
  - Approved by João. Only the header was missing: an error handler local to `/me` and `/logout` sets `WWW-Authenticate: Bearer` on a `401` and forwards the error to the shared handler. Sign-in and other errors are unchanged. OpenAPI documents the header on both `401` responses; `openapi.json` was regenerated with `pnpm openapi:generate`.
  - Green evidence (agent run, Docker available), tests unchanged since Red: `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Tests 14 passed (14)`. `pnpm verify` completed with no errors (unit suite `55 passed (55)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`, `openapi:check`); `pnpm format:check` reported all files formatted.
  - Not asserted by an automated test: the absence of the header on the sign-in `401`.
- [x] 4.3 Refactor and re-run the tests.
  - Dispensed with João's agreement, with no code change: the `401` handler is local and restricted to two routes (`/me` and `/logout`), and the `14` integration tests were green after the 4.2 Green (not rerun for this entry).

## 5. Cycle 4 — Sliding 8-hour expiry

- [x] 5.1 Red: the developer writes tests, with a controlled clock, for "Session used within 8 hours stays valid", "Session idle for 8 hours expires", "Activity keeps the session alive beyond 8 hours from sign-in" and "Activity does not change the last login date"; run them against the unchanged implementation and classify each per the Red rule.
  - Approved by João. Five integration tests with the real `createApp` and PostgreSQL. Vitest fakes only `Date`, with explicit instants and real timers restored after each test; no waiting. Production code was not edited.
  - Evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → exit 1, `Tests 3 failed | 16 passed (19)`; all 14 earlier tests stay green.
    - Red, "Session used within 8 hours stays valid": `200`, but `lastUsedAt` stayed at sign-in (`08:00`) instead of `15:59`.
    - Red, requirement text "renew the last use on every successfully authenticated request", on sign-out: `204` and `endedAt` set, but `lastUsedAt` stayed at sign-in.
    - Red, "Session idle for 8 hours expires" (and "Sign-out without a valid credential" for an expired session): read answered `200` as `application/json` instead of `401` Problem Details; sign-out answered `204` instead of `401` and set `endedAt`. The `lastUsedAt` of the read session was unchanged only because nothing renews it yet.
    - Regression coverage (passed on the first run): "Activity keeps the session alive beyond 8 hours from sign-in" and "Activity does not change the last login date".
- [x] 5.2 Green: implement only what the Red tests of 5.1 require (expected: the atomic conditional renewal of `lastUsedAt` with the 8-hour boundary); run the tests until they pass. Not applicable if 5.1 found no Red.
  - Approved by João. A clock is injected into the service (production passes `new Date()`) and also dates sign-in. The service owns the 8-hour limit. Both operations require `endedAt` null and `lastUsedAt` strictly after the cutoff, and use `GREATEST` so `lastUsedAt` never moves backwards. `me` is a single `UPDATE ... RETURNING` that renews and reads the identity; sign-out is a single update that also ends the session. Both are parameterized raw SQL, because Prisma cannot express `GREATEST`. No migration, contract or `lastLoginAt` change.
  - The unit-test fake was adapted to the new interface (renamed method, fixed clock); assertions are unchanged, and so is the integration file.
  - Green evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Tests 19 passed (19)`. `pnpm verify` completed with no errors (unit suite `55 passed (55)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`); `pnpm format:check` reported all files formatted.
  - Not asserted by an automated test: the forward-only renewal and the behavior under concurrent requests.
- [x] 5.3 Refactor and re-run the tests.
  - Dispensed with João's approval, with no code change: the 5.2 Green already uses an atomic conditional update, and the `19` integration tests were green after it (not rerun for this entry).

## 6. Cycle 5 — Web cookie delivery

- [x] 6.1 Red: the developer writes tests for "Web sign-in sets the cookie and keeps the body free of the credential", "Web client reads identity with the cookie", "Web sign-out clears the cookie" and "Mobile sign-in returns a Bearer credential" (no `Set-Cookie`); run them against the unchanged implementation and classify each per the Red rule.
  - Approved by João. Five integration tests (real `createApp`, disposable PostgreSQL); the `Secure` cookie is sent through an explicit `Cookie` header, and assertions never print its value. A precedence test was added for "Malformed authorization header is rejected". Production code was not edited.
  - Evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → exit 1, `Tests 4 failed | 20 passed (24)`; the 19 earlier tests stay green.
    - Failure actually reached, one cause: web sign-in answers `400` instead of `200` (`expected 400 to be 200`). It is the Red for "Web sign-in sets the cookie and keeps the body free of the credential".
    - Blocked at that same sign-in step: "Web client reads identity with the cookie", "Web sign-out clears the cookie" and the header precedence over a valid cookie. None of their later steps or assertions ran.
    - Regression coverage (passed on the first run): "Mobile sign-in returns a Bearer credential" without `Set-Cookie`.
  - `Cache-Control: no-store` (design D10, mentioned in 6.2) had no spec scenario and no test in this first run.
  - Second Red, approved by João before the Green: the spec gained "Identity and credential responses are not cached" (scenario "Successful responses forbid caching"), and assertions were added to the web sign-in, web identity and mobile tests. Same command → exit 1, `Tests 5 failed | 19 passed (24)`. Reached in the mobile test: sign-in and `me` both lacked the header (`expected undefined to be 'no-store'`). The four web tests were still blocked at sign-in (`400`), so their new assertions did not run.
- [x] 6.2 Green: implement only what the Red tests of 6.1 require (expected: the `__Host-session` cookie set/parse/clear, the per-client response shapes and `Cache-Control: no-store`); run the tests until they pass. Not applicable if 6.1 found no Red.
  - Approved by João. Sign-in accepts `web`, which receives `{ user }` plus the `__Host-session` cookie (`HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`); mobile keeps the body credential without a cookie. A present `Authorization` header is the only source; otherwise the cookie is read and validated with Zod in `session-cookie.ts`. Sign-out clears the cookie only when the cookie authenticated it. Successful sign-in and `me` send `Cache-Control: no-store`. OpenAPI documents `cookieAuth`, both response shapes and the headers; regenerated with `pnpm openapi:generate`. This also lifts the cycle-1 restriction to `client: "mobile"` and the cookie-fallback caveat noted in 4.1.
  - Green evidence (agent run, Docker available), tests unchanged since the second Red: the integration command above → `Tests 24 passed (24)`. `pnpm verify` completed with no errors (unit suite `55 passed (55)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`, `openapi:check`); `pnpm format:check` reported all files formatted.
  - Not asserted by an automated test: that a Bearer sign-out sends no `Set-Cookie`.
- [x] 6.3 Refactor and re-run the tests.
  - Dispensed with João's authorization, conditional on the coordinator's review, which found the code sufficient: the same options set and clear the cookie, and credential resolution lives in a single place. No code change; the `24` integration tests were green after the 6.2 Green (not rerun for this entry).

## 7. Cycle 6 — Credential secrecy and no ERP dependency

- [x] 7.1 Red: the developer writes tests for "Stored session does not contain the credential", "Credentials are unique per sign-in", "Logs do not contain secrets" and "Authentication works without the ERP", and runs them against the unchanged implementation. Earlier cycles may already satisfy these scenarios: a passing test is recorded as regression coverage with its command and output; before declaring Red, look for a real gap (for example a log path or stored field not yet covered). If all four already pass, record it and mark 7.2 as not applicable. No defect is introduced to produce a failure.
  - Approved by João. No Red: all four scenarios are regression coverage, `0` real failures. Production code was not edited.
    - "Stored session does not contain the credential": new test; no stored value contains the token, and `tokenDigest` is its SHA-256.
    - "Credentials are unique per sign-in": reused assertion in `keeps the second session valid after signing out of the first`.
    - "Logs do not contain secrets": new test with the real logger at `info`, redirected to memory, over web and mobile sign-in, `me` and sign-out; password, password hash, tokens, cookie and authorization values are absent, with a positive control for the three routes.
    - "Authentication works without the ERP": new test where any global `fetch` fails; sign-in and `me` return the stored ERP seller name and no call is made. Limit: only `fetch` is intercepted; the project has no ERP client or ERP configuration.
  - Secret assertions compare booleans or status codes, never the values.
  - Evidence (agent run, Docker available): `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/authentication/authentication.integration.test.ts` → `Tests 27 passed (27)`. `pnpm verify` completed with no errors (unit suite `55 passed (55)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`); `pnpm format:check` reported all files formatted.
- [x] 7.2 Green: implement only what a Red test of 7.1 requires; run the tests until they pass. Not applicable if 7.1 found no Red.
  - Not applicable: 7.1 found no Red.
- [x] 7.3 Refactor and re-run the tests.
  - Dispensed with João's approval: cycle 6 added only tests, with no production change to refactor. The full suites were rerun in consolidation (8.2).

## 8. Consolidation

- [x] 8.1 Run `pnpm openapi:generate` and confirm `openapi.json` documents the three routes, request/response schemas, `401`/`400` problems and the `cookieAuth`/`bearerAuth` security schemes.
  - Open. `openapi:check` passes, and the three routes, request and success schemas, `400`/`401` statuses and both security schemes are documented. The authentication `400`/`401` responses do not reference an `application/problem+json` Problem schema. An isolated `pnpm openapi:generate` in consolidation required approval and was not run.
  - Red for the gap, approved by João. The spec gained "Documented authentication errors" (scenario "Error responses reference Problem Details"). New test `src/modules/authentication/authentication.openapi.test.ts` checks the document produced by the real registry; registry, runtime and `openapi.json` were not edited.
  - Evidence (agent run): `./node_modules/.bin/vitest run src/modules/authentication/authentication.openapi.test.ts` → exit 1, `Tests 4 failed (4)`: login `400`, login `401`, `me` `401` and sign-out `401`. The first assertion of each, on the media type, received `[]` instead of `["application/problem+json"]`; the schema assertions after it did not run.
  - Until the Green, this test is part of the unit suite, so the green `verify` and coverage results of 8.2 predate it.
  - Green approved by João, OpenAPI metadata only. `src/shared/http/problem-openapi.ts` is the single registration of `Problem`, with the optional `errors` of the handler; login `400`/`401` and the `me` and sign-out `401` reference it as `application/problem+json`, keeping `WWW-Authenticate`. The example module imports it instead of registering its own. `openapi.json` was regenerated with `pnpm openapi:generate`; the test is unchanged.
  - Evidence (agent run): `./node_modules/.bin/vitest run src/modules/authentication/authentication.openapi.test.ts src/modules/example-items/example-item.openapi.test.ts` → `Tests 5 passed (5)`. `pnpm verify` completed with no errors (unit `59 passed (59)`, architecture `3 passed (3)`, specs `3 passed, 0 failed`, `openapi:check`); `pnpm format:check` passed. This closes the "Open" note above. Coverage, integration, container and build were not rerun after this change.
  - Refactor specific to 8.1 dispensed with João's approval, after review: the `Problem` schema is already centralized with a single registration, with no duplication to remove. No code change. This applies to 8.1 only; any later dispensation requires its own case-by-case review.
- [x] 8.2 Run `pnpm format:check`, `pnpm verify` (typecheck, lint, unit, architecture, strict OpenSpec, OpenAPI check, skills check), `pnpm test:coverage`, `pnpm test:integration` (database behavior changes), `pnpm test:container` (new migration) and `pnpm build`; all must pass.
  - All passed (agent run): unit `55`, full integration `82` in `8` files, coverage above thresholds (`src/shared` only), container smoke test with `3` migrations, and build. Outputs are in the change summary.
- [x] 8.3 Run `./node_modules/.bin/openspec validate s1-04-user-authentication --strict --no-interactive`.
- [x] 8.4 Write `docs/changes/s1-04-user-authentication.md` from `docs/templates/change.md` with real validation output, listing which scenarios had Red evidence and which were regression coverage; update ADR 0004 status according to `docs/adr/README.md` and both indexes.
  - Summary and change index written. ADR 0004 stays `proposed`: only the credential type has a recorded decision. Its row in the ADR index already existed and is unchanged.
- [ ] 8.5 Archive only after explicit confirmation from the developer immediately before archiving.
