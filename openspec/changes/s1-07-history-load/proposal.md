## Why

All DistriLux commercial and financial activity prior to October 2026 exists only in three manually maintained spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, and `titulos.csv`) containing mixed date formats, inconsistent monetary values, duplicate entries, seller nicknames, missing codes, and conflicting records. Without a clean, auditable, idempotent historical ingestion pipeline into PostgreSQL, the commercial dashboard cannot compare periods and the Sprint 1 churn feature pipeline (`S1-08`) has no reliable training base.

## What Changes

- Introduce a Python data cleaning and ingestion pipeline under `data/pipeline/` (`cleaners.py` and `load_history.py`) with automated unit and pipeline tests under `data/tests/`.
- Clean and standardize dates (including Excel serial dates), monetary amounts in integer cents (RN-13), ERP codes, 14-digit CNPJs, Northeast cities/states, official seller names, order quantities, installments, and statuses.
- Resolve free-text customer names and missing product codes against the ERP catalog only when there is a single unambiguous match; record all unresolved, ambiguous, or conflicting rows as auditable load issues with explicit reasons.
- Enforce ERP precedence (RN-09) when auditing the commercial customers spreadsheet against synchronized ERP customer records, never overwriting ERP tables.
- Reconcile duplicate historical records and receivable reversal pairs (`PAID` + `REVERSED`) before persistence, preserve cancelled order items marked outside sales totals, and persist idempotently by natural keys (RN-16).
- Produce a per-file reconciliation summary verifying `read = loaded + discarded + pending` for each source file.
- Record the architectural decision to run the Python/pandas pipeline against the backend PostgreSQL database in `docs/adr/0004-historical-data-pipeline.md`.

### In Scope

- Historical data cleaning, normalization, deduplication, ERP matching, reconciliation reporting, and idempotent persistence for the three pre-October 2026 spreadsheets.
- Local `--dry-run` audit mode (in-memory store) and PostgreSQL `UPSERT` mode (`--database-url`) targeting `historical_order_items`, `historical_receivables`, and `load_issues`.
- Automated unit and pipeline tests (`pytest`) and ADR-0004.

### Out of Scope (Non-Goals)

- Defining or modifying `prisma/schema.prisma` migrations for `HistoricalOrderItem`, `HistoricalReceivable`, or `LoadIssue` (owned by `s1-01-data-model`).
- Calling the live ERP HTTP API directly or overwriting ERP-synchronized tables (`customers`, `products`, `receivables`).
- Computing monthly churn features or training machine learning models (owned by `s1-08-churn-features` and Sprint 2).
- Exposing new HTTP REST endpoints or modifying OpenAPI contracts.
- Versioning raw client spreadsheets (`data/raw/`) or local Python virtual environments (`data/.venv/`).

## Capabilities

### New Capabilities

- `historical-data-ingestion`: Cleaning, normalizing, reconciling against the ERP catalog, auditing pending issues, and idempotently loading pre-October 2026 commercial and financial history.

### Modified Capabilities

<!-- None: no existing backend-foundation requirements change. -->

## Impact

- **Business:** Unlocks reliable historical period comparisons for commercial management and provides the clean Silver-layer dataset required by churn feature engineering (`S1-08`) and ML training while keeping cancelled orders excluded from sales figures and exposing unresolvable rows transparently.
- **API:** No HTTP route, Zod schema, or OpenAPI 3.1 contract changes.
- **Database / Migrations:** No new Prisma migration in this change; writes idempotently to `historical_order_items`, `historical_receivables`, and `load_issues` and reads only from `customers` and `products` created by `s1-01-data-model`.
- **Security:** Raw client files (`data/raw/`) and exploration notebooks (`data/notebooks/`) remain git-ignored; database credentials are supplied at runtime via `--database-url` or environment configuration and never logged or committed.
- **Observability:** Every run prints an auditable per-file accounting breakdown (`read = loaded + discarded + pending`), records applied data corrections per record (RN-16), and persists detailed failure reasons in `load_issues`.
- **Documentation:** Adds `docs/adr/0004-historical-data-pipeline.md`, OpenSpec artifacts under `openspec/changes/s1-07-history-load/`, and (at closure) `docs/changes/s1-07-history-load.md`.
- **Dependencies:** Introduces a scoped Python 3.11+ virtual environment under `data/.venv/` with `pandas`, `openpyxl`, `psycopg[binary]`, and `pytest`; no Node.js runtime dependencies are added.
