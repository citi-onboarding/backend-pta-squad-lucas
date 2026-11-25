## Why

Sprint 1 needs one shared database design before three people start building on it: login (users, sessions, contracts), ERP synchronization (customers, products, receivables) and the historical data load (orders, receivables, load issues). If each feature created its own tables in parallel, their migrations would conflict. This change designs the whole Sprint 1 database once, so that everyone can write to it after it is merged into `develop`.

## What Changes

- Design the Sprint 1 data model in `prisma/schema.prisma`: `User`, `Session`, `Customer`, `Product`, `Receivable`, `SyncRun`, `Order`, `OrderItem`, `Contract`, `HistoricalOrderItem`, `HistoricalReceivable` and `LoadIssue`.
- Add one new additive migration. The existing `initial` migration (example items) is not edited.
- Store every ERP-sourced record with a unique ERP code, so that synchronization and loads update records instead of duplicating them.
- Store all money as integer cents, in fields whose names end in `Cents`.
- Model closed lists as enums: user roles, customer status, the 8 order states, receivable status and historical statuses.
- Seed one test user per role, covering the 8 people of the prototype, with hashed passwords.
- Add an integration test proving that two customers with the same ERP code are rejected.
- Add an ADR (`docs/adr/0001-modelo-de-dados.md`) and a change record (`docs/changes/s1-01-data-model.md`).
- No breaking change: nothing in the existing example module is removed or altered.

### Assumptions recorded (authorized by the squad manager)

These were decided without waiting for answers and are open to review in the pull request:

- Customer status keeps four values (`ACTIVE`, `BLOCKED`, `INACTIVE`, `PROSPECT`). The ERP only sends the first three; `PROSPECT` exists only in the old spreadsheets.
- A seller's ERP name is stored as text (`erpSellerName`), because the ERP exposes the customer's seller as a text field (`vendedor`). `Customer.sellerId` is optional and is filled by matching that name.
- A minimal `Session` table (user, creation, last use, end) is created here so login can implement logout and the 8 hours of inactivity.
- Receivable history is unique by title id (`titleId`). The historical load merges a title and its reversal into one record with status `REVERSED` before writing (changed after Gabriel's review).
- Historical order items are unique by order number and product code (`orderNumber` + `productCode`), and the product code is required. The historical load resolves the product code from the description, or records the row in `LoadIssue` when no single match exists, and merges repeated rows before writing (changed after Gabriel's review).
- A contract's minimum volume is stored in cents per month (`minVolumeCents`), confirmed in the contract PDFs. The contract file is stored as a text path.
- The example module (`example-items`) stays; its removal is out of scope.

## Capabilities

### New Capabilities

- `erp-record-storage`: customers, products and receivables keep a unique ERP code, money in cents, a closed customer status list and a seller portfolio, so synchronization can upsert safely and every synchronization run is recorded.
- `order-state-storage`: orders and their items are stored with one of the 8 closed order states, money in cents and a unique send key.
- `user-account-storage`: users have a closed role, a seller's ERP name, a last-access date, a hashed password and sessions; one test user per role is available after seeding.
- `contract-tracking-storage`: a contract stores its end date and notice days; its situation is computed on demand and never stored.
- `historical-load-storage`: historical order items, historical receivables and load issues can be loaded repeatedly without creating duplicates, and every data problem found is recorded.

### Modified Capabilities

None. There are no existing specs under `openspec/specs/`.

## Impact

- **Business:** unblocks the login, synchronization and historical-load tasks; encodes business rules RN-02, RN-08, RN-11, RN-12, RN-13, RN-15 and RN-16 in the database.
- **API:** none. No endpoint, validation schema or OpenAPI contract changes.
- **Database:** one new additive migration; the `initial` migration is untouched.
- **Security:** passwords are stored only as hashes; seed passwords are test-only; no secret is committed.
- **Dependencies:** adds `bcryptjs` (approved by the squad) for password hashing in a shared function used by the seed and reusable by login.
- **Observability:** `SyncRun` and `LoadIssue` store the results and problems of synchronizations and loads.
- **Documentation:** new ADR and change record.

### Out of scope

- Any endpoint, ERP client, synchronization logic, login logic, order flow or historical-load script.
- Removing the example module.
- Reading or parsing contract PDFs.
