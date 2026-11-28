# erp-sync Specification

## Purpose

Keeps a copy of ERP customers, products, and receivables in the portal database, refreshed
automatically every 30 minutes, so that screens are fast and keep working while the ERP is
down. Records every run and reports how fresh the copy is.

## Requirements

### Requirement: Complete copy of ERP customers, products, and receivables

Each synchronization run MUST read every customer, product, and receivable available in
the ERP, following the pages announced by the ERP until the last one, and MUST store them
in the portal database. A run MUST NOT depend on the ERP filtering by update date. Each
resource MUST be read in pages of 50 records. Customers MUST be stored before receivables,
because a receivable belongs to a customer.

The stored customer fields are the ERP code, name, tax id, city, state, segment, status,
credit limit in cents, and the seller name exactly as the ERP sends it. The stored product
fields are the ERP code, description, category, unit, list price in cents, and the active
flag. The stored receivable fields are the ERP title number, the customer, the ERP order
number, the installment, the amount in cents, the issue date, the due date, the payment
date (empty when unpaid), and the status. Customer status `ATIVO`, `BLOQUEADO`, and
`INATIVO` MUST be stored as `ACTIVE`, `BLOCKED`, and `INACTIVE`. Receivable status
`PAGO`, `EM_ABERTO`, and `VENCIDO` MUST be stored as `PAID`, `OPEN`, and `OVERDUE`. Money
MUST stay in integer cents.

#### Scenario: First run on an empty database

- **WHEN** a run reads 3 customers, 2 products, and 4 receivables from the ERP and the portal database has none of them
- **THEN** the run ends as `SUCCESS`, the database holds exactly those 3 customers, 2 products, and 4 receivables, and the run reports 9 records read and 9 records changed

#### Scenario: Records spread over several pages

- **WHEN** the ERP answers a resource with 3 pages
- **THEN** the run reads all 3 pages of that resource and stores the records of every page

#### Scenario: Status values are translated

- **WHEN** the ERP sends a customer with status `BLOQUEADO` and receivables with status `PAGO`, `EM_ABERTO`, and `VENCIDO`
- **THEN** the stored customer is `BLOCKED` and the stored receivables are `PAID`, `OPEN`, and `OVERDUE`

#### Scenario: A receivable keeps its payment date

- **WHEN** the ERP sends a receivable with no payment date and another with a payment date
- **THEN** the first is stored with an empty payment date and the second with that date

### Requirement: Bounded page reading

The number of pages of a resource MUST be fixed by the first page the ERP answers and MUST
NOT change if a later page announces another total. A resource that announces more than 100
pages MUST make the run end as `FAILED` without reading any further page, of that resource
or of another, and nothing from the run MUST be stored. A page with no records MUST end the
read of that resource, even when more pages were announced; the records read before it are
kept for the run. The error detail of a run that exceeded the limit MUST name the ERP path
without a query string and the limit, and MUST NOT contain record values.

#### Scenario: A later page announces another total

- **WHEN** the first page of a resource announces 3 pages and the second page announces 10
- **THEN** the run reads exactly 3 pages of that resource

#### Scenario: More than 100 pages are announced

- **WHEN** the first page of a resource announces 101 pages
- **THEN** the run ends as `FAILED`, the ERP receives no further request after that first page, nothing is stored, and the detail names the path and says it announces more than 100 pages

#### Scenario: Exactly 100 pages are announced

- **WHEN** the first page of a resource announces 100 pages and every page has records
- **THEN** the run reads all 100 pages and stores their records

#### Scenario: A page with no records ends the read

- **WHEN** the first page of a resource announces 3 pages, the second page has no records, and the third page would have records
- **THEN** the run does not request the third page and keeps the records of the first page

### Requirement: Running twice never duplicates data

Records MUST be matched by their unique ERP code (customer and product code, receivable
title number). A record that already exists MUST be updated only when at least one stored
field differs. A record that does not exist MUST be created. The number of records changed
MUST count only records created or updated.

