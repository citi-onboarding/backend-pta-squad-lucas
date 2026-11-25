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
- After review, added the corrective migration `20261125184249_s1_01_historical_keys`: it drops `content_key` and `occurrence`, makes `product_code` required, makes order items unique by (`order_number`, `product_code`) and historical receivables unique by `title_id`. No applied migration was edited.
- Added `bcryptjs` (exact version) and a shared password-hashing function in `src/shared/security/password.ts`.
- Extended `prisma/seed.ts` with the 8 prototype users (repeatable). The password comes from `SEED_USER_PASSWORD`; a test-only default is used outside production.
- Regenerated the Prisma client in `src/shared/database/generated`.
- Added Testcontainers integration tests (54 in total with the existing one, after review) and shared test support in `tests/support/`.

## Resulting behavior

- The database rejects a second customer, product or receivable with the same ERP code, a second order with the same send key, a second user with the same e-mail or seller ERP name, and references to records that do not exist.
- Customer status, order state, user role and the historical statuses accept only their defined values.
- Every money field is an integer column ending in `Cents`.
- Historical order items, historical receivables and load issues can be loaded repeatedly without duplicates; a title and its reversal are one record marked `REVERSED`, and an order item needs a product code.
- After seeding there is one test user for each of the 8 people of the prototype, with hashed passwords.

## Impact

- No API, validation schema or OpenAPI contract changes.
- Other tasks can write to the database only after this change is merged into `develop`.
- Prisma truncates decimals given to integer fields (12.5 becomes 12). Features that receive money must validate it as an integer at their input.
- The example module (`example-items`) is untouched and still works.

## Validations executed

- First version: `pnpm test:integration` passed 7 files and 52 tests.
- After review (historical keys), on 2026-11-25:
  - Red: `pnpm test:integration` failed 10 of 54 tests, because the database still had the old keys; 44 passed.
  - Green: after the corrective migration and `pnpm db:generate`, `pnpm test:integration` passed 7 files and 54 tests.
  - `pnpm prisma migrate reset` applied the three migrations to an empty database, `pnpm prisma db seed` created the 8 users, and `pnpm test:integration` passed 54 tests again.
  - `pnpm format:check`, `pnpm typecheck`, `pnpm lint` and `pnpm build`: passed.
  - `pnpm exec openspec validate s1-01-data-model --strict --no-interactive` and `pnpm spec:validate`: passed.
  - `pnpm openapi:check` and `pnpm skills:check`: passed.
  - `pnpm verify` and `pnpm test:coverage`: all tests passed except the same 3 architecture tests that fail on the Windows development machine (see Implementation notes); because those fail, the coverage report was not printed locally. To be confirmed by the CI check on Linux.

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
- In Prisma 7, `prisma migrate dev` applies a migration but does not regenerate the client; run `pnpm db:generate` after it, or the client keeps the old fields.
- `@@index([orderNumber])` on `HistoricalOrderItem` is now redundant with the unique index (`order_number`, `product_code`), which starts with the same column. It was kept to avoid another migration in this review and can be dropped later by a corrective migration.
