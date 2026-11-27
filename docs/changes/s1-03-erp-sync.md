---
change_id: s1-03-erp-sync
date: 2026-11-27
status: in-progress
owners: []
tags: [erp, synchronization, resilience, credit, backend, sprint-1]
related_adrs: [ADR-0003]
openspec_change: openspec/changes/s1-03-erp-sync/
---

# ERP synchronization and available credit

## Objective

Keep a copy of ERP customers, products, and receivables in the portal database, refreshed
every 30 minutes without duplicating data, so that screens are fast and keep working while
the ERP is down, and add the available credit calculation (RN-01) that Sprint 2 will use.
Web screens are a separate task in the web repository.

## Change made

- **Synchronization service** (`src/modules/erp-sync/`). Each run reads all customers,
  products, and receivables in pages of 50 through the existing ERP client, checks the
  records one by one, compares them with the stored rows, and writes only the differences in
  one transaction, matching by the unique ERP code. Nothing is written until every resource
  has been read. `src/shared/erp/` is unchanged.
- **Full read, no date filter.** It is not confirmed that the ERP filters by
  `atualizadoDesde`, so every run reads everything (15 calls with the observed totals); see
  ADR 0003.
- **Run history.** Every run is recorded in `SyncRun` when it starts and completed when it
  ends, with kind, result, records read, records changed, and a safe error detail. New result
  `RATE_LIMITED` through the additive migration
  `prisma/migrations/20261127120000_s1_03_sync_result_rate_limited/`; the applied
  `s1_01_data_model` migration is untouched. The Prisma client was regenerated.
- **Scheduler and runtime** (`src/app/erp-sync-runtime.ts`, `src/server.ts`). A `node-cron`
  job (`node-cron` 4.6.0) fires every 30 minutes and skips the tick when a run is already in
  progress. On startup, runs that never ended are completed as `FAILED` (interrupted). On
  shutdown the schedule stops and the process waits at most 10 seconds for a run in progress
  (timer that does not hold the process). `createApp` and the scheduler share one service,
  so the one-run-at-a-time rule holds for both.
- **Endpoints** (`src/modules/erp-sync/erp-sync.router.ts`, `openapi.json` regenerated from
  the same Zod schemas): `GET /api/v1/sync/status` (open), `GET /api/v1/sync/runs`
  (administrators; an addition to the task statement accepted by the task owner), and
  `POST /api/v1/sync/run` (administrators, answers `202`).
- **Interim admin guard** (`src/shared/http/require-admin.ts`). A static bearer token
  (`ADMIN_API_TOKEN`) behind one replaceable recognizer, until login (F01) exists.
- **Available credit** (`src/shared/credit/available-credit.ts`).
  `getAvailableCreditCents(limit, receivables)`: limit minus `OPEN` and `OVERDUE` receivables,
  `PAID` not counted, integer cents, not clamped to zero.
- **Settings.** `ERP_SYNC_ENABLED` (`true` or `false`, default `true`) and `ADMIN_API_TOKEN`
  (optional, at least 32 characters) in `src/shared/config/env.ts`. `ERP_SYNC_ENABLED=false`
  was added to the test setup, CI, Docker Compose, the container test script, and
  `.env.example`; `ADMIN_API_TOKEN` is a commented placeholder in `.env.example`.
- **Test support.** `tests/support/fake-erp.ts` (invented ERP data and a fake ERP client) and
  `tests/support/test-environment.ts` (one test `Environment`). Automated tests never call the
  real ERP.
- **Decision record.** ADR 0003.

## Resulting behavior

- A first run on an empty database stores every ERP customer, product, and receivable, links
  each receivable to its customer, and reports the records read and changed.
- A second run with unchanged ERP data ends as `SUCCESS`, adds no rows, leaves every
  `updatedAt` as it was, and reports 0 records changed. A changed ERP record updates only
  its own row.
- When the ERP cannot be reached or answers with an error, the run ends as `FAILED`, the
  stored data stays exactly as it was, and the next scheduled run tries again. A failure after
  the first resource was read stores nothing from that run.