#### Scenario: Second run with the same ERP data

- **WHEN** a successful run is followed by another run and the ERP data did not change
- **THEN** the second run ends as `SUCCESS`, the number of customers, products, and receivables in the database is the same as after the first run, and the second run reports 0 records changed

#### Scenario: A record changed in the ERP

- **WHEN** the ERP now sends a customer with a different credit limit and every other record is unchanged
- **THEN** the run updates that customer only, the database keeps one row for that customer, and the run reports 1 record changed

#### Scenario: A receivable is paid in the ERP

- **WHEN** a stored `OPEN` receivable is sent by the ERP as `PAGO` with a payment date
- **THEN** the stored receivable becomes `PAID` with that payment date and no second row is created

### Requirement: Records removed from the ERP are kept

A run MUST NOT delete a stored customer, product, or receivable because the ERP no longer
sends it.

#### Scenario: A stored record is missing from the ERP answer

- **WHEN** the ERP answers without a customer that is stored in the portal database
- **THEN** that customer is still stored after the run

### Requirement: A failed run keeps the previous copy

Nothing MUST be written to customers, products, or receivables until every resource has
been read and checked. All writes of one run MUST succeed or fail together. When the ERP
cannot be read (no connection, timeout, server error, or any rejected request), the run
MUST end as `FAILED`, MUST leave the stored customers, products, and receivables as they
were, and MUST NOT stop later runs from trying again.

#### Scenario: The ERP is unreachable

- **WHEN** a run cannot reach the ERP and the database holds data from an earlier successful run
- **THEN** the run ends as `FAILED` with a safe error detail, and every stored customer, product, and receivable is unchanged

#### Scenario: The ERP fails after the first resource was read

- **WHEN** customers are read successfully and the product read then fails
- **THEN** the run ends as `FAILED` and no customer from this run is stored

#### Scenario: The database cannot store a value

- **WHEN** a record from the ERP holds an amount that does not fit the database's integer column and the other records are valid
- **THEN** the run ends as `FAILED`, nothing from that run is stored, and the error detail says only that the database rejected the changes, without quoting any value

#### Scenario: The next run recovers

- **WHEN** a `FAILED` run is followed by a run while the ERP answers normally
- **THEN** the later run ends as `SUCCESS` and the database holds the current ERP data

### Requirement: Rate limit is reported as its own result

When the ERP keeps answering that the request limit was exceeded after the ERP client has
used all its attempts (including the waits it makes for that status), the run MUST end as
`RATE_LIMITED`, MUST leave the stored data unchanged, and MUST NOT retry on its own before
the next scheduled run.

#### Scenario: The ERP limit is still exceeded after the client waited

- **WHEN** every attempt of an ERP read is answered with status `429`
- **THEN** the run ends as `RATE_LIMITED`, the stored data is unchanged, and the error detail states that the limit was reached

#### Scenario: A single 429 is absorbed

- **WHEN** one ERP request is answered with `429` and the next attempt succeeds
- **THEN** the run ends as `SUCCESS`

### Requirement: Invalid ERP records are rejected one by one

A record that does not match the expected shape (for example an unknown status, a missing
field, or a receivable whose customer is not stored) MUST be rejected alone. The other
records of the run MUST still be stored. A run that rejected at least one record MUST end
as `PARTIAL`. A rejected record MUST keep its previously stored copy, if any. The run
detail and the logs MUST report only the resource, the number of rejected records, and the
names of the invalid fields, never record values.

#### Scenario: One customer has an unknown status

- **WHEN** the ERP sends 3 customers and one has a status that is not `ATIVO`, `BLOQUEADO`, or `INATIVO`
- **THEN** the other 2 customers are stored, the run ends as `PARTIAL`, and the detail says that 1 customer record was rejected without showing its values

#### Scenario: A receivable refers to a customer that is not stored

- **WHEN** the ERP sends a receivable whose customer code is not among the stored customers
- **THEN** that receivable is rejected, the other receivables are stored, and the run ends as `PARTIAL`

