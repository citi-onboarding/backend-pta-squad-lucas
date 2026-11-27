## Context

See `proposal.md` (Why) for motivation and `specs/` for the requirements.

Current state, verified in the repository:

- `src/shared/erp/` has `createErpClient` and `erpGet(path, schema)`: 5 attempts in total,
  waits for `Retry-After` (capped at 60 s) or 2, 4, 8, 16 s, request timeout 60000 ms by
  default, no cancellation, no per-call deadline. `ErpError` carries only safe facts.
  Worst case for one read is about 9 minutes (ADR 0002). Nothing uses the client yet.
- `prisma/schema.prisma` already has `Customer`, `Product`, `Receivable` (unique ERP code
  in `erpId`), and `SyncRun` (`kind`, `startedAt`, `finishedAt?`, `result?`,
  `recordsRead`, `recordsChanged`, `errorDetail?`). `SyncResult` is `SUCCESS`, `PARTIAL`,
  `FAILED`. `Receivable.customerId` is a required foreign key. `updatedAt` columns use
  `@updatedAt`, so a blind upsert would change them on every run.
- Login (F01) does not exist on `origin/develop`: there are `User` and `Session` tables
  and no auth module. The `authorization` request header is already redacted in logs.
- `src/app/create-app.ts` is the composition root and `src/server.ts` starts the process
  and handles shutdown. Modules must not import other modules; external dependencies are
  injected.
- ERP facts that matter here (ADR 0002): totals 120 customers, 60 products, 472
  receivables; `tamanho` 1 to 50 is documented, not verified; receivables exist only from
  2026-10-01; a real `429`, the `Retry-After` format, and the per-minute limit are not
  verified; `atualizadoDesde` is accepted (a `422` named it for a bad format) but no call
  has shown it filtering.

## Goals / Non-Goals

**Goals:**

- A synchronization service that is fully testable with a fake ERP client and a real test
  database, with the scheduler and the clock injected.
- A failed or limited run can never damage the stored copy.
- Everything that depends on an unverified ERP fact is isolated and recorded in ADR 0003.

**Non-Goals:**

- Anything listed under Non-goals in `proposal.md`.
- Changing `src/shared/erp/` behavior.

## Decisions

### Resolved by the task owner

**R1. Full read, no `atualizadoDesde`.** The task statement says to ask only for what
changed if the ERP allows it. It is not confirmed that it does, so each run reads
everything (15 calls with page size 50) and records this in ADR 0003 together with the
revisit condition: once someone observes the ERP filtering (and whether the bound is
inclusive, which field it compares, and in which time zone), a later change can read only
`atualizadoDesde` the start time of the last `SUCCESS` run. The service takes the read
step behind one function, so that change is local. **The cursor for that future change is
the start time of a `SUCCESS` run, not its end time**, because records may change while a
run is reading.

**R2. No login in this change.** See D4 for the proposed stopgap.

### Pending approval

**D1. How "rate limit reached" is stored (`SyncResult`).**

- **Option A, no schema change.** Store a rate-limited run as `FAILED` and mark it in
  `errorDetail` with a fixed prefix. Cheap, but the web table and any query would depend
  on a text convention, and `FAILED` and "limit reached" cannot be told apart in a
  filter.
- **Option B, corrective migration (recommended).** Add `RATE_LIMITED` to the enum with a
  new migration. It is additive and safe for deployed environments
  (`ALTER TYPE ... ADD VALUE`), and the merged `s1_01_data_model` migration is untouched
  (AGENTS.md). The three results the prototype shows (OK; failed and will retry; limit
  reached) become three enum values, plus `PARTIAL` for the rejected-record case.
  Cost: one migration, one regenerated Prisma client, one enum value in the OpenAPI
  contract.

