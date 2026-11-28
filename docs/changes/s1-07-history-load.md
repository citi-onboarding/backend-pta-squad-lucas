---
change_id: s1-07-history-load
date: 2026-11-27
status: in-progress
owners: [Gabriel]
tags: [data-pipeline, etl, history, python, postgresql, sprint-1]
related_adrs: [ADR-0004]
openspec_change: openspec/changes/s1-07-history-load/
---

# Historical spreadsheet cleaning and idempotent load

## Objective

All DistriLux commercial and financial transactions prior to October 2026 exist only in three manually maintained spreadsheets (`Clientes - Comercial.xlsx`, `Pedidos 2025-2026 - Comercial.xlsx`, and `titulos.csv`) containing mixed date formats, inconsistent money representations, duplicate entries, seller nicknames, missing codes, and reversal pairs. This change cleans, normalizes, reconciles against the ERP catalog (`RN-09`), audits unresolvable rows in `load_issues`, and persists the Silver-layer historical records idempotently (`RN-16`) into PostgreSQL.

## Change made

- Implemented `data/pipeline/cleaners.py` with 14 pure cell-level normalization functions using `Decimal` to guarantee exact integer cents (`RN-13`), supporting five date patterns plus Excel serial numbers, short/lowercase ERP codes, 14-digit CNPJs, Northeast cities/states, seller nicknames, statuses, quantities with unit suffixes, installments, and accent-insensitive single-match lookup.
- Implemented `data/pipeline/load_history.py` with:
  - Post-cleaning deduplication for order items (`(order_number, product_code)`) and receivables (`title_id`), reconciling reversal pairs (`PAID` + negative `REVERSED`) into a single `REVERSED` record and routing conflicting duplicates to `load_issues`.
  - ERP catalog lookup (`load_erp_catalog_from_postgres`) reading synchronized `customers` and `products` directly from PostgreSQL without calling the live ERP HTTP API, enforcing ERP precedence (`RN-09`) and never mutating ERP-owned tables.
  - Per-file accounting verification (`read = loaded + discarded + pending`) and net sales calculation strictly excluding `CANCELLED` items.
  - `InMemoryHistoryStore` (`--dry-run`) and `PostgresHistoryStore` (`--database-url`) aligned with the `s1-01-data-model` `snake_case` schema (`historical_order_items`, `historical_receivables`, `load_issues`).
- Added automated test suites in `data/tests/test_cleaners.py` (112 parametrized unit tests), `data/tests/test_load_history.py` (6 pipeline and idempotency tests), and `data/tests/test_load_history_postgres.py` (PostgreSQL 17 Docker integration test).
- Recorded the architectural decision in `docs/adr/0004-historical-data-pipeline.md` and updated `docs/adr/README.md`.

## Resulting behavior

- Every source file balances `read = loaded + discarded + pending` across the real DistriLux spreadsheets against the synchronized ERP catalog (`120` customers, `60` products):
  - `Clientes - Comercial.xlsx`: `read=139 | loaded=120 | discarded=16 | pending=3` (`OK`)
  - `Pedidos 2025-2026 - Comercial.xlsx`: `read=15359 | loaded=15329 (INVOICED=14751, CANCELLED=578) | discarded=30 | pending=0` (`OK`, net sales `R$ 28,515,232.31`)
  - `titulos.csv`: `read=8313 | loaded=8216 | discarded=43 | pending=54` (`OK`)
- Running `python -m data.pipeline.load_history --database-url ...` sequentially multiple times against PostgreSQL leaves the exact same persisted totals (`historical_order_items = 15,329`, `historical_receivables = 8,216`, `load_issues = 57`) with zero duplicates.
- Unresolvable records (such as the 3 commercial prospects absent from the ERP and receivables missing `id_cliente` or having conflicting duplicate amounts) are stored in `load_issues` with explicit `problem_type`, `raw_value`, and JSON row context in `resolution`.
- Cancelled order items remain stored as `CANCELLED` and never contribute to net sales totals.

## Impact

