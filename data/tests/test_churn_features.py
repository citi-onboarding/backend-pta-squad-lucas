"""Unit and idempotency tests for monthly customer churn feature computation (S1-08)."""

from __future__ import annotations

from datetime import date

import pytest

from data.pipeline.churn_features import (
    ChurnFeatureRow,
    CustomerRecord,
    ErpOrderInput,
    HistoricalOrderItemInput,
    InMemoryChurnFeatureStore,
    ReceivableInput,
    compute_churn_features,
    run_churn_feature_pipeline,
)


def _by_key(rows: list[ChurnFeatureRow]) -> dict[tuple[str, str], ChurnFeatureRow]:
    return {(row.customer_code, row.month): row for row in rows}


class TestMonthlyPanelAndSegment:
    """Verify full monthly panel generation from 2025-01 through cutoff month."""

    def test_generates_one_row_per_customer_and_month_with_segment(self) -> None:
        customers = [
            CustomerRecord(customer_code="C0001", segment="Varejo"),
            CustomerRecord(customer_code="C0002", segment="Atacado"),
        ]
        orders = [
            HistoricalOrderItemInput(
                order_number=1001,
                customer_code="C0001",
                order_date=date(2025, 2, 10),
                total_cents=150_000,
                status="INVOICED",
            ),
        ]

        rows = compute_churn_features(
            customers=customers,
            historical_order_items=orders,
            erp_orders=[],
            historical_receivables=[],
            erp_receivables=[],
            cutoff_date=date(2025, 4, 30),
        )

        # 2 customers x 4 months (2025-01..2025-04) = 8 rows
        assert len(rows) == 8
        indexed = _by_key(rows)
        assert set(indexed.keys()) == {
            ("C0001", "2025-01"),
            ("C0001", "2025-02"),
            ("C0001", "2025-03"),
            ("C0001", "2025-04"),
            ("C0002", "2025-01"),
            ("C0002", "2025-02"),
            ("C0002", "2025-03"),
            ("C0002", "2025-04"),
        }
        assert indexed[("C0001", "2025-01")].segment == "Varejo"
        assert indexed[("C0002", "2025-04")].segment == "Atacado"

    def test_pre_first_order_months_have_zero_metrics_and_null_recency_and_label(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0010", segment="Industria")]
        orders = [
            HistoricalOrderItemInput(
                order_number=2001,
                customer_code="C0010",
                order_date=date(2025, 3, 15),
                total_cents=500_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=2002,
                customer_code="C0010",
                order_date=date(2025, 5, 10),
                total_cents=400_000,
                status="INVOICED",
            ),
        ]

        rows = compute_churn_features(
            customers=customers,
            historical_order_items=orders,
            erp_orders=[],
            historical_receivables=[],
            erp_receivables=[],
            cutoff_date=date(2025, 9, 30),
        )
        indexed = _by_key(rows)

        for pre_month in ("2025-01", "2025-02"):
            row = indexed[("C0010", pre_month)]
            assert row.orders_last_3m == 0
            assert row.revenue_last_3m_cents == 0
            assert row.revenue_prev_3m_cents == 0
            assert row.days_since_last_order is None
            assert row.churned_90d is None

        march = indexed[("C0010", "2025-03")]
        assert march.orders_last_3m == 1
        assert march.revenue_last_3m_cents == 500_000
        assert march.days_since_last_order == 16  # 2025-03-31 - 2025-03-15
        assert march.churned_90d is False


class TestRollingWindowsAndNoLeakage:
    """Verify exact 3m/prev-3m rolling windows and zero future data leakage."""

    def test_rolling_three_month_and_prior_three_month_windows_match_exact_sums(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0028", segment="Construtora")]
        # Order 3001 has two product items (must count as 1 distinct order)
        orders = [
            HistoricalOrderItemInput(
                order_number=3001,
                customer_code="C0028",
                order_date=date(2025, 1, 10),
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=3001,
                customer_code="C0028",
                order_date=date(2025, 1, 10),
                total_cents=50_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=3002,
                customer_code="C0028",
                order_date=date(2025, 3, 20),
                total_cents=200_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=3003,
                customer_code="C0028",
                order_date=date(2025, 4, 5),
                total_cents=300_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=3004,
                customer_code="C0028",
                order_date=date(2025, 6, 15),
                total_cents=450_000,
                status="INVOICED",
            ),
        ]

        rows = compute_churn_features(
            customers=customers,
            historical_order_items=orders,
            erp_orders=[],
            historical_receivables=[],
            erp_receivables=[],
            cutoff_date=date(2025, 6, 30),
        )
        indexed = _by_key(rows)

        # For 2025-06:
        # last 3m = 2025-04..2025-06 -> orders 3003 + 3004 = 2 orders, 750_000 cents
        # prev 3m = 2025-01..2025-03 -> orders 3001 (150k) + 3002 (200k) = 350_000 cents
        june = indexed[("C0028", "2025-06")]
        assert june.orders_last_3m == 2
        assert june.revenue_last_3m_cents == 750_000
        assert june.revenue_prev_3m_cents == 350_000
        assert june.days_since_last_order == 15  # 2025-06-30 - 2025-06-15

    def test_future_orders_and_future_payments_never_alter_past_month_features(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0030", segment="Varejo")]
        base_orders = [
            HistoricalOrderItemInput(
                order_number=4001,
                customer_code="C0030",
                order_date=date(2025, 2, 12),
                total_cents=120_000,
                status="INVOICED",
            ),
        ]
        base_receivables = [
            ReceivableInput(
                title_id=9001,
                customer_code="C0030",
                issued_at=date(2025, 2, 12),
                due_date=date(2025, 3, 14),
                paid_at=None,
                amount_cents=120_000,
                status="OVERDUE",
                source="HISTORICAL",
            ),
        ]

        rows_before = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=base_orders,
                erp_orders=[],
                historical_receivables=base_receivables,
                erp_receivables=[],
                cutoff_date=date(2025, 3, 31),
            )
        )

        # Add future order in April and mark receivable paid in May
        future_orders = [
            *base_orders,
            HistoricalOrderItemInput(
                order_number=4002,
                customer_code="C0030",
                order_date=date(2025, 4, 2),
                total_cents=999_000,
                status="INVOICED",
            ),
        ]
        future_receivables = [
            ReceivableInput(
                title_id=9001,
                customer_code="C0030",
                issued_at=date(2025, 2, 12),
                due_date=date(2025, 3, 14),
                paid_at=date(2025, 5, 10),
                amount_cents=120_000,
                status="PAID",
                source="HISTORICAL",
            ),
        ]

        rows_after = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=future_orders,
                erp_orders=[],
                historical_receivables=future_receivables,
                erp_receivables=[],
                cutoff_date=date(2025, 7, 31),
            )
        )

        march_before = rows_before[("C0030", "2025-03")]
        march_after = rows_after[("C0030", "2025-03")]

        assert march_after.orders_last_3m == march_before.orders_last_3m == 1
        assert (
            march_after.revenue_last_3m_cents
            == march_before.revenue_last_3m_cents
            == 120_000
        )
        assert (
            march_after.revenue_prev_3m_cents
            == march_before.revenue_prev_3m_cents
            == 0
        )
        assert (
            march_after.days_since_last_order
            == march_before.days_since_last_order
            == 47
        )
        assert (
            march_after.overdue_receivables == march_before.overdue_receivables == 1
        )

        # Title paid on 2025-05-10 is still overdue at 2025-04-30, but cleared at 2025-05-31
        assert rows_after[("C0030", "2025-04")].overdue_receivables == 1
        assert rows_after[("C0030", "2025-05")].overdue_receivables == 0


