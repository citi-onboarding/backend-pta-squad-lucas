---
title: ADR-0001
status: proposed
date: 2026-11-25
owners: [Benjamim]
tags: [database, data-model, prisma, sprint-1]
supersedes: null
superseded_by: null
---

# 0001: Sprint 1 data model

## Context

Three Sprint 1 tasks write to the same database: login (users, sessions, contracts), ERP synchronization (customers, products, receivables) and the historical data load (orders, receivables, load issues). If each task created its own tables, their migrations would conflict. One person therefore designs the whole Sprint 1 structure before anyone else changes the database.

The design also has to make the business rules enforceable by the database itself: money in integer cents (RN-13), a unique ERP code on everything that comes from the ERP (RN-15, RN-16), a seller portfolio per customer (RN-08), closed lists for customer status (RN-02) and order states (RN-12), and a contract situation that is computed, not stored (RN-11). The source data is dirty: 363 historical order rows have no product code, 26 of 27 repeated order/product pairs are fully identical rows, and every reversed title repeats the id of the original title.

## Decision

- **One additive migration** (`s1_01_data_model`) creates 12 tables and all enums. The existing `initial` migration is never edited; later changes use corrective migrations. After this change is merged, Sprint 1 schema changes go through the owner of this change.
- **Money is an `Int` number of cents** in fields whose names end in `Cents`. A 32-bit integer holds about R$ 21 million, which covers every value in the materials.
- **ERP identity:** customers and products keep a unique text ERP code; receivables keep the ERP title number as a unique integer. Synchronization updates by these keys.
- **Closed lists are database enums:** `Role`, `CustomerStatus` (`ACTIVE`, `BLOCKED`, `INACTIVE`, `PROSPECT`), `OrderStatus` (8 states), `ReceivableStatus`, `SyncKind`, `SyncResult`, `HistoricalItemStatus` and `HistoricalReceivableStatus` (adds `REVERSED`).
- **Seller portfolio:** `User.erpSellerName` is unique; `Customer` keeps the ERP text and an optional `sellerId` filled by matching it.
- **Sessions:** a minimal `Session` table (creation, last use, end). The 8-hour inactivity limit is computed from the last use, not stored.
- **Contract:** stores end date and notice days; its situation is never stored. `minVolumeCents` is a monthly amount in cents; `file` is a text path.
- **Historical data is idempotent by key:** historical order items are identified by a content key plus a counter among identical rows; historical receivables by (`titleId`, `status`), so a reversal can coexist with its original; load issues by (`sourceFile`, `rowNumber`, `problemType`).
- **Passwords are stored only as `bcryptjs` hashes,** produced by one shared function used by the seed and reusable by login.

## Consequences

### Positive

- Login, synchronization and the historical load can build on one structure without conflicting migrations.
- The database refuses duplicate ERP codes, duplicate send keys, unknown statuses and orphan references, instead of relying on every feature to check.
- Repeating a synchronization or a historical load updates data instead of duplicating it.

### Negative

- Prisma truncates a decimal given to an `Int` field (12.5 is stored as 12) instead of rejecting it, so every feature that receives money must validate it as an integer at its input.
- `Int` cannot hold amounts above about R$ 21 million; a corrective migration to `BigInt` would be needed.
- The historical content key depends on how the load normalizes values; the load must keep that normalization stable.
- `PROSPECT` and `SyncResult` values are assumptions that may change in review.
- A change to the Sprint 1 structure after merge needs coordination with the owner of this change.

## Alternatives considered

### Decimal or BigInt for money

`Decimal` breaks RN-13 (money as integer cents). `BigInt` is not needed for the current values and can be adopted later by a corrective migration.

### Free text instead of enums

Free text with application checks would let any task write an invalid status. Enums make the database the single enforcer.

### One table set per task

Each task creating its own tables would produce conflicting migrations, which is the problem this change exists to avoid.

### Historical key by order number and product code

PostgreSQL does not treat two nulls as equal, so rows without a product code would duplicate on every load, and repeated order/product pairs would be merged into one.

### Historical key by row position

A counter by position changes when the spreadsheet is exported again with rows inserted, and would silently attach data to the wrong rows.

### Required `sellerId` on customers

It would block saving customers whose seller is not yet known to the system.

## References

- OpenSpec change: `openspec/changes/s1-01-data-model/`
- Change summary: `docs/changes/s1-01-data-model.md`
- Business rules RN-02, RN-08, RN-11, RN-12, RN-13, RN-15 and RN-16 (PRD)
- ERP OpenAPI document, version 3.3.0
