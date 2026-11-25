---
change_id: s1-01-data-model
date: 2026-11-25
status: in-progress
owners: [Benjamim]
tags: [database, data-model, prisma, sprint-1]
related_adrs: [ADR-0001]
openspec_change: openspec/changes/s1-01-data-model/
---

# Sprint 1 data model

## Objective

Design the whole Sprint 1 database once, so that login, ERP synchronization and the historical load can build on it without conflicting migrations, and so that the database itself enforces the business rules.

## Change made

- Added the enums and 12 models to `prisma/schema.prisma`: `User`, `Session`, `Customer`, `Product`, `Receivable`, `SyncRun`, `Order`, `OrderItem`, `Contract`, `HistoricalOrderItem`, `HistoricalReceivable` and `LoadIssue`.
- Added the migration `20261125115933_s1_01_data_model`. The `initial` migration is unchanged.
- Added `bcryptjs` (exact version) and a shared password-hashing function in `src/shared/security/password.ts`.
- Extended `prisma/seed.ts` with the 8 prototype users (repeatable). The password comes from `SEED_USER_PASSWORD`; a test-only default is used outside production.
- Regenerated the Prisma client in `src/shared/database/generated`.
- Added Testcontainers integration tests (52 in total with the existing one) and shared test support in `tests/support/`.

## Resulting behavior

- The database rejects a second customer, product or receivable with the same ERP code, a second order with the same send key, a second user with the same e-mail or seller ERP name, and references to records that do not exist.
- Customer status, order state, user role and the historical statuses accept only their defined values.
- Every money field is an integer column ending in `Cents`.
- Historical order items, historical receivables and load issues can be loaded repeatedly without duplicates; a title and its reversal coexist.
- After seeding there is one test user for each of the 8 people of the prototype, with hashed passwords.

## Impact

- No API, validation schema or OpenAPI contract changes.
- Other tasks can write to the database only after this change is merged into `develop`.
- Prisma truncates decimals given to integer fields (12.5 becomes 12). Features that receive money must validate it as an integer at their input.
- The example module (`example-items`) is untouched and still works.

## Validations executed

- `pnpm test:integration`: 7 files, 52 tests passed.
- `pnpm typecheck` and `pnpm lint`: no errors.
- `pnpm test` (unit): all tests passed except 3 architecture tests that failed on the Windows development machine (see Implementation notes); to be confirmed by the CI check on Linux.
- `pnpm spec:validate` (strict): passed for `change/s1-01-data-model` and `spec/backend-foundation`.
- `pnpm openapi:check`: passed after `pnpm openapi:generate` normalized line endings; no content change.
- `pnpm skills:check`: passed after `pnpm skills:sync`.
- `pnpm format:check`, `pnpm test:coverage` and `pnpm build`: to be run before the pull request.

## Related artifacts

- Proposal: `openspec/changes/s1-01-data-model/proposal.md`
- Specifications: `openspec/changes/s1-01-data-model/specs/`
- Design: `openspec/changes/s1-01-data-model/design.md`
- Tasks: `openspec/changes/s1-01-data-model/tasks.md`
- ADR: `docs/adr/0001-modelo-de-dados.md`

## Usage

- Recreate the local database from scratch with `pnpm prisma migrate reset`, then seed it with `pnpm prisma db seed`. Both commands were run on 2026-11-25 and worked (`pnpm db:migrate reset` does not reset: the `db:migrate` script is `prisma migrate dev`).
- Set `SEED_USER_PASSWORD` to choose the test password; it is required when `NODE_ENV` is `production`.
- Inspect the data with `pnpm db:studio`.

## Implementation notes

- New dependency: `bcryptjs` 3.0.3, approved by the squad.
- Assumptions open for review in the pull request: `PROSPECT` in customer status (the ERP never sends it), the `SyncResult` values, the provisional seller ERP names in the seed, and the `SEED_USER_PASSWORD` mechanism.
- `tests/architecture/boundaries.test.ts` builds a path with `URL.pathname`, which breaks on Windows. It is unrelated to this change (the file was not modified); whether it passes on Linux is to be confirmed by the CI check.
- Historical quantity is an integer; 308 spreadsheet quantities are text and must be cleaned by the historical load.
