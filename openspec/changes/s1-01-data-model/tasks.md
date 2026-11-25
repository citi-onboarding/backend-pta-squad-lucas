## 1. SDD (specification)

- [x] 1.1 The developer reviews and approves `proposal.md`, the five specs and `design.md`.
- [x] 1.2 Run `pnpm exec openspec validate s1-01-data-model --strict --no-interactive` and confirm it passes.

## 2. Red (failing tests first)

- [x] 2.1 The developer writes, by hand, the first failing integration test: saving two customers with the same ERP code is rejected (`erp-record-storage`).
- [x] 2.2 Write failing integration tests for the remaining `erp-record-storage` scenarios: duplicate product and receivable codes, update-or-create by ERP code, integer cents, closed customer status, seller portfolio, receivable ownership and optional payment date, synchronization run record.
- [x] 2.3 Write failing integration tests for `order-state-storage`: the 8 states, unknown state, items in cents, item of a missing product, unique send key, order of a missing customer.
- [x] 2.4 Write failing integration tests for `user-account-storage`: closed roles, unique e-mail, hashed passwords, unique seller ERP name, empty last access, sessions, and the seed (8 users, repeatable).
- [x] 2.5 Write failing integration tests for `contract-tracking-storage`: stored terms, missing customer, duplicate number, no stored situation, optional document path.
- [x] 2.6 Write failing integration tests for `historical-load-storage`: repeated load without duplicates, items without product code, identical rows kept, cent totals, statuses, title plus reversal, whole-row load issues, repeated issues.
- [x] 2.7 Run the integration tests and confirm they fail for the expected reason (the structure does not exist yet).

## 3. Green (minimal implementation)

- [x] 3.1 Add the enums and the 12 models to `prisma/schema.prisma` as described in `design.md`, with the unique keys, optional fields, relations and indexes (including the index on customer CNPJ).
- [x] 3.2 Generate one new migration with `pnpm db:migrate --name s1_01_data_model` and confirm the `initial` migration is unchanged.
- [x] 3.3 Add `bcryptjs` and the shared password-hashing function in `src/shared`.
- [x] 3.4 Write the repeatable seed with the 8 prototype users and hashed test passwords.
- [x] 3.5 Run the integration tests and confirm they all pass.

## 4. Refactor

- [x] 4.1 Review names (every money field ends in `Cents`), comments in the schema and test organization, without changing behavior, and re-run the tests.

## 5. Consolidation

- [x] 5.1 Run `pnpm format:check`, `pnpm verify` (typecheck and lint), `pnpm test:coverage`, `pnpm test:integration` and `pnpm build`; all must pass.
- [x] 5.2 Recreate the local database from scratch, run the seed and open Prisma Studio (`pnpm db:studio`) to capture the screenshot for the pull request.
- [x] 5.3 Write `docs/adr/0001-modelo-de-dados.md` and `docs/changes/s1-01-data-model.md` from the templates.
- [ ] 5.4 Run `pnpm exec openspec validate s1-01-data-model --strict --no-interactive` again; archive only after explicit confirmation from the developer.
- [ ] 5.5 Open the pull request against `develop` with the screenshot, the note on how AI was used, João and Gabriel as reviewers and the open assumptions listed; after merge, announce in the squad group that everyone can write to the database.
