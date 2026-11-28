## 1. SDD — Specification and Architecture

- [x] 1.1 Explore the three historical spreadsheets in read-only mode to catalog every format anomaly, duplicate pattern, and noise row without altering raw files.
- [x] 1.2 Create OpenSpec planning artifacts (`proposal.md`, `specs/historical-data-ingestion/spec.md`, `design.md`, and `tasks.md`) for `s1-07-history-load`.
- [x] 1.3 Record the Python + pandas + psycopg architectural decision in `docs/adr/0004-historical-data-pipeline.md`.

## 2. Red — Failing Automated Tests

- [x] 2.1 Write unit tests in `data/tests/test_cleaners.py` covering money cents, dates (including Excel serials), ERP codes (with zero-padding), CNPJs, cities/states, sellers, statuses, quantities, installments, text normalization, single-match lookup, and noise/footer rows; run `pytest` to confirm failure before implementation.
- [x] 2.2 Write pipeline tests in `data/tests/test_load_history.py` covering post-cleaning deduplication, customer/product unique matching, cancelled order exclusion from net sales, receivable reversal vs conflict handling, ERP precedence (RN-09), per-file accounting, and double-run idempotency; run `pytest` to confirm failure before implementation.
- [x] 2.3 Write a PostgreSQL integration test verifying `PostgresHistoryStore` SQL alignment against the migrated `s1-01-data-model` schema (`historical_order_items`, `historical_receivables`, `load_issues`, `customers`, `products`) and confirm Red before aligning SQL identifiers.

## 3. Green — Minimal Implementation

- [x] 3.1 Implement pure cleaning functions in `data/pipeline/cleaners.py` until all unit tests in `data/tests/test_cleaners.py` pass and 0 real values fail parsing across the three raw files.
- [x] 3.2 Implement `data/pipeline/load_history.py` with `ErpCatalog`, file processors, `InMemoryHistoryStore`, `PostgresHistoryStore`, and CLI (`--dry-run` and `--database-url`) until all tests in `data/tests/test_load_history.py` pass.
- [x] 3.3 After `s1-01-data-model` and `s1-03-erp-sync` merge into `develop`, align `PostgresHistoryStore` SQL queries to the snake_case schema (`historical_order_items`, `historical_receivables`, `load_issues`, `customers`, `products`), run the load twice against PostgreSQL, and verify identical row counts and 5 inspected `load_issues`.

## 4. Refactor

- [x] 4.1 Refine `normalize_text_key` (handling `35 mm2` vs `35mm²`) and `normalize_code` (handling missing leading zeros such as `C077` -> `C0077`) discovered during `--dry-run` issue inspection while keeping all 118 tests green.
- [x] 4.2 Review `data/pipeline/load_history.py` after PostgreSQL integration for clarity, type safety, and strict separation of concerns with all tests remaining green.

## 5. Consolidation and Verification

- [x] 5.1 Run Python verification (`python -m pytest data/tests/ -v` and `python -m data.pipeline.load_history --database-url ...` twice) and repository gates (`pnpm format:check`, `pnpm typecheck`, `pnpm spec:validate`, `pnpm verify`, `pnpm build`).
- [x] 5.2 Create `docs/changes/s1-07-history-load.md` from `docs/templates/change.md` linking OpenSpec artifacts and `docs/adr/0004-historical-data-pipeline.md`.
- [x] 5.3 Run branch review (`citi-review-change`) and prepare the pull request (`citi-prepare-pr`) with per-file accounting, test output, and Red/Green/Refactor evidence.