class TestSourceUnificationAndExclusions:
    """Verify exclusions (CANCELLED/REVERSED/non-invoiced) and Oct 2026 ERP precedence."""

    def test_cancelled_orders_reversed_receivables_and_unapproved_portal_orders_are_excluded(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0040", segment="Varejo")]
        historical_items = [
            HistoricalOrderItemInput(
                order_number=5001,
                customer_code="C0040",
                order_date=date(2025, 1, 15),
                total_cents=250_000,
                status="CANCELLED",
            ),
            HistoricalOrderItemInput(
                order_number=5002,
                customer_code="C0040",
                order_date=date(2025, 2, 10),
                total_cents=100_000,
                status="INVOICED",
            ),
        ]
        erp_orders = [
            ErpOrderInput(
                order_id="ord-draft",
                order_number=None,
                customer_code="C0040",
                order_date=date(2025, 2, 15),
                total_cents=500_000,
                status="DRAFT",
            ),
            ErpOrderInput(
                order_id="ord-rejected",
                order_number=None,
                customer_code="C0040",
                order_date=date(2025, 2, 16),
                total_cents=400_000,
                status="REJECTED",
            ),
            ErpOrderInput(
                order_id="ord-sent",
                order_number=5003,
                customer_code="C0040",
                order_date=date(2025, 2, 20),
                total_cents=300_000,
                status="SENT_TO_ERP",
            ),
        ]
        historical_receivables = [
            ReceivableInput(
                title_id=9101,
                customer_code="C0040",
                issued_at=date(2025, 1, 15),
                due_date=date(2025, 2, 1),
                paid_at=None,
                amount_cents=250_000,
                status="REVERSED",
                source="HISTORICAL",
            ),
        ]

        rows = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=historical_items,
                erp_orders=erp_orders,
                historical_receivables=historical_receivables,
                erp_receivables=[],
                cutoff_date=date(2025, 2, 28),
            )
        )

        # In Jan 2025, only CANCELLED order existed -> treated as pre-first-order
        jan = rows[("C0040", "2025-01")]
        assert jan.orders_last_3m == 0
        assert jan.revenue_last_3m_cents == 0
        assert jan.days_since_last_order is None
        assert jan.churned_90d is None

        # In Feb 2025, orders 5002 + 5003 counted; DRAFT/REJECTED/CANCELLED/REVERSED ignored
        feb = rows[("C0040", "2025-02")]
        assert feb.orders_last_3m == 2
        assert feb.revenue_last_3m_cents == 400_000
        assert feb.days_since_last_order == 8  # 2025-02-28 - 2025-02-20
        assert feb.overdue_receivables == 0

    def test_overlapping_october_receivable_is_deduplicated_with_erp_precedence(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0050", segment="Atacado")]
        # Title 9200 appears in both historical (still unpaid) and ERP (paid on 2026-10-15)
        historical_receivables = [
            ReceivableInput(
                title_id=9200,
                customer_code="C0050",
                issued_at=date(2026, 9, 10),
                due_date=date(2026, 10, 10),
                paid_at=None,
                amount_cents=180_000,
                status="OVERDUE",
                source="HISTORICAL",
            ),
        ]
        erp_receivables = [
            ReceivableInput(
                title_id=9200,
                customer_code="C0050",
                issued_at=date(2026, 9, 10),
                due_date=date(2026, 10, 10),
                paid_at=date(2026, 10, 15),
                amount_cents=180_000,
                status="PAID",
                source="ERP",
            ),
            # Another title present only in ERP, overdue at 2026-10-31
            ReceivableInput(
                title_id=9201,
                customer_code="C0050",
                issued_at=date(2026, 10, 1),
                due_date=date(2026, 10, 20),
                paid_at=None,
                amount_cents=95_000,
                status="OVERDUE",
                source="ERP",
            ),
        ]

        rows = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=[],
                erp_orders=[],
                historical_receivables=historical_receivables,
                erp_receivables=erp_receivables,
                cutoff_date=date(2026, 10, 31),
                start_month="2026-09",
            )
        )

        # At 2026-10-31: title 9200 uses ERP (paid Oct 15 -> not overdue); title 9201 is overdue -> count = 1
        assert rows[("C0050", "2026-10")].overdue_receivables == 1