- When every attempt of the ERP client is answered with `429`, the run ends as
  `RATE_LIMITED` and keeps the data. The sync adds no wait of its own.
- A record with an unknown status or a missing field, or a receivable whose customer is not
  stored, is rejected alone; the run ends as `PARTIAL`, keeps the previous copy of that
  record, and its detail and logs name only the resource, the count, and the field names.
- If the database rejects a value (for example an amount that does not fit a 32-bit integer),
  the run ends as `FAILED` with a generic detail and nothing from the run is stored.
- The last successful synchronization is the end time of the latest `SUCCESS` run; `PARTIAL`,
  `FAILED`, and `RATE_LIMITED` do not move it. The ERP is reported unavailable only when the
  latest finished run is `FAILED`.
- `POST /api/v1/sync/run` answers `202` with the run and works in the background, answers
  `409` while another run is in progress, and `401` without the administrator token (also
  when no token is configured). `GET /api/v1/sync/runs` is newest first, with `limit` 50 by
  default and 100 at most (`400` otherwise).
- A record removed from the ERP stays in the portal.

## Impact

- **Database:** one additive migration (enum value). No existing data changes.
- **API:** three new endpoints and an `openapi.json` with 311 added lines and none removed.
  No existing endpoint changes.
- **Quota:** a full read costs 15 calls (computed from the totals; the real count of calls
  was not measured; 33 at page size 20, which the real server did not require because it
  accepts 50) every 30 minutes, 720 a day, plus retries, on the call quota shared by the
  whole squad. This is the main cost of not filtering by date.
- **Configuration:** new optional `ADMIN_API_TOKEN` and `ERP_SYNC_ENABLED` (default `true`).
  A deployment without `ADMIN_API_TOKEN` runs the scheduler but refuses every administrator
  request. Local development should keep `ERP_SYNC_ENABLED=false` and start a run with
  `POST /api/v1/sync/run`.
- **Security:** a new shared secret that only the backend reads. It is compared in constant
  time, never logged, and the endpoints fail closed.
