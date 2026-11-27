## Why

The portal screens must stay fast and keep working while the ERP is down, so the backend
keeps its own copy of customers, products, and receivables and refreshes it every 30
minutes (F02 part 3). Changes made in the ERP must show up in the portal within 1 hour,
and an ERP outage or quota limit must never lose, corrupt, or duplicate data (RN-15).
The same task introduces the available credit calculation (RN-01), which Sprint 2 uses to
decide whether an order can be sent.

Decisions D1 to D8 in `design.md` were approved by the task owner as recommended, with
the adjustments recorded there (D7 is an assumption; D8 limits are documented).

## What Changes

- Add an automatic synchronization that reads every customer, product, and receivable
  from the ERP and stores them in the portal database, matching records by their unique
  ERP code so that running it twice never duplicates data.
- Read everything on each run instead of only what changed. It is **not confirmed** that
  the ERP filters by `atualizadoDesde`: the parameter is documented and accepted, but no
  call has shown it filtering (ADR 0003 records this).
- Record every run (start, end, kind, result, records read, records changed, safe error
  detail) and expose the time of the last successful synchronization and whether the ERP
  answered on the latest run.
- Keep the previous copy untouched when a run fails: nothing is written until every
  resource has been read, and all writes of a run happen in one transaction.
- Skip a scheduled run when the previous one is still running, and reject a manual run
  with `409` in the same situation.
- Add `GET /api/v1/sync/status`, `GET /api/v1/sync/runs`, and `POST /api/v1/sync/run`.
  The manual run answers `202` at once and works in the background, so no HTTP request
  waits on the ERP (D3, approved).
- Add `getAvailableCreditCents` (RN-01): credit limit minus the receivables that are not
  paid (open and overdue).
- Add a minimal admin guard for the two admin endpoints (D4, approved), because login
  (F01) does not exist on `develop`. It is a stopgap that F01 replaces.
- Add a corrective migration that adds `RATE_LIMITED` to `SyncResult` (D1, approved).
- Add the `node-cron` dependency (approved in the task statement) and the settings
  `ERP_SYNC_ENABLED` and `ADMIN_API_TOKEN`.
- Record the full-read decision and its quota cost in ADR 0003.

### Non-goals

- Login, sessions, roles, or any user-facing authentication (F01). The admin guard is a
  stopgap only.
- Reading only what changed (`atualizadoDesde`), until the ERP is verified to filter.
- Deleting local records that disappeared from the ERP.
- Orders (`/v1/pedidos`) or any write to the ERP.
- Matching a customer to a seller user (`sellerId`) (D6, approved).
- Historical receivables (`HistoricalReceivable`) and the customer status in the available
  credit. They stay out and are documented as limitations in the spec and in the pull
  request.
- Any change to the ERP client in `src/shared/erp/`, a cancellation or deadline mechanism
  for it, or a distributed lock for several backend instances.
- Pagination, filters, or retention of `SyncRun` rows.
- A "requested by" user on manual runs (needs F01).
- Monitoring or alerting infrastructure: invalid ERP data is logged at error level with
  field paths and shown as a partial run in the admin table.
- The web screens and badge. They belong to the separate web repository (see Impact).

## Capabilities

### New Capabilities

- `erp-sync`: Scheduled and manual synchronization of customers, products, and
  receivables from the ERP, run history, last-synchronization status, and failure
  behavior.
- `available-credit`: The available credit calculation for a customer.
- `admin-access`: The stopgap protection of admin-only endpoints until login exists.

### Modified Capabilities

None. The ERP client, the environment checks of `erp-integration`, and
`backend-foundation` keep their requirements.

## Impact

- **Business:** Portal data is at most about 30 minutes old when the ERP is healthy and
  keeps the last good copy when it is not. Receivables issued before 2026-10-01 do not
  exist in the ERP, so any credit based on them is incomplete (see D5).
- **API:** Three new endpoints and `openapi.json` regenerated from the same Zod schemas.
  No existing endpoint changes.
- **Database migration:** One additive corrective migration (`ALTER TYPE "SyncResult" ADD
VALUE 'RATE_LIMITED'`) (D1, approved). `20261125115933_s1_01_data_model` is already
  merged and is never edited.
- **Security:** A new secret, `ADMIN_API_TOKEN`, used only for the stopgap guard; never
  logged (the `authorization` header is already redacted), compared in constant time, and
  fail-closed when unset. Error details stored in `SyncRun` and returned by the API carry
  no ERP record data, no query strings, and no key.
- **Observability:** One info line per run start and end (counts, result), one warning
  per rejected record batch with resource and field paths only, and an error line for an
  unexpected ERP shape.
- **Quota:** A full read costs 15 calls with page size 50 (33 with 20), 48 times a day,
  on the call quota shared by the whole squad, plus retries. This is the main cost of not
  filtering by date.
- **Runtime and delivery:** Two new settings (`ERP_SYNC_ENABLED`, `ADMIN_API_TOKEN`) in
  `.env.example`, CI, Docker Compose, test setup, and `scripts/test-container.mjs`, so
  `pnpm test:container` applies. Database behavior changes, so `pnpm test:integration`
  applies.
- **Dependencies:** `node-cron` (exact version, at least two weeks old, pinned in
  `pnpm-lock.yaml`).
- **Code:** `src/modules/erp-sync/`, `src/shared/credit/available-credit.ts`, a small
  admin guard in `src/shared/http/`, `src/shared/config/env.ts`, `src/server.ts` and
  `src/app/create-app.ts` (wiring), `prisma/schema.prisma`, and a new migration.
- **Documentation:** ADR `docs/adr/0003-erp-sync-strategy.md` and
  `docs/changes/s1-03-erp-sync.md`.
- **Separate web task (other repository, not part of this change):**
  `src/shared/components/last-sync-badge.tsx` ("Sincronizado com o ERP em [data e hora]"
  and "ERP fora do ar · dados de [hora]" from `GET /sync/status`), and the admin screen
  "Sincronização com o ERP" (runs table from `GET /sync/runs`, "Sincronizar agora" button
  using `POST /sync/run`). It depends on the regenerated `openapi.json` and on F01 for
  non-admin users and for a real admin session. The "limit reached" label must not promise
  a wait of 60 seconds: the ERP client waits up to 60 seconds per `Retry-After`, or 2, 4,
  8, and 16 seconds without it.