#### Scenario: An envelope the client cannot read

- **WHEN** an ERP list answers `200` with a body that is not a list of records at all
- **THEN** the run ends as `FAILED` and nothing is stored

### Requirement: Every run is recorded

Every run, automatic or manual, MUST be recorded when it starts, with its kind
(`AUTOMATIC` or `MANUAL`) and start time, and MUST be completed when it ends with its end
time, its result (`SUCCESS`, `PARTIAL`, `FAILED`, or `RATE_LIMITED`), the number of
records read, the number of records changed, and a safe error detail when the run did not
end as `SUCCESS`. The number of records read MUST count every record the ERP returned,
including rejected ones. A run that has started and not ended MUST have no end time and no
result. The error detail MUST NOT contain the ERP key, record values, or query strings.

#### Scenario: A successful run is recorded

- **WHEN** a run ends as `SUCCESS`
- **THEN** its record has an end time, result `SUCCESS`, the counts of records read and changed, and no error detail

#### Scenario: A failed run is recorded

- **WHEN** a run ends as `FAILED`
- **THEN** its record has an end time, result `FAILED`, and an error detail naming the ERP path and the kind of failure without a query string

#### Scenario: A run in progress is visible

- **WHEN** a run has started and not ended
- **THEN** its record has a start time, no end time, and no result

### Requirement: Last successful synchronization

The time of the last successful synchronization MUST be the end time of the most recent
run whose result is `SUCCESS`. A run that ended as `PARTIAL`, `FAILED`, or `RATE_LIMITED`
MUST NOT change it. It MUST be empty when no run has succeeded yet.

#### Scenario: A failure does not move the time

- **WHEN** a `SUCCESS` run ended at 10:00 and a later run ended as `FAILED` at 10:30
- **THEN** the last successful synchronization is still 10:00

#### Scenario: A partial run does not move the time

- **WHEN** a `SUCCESS` run ended at 10:00 and a later run ended as `PARTIAL` at 10:30
- **THEN** the last successful synchronization is still 10:00

#### Scenario: No successful run yet

- **WHEN** the only recorded runs ended as `FAILED`
- **THEN** the last successful synchronization is empty

### Requirement: Automatic synchronization every 30 minutes

When automatic synchronization is enabled, the backend MUST start a run of kind
`AUTOMATIC` every 30 minutes while it is running. A scheduled run MUST be skipped, without
recording a run and without calling the ERP, when another run (automatic or manual) is
still in progress. Automatic synchronization MUST be enabled by default and MUST be
switchable by the `ERP_SYNC_ENABLED` setting (`true` or `false`); any other value MUST
make startup fail naming `ERP_SYNC_ENABLED`. When it is disabled, no scheduled run starts.

#### Scenario: The schedule fires

- **WHEN** 30 minutes pass with automatic synchronization enabled and no run in progress
- **THEN** a run of kind `AUTOMATIC` starts

#### Scenario: The previous run is still running

- **WHEN** the schedule fires while another run is in progress
- **THEN** no new run starts, no run record is added, and the ERP receives no call from the skipped tick

#### Scenario: Automatic synchronization is disabled

- **WHEN** the backend starts with `ERP_SYNC_ENABLED=false`
- **THEN** no scheduled run ever starts, and the manual run still works

#### Scenario: Invalid setting

- **WHEN** the backend starts with `ERP_SYNC_ENABLED=maybe`
- **THEN** startup fails with an error naming `ERP_SYNC_ENABLED`

### Requirement: Manual synchronization

`POST /api/v1/sync/run` MUST be available to administrators only. It MUST start a run of
kind `MANUAL` and answer `202` with the identifier, kind, and start time of the new run
without waiting for the run to end. When another run is in progress it MUST answer `409`
as a problem response and MUST NOT start a run. The outcome of the run MUST be read from
the run list.

#### Scenario: An administrator starts a run

