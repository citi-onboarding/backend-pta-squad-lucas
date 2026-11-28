## 1. SDD (specification)

- [x] 1.1 João reviews and accepts `proposal.md`, `specs/role-authorization/spec.md`, `design.md` (including the neutral `403` detail, D3, and the Red stubs, D4) before any test is written.
  - Accepted by João on 2026-11-28, including the neutral `403` detail (D3) and the Red stubs (D4).
- [x] 1.2 Run `./node_modules/.bin/openspec validate s1-04-role-guard --strict --no-interactive`.
  - `Change 's1-04-role-guard' is valid`; `validate --all --strict` → `Totals: 10 passed, 0 failed (10 items)`.

## 2. Red

- [x] 2.1 The developer writes `src/app/role-guard.integration.test.ts` for every scenario of the delta spec (design D5), after adding only the stubs of design D4.
  - Authorized by João on 2026-11-28. Written by the agent. Only the two signatures of D4 were added to production code. `tsc --noEmit` → exit 0; `eslint src` and `prettier --check src` → no problems.
- [x] 2.2 Run it against the stubs and classify each test: failure on an assertion is Red; a test that already passes is regression coverage; any other failure is not Red.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/role-guard.integration.test.ts` → `Tests 10 failed (10)`, every failure an assertion. No regression coverage.
  - Failures: `expected 500 to be 200` (single role by Bearer and by cookie, several roles, both identity scenarios and the control of "without a role restriction"), `expected 500 to be 403` (`SELLER`, `ADMIN`), `expected 500 to be 401` (no valid session) and `expected "vi.fn()" to be called 1 times, but got 0 times` (decision cannot be made).
  - Two scenarios expect `500`, which the stubs also answer. Their tests require the session lookup to be attempted, and a restricted request to succeed first, so they cannot pass vacuously.

## 3. Green

- [x] 3.1 Implement `request-identity.ts` and `createRoleGuard`, use `requireRole("ADMIN")` in `create-app.ts` and remove `admin-session-guard.ts` (design D1–D3). No test changes.
  - Authorized by João on 2026-11-28. `request-identity.ts` and `role-guard.ts` implemented, `create-app.ts` uses `requireRole("ADMIN")` in both routers and `admin-session-guard.ts` removed. No test changed (checksum of the new test file verified).
- [x] 3.2 Run the new test first, then the unit and integration suites, with the existing administrator tests unchanged.
  - `./node_modules/.bin/vitest run --config vitest.integration.config.ts src/app/role-guard.integration.test.ts` → `Tests 10 passed (10)`.
  - `pnpm verify` → exit 0 (unit `321 passed (321)`, architecture `3 passed (3)`, OpenSpec `10 passed, 0 failed`, `openapi:check`, `skills:check`); `pnpm test:integration` → `Test Files 15 passed (15)`, `Tests 184 passed (184)`. Run as `npx -y pnpm@12.5.1 run <script>`. `openapi.json` unchanged.

## 4. Refactor

- [x] 4.1 Refactor only with a concrete gain and rerun the tests, or record the dispensation.
  - Dispensed by João on 2026-11-28: the guard reuses the credential reading and the `401` challenge, and no duplication was introduced.

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm test:integration` and `pnpm build`, and confirm that `openapi.json` did not change.
  - As `npx -y pnpm@12.5.1 run <script>`: all exit 0; unit `321 passed (321)`, integration `184 passed (184)`; coverage statements 95.69%, branches 95.04%, functions 93.33%, lines 95.55%. `openapi.json` unchanged.
- [x] 5.2 Run `./node_modules/.bin/openspec validate --all --strict --no-interactive`.
  - `Totals: 10 passed, 0 failed (10 items)` (through `spec:validate` inside `verify`).
- [x] 5.3 Through `citi-close-change`, write `docs/changes/s1-04-role-guard.md`, record the ADR rationale (ADR-0004 covers it) and update the index.
  - Written from the instructions of `citi-close-change`. No new ADR; rationale in the change summary.
- [ ] 5.4 Archive only after João's explicit confirmation immediately before the move.
