Phases follow `openspec/config.yaml` and `AGENTS.md`. Every phase change waits for explicit
developer confirmation, and the phase is explained in Portuguese before asking. Tests use
invented data only, and automated tests never call the real ERP. Decisions D1 to D8 in
`design.md` must be approved before section 2 starts.

## 1. SDD

- [x] 1.1 Draft the task with citi-task-spec and record the pending decisions D1 to D8
- [x] 1.2 Write proposal, specs (`erp-sync`, `available-credit`, `admin-access`), design, and tasks
- [x] 1.3 Run `openspec validate s1-03-erp-sync --strict`
- [x] 1.4 Task owner answers D1 to D8 (approved as recommended; D7 recorded as an assumption, D8 limits documented, `GET /sync/runs` accepted, environment files updated)
- [x] 1.5 Developer approves the artifacts and confirms the move to Red

## 2. Red

- [x] 2.1 Developer reviews and approves the failing tests written in this phase
- [x] 2.2 Write failing tests in `src/shared/credit/available-credit.test.ts` for every `available-credit` scenario (open, overdue, paid ignored, none, negative result, several, non-integer input)
- [x] 2.3 Write failing tests in `src/shared/config/env.test.ts` for `ERP_SYNC_ENABLED` (default `true`, `false`, invalid value) and `ADMIN_API_TOKEN` (absent, 32 characters, too short, value never echoed)
- [x] 2.4 Write failing tests for the admin guard in `src/shared/http/` for every `admin-access` scenario, including a replaced recognizer, an invalid scheme, a token of a different length, and the token absent from captured logs
- [x] 2.5 Write failing tests in `src/modules/erp-sync/erp-sync.service.test.ts` with a fake ERP client (fake `erpGet`), an in-memory fake repository, a fake clock, and a captured logger: first run counts, pagination over several pages, status translation, receivable payment date, `recordsChanged` 0 on a repeated run, one record changed, records missing from the ERP kept, `FAILED` on ERP error with nothing written, failure after the first resource, `RATE_LIMITED` after a `429` error, rejected records making `PARTIAL` (unknown status, unknown customer), non-list body making `FAILED`, run records for every result, last successful time rules, status derivation (healthy, ERP down, rate limited, never synchronized), run in progress guard, and no ERP value in details or logs
- [x] 2.6 Write failing tests in `src/modules/erp-sync/erp-sync.scheduler.test.ts` with a fake cron: fires every 30 minutes, skips while a run is in progress without calling the ERP or recording a run, never starts when disabled, stops on shutdown
- [x] 2.7 Write failing router tests (`erp-sync.router.test.ts`) with supertest and a fake service: `202` and `409` for `POST /sync/run`, `401` without the token, `GET /sync/status` shape with no error detail, `GET /sync/runs` ordering, `limit` default and ceiling, `400` for an invalid `limit`, and response validation
- [x] 2.8 Write failing OpenAPI tests for the three routes and the new enum value, and check that `openapi.json` is regenerated, not hand-edited
- [x] 2.9 Write failing integration tests (`*.integration.test.ts`, Testcontainers PostgreSQL) for the real repository: two runs never duplicate rows, only changed rows are updated, a failure rolls back every write of the run, `RATE_LIMITED` can be stored, the last `SUCCESS` time query, newest-first listing, and startup cleanup of an open run
- [x] 2.10 Run the narrowest tests and confirm each fails for the expected reason (assertion failures, not import errors from missing files, once stubs exist)
  - Result: 110 unit tests and 8 integration tests fail on assertions against inert stubs (`available-credit.ts`, `require-admin.ts`, and the `erp-sync` service, repository, scheduler, router, and OpenAPI files). Three "nothing happens" tests pass at once because an inert stub already behaves that way (scheduler disabled, scheduler stopped before start, service idle); they are regression guards. The shared fake ERP lives in `tests/support/fake-erp.ts`.

## 3. Green

- [x] 3.1 Add the corrective migration for `RATE_LIMITED` (D1, never editing an applied migration) and run `prisma generate`
- [x] 3.2 (node-cron 4.6.0, published 2026-07-05; nothing imports it until the wiring step) Install `node-cron` with pnpm at an exact version at least two weeks old and keep `pnpm-lock.yaml` consistent
- [x] 3.3 Add `ERP_SYNC_ENABLED` and `ADMIN_API_TOKEN` to `src/shared/config/env.ts`; add the test-safe values to `tests/setup-env.ts`, `.github/workflows/ci.yml`, `docker-compose.yml`, `scripts/test-container.mjs`, and `.env.example` (`ERP_SYNC_ENABLED=false` in every test, CI, and Compose setup was already added during SDD; `Dockerfile` needs no change; the `Environment` fixtures in `src/app/create-app.test.ts` and `example-items.integration.test.ts` need the two new fields)
- [x] 3.4 Implement `getAvailableCreditCents` in `src/shared/credit/available-credit.ts`
- [x] 3.5 Implement the admin guard in `src/shared/http/` with an injected recognizer, and the token-based recognizer
- [x] 3.6 Implement the schemas, repository, and service in `src/modules/erp-sync/` (read all pages, check records one by one, compare, write in one transaction, record the run, derive status)
- [x] 3.7 Implement the scheduler with the shared in-process guard and the startup cleanup of open runs
- [x] 3.8 Implement the router and OpenAPI registration, wire them in `src/app/create-app.ts`, wire the scheduler and bounded shutdown in `src/server.ts`, and regenerate `openapi.json` with `pnpm openapi:generate`
- [x] 3.9 Run the narrowest tests, then `pnpm test` and `pnpm typecheck`, and confirm all pass