class TestNinetyDayForwardChurnLabel:
    """Verify rolling 90-day inactivity gap label semantics (PD-2 Option B, RN-18)."""

    def test_detects_rolling_90_day_inactivity_gap_even_when_customer_later_reactivates(
        self,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0060", segment="Varejo")]
        # Buys on Feb 10, then goes silent for 94 days until May 15, then buys again on Jun 20 and Aug 1
        orders = [
            HistoricalOrderItemInput(
                order_number=6001,
                customer_code="C0060",
                order_date=date(2025, 2, 10),
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=6002,
                customer_code="C0060",
                order_date=date(2025, 5, 15),  # 94 days after Feb 10 (crosses 90d on May 11)
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=6003,
                customer_code="C0060",
                order_date=date(2025, 6, 20),  # 36 days after May 15
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=6004,
                customer_code="C0060",
                order_date=date(2025, 8, 1),  # 42 days after Jun 20
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=6005,
                customer_code="C0060",
                order_date=date(2025, 9, 15),  # 45 days after Aug 1
                total_cents=100_000,
                status="INVOICED",
            ),
        ]

        rows = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=orders,
                erp_orders=[],
                historical_receivables=[],
                erp_receivables=[],
                cutoff_date=date(2025, 9, 30),
            )
        )

        # Jan 2025: pre-first-order -> None
        assert rows[("C0060", "2025-01")].churned_90d is None

        # Feb 2025 (window Mar 1..May 29): May 11 hits 90 days since Feb 10 -> True
        assert rows[("C0060", "2025-02")].churned_90d is True

        # Mar 2025 (window Apr 1..Jun 29): May 11 hits 90 days since Feb 10 -> True
        assert rows[("C0060", "2025-03")].churned_90d is True

        # Apr 2025 (window May 1..Jul 29): May 11 hits 90 days since Feb 10 -> True
        assert rows[("C0060", "2025-04")].churned_90d is True

        # May 2025 (window Jun 1..Aug 29): reactivated on May 15; gaps are 36d and 42d (< 90) -> False
        assert rows[("C0060", "2025-05")].churned_90d is False

        # Jun 2025 (window Jul 1..Sep 28, cutoff Sep 30 >= Sep 28): gaps 42d and 45d -> False
        assert rows[("C0060", "2025-06")].churned_90d is False

        # Jul, Aug, Sep 2025: fewer than 90 days left until 2025-09-30 -> None
        assert rows[("C0060", "2025-07")].churned_90d is None
        assert rows[("C0060", "2025-08")].churned_90d is None
        assert rows[("C0060", "2025-09")].churned_90d is None

    @pytest.mark.parametrize(
        ("second_order_date", "expected_churned"),
        [
            # Last order 2025-03-31; horizon_end for 2025-03 is 2025-06-29 (90 days).
            # Buying ON 2025-06-29 means peak day without order is 2025-06-28 (89 days) -> False
            (date(2025, 6, 29), False),
            # Buying ON 2025-06-30 means on 2025-06-29 elapsed days reached 90 -> True
            (date(2025, 6, 30), True),
        ],
    )
    def test_exact_90_day_boundary_on_horizon_end(
        self,
        second_order_date: date,
        expected_churned: bool,
    ) -> None:
        customers = [CustomerRecord(customer_code="C0061", segment="Varejo")]
        orders = [
            HistoricalOrderItemInput(
                order_number=6101,
                customer_code="C0061",
                order_date=date(2025, 3, 31),
                total_cents=100_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=6102,
                customer_code="C0061",
                order_date=second_order_date,
                total_cents=100_000,
                status="INVOICED",
            ),
        ]

        rows = _by_key(
            compute_churn_features(
                customers=customers,
                historical_order_items=orders,
                erp_orders=[],
                historical_receivables=[],
                erp_receivables=[],
                cutoff_date=date(2025, 7, 31),
                start_month="2025-03",
            )
        )

        assert rows[("C0061", "2025-03")].churned_90d is expected_churned


