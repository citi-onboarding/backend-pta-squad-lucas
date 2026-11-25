---
change_id: add-contract-status-calculation
date: 2026-11-25
status: in-progress
owners: []
tags: [contracts, f21, us-021, rn-11]
related_adrs: []
openspec_change: openspec/changes/add-contract-status-calculation/
---

# Add the contract status calculation

> **Partial delivery of F21.** This change delivers only the calculation of a
> contract's status. The rest of F21 is still pending: the six sample contracts
> in the test database (seed), the Prisma model, `GET /api/v1/contracts` with
> ascending ordering by notice deadline, permissions, the web table, and the
> status legend.

## Objective

Supply contracts expired without anyone sending the renewal notice in time.
US-021 and RN-11 require each contract to show whether it needs attention. This
change provides the single, tested rule that derives that status, so that the
seed, the endpoint, and the web table can rely on it later.

## Change made

- Added `getContractStatus(endDate, noticeDays, today)` in
  `src/modules/contracts/contract-status.ts`. It is a pure function with no
  database, network, clock, or authentication dependency. It returns a
  discriminated union on `kind` (`EXPIRED`, `NOTICE_OVERDUE`, `NOTIFY_BY` with
  `deadline`, `ON_TRACK`) that follows the signature, return shape, and
  precedence of the F21 task example.
- The 30-day notice window is the named constant `NOTICE_WINDOW_DAYS`.
- Added the `date-fns` 4.4.0 runtime dependency, prescribed by the task, for
  `subDays` and `differenceInCalendarDays`. The `pnpm-lock.yaml` diff contains
  only two things:
  - The `date-fns@4.4.0` entries: the root importer, `packages`, and
    `snapshots`.
  - The removal of seven `@typescript-eslint/*@8.67.0` entries, in both
    `packages` and `snapshots`. They were orphans: no importer or surviving
    package referenced them, only each other.

  No existing dependency changed version. Adding `date-fns` had also moved
  `vite`'s transitive `picomatch` reference from 4.0.5 to 4.0.7. That one line
  was restored by hand to 4.0.5, as it is on `develop`. Both versions were
  already in the lockfile. `pnpm install --frozen-lockfile` accepted the
  restored lockfile and left it byte-identical.

- Added 11 unit tests in `src/modules/contracts/contract-status.test.ts`.

## Resulting behavior

Notice deadline = end date − notice days, in calendar days (RN-11). For a
contract ending on 2026-12-31 with 30 days of notice (deadline 2026-12-01):

- Before 2026-11-01, for example 2026-10-31, the status is `ON_TRACK`.
- From 2026-11-01 (30 days before) to 2026-12-01 (the deadline itself), the
  status is `NOTIFY_BY` and the result carries the deadline.
- From 2026-12-02 to 2026-12-31 (the last day of the term), the status is
  `NOTICE_OVERDUE`.
- From 2027-01-01 on, the status is `EXPIRED`, which takes precedence over an
  overdue notice.
- Only the calendar day matters. A reference date at 23:00 on 2026-10-31 is
  still `ON_TRACK`.
- The deadline subtraction crosses month and year boundaries. For example, an
  end date of 2027-01-10 with 30 days of notice gives 2026-12-11.
- The received `Date` objects are not modified.

## Impact

- No external impact yet. Nothing calls the function: no route, schema,
  `openapi.json`, database, or migration changed.
- New runtime dependency: `date-fns` 4.4.0.
- Security and privacy: none. No personal data, input parsing, I/O, or logging.

## Validations executed

Run on branch `S1-06-contracts-list` with Node.js 22.22.1 and pnpm 12.5.1.

- Red: `pnpm exec vitest run src/modules/contracts/contract-status.test.ts`
  against a signature-only placeholder → `Tests 11 failed (11)`, each with
  `getContractStatus is not implemented`. An earlier run without the module
  failed with `Cannot find module './contract-status.js'`. That was an import
  failure and was not counted as Red.
- Green: same command → `Tests 11 passed (11)`. `pnpm typecheck` → exit 0.
- Refactor: same command → `Tests 11 passed (11)`. `pnpm typecheck` → exit 0.
- `pnpm format:check` → `All matched files use Prettier code style!`.
- `pnpm verify` → exit 0. It ran these checks:
  - `tsc --noEmit` and `eslint .` passed.
  - Unit tests: `Test Files 12 passed (12)`, `Tests 53 passed (53)`.
  - Architecture tests: `Tests 3 passed (3)`.
  - `openspec validate --all --strict` → `Totals: 2 passed, 0 failed`.
  - The OpenAPI check and the skills check passed.
- `pnpm test:coverage` → exit 0, `Tests 53 passed (53)`, all files 95%
  statements, 94.11% branches. Coverage thresholds apply only to `src/shared`,
  so this module is not part of that figure. Its four return paths are each
  covered by the scenarios above.
- `pnpm build` → exit 0.
- After restoring `picomatch` 4.0.5 in `pnpm-lock.yaml`:
  - `pnpm install --frozen-lockfile` → exit 0. The lockfile's SHA-256 was the
    same before and after the install, and `vite` resolves to `picomatch@4.0.5`.
  - `pnpm verify` → exit 0. Unit tests: `Tests 53 passed (53)`. Architecture
    tests: `Tests 3 passed (3)`. `openspec validate --all --strict` →
    `Totals: 2 passed, 0 failed`.
  - Lockfile against `HEAD`, compared entry by entry:
    - `packages` and `snapshots` each lose the same seven orphaned entries and
      gain `date-fns@4.4.0`.
    - No surviving entry changed.
    - The root importer only gains `date-fns`.
- `pnpm test:integration` and `pnpm test:container`: Not applicable. No
  database, migration, runtime delivery, or health-check behavior changed.

## Related artifacts

- Proposal: `openspec/changes/add-contract-status-calculation/proposal.md`
- Specification: `openspec/changes/add-contract-status-calculation/specs/contract-status/spec.md`
- Design: `openspec/changes/add-contract-status-calculation/design.md`
- Tasks: `openspec/changes/add-contract-status-calculation/tasks.md`
- ADR: Not applicable. The ADR triggers in `docs/adr/README.md` do not fire:
  - It changes no durable system boundary or data contract. The function is
    internal to one module and has no callers.
  - `date-fns` is a small, replaceable date utility used by a single function.
    It is not a significant dependency or infrastructure provider.
  - It establishes no security, privacy, or compatibility invariant.
  - It resolves no recurring disagreement.

  The time-zone convention for dates at the API and database boundary is still
  undecided. It may warrant an ADR when that boundary is implemented.

## Usage

```ts
import { getContractStatus } from "./contract-status.js";

const status = getContractStatus(endDate, noticeDays, today);
if (status.kind === "NOTIFY_BY") {
  // status.deadline is the last day to send the notice.
}
```

The caller must pass the end date already resolved, using the latest amendment
when there is one, and an explicit reference date.

## Implementation notes

- `Date` values are read as calendar days in the process's local time zone. The
  boundary that builds them from stored or received data must define that
  convention. The tests use local-time constructors only.
- The result carries the deadline only for `NOTIFY_BY`. The future listing needs
  it for every contract, for the table column and for sorting. That is to be
  resolved when the endpoint is implemented.
- The 30-day window is fixed, as the task states. The PRD lists whether it
  varies per client as an open question owned by Fernanda Cavalcanti.
- The expected statuses of the six sample contracts (today = 2026-11-22) are not
  verified, because their documents have not been provided yet.
- The index in `docs/changes/README.md` is updated after merge, as that README
  prescribes.
