---
change_id: s1-08-churn-features
date: 2026-11-26
status: in-progress
owners: [Gabriel]
tags: [data-pipeline, churn, features, prisma, python, sprint-1]
related_adrs: [ADR-0001]
openspec_change: openspec/changes/s1-08-churn-features/
---

# Monthly customer churn feature computation

## Objective

DistriLux currently notices customer churn only months after a buyer stops purchasing, even though early warning signs appear as falling order frequency, declining revenue, and overdue receivables. This change adds the Gold-layer `ChurnFeature` table and a leak-free Python/pandas pipeline that computes monthly behavioral features and 90-day forward churn outcomes (`RN-18`) across all customers so Sprint 2 churn modeling (`US-026`) has an auditable training and inference dataset.

## Change made

- Added the additive Prisma model `ChurnFeature` (`@@map("churn_features")`, `@@unique([customerCode, month])`, `@@index([month])`) to `prisma/schema.prisma`, storing monetary amounts in integer cents (`RN-13`) and keeping `daysSinceLastOrder` (`Int?`) and `churned90d` (`Boolean?`) nullable.
- Added the additive migration `prisma/migrations/20261126204800_s1_08_churn_features/migration.sql` and regenerated the Prisma client in `src/shared/database/generated/`.
- Implemented `data/pipeline/churn_features.py` with:
  - Historical + ERP source unification (`unify_invoiced_orders`, `unify_receivables`) excluding `CANCELLED` historical items, unapproved portal orders, and `REVERSED` receivables, and deduplicating overlapping October 2026 receivables by title number with ERP precedence (`RN-09`).
  - Pure point-in-time monthly panel generation (`compute_churn_features`, `_compute_customer_month_row`, `_count_overdue_receivables_at`) from `2025-01` through the dataset cutoff month, preventing future data leakage for rolling windows (`ordersLast3m`, `revenueLast3mCents`, `revenuePrev3mCents`), `daysSinceLastOrder`, and `overdueReceivables`.
  - Rolling 90-day forward churn labeling (`_reaches_inactivity_threshold_in_horizon`, `RN-18`), leaving `daysSinceLastOrder` and `churned90d` as `null` prior to a customer's first invoiced order and leaving `churned90d` as `null` when fewer than 90 calendar days remain before the cutoff date.
  - Idempotent persistence (`InMemoryChurnFeatureStore` and `PostgresChurnFeatureStore` using `INSERT ... ON CONFLICT (customer_code, month) DO UPDATE`) and CLI (`--database-url`, `--start-month`, `--cutoff-date`, `--dry-run`).
- Added automated tests in `data/tests/test_churn_features.py` (10 unit and idempotency tests) and `src/shared/database/churn-feature-storage.integration.test.ts` (3 PostgreSQL 17 integration tests via Testcontainers).

## Resulting behavior

- Every customer receives exactly one monthly row per calendar month from `2025-01` through the cutoff month carrying their segment and uniquely keyed by `(customer_code, month)`.
- Rolling 3-month (`M-2..M`) and prior 3-month (`M-5..M-3`) metrics count distinct invoiced orders and sum revenue in integer cents strictly up to month-end (`as_of = min(month_end, cutoff_date)`).
- Point-in-time `overdueReceivables` counts non-reversed receivables with `issued_at <= as_of`, `due_date <= as_of`, and `paid_at IS NULL OR paid_at > as_of`, so future payments never leak into past months.
- Months prior to a customer's first invoiced order store `0` for order/revenue counters and `null` for `daysSinceLastOrder` and `churned90d`; recent months with fewer than 90 calendar days until `cutoff_date` store `null` for `churned90d`.
- For active buyers with a full 90-day forward horizon, `churned90d` is `true` if and only if on any calendar day within `(as_of, as_of + 90 days]` the elapsed days since their latest invoiced order reaches 90 or more, and `false` otherwise.
- Running the pipeline twice sequentially produces identical rows in `churn_features` without duplicates; direct duplicate inserts on `(customer_code, month)` are rejected by PostgreSQL (`P2002`).

## Impact

- **API / OpenAPI:** No HTTP endpoints, Zod validation schemas, or OpenAPI contract changes.
- **Database / Migrations:** Adds one strictly additive table (`churn_features`) via `20261126204800_s1_08_churn_features`; no existing tables or applied migrations are modified. Rollback is a corrective migration dropping `churn_features` (or truncating it) with zero effect on ERP or portal tables.
- **Security and privacy:** Reads database credentials from `--database-url` or `DATABASE_URL` without logging secrets, connection strings, or customer payloads.
- **Observability:** CLI reports cutoff date, customer count, month count, total rows written, labeled vs. `null` rows, and distinct churned customers.
- **ADR decision:** Not applicable — no ADR trigger in `docs/adr/README.md` fires because this change reuses the durable database contract established in `ADR-0001` (additive Prisma migrations, integer cents, composite unique keys) and the Python/pandas/psycopg pipeline boundary established in `ADR-0003` (`s1-07-history-load`), introducing no new dependency, runtime, or cross-cutting architectural boundary.