- **WHEN** an administrator calls `POST /api/v1/sync/run` and no run is in progress
- **THEN** the response is `202` with the new run, and the run appears in the run list with kind `MANUAL`

#### Scenario: A run is already in progress

- **WHEN** an administrator calls `POST /api/v1/sync/run` while a run is in progress
- **THEN** the response is `409` with a problem body, and no run record is added

#### Scenario: The ERP is down during a manual run

- **WHEN** a manual run starts while the ERP cannot be reached
- **THEN** the `202` answer is not delayed by the ERP, and the run later ends as `FAILED`

#### Scenario: A caller who is not an administrator

- **WHEN** `POST /api/v1/sync/run` is called without administrator credentials
- **THEN** the response is `401` and no run starts

### Requirement: Synchronization status

`GET /api/v1/sync/status` MUST return the time of the last successful synchronization
(empty when there is none), whether a run is in progress, and whether the ERP answered on
the most recent finished run. The ERP MUST be reported as unavailable only when the most
recent finished run ended as `FAILED`; `SUCCESS`, `PARTIAL`, and `RATE_LIMITED` mean it
answered. With no finished run, availability MUST be reported as unknown. The response
MUST be validated against its published schema and MUST NOT contain error details.

#### Scenario: Healthy

- **WHEN** the most recent finished run ended as `SUCCESS` at 10:00
- **THEN** the status shows last successful synchronization 10:00, the ERP as available, and no run in progress

#### Scenario: ERP down

- **WHEN** a `SUCCESS` run ended at 10:00 and the most recent finished run ended as `FAILED`
- **THEN** the status shows last successful synchronization 10:00 and the ERP as unavailable

#### Scenario: Rate limited is not down

- **WHEN** the most recent finished run ended as `RATE_LIMITED`
- **THEN** the status shows the ERP as available

#### Scenario: Never synchronized

- **WHEN** no run has finished
- **THEN** the status shows no last successful synchronization and the ERP availability as unknown

### Requirement: Run list for administrators

This route is an addition to the original task statement, which lists only `GET
/api/v1/sync/status` and `POST /api/v1/sync/run`; the task owner accepted it because the
status response carries no error details and the administrator table needs them.
`GET /api/v1/sync/runs` MUST be available to administrators only and MUST return the most
recent runs, newest first, with identifier, kind, start time, end time (empty while
running), result (empty while running), records read, records changed, and the safe error
detail. It MUST return at most the number of runs requested by the optional `limit` query
parameter, which defaults to 50 and MUST NOT exceed 100. An invalid `limit` MUST be
answered with `400` as a problem response, like every other invalid request of this API.

#### Scenario: Newest first

- **WHEN** an administrator lists runs and three runs exist
- **THEN** the three runs are returned ordered from the latest start time to the earliest

#### Scenario: Limit applies

- **WHEN** an administrator lists runs with `limit=2` and three runs exist
- **THEN** only the two newest runs are returned

#### Scenario: Limit above the ceiling

- **WHEN** an administrator lists runs with `limit=101`
- **THEN** the response is `400` as a problem response

#### Scenario: Not an administrator

- **WHEN** `GET /api/v1/sync/runs` is called without administrator credentials
- **THEN** the response is `401`

### Requirement: Interrupted runs are closed at startup

When the backend starts, every run that was started and never ended MUST be completed with
the result `FAILED` and an error detail stating that it was interrupted, so that it is
never shown as running forever and never blocks a later run.

#### Scenario: The backend stopped during a run

- **WHEN** the backend starts and a run record has a start time but no end time
- **THEN** that run is completed as `FAILED` with an interruption detail, and the next run can start

### Requirement: Safe diagnostics

Synchronization MUST NOT write the ERP key, record values, request bodies, or query
strings to logs, run details, or API responses. Logs MUST carry only run identifier,
kind, result, counts, durations, resource names, and field names.

#### Scenario: Rejected record values stay out

- **WHEN** a run rejects a record that contains a customer name
- **THEN** that name appears in no log line, run detail, or API response
