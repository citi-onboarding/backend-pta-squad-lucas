## Context

See `proposal.md` for motivation and scope. The backend repository is primarily a Node.js 22 / TypeScript / Prisma 7 / PostgreSQL service (`src/app`, `src/modules`, `src/shared`), while pre-October 2026 historical data arrives as three raw spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, `titulos.csv`) totaling 23,811 rows. The PostgreSQL schema (`historical_order_items`, `historical_receivables`, `load_issues`, `customers`, `products`) is owned by `s1-01-data-model` and populated for ERP entities by `s1-03-erp-sync`.

## Goals / Non-Goals

**Goals:**

- Provide a clean separation between pure cell-level transformation functions (`data/pipeline/cleaners.py`) and dataset-level orchestration, ERP lookup, reconciliation, and persistence (`data/pipeline/load_history.py`).
- Guarantee exact monetary arithmetic using `Decimal` to integer cents (RN-13) and deterministic date/code normalization.
- Allow full local validation and idempotency proof (`--dry-run` with `InMemoryHistoryStore`) before PostgreSQL migrations and ERP sync land in `develop`.
- Support direct idempotent PostgreSQL persistence (`PostgresHistoryStore` via `psycopg` `ON CONFLICT ... DO UPDATE`) aligned with the snake_case schema defined in `s1-01-data-model`.

**Non-Goals:**

- Introducing any dependency between `src/` TypeScript modules and `data/` Python scripts; both share only the PostgreSQL database contract defined in `prisma/schema.prisma`.
- Running Prisma migrations from Python or mutating ERP-owned tables (`customers`, `products`, `receivables`).

## Decisions

### D1: Python + pandas + psycopg in `data/` writing to backend PostgreSQL

- **Choice:** Implement the ETL pipeline in Python 3.11+ (`pandas`, `openpyxl`, `psycopg[binary]`, `pytest`) under `data/` targeting the same PostgreSQL instance as the Node.js API.
- **Rationale:** Matches downstream ML feature engineering (`s1-08-churn-features`) and Sprint 2 churn modeling while keeping a single database for the web portal, mobile app, and ML pipeline. Recorded durably in `docs/adr/0004-historical-data-pipeline.md`.
- **Alternatives rejected:** TypeScript/Node.js ETL (would split data tooling from Python ML workflows); separate SQLite/DuckDB database (would require extra synchronization to serve portal dashboards).

### D2: Clean-first, then deduplicate and reconcile by natural keys

- **Choice:** Run all cell-level cleaners before grouping by natural keys (`(order_number, product_code)` for orders; `title_id` for receivables).
- **Rationale:** Real spreadsheet exploration revealed 22 duplicate order items whose raw date (`10.01.2025` vs `2025-01-10`) or status (`Faturado` vs `FATURADO`) differed before cleaning, plus 6 receivable reversal pairs (`PAID` + negative `REVERSED`) and 9 conflicting-amount duplicate title pairs. Cleaning first ensures identical records collapse cleanly while genuine conflicts route to `load_issues`.
- **Alternatives rejected:** Raw-row deduplication before cleaning (misses format-variant duplicates); composite key `(title_id, status)` or content-hash counters (would duplicate reversed titles or inflate sales counts).

### D3: Dependency-injected `HistoryStore` protocol and `ErpCatalog`

- **Choice:** Inject `ErpCatalog` and `HistoryStore` (`InMemoryHistoryStore` for unit tests and `--dry-run`; `PostgresHistoryStore` for PostgreSQL persistence).
- **Rationale:** Keeps unit and pipeline tests fast, isolated, and completely independent of live ERP API rate limits or Docker containers, while ensuring `--dry-run` exercises the exact same business logic as production persistence.

### D4: Schema alignment with `s1-01-data-model`

- **Choice:** Align `PostgresHistoryStore` SQL queries to the snake_case PostgreSQL tables/columns and integer identifiers (`order_number`, `title_id`) established in `s1-01-data-model` (`historical_order_items`, `historical_receivables`, `load_issues`, `customers`, `products`), generating UUID primary keys on insert while upserting on the natural unique constraints (`(order_number, product_code)`, `title_id`, `(source_file, row_number, problem_type)`).
- **Rationale:** Preserves `prisma/schema.prisma` as the single schema source of truth with zero conflicting migrations.

## Risks / Trade-offs

- **[Schema drift between Prisma and raw SQL in Python]** → Mitigation: Keep all SQL statements centralized inside `PostgresHistoryStore` and verify against a real migrated PostgreSQL instance (running twice for idempotency) after `s1-01-data-model` merges.
- **[ERP catalog spelling differences vs preview catalog]** → Mitigation: `resolve_unique_match` is strict (exact single match after accent/case/unit normalization); any mismatch against live ERP `customers` or `products` surfaces transparently in `load_issues` rather than silently misattributing records.
- **[Second runtime in repository]** → Mitigation: Isolate Python dependencies inside git-ignored `data/.venv/` and keep raw client spreadsheets in git-ignored `data/raw/`.

## Migration Plan

1. Wait for `s1-01-data-model` and `s1-03-erp-sync` to merge into `develop`, then merge `develop` into `S1-07-history-load`.
2. Align `PostgresHistoryStore` SQL statements to the merged `prisma/schema.prisma` snake_case table/column names and run `pnpm db:migrate` + ERP sync locally.
3. Run `python -m data.pipeline.load_history --database-url <URL>` twice against PostgreSQL, verifying identical row counts, balanced per-file accounting, and 5 inspected `load_issues` records.
4. Rollback: Because writes target only `historical_order_items`, `historical_receivables`, and `load_issues` without modifying ERP tables, rolling back is safely achieved by truncating those three tables or re-running after fixing any rule.