- **API / OpenAPI:** No HTTP routes, Zod schemas, or OpenAPI contract changes.
- **Database / Migrations:** No new Prisma migration; reads `customers` and `products` and upserts into `historical_order_items`, `historical_receivables`, and `load_issues` created by `s1-01-data-model`. Rollback: truncate `historical_order_items`, `historical_receivables`, and `load_issues` without affecting ERP or portal tables.
- **Security and privacy:** Raw spreadsheets (`data/raw/`), exploration notebooks (`data/notebooks/`), and virtual environments (`data/.venv/`) are git-ignored; database credentials come from `--database-url` and are never logged.
- **ADR:** `docs/adr/0004-historical-data-pipeline.md` (renumbered from `0003` after `s1-03-erp-sync` claimed `ADR-0003`).

## Validations executed

- **Red / Green / Refactor (cleaners & pipeline):**
  - Red: initial `pytest` runs failed before `cleaners.py` and `load_history.py` existed; PostgreSQL schema alignment test `pytest data/tests/test_load_history_postgres.py -v` failed with `psycopg.errors.UndefinedTable: relation "Customer" does not exist` before `snake_case` SQL alignment.
  - Green: `.\data\.venv\Scripts\python.exe -m pytest data/tests/ -v` -> Exit code 0 (`119 passed in 9.87s`).
  - Refactor: added `PostgresHistoryStore.counts()` reporting and re-ran `.\data\.venv\Scripts\python.exe -m pytest data/tests/ -v` -> Exit code 0 (`119 passed in 17.55s`).
- **End-to-end execution against ERP-synchronized PostgreSQL 17 (3 consecutive runs):**
  - Synchronized real ERP catalog once via `s1-03-erp-sync` (`SUCCESS`, `665` records read/changed: `120` customers, `60` products, `485` receivables).
  - Executed `.\data\.venv\Scripts\python.exe -m data.pipeline.load_history --database-url "postgresql://postgres:postgres@localhost:5433/node_boilerplate"` consecutively; persisted counts remained `{'order_items': 15329, 'receivables': 8216, 'issues': 57}` across runs, and 5 `load_issues` rows were inspected directly in PostgreSQL (`prospect_not_in_erp` on rows 8, 55, 129 of `Clientes - Comercial.xlsx`; `missing_customer_id` on rows 415, 572 of `titulos.csv`).
- **Repository verification gates:**
  - `.\node_modules\.bin\openspec.cmd validate --all --strict --no-interactive` -> Exit code 0 (`Totals: 5 passed, 0 failed`).
  - `.\node_modules\.bin\tsc.cmd --noEmit` -> Exit code 0.
  - `.\node_modules\.bin\tsc.cmd -p tsconfig.build.json` -> Exit code 0.
  - `.\node_modules\.bin\vitest.cmd run tests/architecture` -> Exit code 0 (`1 passed, 3 passed`).
  - `node scripts/check-agent-skills.mjs` -> Exit code 0.

## Related artifacts

- Proposal: `openspec/changes/s1-07-history-load/proposal.md`
- Specifications: `openspec/changes/s1-07-history-load/specs/historical-data-ingestion/spec.md`
- Design: `openspec/changes/s1-07-history-load/design.md`
- Tasks: `openspec/changes/s1-07-history-load/tasks.md`
- ADR: `docs/adr/0004-historical-data-pipeline.md` (related: `ADR-0001`, `ADR-0003`)

## Usage

```bash
# Audit spreadsheets in memory without touching PostgreSQL
python -m data.pipeline.load_history --dry-run

# Persist idempotently into ERP-synchronized PostgreSQL
python -m data.pipeline.load_history --database-url "$DATABASE_URL"
```

## Implementation notes

- Running on Windows with `core.autocrlf=true` produces CRLF warnings on untouched files during global `pnpm format:check`; all files modified in this branch are formatted with Prettier.
- Automated tests never call the live ERP API (`test_load_history_postgres.py` seeds an isolated ephemeral `postgres:17-alpine` Docker container).
