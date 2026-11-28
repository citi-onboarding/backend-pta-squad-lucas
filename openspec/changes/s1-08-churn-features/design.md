## Context

See `proposal.md` for motivation and scope. `s1-01-data-model` merged the core Sprint 1 PostgreSQL schema (`customers`, `orders`, `order_items`, `receivables`, `historical_order_items`, `historical_receivables`, `load_issues`), and `ADR-0001` specifies that money fields use 32-bit `Int` cents ending in `Cents` and additive Prisma migrations preserve applied migrations unchanged. Historical pre-October 2026 transactions live in `historical_order_items` / `historical_receivables`, while October 2026+ transactions arrive in `orders` / `receivables` via ERP synchronization (`s1-03-erp-sync`).

## Goals / Non-Goals

**Goals:**

- Add the `ChurnFeature` Prisma model (`@@map("churn_features")`) with an additive migration and database-enforced `@@unique([customerCode, month])`.
- Implement pure, deterministic pandas feature computation functions decoupled from database I/O so unit tests verify every rolling window, leak-prevention rule, and 90-day churn boundary in milliseconds.
- Unify historical and ERP order/receivable streams without double counting October 2026 overlaps (`RN-09`, `RN-17`).
- Support both `--dry-run` (in-memory store / local data preview) and `--database-url` (idempotent `psycopg` `ON CONFLICT (customer_code, month) DO UPDATE`).

**Non-Goals:**

- Model training, feature scaling/one-hot encoding, threshold calibration, or HTTP API exposure (all deferred to Sprint 2 `US-026` / `US-027`).
- Mutating any source table (`customers`, `orders`, `receivables`, `historical_order_items`, `historical_receivables`).

## Decisions

### D1: Additive `ChurnFeature` table keyed by `(customerCode, month)` with nullable recency and label

- **Choice:** Store `customerCode` (`String`, `@map("customer_code")`, matching `customers.erp_id` and historical tables) and `month` (`String`, `"YYYY-MM"`), with `ordersLast3m` (`Int`), `revenueLast3mCents` (`Int`), `revenuePrev3mCents` (`Int`), `daysSinceLastOrder` (`Int?`), `overdueReceivables` (`Int`), `segment` (`String`), `churned90d` (`Boolean?`), and `@@unique([customerCode, month])`.
- **Rationale:** Generating the full monthly grid from `2025-01` through the cutoff month across all customers (aligned with tech lead guidance) requires representing pre-first-order months without fabricating a `True` or `False` churn outcome or introducing a synthetic third class that would break binary probability modeling in Sprint 2. Keeping `daysSinceLastOrder` (`Int?`) and `churned90d` (`Boolean?`) as `null` before the first invoiced order cleanly distinguishes pre-acquisition rows (`daysSinceLastOrder IS NULL`) from insufficient-horizon recent rows (`daysSinceLastOrder IS NOT NULL AND churned90d IS NULL`).
- **Alternatives rejected:** Three-class categorical target (`YES` / `NO` / `NOT_APPLICABLE`), which complicates binary probability calibration for `RN-20` risk bands; omitting pre-first-order months, rejected during alignment with the tech lead.

### D2: Rolling 90-day inactivity gap check within `(month_end, month_end + 90 days]`

- **Choice:** For an active customer (`daysSinceLastOrder != null`) when `cutoff_date >= month_end + 90 days`, evaluate the customer's chronological invoiced order dates `(d_0 <= month_end < d_1 < d_2 ...)` clipped to `(month_end, month_end + 90 days]`: `churned90d` is `true` iff any consecutive gap `(next_date - prev_date).days >= 90` occurs on or before `month_end + 90 days` (including `(month_end + 90 days - last_order_before_horizon_end).days >= 90`).
- **Rationale:** Directly implements `RN-18` (_"probabilidade de o cliente ativo chegar a essa situação [90 dias ou mais sem nenhum pedido faturado] nos próximos 90 dias"_), catching ~95-day abandonments that start mid-quarter and resume before `month_end + 90 days`, which a naive "zero orders in next 90 days" check would miss.
- **Alternatives rejected:** Naive zero-order count in `(month_end, month_end + 90 days]` (misses 90–115 day gaps straddling month boundaries); labeling `daysSinceLastOrder >= 90` on the current row (leaks the feature directly into the target and fails to predict future churn).

### D3: Point-in-time reconstruction of `overdueReceivables` and source unification

- **Choice:** Reconstruct `overdueReceivables` at `month_end` from raw dates (`issued_at <= month_end`, `due_date <= month_end` or `< month_end` — specifically `due_date < month_end` for strictly past-due titles, `status != 'REVERSED'`, and `paid_at IS NULL OR paid_at > month_end`) rather than relying on the current static `status` column. When unifying receivables across `historical_receivables` and `receivables`, deduplicate by title number (`erp_id` / `title_id`) giving precedence to the ERP record (`RN-09`). For invoiced orders, combine `historical_order_items` (`status = 'INVOICED'`, aggregated to order level `(order_number, customer_code, date, sum(total_cents))`) with portal/ERP `orders` whose status is `SENT_TO_ERP` or `APPROVED` (deduplicated by `erp_order_number` when present).
- **Rationale:** Using today's `PAID` status on a receivable that was actually paid two months after `month_end` would leak future payment information into past months. Date-based reconstruction guarantees zero future leakage.
- **Alternatives rejected:** Filtering by static `status == 'OVERDUE'` (leaks future payments and misses titles that were overdue at `month_end` and paid later).

### D4: No new ADR required

- **Choice:** Reuse the architectural boundary already established in `ADR-0001` (integer cents, additive Prisma migrations, unique business keys) and `ADR-0004` (Python + pandas + psycopg writing to backend PostgreSQL).
- **Rationale:** `s1-08-churn-features` introduces no new runtime, external dependency, or cross-cutting architectural boundary beyond `ADR-0001` and `ADR-0004`.

## Risks / Trade-offs

- **[Sprint 1 schema coordination (`ADR-0001`)]** → Mitigation: Keep the migration strictly additive (`churn_features` table only, no changes to existing models) and notify the Sprint 1 data model owner (Benjamim) during PR review.
- **[Class imbalance in 90-day churn labels]** → Mitigation: Report exact positive/negative/null counts in the CLI output so Sprint 2 ML training (`01/12` workshop) can apply appropriate class weighting or threshold tuning.
- **[Empty ERP tables before `s1-03-erp-sync` runs]** → Mitigation: Handle empty `orders`/`receivables` tables gracefully and provide `--dry-run` mode capable of running end-to-end against cleaned historical data.

## Migration Plan

1. Add `ChurnFeature` to `prisma/schema.prisma`, generate the additive migration (`pnpm db:migrate --name add_churn_features`), and regenerate the Prisma client (`pnpm db:generate`).
2. Run Vitest integration tests and Python `pytest` suite (`data/tests/test_churn_features.py`) verifying constraints, leak-free features, 90-day labels, and idempotency.
3. Execute `python -m data.pipeline.churn_features` twice once historical and ERP data are loaded, confirming identical row counts in `churn_features`.
4. Rollback: Drop `churn_features` via a corrective migration or truncate `churn_features`; no existing portal or ERP tables are affected.
