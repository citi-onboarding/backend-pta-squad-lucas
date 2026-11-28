## Context

See `proposal.md` for motivation and scope, and `specs/contract-status/spec.md` for the required behavior. There is no `contracts` module yet; the Prisma model for contracts is owned by another task and may not exist. This change therefore adds only a pure function inside a new `src/modules/contracts/` folder, with no repository, service, router, or schema.

## Goals / Non-Goals

**Goals:**

- One pure, deterministic function that later parts of F21 (seed, endpoint, web table) can call.
- Follow the signature, return shape, and precedence of the example provided by the F21 task.

**Non-Goals:**

- Input validation. The function trusts valid `Date` objects and a non-negative integer notice period; validation happens at the HTTP or persistence boundary when it is implemented.
- Display labels ("Vencido", "Avisar até [data]", …) and date formatting. They belong to the web client.
- Computing the notice deadline for statuses other than `NOTIFY_BY`.

## Decisions

### Signature follows the task example

`getContractStatus(endDate: Date, noticeDays: number, today: Date): ContractStatus`, where `ContractStatus` is a discriminated union on `kind`: `{ kind: "EXPIRED" } | { kind: "NOTICE_OVERDUE" } | { kind: "NOTIFY_BY"; deadline: Date } | { kind: "ON_TRACK" }`.

- Alternative: an object parameter (`{ endDate, noticeDays, today }`). Rejected for now because the task fixes the positional signature and the team will compare against it; the change is cheap to make later if call sites multiply.
- Alternative: always returning `deadline`. Rejected because the task example returns it only for `NOTIFY_BY` and the instructions forbid adding fields without need. See Risks.

### Calendar-day arithmetic with `date-fns`

`subDays` computes the deadline and `differenceInCalendarDays` drives every comparison, as the task prescribes. Both operate in the process's local time zone and ignore the time of day.

- Alternative: native `Date` arithmetic with millisecond differences. Rejected because 24-hour periods misclassify dates when a time of day is present or a daylight-saving shift occurs.
- Alternative: a UTC-only date type or string-based dates. Rejected for this step: the future API date format is not decided, and the task example uses `Date`.

### Reference date is a parameter

`today` is always passed in, so tests are deterministic and the function never reads the clock. No clock fake is needed.

### Test calendar convention

Tests build every date with the local-time constructor `new Date(year, monthIndex, day[, hours])`, which represents a calendar day in the process's local time zone. They never parse date strings. This is a test convention only; it does not define the date format of the future API.

## Risks / Trade-offs

- [The listing needs the notice deadline for every contract (table column and ascending sort), but the result carries it only for `NOTIFY_BY`.] → When the endpoint is implemented, either compute the deadline separately with the same RN-11 formula or extend the result through a new OpenSpec change. Not decided here.
- [Local time zone semantics: a `Date` created at UTC midnight and read in a negative-offset zone falls on the previous calendar day.] → The boundary that converts stored or received dates into `Date` objects must define the time-zone convention; tests here use local-time constructors only.
- [The 30-day threshold may vary per client — an open question in the PRD, owned by Fernanda Cavalcanti.] → The threshold stays fixed at 30 days as the task states; a per-client threshold would be a new change.
- [The expected statuses of the six sample contracts (today fixed on 2026-11-22) are not verified, because their documents are not available.] → Verify them when the seed is created.