## Validations executed

- **Red (Python):** `.\data\.venv\Scripts\python.exe -m pytest data/tests/test_churn_features.py -v` -> Exit code 1 (`ModuleNotFoundError: No module named 'data.pipeline.churn_features'`).
- **Red (TypeScript / Prisma):** `.\node_modules\.bin\tsc.cmd --noEmit` -> Exit code 1 (`error TS2339: Property 'churnFeature' does not exist on type 'PrismaClient'`).
- **Green (Python):** `.\data\.venv\Scripts\python.exe -m pytest data/tests/test_churn_features.py -v` -> Exit code 0 (`10 passed in 5.99s`).
- **Green (Prisma & PostgreSQL 17 integration):**
  - `node node_modules/prisma/build/index.js validate` -> `The schema at prisma\schema.prisma is valid` (Exit code 0).
  - `node node_modules/prisma/build/index.js generate` -> `Generated Prisma Client (7.10.1) to .\src\shared\database\generated in 522ms` (Exit code 0).
  - `.\node_modules\.bin\vitest.cmd run --config vitest.integration.config.ts src/shared/database/churn-feature-storage.integration.test.ts` -> Exit code 0 (`Test Files 1 passed (1), Tests 3 passed (3)`).
- **Refactor (Python):** `.\data\.venv\Scripts\python.exe -m pytest data/tests/test_churn_features.py -v` -> Exit code 0 (`10 passed in 8.68s`).
- **Verification gates:**
  - `.\node_modules\.bin\prettier.cmd --check openspec/changes/s1-08-churn-features/ src/shared/database/churn-feature-storage.integration.test.ts` -> `All matched files use Prettier code style!` (Exit code 0).
  - `.\node_modules\.bin\tsc.cmd --noEmit` -> Exit code 0.
  - `.\node_modules\.bin\tsc.cmd -p tsconfig.build.json` -> Exit code 0.
  - `.\node_modules\.bin\eslint.cmd src/shared/database/churn-feature-storage.integration.test.ts` -> Exit code 0.
  - `.\node_modules\.bin\vitest.cmd run --exclude '**/*.integration.test.ts' --exclude 'tests/architecture/**'` -> Exit code 0 (`Test Files 11 passed (11), Tests 42 passed (42)`).
  - `.\node_modules\.bin\openspec.cmd validate --all --strict --no-interactive` -> Exit code 0 (`Totals: 3 passed, 0 failed`).
  - `node scripts/check-agent-skills.mjs` -> Exit code 0.

## Related artifacts

- Proposal: `openspec/changes/s1-08-churn-features/proposal.md`
- Specifications: `openspec/changes/s1-08-churn-features/specs/churn-feature-computation/spec.md`
- Design: `openspec/changes/s1-08-churn-features/design.md`
- Tasks: `openspec/changes/s1-08-churn-features/tasks.md`
- Related ADRs: `docs/adr/0001-sprint-1-data-model.md` (new ADR: Not applicable, rationale in Impact)

## Usage

Run the pipeline after `s1-03-erp-sync` and `s1-07-history-load` have populated PostgreSQL:

```bash
# Dry-run preview (reads PostgreSQL, computes in memory, writes nothing)
python -m data.pipeline.churn_features --database-url "$DATABASE_URL" --dry-run

# Persist idempotently into churn_features
python -m data.pipeline.churn_features --database-url "$DATABASE_URL"
```

Sprint 2 ML training queries labeled rows via `SELECT * FROM churn_features WHERE churned_90d IS NOT NULL` and scores the latest active customer snapshots via `WHERE month = <latest_month> AND days_since_last_order IS NOT NULL`.

## Implementation notes

- On Windows development machines, `tests/architecture/boundaries.test.ts` and repository-wide CRLF checks (`prettier --check .`, `openapi:check` on untouched LF files) exhibit known Windows path/CRLF behavior already documented in `docs/changes/s1-01-data-model.md`; Linux CI (`ubuntu-latest`) validates those gates cleanly.
- End-to-end execution against the populated DistriLux database depends on `s1-03-erp-sync` and `s1-07-history-load` merging into `develop`.
