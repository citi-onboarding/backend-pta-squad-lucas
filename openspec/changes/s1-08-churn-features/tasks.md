## 1. SDD — Specification and Planning

- [x] 1.1 Resolve task ambiguities (`PD-1` full monthly grid with nullable pre-first-order recency/label, `PD-2` rolling 90-day inactivity gap within the forward 90-day window, and `PD-3` historical + ERP event unification).
- [x] 1.2 Create OpenSpec planning artifacts (`proposal.md`, `specs/churn-feature-computation/spec.md`, `design.md`, and `tasks.md`) for `s1-08-churn-features` and validate with `openspec validate --strict`.

## 2. Red — Failing Automated Tests

- [ ] 2.1 Write failing Python unit tests in `data/tests/test_churn_features.py` covering the full monthly panel (`2025-01`..cutoff), rolling 3-month and prior 3-month order/revenue windows, point-in-time `daysSinceLastOrder` and `overdueReceivables` without future data leakage, `null` recency and label before first purchase, `null` label when fewer than 90 days remain before cutoff, rolling 90-day churn target transitions, exclusion of `CANCELLED`/`REVERSED` records, October 2026 receivable deduplication with ERP precedence, and double-run idempotency; run `pytest` and record Red evidence.
- [ ] 2.2 Write a failing database integration test verifying the `ChurnFeature` Prisma model and unique `(customerCode, month)` constraint; run the narrowest integration test and record Red evidence.

## 3. Green — Minimal Implementation

- [ ] 3.1 Add the `ChurnFeature` model (`@@map("churn_features")`, `@@unique([customerCode, month])`) to `prisma/schema.prisma`, generate the additive migration (`pnpm db:migrate`), regenerate the Prisma client, and confirm the database integration test passes.
- [ ] 3.2 Implement `data/pipeline/churn_features.py` (event unification, leak-free monthly panel computation, 90-day forward churn labeling, `InMemoryChurnFeatureStore`, `PostgresChurnFeatureStore` with `ON CONFLICT (customer_code, month) DO UPDATE`, and CLI `--dry-run` / `--database-url`) until all tests in `data/tests/test_churn_features.py` pass; record Green evidence.

## 4. Refactor

- [ ] 4.1 Refine `data/pipeline/churn_features.py` for readability, strict type annotations, and separation between pure feature calculation and database persistence while keeping all Python and TypeScript tests green; record Refactor evidence.

## 5. Consolidation and Verification

- [ ] 5.1 Run full verification gates (`python -m pytest data/tests/ -v`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm verify`, `pnpm test:integration`, `openspec validate --all --strict --no-interactive`, and `pnpm build`).
- [ ] 5.2 Create `docs/changes/s1-08-churn-features.md` from `docs/templates/change.md` (recording that no new ADR is needed because `ADR-0001` and `ADR-0003` already govern the architecture).
- [ ] 5.3 Run `citi-review-change` and `citi-prepare-pr` (including the sample table screenshot and total churned customer count for the `01/12` ML workshop).
