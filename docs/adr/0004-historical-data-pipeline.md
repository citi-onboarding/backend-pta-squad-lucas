---
title: ADR-0004
status: proposed
date: 2026-11-24
owners:
  - Gabriel
tags:
  - data
  - etl
  - python
  - postgresql
supersedes: null
superseded_by: null
---

# 0004: Historical data ingestion pipeline in Python with pandas writing to backend PostgreSQL

## Context

All DistriLux commercial and financial history prior to October 2026 exists exclusively in three manually maintained spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, and `titulos.csv`, totaling 23,811 rows). These files contain heterogeneous formats and data quality issues: five date patterns plus Excel serial numbers, mixed BRL/US/abbreviated monetary values, negative reversal amounts, quantities with unit suffixes, short and mixed-case ERP codes, seller nicknames, exact and conflicting duplicates, and rows missing codes.

This cleaned history is required simultaneously by:

1. Historical period comparisons in the commercial web portal and mobile manager app;
2. Monthly churn feature engineering (`ChurnFeature`, task `s1-08-churn-features`) and Sprint 2 churn model training.

Meanwhile, the portal backend is built in Node.js 22 / TypeScript with PostgreSQL managed via Prisma (`prisma/schema.prisma`), and authoritative master data is synchronized from the ERP (`RN-09`, `RN-16`).

## Decision

We adopt **Python 3.11+ with `pandas`, `openpyxl`, `psycopg[binary]`, and `pytest`** under `data/` in `backend-pta-squad-lucas`, writing directly into the historical tables (`historical_order_items`, `historical_receivables`, and `load_issues`) inside the **same PostgreSQL database** used by the Node.js backend.

Invariants that future changes must preserve:

- **Single schema source of truth:** Table definitions and migrations remain owned exclusively by `prisma/schema.prisma`; the Python pipeline only reads ERP-synchronized tables (`customers`, `products`) and performs idempotent writes to the three historical tables.
- **Layer separation:** Pure cell-level cleaning functions live in `data/pipeline/cleaners.py` (using `Decimal` to guarantee exact integer cents per `RN-13`), while dataset orchestration, post-cleaning deduplication, ERP matching, and persistence live in `data/pipeline/load_history.py`.
- **ERP precedence (`RN-09`):** The historical pipeline never writes to or overwrites ERP-owned tables (`customers`, `products`, `receivables`).
- **Idempotency and traceability (`RN-16`):** Every write uses `UPSERT` (`ON CONFLICT ... DO UPDATE`) keyed by natural unique constraints (`(order_number, product_code)`, `title_id`, and `(source_file, row_number, problem_type)`), records applied corrections, and verifies `read = loaded + discarded + pending` per source file.
- **Raw data excluded from Git:** `data/raw/`, `data/.venv/`, and `data/notebooks/` remain listed in `.gitignore`.

## Consequences

### Positive

- Leverages the mature Python data engineering ecosystem (`pandas`, `openpyxl`, `pytest`), providing direct continuity into churn feature engineering (`s1-08-churn-features`) and Sprint 2 machine learning workflows.
- Avoids operating and synchronizing a second analytical database: the Node.js API, dashboards, and ML scripts read from the same PostgreSQL instance.
- Enables deterministic local validation and idempotency testing (`--dry-run` with `InMemoryHistoryStore`) before database migrations or live ERP sync are merged.

### Negative

- Introduces a second runtime (`Python 3.11+` isolated in `data/.venv/`) inside a primarily Node.js/TypeScript repository.
- Changes to table or column names in `prisma/schema.prisma` must be kept synchronized with the parameterized SQL queries in `PostgresHistoryStore` inside `data/pipeline/load_history.py`.

## Alternatives considered

### ETL pipeline in TypeScript/Node.js with Prisma

Would keep a single runtime and generated Prisma types across the repository. Rejected because the Data track already requires Python for churn feature computation (`s1-08-churn-features`) and Sprint 2 ML model training, and `pandas` + `openpyxl` provide stronger tooling for inspecting and cleaning heterogeneous spreadsheets.

### Separate analytical database (SQLite or DuckDB) for history and ML

Would decouple the data pipeline from backend schema evolution initially. Rejected because the commercial portal API and mobile app must query historical comparisons and churn risk directly from PostgreSQL, which would require an unnecessary extra sync layer between databases.

## References

- OpenSpec change `openspec/changes/s1-07-history-load/`
- Task specification `S1-07-history-load` (`F11 — Carga e Limpeza do Histórico`, part 1 of 2)
- Business rules `RN-09`, `RN-13`, and `RN-16` in the DistriLux PRD
- `data/pipeline/cleaners.py`, `data/pipeline/load_history.py`, and `data/tests/`
