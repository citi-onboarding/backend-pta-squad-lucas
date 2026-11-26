Stage A runs without the ERP API key. P1 (key header), P2 (record fields), and P3 (list
envelope) are confirmed by real responses; P4 (query parameters) and P2-status are
documented in the Swagger. Stage B starts only after the developer has verified the
remaining pending facts with the squad key: the maximum page size, the real `429` and
`5xx` bodies, the `Retry-After` format and the per-minute limit (P6), and the duration of
the first call (P7). The real `401` and `422` bodies are already confirmed (2026-11-26). Every phase change waits for explicit developer confirmation.
Tests use invented data only.

## 1. SDD (Stage A)

- [x] 1.1 Draft the task with citi-task-spec and resolve decisions D1–D12 with the developer
- [x] 1.2 Write proposal, specs (`erp-integration`, `backend-foundation` delta), design, and tasks
- [x] 1.3 Update the artifacts with the confirmed P1, P2, and P3 facts
- [x] 1.4 Run `openspec validate s1-02-erp-client --strict` and get developer approval of the artifacts

## 2. Red (Stage A)

- [x] 2.1 Developer reviews and approves the failing tests written in this phase
- [x] 2.2 Write failing tests in `src/shared/config/env.test.ts` for ERP configuration at startup (valid settings and 60000 default, missing or invalid URL, missing or empty key, key not echoed, invalid timeout), adding fake ERP values to its fixture
- [x] 2.3 Write failing tests in `src/shared/erp/money.test.ts` for cents formatting (positive, zero, small, negative, non-integer, `NaN`, unsafe integer)
- [x] 2.4 Write failing tests in `src/shared/erp/erp-schemas.test.ts` with invented records: valid customer list envelope, valid product, valid receivable with `pagamento` null, two installments of one `pedidoErp`, extra fields accepted, missing field, wrong type, invalid `cnpj`, unknown customer `status`, malformed date, fractional cents, incomplete envelope
- [x] 2.5 Write failing tests in `src/shared/erp/erp-client.test.ts` with fake `fetch`, `sleep`, `now`, and logger: successful read, request target and `x-api-key` header, 429 then success, `Retry-After` seconds, date, cap, and invalid, 503 then success, no connection then success, timeout then success, five consecutive failures, 401/403/404 immediate failure, `requestId` kept, unexpected error body, invalid body on 200 without retry, retry log content
- [x] 2.6 Write a failing test that the invalid-response error lists only field paths (`dados.0.cnpj`) and contains neither the Zod message nor the received value
- [x] 2.7 Write failing tests for key confidentiality: fake key absent from error `message`, `stack`, `JSON.stringify`, and captured log lines
- [x] 2.8 Write a failing test in `src/shared/logging/logger.test.ts` for redaction of the ERP API key header
- [x] 2.9 Run the narrowest tests and confirm each fails for the expected reason

## 3. Green (Stage A)

- [x] 3.1 Add `ERP_API_URL`, `ERP_API_KEY`, and `ERP_REQUEST_TIMEOUT_MS` to `src/shared/config/env.ts`
- [x] 3.2 Add fake ERP values to `tests/setup-env.ts`, `src/app/create-app.test.ts`, `src/modules/example-items/example-items.integration.test.ts`, `.github/workflows/ci.yml`, `docker-compose.yml`, and `scripts/test-container.mjs`, and add the public URL and a placeholder key to `.env.example`
- [x] 3.3 Implement `formatCents` in `src/shared/erp/money.ts`
- [x] 3.4 Implement the cents, date, date-time, customer, product, receivable, and page envelope schemas in `src/shared/erp/erp-schemas.ts`, marking receivable `status` as `PENDING P2-status`
- [x] 3.5 Implement `ErpError` in `src/shared/erp/erp-error.ts`, with `issues` built from Zod issue paths only
- [x] 3.6 Implement `createErpClient` and `erpGet` in `src/shared/erp/erp-client.ts`, with `ERP_API_KEY_HEADER = "x-api-key"`
- [x] 3.7 Add the ERP key header to the redaction list in `src/shared/logging/logger.ts`
- [x] 3.8 Run the narrowest tests, then `pnpm test` and `pnpm typecheck`, and confirm all pass
  - Exception (developer-approved): the 3 tests in `tests/architecture/boundaries.test.ts`
    fail on Windows only (fixture paths from `URL.pathname`). They failed before this change,
    are out of its scope, and pass in CI (Linux). All other tests pass.
- [x] 3.9 Stop and report Stage A results and the remaining pending facts to the developer

## 3b. Documented ERP facts round (Stage A)

The Swagger facts (closed status lists, `Problema` error body, `application/problem+json`)
were added to the spec and design after the first Green. This round covers only what they
change. Every phase change waits for explicit developer confirmation.

