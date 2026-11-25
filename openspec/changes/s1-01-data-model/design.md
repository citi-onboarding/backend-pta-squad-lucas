## Context

The repository has one Prisma model (`ExampleItem`) and one migration (`initial`). Prisma 7 with PostgreSQL 17 is the persistence stack; tests use Vitest and Testcontainers; the architecture rule is `src/app` → `src/modules` → `src/shared`, with no module importing another module. Nothing in `src/modules` uses the new tables yet: this change only creates the structure that the login, synchronization and historical-load tasks will use.

Inputs: the task text (F02 part 1), the PRD, the three client spreadsheets, the ERP OpenAPI document (`/openapi.json`, version 3.3.0) and the contract PDFs.

## Goals / Non-Goals

**Goals:**

- One schema covering the whole Sprint 1, so later tasks add no conflicting migrations.
- Idempotent writes for ERP data and the historical load, enforced by the database.
- Business rules RN-02, RN-08, RN-11, RN-12, RN-13, RN-15 and RN-16 visible in the structure.

**Non-Goals:**

- Endpoints, ERP client, synchronization, login, order flow and historical-load scripts.
- Removing `ExampleItem`.
- Reading data from contract PDFs.

## Decisions

### D1. One additive migration; `initial` stays untouched

A new migration creates every new table and enum. Applied migrations are never edited; later fixes use corrective migrations. `example_items` is kept.
_Rejected:_ editing `initial` or resetting history — it breaks every database that already applied it.

### D2. Closed lists as database enums

`Role` (`SELLER`, `MANAGER`, `FINANCE`, `ADMIN`), `CustomerStatus` (`ACTIVE`, `BLOCKED`, `INACTIVE`, `PROSPECT`), `OrderStatus` (the 8 states), `ReceivableStatus` (`PAID`, `OPEN`, `OVERDUE`), `HistoricalItemStatus` (`INVOICED`, `CANCELLED`), `HistoricalReceivableStatus` (`PAID`, `OPEN`, `OVERDUE`, `REVERSED`), `SyncKind` (`AUTOMATIC`, `MANUAL`) and `SyncResult` (`SUCCESS`, `PARTIAL`, `FAILED`).
_Rejected:_ free text with application checks — the database would accept invalid values written by any task.
_Note:_ the `SyncResult` values are an assumption of this change, since the task does not define them.

### D3. Money as `Int` cents

Every monetary field is an `Int` and its name ends in `Cents` (RN-13). A 32-bit integer holds up to about R$ 21 million, which covers credit limits, order totals and monthly contract volumes in the materials.
_Rejected:_ `Decimal` (breaks RN-13) and `BigInt` (not needed now; can be changed by a corrective migration).

### D4. ERP identity

Customers and products keep the ERP code as a unique text (`C0001`, `P00001`). Receivables keep the ERP title number and the ERP order number as integers, as the ERP exposes them; the historical title id is also an integer (all 8,313 ids in `titulos.csv` are 6-digit numbers without leading zeros). Synchronization updates by these keys (RN-15, RN-16).

### D5. Seller link

`User.erpSellerName` is a unique, optional text. `Customer` keeps both the ERP text (`erpSellerName`) and an optional `sellerId`, filled by matching the name. A customer whose seller is not found stays without `sellerId` and becomes a load or synchronization issue.
_Rejected:_ required `sellerId` — it would block saving customers whose seller is unknown.

### D6. Sessions

A `Session` has user, creation, last-use and end times. Expiry after 8 hours without use is computed from the last-use time; it is not stored. `User.lastLoginAt` serves the users screen.
_Rejected:_ leaving sessions to the login task — it would need its own migration after this one is merged.

### D7. Contract

The contract stores end date and notice days; its situation is computed on demand (RN-11). `minVolumeCents` is the monthly minimum in cents (confirmed in the contract PDFs). `file` is a text path. `hasAmendment` is a flag; amended values replace the contract's current values.

### D8. Historical order items

Each row is identified by `@@unique([orderNumber, productCode])`, and `productCode` is required. The historical load (Gabriel's pipeline) resolves the product code from the description, or sends the row to `LoadIssue` when no single match exists, and merges repeated rows before writing, so no row without a product code and no repeated pair reaches this table. `totalCents` is stored because the spreadsheet column is a formula without a stored value. `corrections` is `Json?`.
_Rejected:_ a content hash plus an occurrence counter (the first version of this change) — it was meant for raw spreadsheets; with a clean load it would store a repeated sale twice and break the update when the load runs again. _Rejected:_ a counter by row position — it changes if the spreadsheet is exported again with inserted rows.

### D9. Historical receivables

`titleId` is unique. The historical load merges a title and its reversal into one record with status `REVERSED` before writing, so the database accepts one record per title and updates it when its status changes. `paidAt` is optional. `corrections` is `Json?`.
_Rejected:_ `@@unique([titleId, status])` (the first version of this change) — it kept the paid and the reversed rows side by side, so the same title would count twice in reports and would be duplicated if its status changed later.

### D10. Load issues

`@@unique([sourceFile, rowNumber, problemType])` makes repeated loads idempotent. `field`, `rawValue` and `resolution` are optional.

### D11. Password hashing and seed

A shared function in `src/shared` hashes passwords with `bcryptjs` (approved by the squad), so the seed and the future login use the same code. The seed upserts the 8 prototype users with a test-only password and is repeatable.
_Rejected:_ hashing code inside `prisma/seed.ts` — login could not reuse it.

### D12. Tests

Integration tests against a real PostgreSQL (Testcontainers) cover each scenario of the specs: rejected duplicates, rejected invalid values, idempotent writes, optional fields and the seed.

### D13. ADR

This is a cross-cutting, hard-to-reverse decision, so it is recorded in `docs/adr/0001-modelo-de-dados.md`.

## Risks / Trade-offs

- **Schema owner:** after merge, Sprint 1 schema changes go through this task's owner; other tasks must ask before creating tables.
- **Fractional money is truncated, not rejected:** Prisma stores 12.5 in an `Int` field as 12 without raising an error (observed in the integration test). The database column is an integer, but rejecting decimals must be done by input validation (Zod `.int()`) in each feature that receives money.
- **`Int` ceiling:** values above about R$ 21 million need a corrective migration to `BigInt`.
- **The database relies on the load cleaning first:** a load that does not resolve the product code, merge repeated rows and merge a title with its reversal is rejected by the database instead of silently duplicating data.
- **`PROSPECT`:** the ERP never sends it; it can be removed later by a corrective migration if the squad decides so.
- **`SyncResult` values** are assumed and may change in review.
