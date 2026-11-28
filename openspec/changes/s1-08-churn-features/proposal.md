## Why

DistriLux currently notices lost customers only months after they stop buying, even though warning signs appear earlier as declining order frequency, falling purchase volume, and overdue receivables. Now that the Sprint 1 database model (`s1-01-data-model`) is merged, we must compute leak-free monthly point-in-time behavioral features and 90-day forward churn labels (`ChurnFeature`) across all customers so the Sprint 2 churn risk model (`US-026`, `RN-18`) has an auditable Gold-layer training and inference dataset.

## What Changes

- Add an additive Prisma model `ChurnFeature` (mapped to `churn_features`) with a unique `(customerCode, month)` constraint, monetary features in integer cents (`RN-13`), nullable `daysSinceLastOrder` (`Int?`), and nullable `churned90d` (`Boolean?`), along with a new Prisma migration and regenerated client.
- Implement `data/pipeline/churn_features.py` and automated tests in `data/tests/test_churn_features.py` to build the full monthly customer panel from `2025-01` through the dataset cutoff month.
- Combine pre-October 2026 historical data (`historical_order_items` with `INVOICED` status and `historical_receivables` excluding `REVERSED`) with October 2026+ ERP-synchronized data (`orders` and `receivables`, deduplicating overlapping October receivables by title number with ERP precedence per `RN-09`) and `customers.segment`.
- Compute each month's six features strictly from events on or before the last calendar day of that month (preventing future data leakage), leaving `daysSinceLastOrder` and `churned90d` as `null` in months prior to a customer's first invoiced order.
- Compute the binary 90-day churn label (`churned90d`, `RN-18`) as `true` when, at any day within the 90 calendar days following month-end, a customer who has already purchased reaches 90 or more consecutive days without an invoiced order, and `null` when fewer than 90 days exist between month-end and the dataset cutoff date.
- Persist feature rows idempotently (`UPSERT` on `(customer_code, month)`) and report total rows and churned customer counts for Sprint 2 modeling.

### In Scope

- Additive `ChurnFeature` Prisma schema model, migration, and database constraint tests.
- Point-in-time monthly feature computation, multi-source (historical + ERP) event unification without double counting, leak-free rolling windows, and 90-day churn labeling.
- Automated unit and database/idempotency tests (`pytest` and Vitest integration where applicable) plus CLI execution (`--dry-run` and `--database-url`).

### Out of Scope (Non-Goals)

- Training, hyperparameter tuning, validating, or serving a machine learning churn model (`US-026`, Sprint 2).
- Generating risk bands (`alto`, `médio`, `baixo`) or natural-language risk explanations (`RN-20`, Sprint 2).
- Adding HTTP endpoints, controllers, Zod schemas, or OpenAPI 3.1 routes.
- Modifying raw spreadsheet cleaning logic (`s1-07-history-load`) or mutating ERP-owned tables (`customers`, `products`, `receivables`, `orders`).

## Capabilities

### New Capabilities

- `churn-feature-computation`: Monthly point-in-time customer churn feature engineering, historical-and-ERP event unification, leak-free 90-day churn labeling, and idempotent storage in `churn_features`.

### Modified Capabilities

<!-- None: existing backend-foundation requirements remain unchanged. -->

## Impact

- **Business:** Materializes the Gold-layer panel dataset (`ChurnFeature`) capturing declining purchase trajectories and overdue receivables month by month, enabling Sprint 2 churn risk prediction (`US-026`) with at least 30 days' advance warning while keeping pre-first-order and insufficient-horizon months cleanly unlabeled (`null`).
- **API:** No HTTP endpoints, request/response schemas, or OpenAPI contract changes.
- **Database / Migrations:** Adds one additive Prisma migration creating `churn_features` (`@@unique([customerCode, month])`) and updates the generated Prisma client; existing tables and migrations remain untouched.
- **Security:** Reads existing database tables using runtime-configured credentials without logging customer payloads, secrets, or connection strings.
- **Observability:** CLI execution reports the number of customers, monthly rows generated, labeled vs unlabeled (`null`) rows, and distinct customers who experienced a 90-day churn event.
- **Documentation:** Adds OpenSpec artifacts under `openspec/changes/s1-08-churn-features/` and (at closure) `docs/changes/s1-08-churn-features.md`.
- **Dependencies:** Reuses the existing Python 3.11+ environment (`pandas`, `psycopg[binary]`, `pytest`) and existing Prisma/PostgreSQL stack with zero new Node.js or Python packages.
