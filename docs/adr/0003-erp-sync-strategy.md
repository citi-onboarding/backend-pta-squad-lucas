---
title: ADR-0003
status: proposed
date: 2026-11-27
owners: []
tags: [erp, synchronization, resilience, security, sprint-1]
supersedes: null
superseded_by: null
---

# 0003: ERP synchronization strategy, run results, and the interim admin guard

## Context

The portal keeps its own copy of ERP customers, products, and receivables so that screens
are fast and keep working while the ERP is down (F02 part 3). Changes made in the ERP must
reach the portal within 1 hour, and an outage or a quota limit must never lose, corrupt, or
duplicate data (RN-15). The call quota of the ERP is shared by the whole squad, and ADR 0002
records how little is verified about the ERP.

Implemented by the OpenSpec change `s1-03-erp-sync` (`openspec/changes/s1-03-erp-sync/`);
the change summary is `docs/changes/s1-03-erp-sync.md`.

### What is and is not known about the ERP (from ADR 0002 and this change)

- **Not confirmed:** that the ERP filters by `atualizadoDesde`. The parameter is documented
  in the Swagger for the three lists and is accepted: a badly formatted value answered `422`
  naming it, and it accepts a plain date or a date-time. No call has shown it actually
  filtering, so it is unknown which field it compares, whether the bound is inclusive, and in
  which time zone.
- **Not verified:** a real `429` and its `Retry-After`, a real `5xx`, and the per-minute
  limit.
- **Confirmed** (ADR 0002): totals of 120 customers, 60 products, and 472 receivables on
  2026-11-26, and receivables exist in the ERP only from 2026-10-01.
- **Confirmed by the manual verification below (recorded on 2026-11-27):** the real ERP
  accepts `tamanho=50`, and a full read returned 120 customers, 60 products, and 485
  receivables (665 records; ADR 0002 observed 472 receivables the day before).
- Login (F01) does not exist on `develop`: there are `User` and `Session` tables and no
  authentication module.

## Decision

1. **Every run reads everything.** A run reads all customers, products, and receivables in
   pages of 50 and follows the `totalPaginas` of the ERP, so a smaller page size accepted by
   the server still works. It never sends `atualizadoDesde`. Computed from the totals (the
   number of calls was not measured), this is 15 calls per run (3 + 2 + 10 pages of 50; 485
   receivables still fit in 10 pages), or 33 at page size 20. At one run every 30 minutes
   that is 720 calls a day (1,584 at page size 20) on the shared quota, before retries.
   One real full read of 665 records took 5 seconds (a single observation). **Revisit condition:** when someone observes the ERP filtering by
   `atualizadoDesde` (which field, inclusive or not, which time zone), a later change can
   read only what changed since the **start time** of the last `SUCCESS` run. The start time
   is the cursor, not the end time, because records may change while a run reads.
2. **All writes of a run are one transaction, after every read.** Nothing is written until
   the three resources have been read and checked, so a failed read leaves the stored copy
   as it was. Only records that differ from the stored ones are written, so unchanged rows
   keep their `updatedAt` and a repeated run reports 0 changed records. Records are matched
   by their unique ERP code. A run never deletes a record the ERP stopped sending (known
   limitation).
3. **Records are checked one by one.** A record with an unknown status or a missing field,
   or a receivable whose customer is not stored, is rejected alone and the run ends as
   `PARTIAL`. The previous copy of a rejected record is kept. Run details and logs carry only
   the resource, a count, and field names. This answers the follow-up of ADR 0002 about one
   unknown status dropping a whole page. A body that is not a list at all fails the run.
4. **Run results.** `SUCCESS`, `PARTIAL`, `FAILED`, and `RATE_LIMITED`. The last one is new:
   it is added to the `SyncResult` enum by the additive corrective migration
   `20261127120000_s1_03_sync_result_rate_limited`; the already merged
   `20261125115933_s1_01_data_model` is untouched. A run is `RATE_LIMITED` when the ERP
   client ends all its attempts with status `429`. The sync adds no wait of its own: the
   client already waits per `Retry-After` (capped at 60 seconds) or 2, 4, 8, and 16 seconds
   across its 5 attempts, and an extra wait would only spend shared quota. The next scheduled
   run is the next try. A label that says the run "waited 60 seconds" would be true only when
   the ERP asked for 60 seconds, so screens must not promise a duration.