- **Web and mobile:** the badge ("Sincronizado com o ERP em …" and "ERP fora do ar · dados
  de …") and the administrator screen "Sincronização com o ERP" are a separate task in the
  web repository. The "limit reached" label must not promise a 60-second wait. The
  administrator screen is only usable for real after F01.
- **Known limitations of the available credit** (repeat them in the pull request):
  - historical receivables loaded from files (`HistoricalReceivable`) are not counted;
  - the customer status is not considered, so a blocked customer gets the same arithmetic;
  - the ERP has no receivable issued before 2026-10-01, so the result can overstate the
    available credit of a customer with an older unpaid title.

## Validations executed

Run on Windows on 2026-11-27, rerun at closing (after the Refactor and the manual verification), with the working tree line endings
as checked out (`core.autocrlf=true`). The real ERP was not called by any of these commands.

| Command                                                 | Result                                                                                                                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:coverage` (unit, integration tests excluded) | 25 files, 300 tests passed. Coverage over `src/shared/**`: statements 98.43%, branches 96.77%, functions 97.87%, lines 98.38% (limits 90, 85, 90, 90). Thresholds met.                              |
| `vitest run --config vitest.integration.config.ts`      | 8 files, 63 tests passed (Testcontainers PostgreSQL, all migrations applied), 8 of them for this change.                                                                                            |
| `pnpm typecheck` (`tsc --noEmit`) and `pnpm build`      | Passed.                                                                                                                                                                                             |
| `pnpm lint` (`eslint .`)                                | Passed.                                                                                                                                                                                             |
| `pnpm openapi:check`                                    | Passed.                                                                                                                                                                                             |
| `openspec validate s1-03-erp-sync --strict`             | Valid.                                                                                                                                                                                              |
| `pnpm spec:validate`, `pnpm skills:check`               | Passed.                                                                                                                                                                                             |
| `pnpm test:container`                                   | Passed: the three migrations applied (including `20261127120000_s1_03_sync_result_rate_limited`) and the API container started with synchronization disabled.                                       |
| `pnpm format:check`                                     | Fails only because of CRLF line endings in the Windows working tree (the same Windows-only failure recorded in `s1-02-erp-client`). With `prettier --end-of-line auto --check .` every file passes. |

The Red evidence (110 unit and 8 integration tests failing on assertions against inert stubs,
then 14 of 15 wiring tests) and the Green evidence are in the pull request.

### Manual verification with the real ERP

Observed by the developer against the real ERP (recorded on 2026-11-27). Only what was
observed is written here; the same record is in ADR 0003.

| Step                             | Observed                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synchronization 1, empty tables  | `SUCCESS`, 665 records read, 665 changed, 5 seconds. Tables: 120 customers, 60 products, 485 receivables (665 in total). The real server accepted page size 50, which was only documented before.                                                                                           |
| Synchronization 2, unchanged ERP | `SUCCESS`, 665 read, 0 changed, same table counts.                                                                                                                                                                                                                                          |
| Wrong ERP address                | `FAILED` after 42 seconds, detail `ERP GET /v1/clientes failed without a response after 5 attempts`, 0 records read, `erpAvailable` false, `lastSuccessfulSyncAt` kept the time of the last good run. Table counts checked in the database after the failure: 120, 60, and 485 (unchanged). |
| Correct address restored         | `SUCCESS`, `erpAvailable` true, `lastSuccessfulSyncAt` updated.                                                                                                                                                                                                                             |

**NOT VERIFIED (not observed):** a real `429` (and with it `RATE_LIMITED` and `Retry-After`
against the real ERP), a real `5xx`, the per-minute limit, the scheduler firing on its own
after 30 minutes, shutdown while a run is in progress, a `PARTIAL` run with real ERP data,
that the ERP filters by `atualizadoDesde`, and the web part (a separate task).

## Related artifacts

- Proposal: `openspec/changes/s1-03-erp-sync/proposal.md`
- Specifications: `openspec/changes/s1-03-erp-sync/specs/erp-sync/spec.md`,
  `specs/available-credit/spec.md`, and `specs/admin-access/spec.md`
- Design: `openspec/changes/s1-03-erp-sync/design.md`
- Tasks: `openspec/changes/s1-03-erp-sync/tasks.md`
- ADR: `docs/adr/0003-erp-sync-strategy.md` (proposed); related ADRs `0001` and `0002`

## Usage

- Set `ADMIN_API_TOKEN` (at least 32 random characters) in the ignored `.env` file. Keep
  `ERP_SYNC_ENABLED=false` locally to save the shared ERP quota; set it to `true` (or leave it
  unset) where the 30-minute schedule must run.
- Start a run: `POST /api/v1/sync/run` with the header `Authorization: Bearer <token>`. It
  answers `202`; read the outcome from `GET /api/v1/sync/runs` (same header), or open the
  tables with `pnpm db:studio`.
- Show freshness: `GET /api/v1/sync/status` (no credentials) returns the last successful time,
  whether a run is in progress, and whether the ERP answered on the latest finished run.
- Credit: call `getAvailableCreditCents(creditLimitCents, receivables)` from
  `src/shared/credit/available-credit.ts` with the customer's receivables.

## Implementation notes

- **Assumption, not a fact:** the backend runs as a single instance (ADR 0003).
- **Confirmed by the manual run:** the real ERP accepts `tamanho=50`.
- **NOT VERIFIED:** a real `429` and its `Retry-After`, a real `5xx`, the per-minute limit,
  that `atualizadoDesde` filters, the automatic schedule firing after 30 minutes, and
  shutdown during a run. Everything that depends on them is isolated and recorded in ADR 0003.
- **Future improvements, not done:** split `erp-sync.service.ts`, tidy its log messages, read
  only what changed once the filter is confirmed, a database lock for several instances,
  alerting for invalid ERP data, and purging old `SyncRun` rows.
- **Fixtures.** `create-app.test.ts` and `example-items.integration.test.ts` build their
  `Environment` with `createTestEnvironment` now; their assertions did not change.
- **Windows only.** The CRLF-only `format:check` failure is a property of the checkout, not of
  this change.