## 3b. Wiring round (Red, then Green)

Added after Green: no test covered the wiring in `create-app.ts` and `server.ts`.

- [x] 3b.1 Red: `src/app/create-app-erp-sync.test.ts` (routes mounted, status open, administrator routes need the `ADMIN_API_TOKEN` bearer and refuse everything without a token, routes in `/openapi.json`) and `src/app/erp-sync-runtime.test.ts` (interrupted runs closed before scheduling, `ERP_SYNC_ENABLED` respected, node-cron adapter, shutdown with an unref timer); 14 failed on assertions, 1 regression guard passed by design
- [x] 3b.2 Green: `src/app/erp-sync-runtime.ts` (node-cron adapter, unref sleep, default service, runtime), `create-app.ts`, and `server.ts` (start recovers interrupted runs, shutdown stops the schedule and waits at most 10 s before closing the database)
- [x] 3b.3 Verified: unit 298 passed, integration 63 passed, `tsc`, `eslint`, `openapi:check`, `openspec validate --strict`, `pnpm test:container` passed

## 4. Refactor

- [x] 4.1 Remove duplication with all tests green; no behavior change (one shared `createTestEnvironment` in `tests/support/test-environment.ts` replaces three copied `Environment` objects; assertions untouched)
  - Not done on purpose, left as future improvements (see `design.md`): splitting `erp-sync.service.ts` and tidying log messages
- [x] 4.2 Run `pnpm lint` and `pnpm format:check` and fix findings
  - Result: `pnpm lint` passes. `pnpm format:check` still fails on this Windows checkout only because of CRLF line endings (88 files; the same Windows-only failure recorded in `s1-02-erp-client`); with `--end-of-line auto` the whole repository passes.

## 5. Real ERP verification (developer only)

- [x] 5.1 Developer runs one manual sync against the real ERP (with `ADMIN_API_TOKEN` set) and reports only the counts, duration, and whether `tamanho=50` was accepted
- [x] 5.2 Developer runs it a second time and confirms the counts in `pnpm db:studio` did not change and `recordsChanged` is 0
- [x] 5.3 Developer sets a wrong ERP address, runs again, and confirms a `FAILED` run with the old data kept; then restores the address and confirms the next run is `SUCCESS`
- [x] 5.4 Record in ADR 0003 what was observed (page size accepted or not, run duration, any `429` seen) and keep `atualizadoDesde` marked as not confirmed unless it was observed filtering

Observed by the developer on the real ERP (recorded on 2026-11-27); only what was observed is
written. The full record is in ADR 0003 and `docs/changes/s1-03-erp-sync.md`.

- 5.1: `SUCCESS`, 665 records read, 665 changed, 5 seconds; 120 customers, 60 products, and
  485 receivables in the tables (665 in total). The real server accepted `tamanho=50`.
- 5.2: `SUCCESS`, 665 read, 0 changed; table counts unchanged.
- 5.3: wrong ERP address: `FAILED` after 42 seconds, `ERP GET /v1/clientes failed without a
response after 5 attempts`, 0 read, `erpAvailable` false, `lastSuccessfulSyncAt` kept; counts
  checked in the database after the failure: 120, 60, and 485. Correct address restored:
  `SUCCESS`, `erpAvailable` true, `lastSuccessfulSyncAt` updated.
- 5.4: ADR 0003 and ADR 0002 updated for page size 50 only.
- **NOT VERIFIED (not observed):** a real `429` or `5xx`, the per-minute limit, the
  scheduler firing on its own after 30 minutes, shutdown while a run is in progress, a
  `PARTIAL` run with real data, that `atualizadoDesde` filters, and the web part.

## 6. Consolidation

- [x] 6.1 Write `docs/adr/0003-erp-sync-strategy.md` from `docs/templates/adr.md` (full read and its quota cost, the unconfirmed filter and the revisit condition, single-instance assumption, stopgap admin guard and the F01 dependency, `RATE_LIMITED`, partial runs, known limitations) and update the ADR index
- [x] 6.2 Write `docs/changes/s1-03-erp-sync.md` from `docs/templates/change.md` with real validation output, and update the change index
- [x] 6.3 (all passed on 2026-11-27; `format:check` only fails on CRLF in this Windows checkout) Run `pnpm format:check`, `pnpm verify`, `pnpm test:coverage`, `pnpm build`, `pnpm test:integration`, and `pnpm test:container`
- [x] 6.4 Run `openspec validate s1-03-erp-sync --strict` and `pnpm spec:validate`
- [ ] 6.5 Open the separate web task (badge and admin screen) in the web repository's backlog
- [ ] 6.6 Obtain explicit confirmation immediately before archiving, then archive