5. **Last successful synchronization and ERP availability come from `SyncRun`.** The time is
   the end time of the latest `SUCCESS` run; `PARTIAL`, `FAILED`, and `RATE_LIMITED` never
   move it (RN-15), so a record skipped today can never be passed over by a future
   incremental read. The ERP is reported as unavailable only when the latest finished run
   ended as `FAILED`; a rate-limited ERP did answer.
6. **One run at a time, enforced in process (assumption: single instance).** The scheduler
   (every 30 minutes) and the manual run share one in-process guard. A scheduled tick that
   finds a run in progress is skipped and records nothing; a manual request gets `409`.
   **The backend running as a single instance is an assumption, not a confirmed fact:**
   nobody has verified how production will be deployed. If it runs as several instances,
   each one would run its own synchronization and the quota spent would multiply; a database
   advisory lock would then be needed. A run that never ended (crash or forced stop) is
   completed as `FAILED` ("interrupted") when the backend starts.
7. **The manual run answers `202` and works in the background.** `POST /api/v1/sync/run`
   starts a run and answers at once; its outcome is read from `GET /api/v1/sync/runs`. The
   ERP client has no cancellation and no per-call deadline, and one read can take about 9
   minutes in the worst case (ADR 0002), so no HTTP request waits on it. This replaces the
   separate short-timeout client ADR 0002 suggested for interactive use. On shutdown the
   scheduler stops first and the process waits at most 10 seconds for a run in progress
   before closing the database; the transaction in decision 2 means a cut run stores nothing
   from itself.
8. **Interim admin guard, replaced by F01.** Because login does not exist, the two
   administrator-only endpoints (`GET /api/v1/sync/runs` and `POST /api/v1/sync/run`) accept
   a static bearer token configured in `ADMIN_API_TOKEN` (at least 32 characters). The token
   is compared in constant time through fixed-length digests, is never logged or returned,
   and with no token configured every request is refused. Any failure while deciding is
   also a refusal and leaks no detail. The decision "is this an administrator" is one
   replaceable function, so F01 swaps it for "the session user has role `ADMIN`" without
   changing the endpoints. **Dependency:** the web administrator screen cannot rely on this
   token inside a browser and is only usable for real after F01. `GET /api/v1/sync/status`
   is open (a timestamp and two flags, no error detail) so that every screen can show the
   badge; once F01 exists it should require any signed-in user. `GET /api/v1/sync/runs` is an
   addition to the task statement, accepted by the task owner, because the status response
   must stay free of error details while the administrator table needs them.
9. **Limits of the available credit.** `getAvailableCreditCents(limit, receivables)` is a
   pure function: the credit limit minus the receivables that are `OPEN` or `OVERDUE`,
   with `PAID` not counting (RN-01), on integer cents only (RN-13), and not clamped to zero.
   It uses only the receivables it is given. It does **not** count historical receivables
   loaded from files (`HistoricalReceivable`), and it does not look at the customer status,
   so a blocked customer gets the same arithmetic. Because the ERP has no receivable issued
   before 2026-10-01, the result can overstate the available credit of a customer with an
   older unpaid title. These limits are repeated in the pull request. What blocking or
   history means for an order is a Sprint 2 decision.

## Consequences

### Positive

- An ERP outage, a `429`, or a server failure leaves the stored copy untouched, and the next
  scheduled run recovers by itself.
- Running twice never duplicates data, and a run that changes nothing writes nothing.
- One invalid ERP record no longer hides the rest of a page; it is visible as a `PARTIAL` run.
- No HTTP request ever waits on the ERP, and no secret, record value, or query string reaches
  logs, run details, or responses.
- The ERP shows its own staleness: screens can say when the data was last synchronized and
  whether the ERP answered.

### Negative

- A full read spends 15 or more calls of the shared quota 48 times a day, plus retries, while
  the per-minute limit is unknown. This is the price of not filtering by date.
- A permanently invalid ERP record keeps every run `PARTIAL`, so the "last synchronized"
  time stays old even though most data is fresh; the administrator table shows why.
- A record removed in the ERP stays in the portal.
- The single-instance guard is only valid while the backend runs as one instance.
- The static admin token is a shared secret with no per-person identity and no audit of who
  started a manual run (the run list shows only the kind). It is a stopgap.
- `GET /api/v1/sync/status` is public until F01.
- The one-hour freshness rule holds with a healthy ERP and at most one failed run in a row;
  a longer outage cannot meet it, and the badge says so.