- [x] 3b.1 Developer approves the updated `erp-integration` spec and `design.md`
- [x] 3b.2 Red: rename the receivable status test (`VENCIDO` is now valid) and cover `PAGO`, `EM_ABERTO`, `VENCIDO`, and undocumented receivable statuses in `src/shared/erp/erp-schemas.test.ts`
- [x] 3b.3 Red: in `src/shared/erp/erp-client.test.ts`, cover customer and receivable statuses outside the closed lists (invalid response, one attempt, path `dados.0.status`)
- [x] 3b.4 Red: cover safe error details: `title`, `type`, `requestId`, and `fields` kept from a 400, a 404, and the last of five 429 attempts served as `application/problem+json`; `detail`, `instance`, and `erros[].mensagem` absent from message, stack, JSON, and logs; malformed error bodies leave the error kind unchanged; a 200 body without a JSON media type is still read and validated
- [x] 3b.5 Run the narrowest tests and confirm every new failure is an assertion failure
- [x] 3b.6 Developer reviews and approves the new failing tests
- [x] 3b.7 Green: make receivable `status` the closed enum `PAGO | EM_ABERTO | VENCIDO` in `src/shared/erp/erp-schemas.ts`
- [x] 3b.8 Green: add `title`, `type`, and `fields` to `ErpError`, and read the error body best-effort on every HTTP failure, including the last retryable attempt, keeping only the safe fields
- [x] 3b.9 Run the narrowest tests, then `pnpm test` and `pnpm typecheck`, and confirm all pass (same architecture-test exception as 3.8)
  - Result: the narrowest set passes (111 tests); `pnpm test` passes 146 of 149, the 3
    failures being the architecture tests covered by the 3.8 exception; typecheck passes.
- [x] 3b.10 Stop and report the round to the developer

## 4. ERP verification (Stage B)

- [x] 4.1 Developer verifies the maximum page size, the real `429` and `5xx` bodies, the `Retry-After` format and the per-minute limit (P6), and the first-call duration (P7) with the squad key and reports the findings (real `401` and `422` bodies already confirmed)
  - Note: what was safe to verify was verified (real `401` and `422` bodies; page size limits documented from the Swagger form). The rest (real `429`, real `5xx`, `Retry-After` format, per-minute limit, P7) is deferred to ADR 0002 as not verified.
- [x] 4.2 Update the `erp-integration` spec: move verified facts from pending to confirmed and adjust requirements and scenarios
  - Note: done for the verified facts (`401`, `422`, page size documented); deferred items stay under pending verification.
- [x] 4.3 If behavior changes, run Red then Green again for the affected tests (error body, `Retry-After`)
  - Note: closed as not applicable. The deferred facts (real `429`, real `5xx`, `Retry-After` format, per-minute limit) go only into ADR 0002; if any is observed later and changes behavior, a new task is opened.
- [x] 4.3a Add the `422` regression-guard test (`erp-client.test.ts`: immediate-failure list `[401, 403, 404, 422]` and the safe-details case with invented values). It passes immediately by design: there is no Red because the client already treats every `4xx` except `429` as non-retryable and keeps only the safe error fields.
- [x] 4.4 Manual smoke script (see design D-10), done as a Red-Green cycle with a developer checkpoint between phases
  - [x] 4.4a Red: write failing tests in `src/shared/erp/erp-smoke.test.ts` with fake `fetch` and `now` and invented records (three reads with `pagina=1&tamanho=1`, one line per resource, no record content or key in the output, stop at the first failure with safe error facts only)
  - [x] 4.4b Developer reviews and approves the failing tests
  - [x] 4.4c Green: implement `src/shared/erp/erp-smoke.ts` and the entry point `scripts/erp-smoke.ts`, add the `erp:smoke` script to `package.json`, and document how to run it without exposing the key in the README
  - [x] 4.4d Run the narrowest tests, `pnpm typecheck`, and `openspec validate s1-02-erp-client --strict`; do not run the script against the real ERP
- [x] 4.5 Developer runs the smoke script and reports the first-call duration (P7)
  - Note: one round on 2026-11-26 (about 20:07 Brazil time, after about 3 hours without calls from the developer): 643 ms, 250 ms, and 344 ms for the three reads. No evident slow start; a single round is not conclusive. The 60000 ms default stays and is revisited if a later round shows a slow first call.
- [x] 4.4e Fix lint errors found by the pre-commit hook (`restrict-template-expressions` in `erp-error.ts` and `erp-smoke.ts`, `no-base-to-string` in `erp-smoke.test.ts`), with no behavior change
  - Note: `pnpm lint` was not run in the Green phases (3.8, 3b.9, 4.4c); only tests, typecheck, and formatting were. From now on `pnpm lint` is part of the verification of every phase.
- [ ] 4.6 Write `docs/adr/0002-api-do-erp.md` from `docs/templates/adr.md`, recording confirmed facts, still-pending items, the retry policy, the 60-second timeout as an initial value with a single P7 observation, and the 33-call cost of a full read with page size 20; update the ADR index

## 5. Refactor (Stage B)

- [ ] 5.1 Improve naming, structure, and duplication in `src/shared/erp/` and test helpers without changing behavior
- [ ] 5.2 Run `pnpm test` and `pnpm typecheck` and confirm everything stays green

## 6. Consolidation (Stage B)

- [ ] 6.1 Run the applicable gates with citi-verify-scope: `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm build`, and `pnpm test:container`
- [ ] 6.2 Run `openspec validate s1-02-erp-client --strict`
- [ ] 6.3 Write `docs/changes/s1-02-erp-client.md` from `docs/templates/change.md` with citi-close-change
- [ ] 6.4 Review the branch with citi-review-change and address findings
- [ ] 6.5 Prepare the pull request description with citi-prepare-pr, including test output and the ADR
- [ ] 6.6 Obtain explicit developer confirmation before archiving the change