The spec is written for option B. The label "limite atingido e esperou 60 s" is a web
label. The backend does not add its own wait: the ERP client already waits up to 60 s per
`Retry-After` (or 2, 4, 8, 16 s when the header is absent) across its 5 attempts, and an
extra wait would only burn shared quota. So "esperou 60 s" is true only when the ERP asks
for 60 s; the web label should not promise a duration.

**D2. Last successful synchronization.** Derived from `SyncRun`, no new column: the end
time of the latest run with result `SUCCESS`. This is exactly the status endpoint's
`lastSuccessfulSyncAt`. A `PARTIAL` run does **not** count (RN-15: only a clean finish
moves it). Reason: with a later incremental read, advancing past a rejected record would
lose it forever. Cost: a permanently invalid ERP record keeps the badge at an old time
while data is otherwise fresh; the admin table shows why. Alternative: let `PARTIAL`
count for the badge only. Rejected for now as it splits one meaning into two.

**D3. Manual run and the ERP client's lack of cancellation and deadline.**

- **Option A, synchronous.** The request waits for the run. One read can take up to about
  9 minutes (ADR 0002), so HTTP clients and proxies time out first. Rejected.
- **Option B, synchronous with a second client with a shorter timeout.** ADR 0002 suggests
  a separate client for interactive use. But a full read is 15 or more calls, and a short
  timeout makes a slow ERP fail a run that would have succeeded. Rejected.
- **Option C, `202` and background (recommended).** `POST /sync/run` reserves the single
  run slot, records the run, answers `202` with the run, and finishes in the background
  with the same client as the scheduler. No HTTP request waits on the ERP, so no
  cancellation is needed for it. The admin sees the outcome in the run list. A second
  request while a run exists gets `409`.

