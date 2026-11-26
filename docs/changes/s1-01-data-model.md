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
- After review, the historical keys changed: `content_key` and `occurrence` were removed, `product_code` became required, order items became unique by (`order_number`, `product_code`) and historical receivables unique by `title_id`. This first went into a corrective migration, `20261125184249_s1_01_historical_keys`, which dropped columns and was therefore not additive. Because neither migration had been applied to any shared environment, they were merged: `20261125115933_s1_01_data_model` now creates the final structure directly and the corrective migration was deleted.
- Added `bcryptjs` (exact version) and a shared password-hashing function in `src/shared/security/password.ts`.
- Extended `prisma/seed.ts` with the 8 prototype users (repeatable). The password comes from `SEED_USER_PASSWORD`; a test-only default is used outside production.
- Regenerated the Prisma client in `src/shared/database/generated`.
- Added Testcontainers integration tests (55 in total with the existing one, after review) and shared test support in `tests/support/`.

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
  - `pnpm prisma migrate reset` applied the three migrations (before they were merged) to an empty database, `pnpm prisma db seed` created the 8 users, and `pnpm test:integration` passed 54 tests again.
  - `pnpm format:check`, `pnpm typecheck`, `pnpm lint` and `pnpm build`: passed.
  - `pnpm exec openspec validate s1-01-data-model --strict --no-interactive` and `pnpm spec:validate`: passed.
  - `pnpm openapi:check` and `pnpm skills:check`: passed.
  - `pnpm verify` and `pnpm test:coverage`: all tests passed except the same 3 architecture tests that fail on the Windows development machine (see Implementation notes).
- After review (password unit test), on 2026-11-26:
  - The CI check does not run `pnpm test:coverage`, and `src/shared/security/password.ts` had no unit test, so coverage was below the thresholds (lines 88.09%, functions 76.92%, statements 88.37%).
  - Red: with `hashPassword` returning the plain password and `verifyPassword` always returning `true`, `pnpm exec vitest run src/shared/security/password.test.ts` failed 2 of 3 tests on their assertions. The change was then reverted.
  - Green and Refactor: no production change; the same command passed 3 of 3 tests.
  - `pnpm exec vitest run --coverage --exclude "tests/architecture/**" --exclude "**/node_modules/**" --exclude "**/*.integration.test.ts"` passed 42 tests with statements 95.34%, branches 94.11%, functions 92.3% and lines 95.23%. The architecture tests were excluded only because they fail on Windows.
- After review (seeded password verification), on 2026-11-26:
  - Red: with the seed hashing `seedPassword() + "-wrong"`, `pnpm exec vitest run --config vitest.integration.config.ts src/shared/database/user-account-storage.integration.test.ts -t "stores only password hashes"` failed on the new `verifyPassword` assertion, while the two older assertions passed. The change was then reverted.
  - Green: no production change; the same command passed.
- After review (single migration), on 2026-11-26:
  - `pnpm test:integration` passed 7 files and 54 tests.
  - `pnpm prisma migrate reset --force` applied `20260813000000_initial` and `20261125115933_s1_01_data_model` to the local database, and `pnpm prisma db seed` created the 8 users.
  - `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reported no difference between the migrated database and the schema.
- After review (unchanged customer on duplicate ERP code), on 2026-11-26:
  - Red: with the expected name temporarily set to the duplicate's name (`"Other name"`), `pnpm exec vitest run --config vitest.integration.config.ts src/shared/database/erp-code-uniqueness.integration.test.ts` failed with `expected 'Test Customer' to be 'Other name'`. This proves the assertion reads the database; it does not simulate a production defect, because PostgreSQL rejects the insert atomically.
  - Green: no production change; the same command passed.
  - Refactor: no change; `pnpm test:integration` passed 7 files and 54 tests.
- After review (order for a missing seller), on 2026-11-26:
  - Added the scenario "Order for a missing seller is rejected" to `specs/order-state-storage/spec.md`.
  - Red: with the `orders_seller_id_fkey` foreign key temporarily removed from the migration, `pnpm exec vitest run --config vitest.integration.config.ts src/shared/database/order-state-storage.integration.test.ts -t "seller that does not exist"` failed because the order was saved instead of rejected. The migration was then reverted.
  - Green: no production change; the same command passed.
  - Refactor: no change; `pnpm test:integration` passed 7 files and 55 tests.
- After review (seeded sellers' ERP name), on 2026-11-26:
  - The test "gives every seller an ERP name" had no scenario. Added "Each seeded seller SHALL have an ERP name" to the requirement "Test users from the prototype" and the scenario "Seeded sellers have an ERP name" to `specs/user-account-storage/spec.md`. The test was not changed.
  - Red: with the seed temporarily storing no ERP name for sellers, `pnpm exec vitest run --config vitest.integration.config.ts src/shared/database/user-account-storage.integration.test.ts -t "gives every seller an ERP name"` failed on its assertion. The seed was then reverted.
  - Green: no production change; the same command passed.
  - Refactor: no change; `pnpm test:integration` passed 7 files and 55 tests.

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