- The available credit can be overstated for customers with receivables older than
  2026-10-01 (decision 9).
- A real `429`, a real `5xx`, the per-minute limit, and the automatic schedule firing on its
  own are still not verified; see the manual verification below.

### Limitations and follow-ups

- Read only what changed once the ERP is confirmed to filter by `atualizadoDesde` (decision
  1).
- A database advisory lock if the backend ever runs as several instances (decision 6).
- Replace the admin guard and protect the status endpoint after F01 (decision 8), and add a
  "requested by" user to manual runs.
- Decide how historical receivables and blocked customers affect the available credit
  (Sprint 2).
- Split `erp-sync.service.ts` and tidy its log messages (see the design's future
  improvements).
- Invalid ERP data is only logged at error level and shown as a `PARTIAL` run; there is no
  alerting infrastructure yet (the alert ADR 0002 asked for).
- Retention of old `SyncRun` rows and pagination of the run list.

### Manual verification with the real ERP

Observed by the developer on the manual run (recorded on 2026-11-27), against the real ERP.
Only what was observed is written here.

**Observed:**

- **Synchronization 1 (empty tables):** `SUCCESS`, 665 records read, 665 changed, 5 seconds.
  The tables then held 120 customers, 60 products, and 485 receivables (665 in total). The
  real server accepted page size 50, which was only documented before.
- **Synchronization 2 (unchanged ERP):** `SUCCESS`, 665 read, 0 changed, and the table counts
  stayed the same.
- **Wrong ERP address:** the run ended as `FAILED` after 42 seconds with the detail
  `ERP GET /v1/clientes failed without a response after 5 attempts` and 0 records read. The
  status showed `erpAvailable` false and `lastSuccessfulSyncAt` kept the time of the last good
  run. The developer checked the database: 120 customers, 60 products, and 485 receivables
  after the failure, the same counts as before.
- **Correct address again:** `SUCCESS`, `erpAvailable` true, and `lastSuccessfulSyncAt`
  updated.

**NOT VERIFIED (not observed):**

- A real `429` (so also the `RATE_LIMITED` result against the real ERP and the real
  `Retry-After`), a real `5xx`, and the per-minute limit.
- The scheduler firing on its own after 30 minutes.
- Shutdown while a run is in progress.
- A `PARTIAL` run with real ERP data (none was reported).
- That the ERP filters by `atualizadoDesde` (not tried; decision 1 stands).
- The web part (the badge and the administrator screen), which is a separate task.

## Alternatives considered

### Ask the ERP only for what changed (`atualizadoDesde`)

Not selected: the parameter is documented and accepted, but filtering was never observed,
and a wrong guess about the bound or the field would silently lose changes (RN-15). Kept as
the first follow-up with an explicit revisit condition.

### A rate-limited run stored as `FAILED` with a text prefix

Not selected: a query or a screen would depend on a text convention and could not tell
"failed" from "limit reached". The corrective migration is additive and cheap.

### Let a `PARTIAL` run move the last successful time

Not selected: with a future incremental read, passing a skipped record would lose it for
good, and the time would mean two different things.

### A synchronous manual run, with or without a shorter-timeout client

Not selected: a run takes 15 or more calls and up to about 9 minutes in the worst case, so
HTTP clients and proxies would time out first, and a short timeout would fail runs that
would have succeeded.

### Leave the administrator endpoints open, or block them until login exists

Not selected: an open `POST /sync/run` spends the shared quota for anyone, and a blocked one
cannot be tested or used. A static token that fails closed is the smallest safe option.

### A database advisory lock now

Not selected: nothing says production has more than one instance, and the lock adds
complexity and behavior tied to pooled connections. Recorded as the answer if the
assumption turns out false.

### Match customers to seller users during the sync

Not selected: no users exist before F01 and matching touches the seller portfolio rule
(RN-08). The ERP seller name is stored as sent.

## References

- OpenSpec change: `openspec/changes/s1-03-erp-sync/` (specs `erp-sync`, `available-credit`,
  `admin-access`, `design.md`, `tasks.md`).
- Change summary: `docs/changes/s1-03-erp-sync.md`.
- ADR 0002 (`docs/adr/0002-erp-api-access.md`): ERP client, retry policy, and unverified
  facts. ADR 0001 (`docs/adr/0001-sprint-1-data-model.md`): the data model.
- Business rules RN-01, RN-08, RN-13, and RN-15.