Shutdown (no cancellation exists): on `SIGTERM` the scheduler is stopped first. Then the
process waits for the run in progress for at most 10 s. After that it goes on closing the
HTTP server and the database; it does **not** force the process to exit, so a run still in
progress may stay alive until its current ERP request ends. What such a run can still do
once the database is closed was not verified. Its record keeps no end time and is
completed as `FAILED (interrupted)` at the next startup (spec: "Interrupted runs are closed
at startup"). Since all writes of a run are one transaction, an interruption never leaves
half a run stored. Forcing the exit after the grace period is a deferred improvement (see
"Future improvements").

**D4. Admin guard without login.** `src/shared/http/` gets one function that builds an
Express middleware from an injected `isAdministrator(request)` recognizer. Until F01, the
composition root injects a recognizer that checks `Authorization: Bearer <token>` against
`ADMIN_API_TOKEN` in constant time (compare fixed-length digests with
`timingSafeEqual`). With no token configured it refuses everything. F01 later swaps the
recognizer for "session user has role `ADMIN`" and changes no endpoint (spec:
`admin-access`).

- Alternative: leave the endpoints open until F01. Rejected: `POST /sync/run` spends shared
  squad quota.
- Alternative: block the endpoints entirely until F01. Rejected: the task cannot be
  tested manually and the admin screen has nothing to call.
- Dependency recorded here and in ADR 0003: **F01 must provide the real recognizer, and
  the web admin screen cannot rely on `ADMIN_API_TOKEN` in a browser.** The web
  admin screen is therefore only usable after F01 (or with a developer tool).

**D5. Endpoints, who may call them, and what the badge needs.**

- `GET /api/v1/sync/status`: **open, no credential (recommended for now).** It returns a
  timestamp, one boolean, and one flag, and no error detail, so exposure is low, and the
  badge appears on every screen for every role. When F01 exists, it should require any
  logged-in user. Alternative: protect it with the admin guard, which would make the
  badge impossible for sellers and managers.
- `GET /api/v1/sync/runs`: admin-only, newest first, `limit` default 50, maximum 100.
  **This route is not in the task statement's file list; the task owner accepted it as an
  addition** (cited in the `erp-sync` spec). It is needed because the status response
  must stay free of error details, while the admin table needs them. Alternative:
  return the runs inside `/sync/status` and make that endpoint admin-only.
- "ERP down" is derived: the most recent finished run ended as `FAILED`. `RATE_LIMITED`
  means the ERP answered, so it is not "down". `PARTIAL` and `SUCCESS` mean it answered.

**D6. Seller matching is out of this change.** The ERP seller name is stored in
`Customer.erpSellerName` as the data model comment says ("`sellerId` is filled by matching
it"), but `sellerId` is not touched by the sync. No users exist before F01 and matching
touches RN-08 (portfolio). A later task fills `sellerId`, either at the end of a run or
when a user is created.

**D7. Single backend instance.** The "skip if the previous one is still running" rule
uses an in-process guard shared by the scheduler and the manual run, plus the startup
cleanup of open runs. If the backend ever runs as several instances, two instances would
both run. Alternative for that day: a database advisory lock. Not needed now.
**"Single instance" is an assumption, not a confirmed fact:** nobody has verified how
production will be deployed. ADR 0003 records it as an assumption, together with what
breaks if it is false (two instances run at once and double the quota spent).

**D8. Available credit scope.** `getAvailableCreditCents(creditLimitCents, receivables)`
is a pure function in `src/shared/credit/available-credit.ts`; it reads nothing from the
database and lets Sprint 2 pass in the customer's receivables. Unpaid means `OPEN` and
`OVERDUE`; `PAID` does not count (RN-01). The result is not clamped, so a negative value
tells the caller the customer is over the limit. **Decided by the task owner:** the
function is pure and works on `Receivable` rows only. Two points are out and documented
as limitations in the spec (`available-credit`) and in the pull request:

- Historical receivables (`HistoricalReceivable`, loaded from CSV) are not counted.
  Receivables issued before 2026-10-01 are not in the ERP, so the available credit of a
  customer with an older unpaid title is overstated.
- The customer's status is not considered: a `BLOCKED` customer gets the same arithmetic
  as an active one. Whether and how blocking affects an order is a Sprint 2 rule.

### Technical decisions (no approval needed)

**T1. Read everything, then write once.** A run reads customers, products, and receivables
page by page (`tamanho=50`) until the `totalPaginas` of the first answer, with no database
transaction open. Only after the three reads, each item is checked record by record. Then
it loads the stored rows of the three tables, computes what is new or different (so
`updatedAt` and `recordsChanged` stay honest), and writes only the differences inside one
transaction with an explicit timeout (Prisma's default is 5 s). Volume is about 650
records, so loading the three tables is cheap; revisit if the ERP grows by orders of
magnitude. Records can move between pages while the read is in progress; an upsert makes
duplicates impossible and a record missed once is picked up by the next run.

**T2. Item validation is separate from page validation.** The list is read with a page
schema whose items are unvalidated; each record is then checked with the existing
customer, product, and receivable schemas. This is what lets one unknown status reject a
single record (the follow-up ADR 0002 asks for) instead of discarding the page. A body
that is not a list at all still fails the whole run through the client.

**T3. Run record.** The row is created when the run starts (`finishedAt` and `result`
empty) and completed in one update at the end. `errorDetail` is built from `ErpError`
fields only (kind, status, path without query string, attempts, `requestId`) or from
counts and field names; it never receives a free-form message from another source.

**T4. Module layout.** `src/modules/erp-sync/` has the service (orchestration), a
repository for the database work, the router, the OpenAPI registration, the scheduler,
and the Zod schemas. The ERP client, database, clock, logger, and cron are injected.
`src/server.ts` creates the client and scheduler; `createApp` receives the service for
the routes, and `createApp` never starts a scheduler (tests would otherwise call the
ERP).

**T5. Scheduling.** `node-cron` with `*/30 * * * *`, started by `src/server.ts` only when
`ERP_SYNC_ENABLED` is true. There is no run at startup: a restart loop in development must
not spend the squad's quota. The first run happens at the next half hour, or on demand.
The schedule function is injected so tests fire ticks by hand.

**T6. Settings.** `ERP_SYNC_ENABLED` is parsed from the strings `true` and `false`
explicitly (not `z.coerce.boolean`, which turns the string `"false"` into `true`) and
defaults to `true`. `ADMIN_API_TOKEN` is optional, at least 32 characters when present.
The shared test setup (`tests/setup-env.ts`), CI (`.github/workflows/ci.yml`), Docker
Compose, the container test script, and `.env.example` set `ERP_SYNC_ENABLED=false` (and
no token) so nothing calls the ERP. The `Dockerfile` sets no ERP setting and needs no
change. `.env.example` keeps `ADMIN_API_TOKEN` as a commented placeholder, so a copied
file never carries a usable token.

**T7. One-hour freshness.** With a 30-minute schedule and a healthy ERP, a change reaches
the portal in at most 30 minutes plus the run time, within the 1-hour rule. One failed
run in a row still stays inside it; longer outages cannot be inside it by nature, and the
badge says so.

## Risks / Trade-offs

- [Full read spends 15+ calls of the shared quota 48 times a day] → ADR 0003 records the
  cost and the revisit condition; page size 50 is the documented maximum, and the run
  follows the server's own `totalPaginas`, so a smaller accepted size still works.
- [`tamanho=50` was only documented] → confirmed: the real ERP accepted `tamanho=50` on
  2026-11-27 (manual verification, ADR 0003). The `pagina` minimum of 1 is still only
  documented. If a later ERP change rejects the page size, the run fails with a `422` detail
  naming `tamanho`, and the constant is changed.
- [A real `429` was never observed] → the `RATE_LIMITED` mapping rests on the status code,
  which the client already treats as retryable; nothing depends on `Retry-After`.
- [An old unpaid receivable before 2026-10-01 is invisible] → D8 flags it for the owner.
- [Backend stops while a run is in progress] → the single transaction keeps data
  consistent and startup closes the orphan run.
- [Stopgap token travels as a static secret] → fail-closed, constant-time compare,
  redacted logs, replaced by F01; documented as temporary.
- [The status endpoint is open until F01] → payload is limited to a timestamp and two
  flags; D5 records the follow-up.
- [A permanently invalid ERP record keeps `PARTIAL` forever and the badge old] → D2
  accepts this on purpose; the run table shows the rejected counts.
- [An ERP record deleted upstream stays in the portal] → out of scope; recorded in ADR
  0003 as a known limitation.

## Migration Plan

1. If D1 is approved: add a new migration (never edit `20261125115933_s1_01_data_model`)
   containing `ALTER TYPE "SyncResult" ADD VALUE 'RATE_LIMITED'`, and regenerate the
   Prisma client. It is additive; deployed rows stay valid.
2. Deploy with `ERP_SYNC_ENABLED` unset (enabled by default) and `ADMIN_API_TOKEN` set.
3. Rollback: set `ERP_SYNC_ENABLED=false`. Rows already written stay valid. The enum
   value is not removed (additive migrations are not reverted).

## Future improvements

Deliberately not done in the Refactor of this change, to keep it small and its behavior
frozen:

- Split `src/modules/erp-sync/erp-sync.service.ts` (reading pages, mapping and checking
  records, diffing against stored rows, and run bookkeeping) into smaller files. It is
  about 450 lines, but every part is covered by `erp-sync.service.test.ts`, so the split
  can be done later without changing behavior.
- Call `process.exit` (or an equivalent forced close) after the 10 s grace period at
  shutdown, so a run still in progress cannot keep the process alive.
- Tidy the log messages of the service and the scheduler (names of fields and wording are
  slightly inconsistent between them). Tests assert only a few fields, so this is safe
  later.

## Open Questions

- Does the ERP honour `atualizadoDesde` as a filter? Settled by a future observation, not
  by this change (R1).
- Should the first run after an empty database start on boot instead of waiting for the
  next half hour? It can be changed without touching specs or tasks (T5).