class TestIdempotentPipelineExecution:
    """Verify running the pipeline twice produces identical stored state without duplicates."""

    def test_running_pipeline_twice_is_idempotent_and_reports_churned_customers(
        self,
    ) -> None:
        customers = [
            CustomerRecord(customer_code="C0070", segment="Varejo"),
            CustomerRecord(customer_code="C0071", segment="Atacado"),
        ]
        orders = [
            # C0070 buys only in Jan 2025 -> churns
            HistoricalOrderItemInput(
                order_number=7001,
                customer_code="C0070",
                order_date=date(2025, 1, 10),
                total_cents=200_000,
                status="INVOICED",
            ),
            # C0071 buys regularly every 45 days -> never churns
            HistoricalOrderItemInput(
                order_number=7002,
                customer_code="C0071",
                order_date=date(2025, 1, 15),
                total_cents=300_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=7003,
                customer_code="C0071",
                order_date=date(2025, 3, 1),
                total_cents=300_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=7004,
                customer_code="C0071",
                order_date=date(2025, 4, 15),
                total_cents=300_000,
                status="INVOICED",
            ),
            HistoricalOrderItemInput(
                order_number=7005,
                customer_code="C0071",
                order_date=date(2025, 5, 30),
                total_cents=300_000,
                status="INVOICED",
            ),
        ]

        store = InMemoryChurnFeatureStore()
        summary_first = run_churn_feature_pipeline(
            customers=customers,
            historical_order_items=orders,
            erp_orders=[],
            historical_receivables=[],
            erp_receivables=[],
            cutoff_date=date(2025, 6, 30),
            store=store,
        )
        snapshot_after_first = store.fetch_all()

        summary_second = run_churn_feature_pipeline(
            customers=customers,
            historical_order_items=orders,
            erp_orders=[],
            historical_receivables=[],
            erp_receivables=[],
            cutoff_date=date(2025, 6, 30),
            store=store,
        )
        snapshot_after_second = store.fetch_all()

        assert len(snapshot_after_first) == 12  # 2 customers x 6 months
        assert snapshot_after_second == snapshot_after_first
        assert summary_second == summary_first
        assert summary_first.customers_count == 2
        assert summary_first.rows_written == 12
        assert summary_first.distinct_churned_customers == 1
