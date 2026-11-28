"""Monthly point-in-time churn feature engineering and 90-day churn labeling (S1-08).

Computes leak-free monthly behavioral features and 90-day forward churn labels
for every customer from ``2025-01`` through the dataset cutoff month, unifying
pre-October 2026 historical records with October 2026+ ERP-synchronized records
and persisting results idempotently into ``churn_features``.
"""

from __future__ import annotations

import argparse
import calendar
import os
import sys
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol

import pandas as pd

CHURN_INACTIVITY_DAYS = 90
INVOICED_HISTORICAL_STATUS = "INVOICED"
INVOICED_ERP_ORDER_STATUSES = frozenset({"SENT_TO_ERP", "APPROVED"})
REVERSED_RECEIVABLE_STATUS = "REVERSED"
DEFAULT_START_MONTH = "2025-01"


@dataclass(frozen=True)
class CustomerRecord:
    """Master customer attributes required for feature generation."""

    customer_code: str
    segment: str


@dataclass(frozen=True)
class HistoricalOrderItemInput:
    """Single item row from ``historical_order_items``."""

    order_number: int
    customer_code: str
    order_date: date
    total_cents: int
    status: str


@dataclass(frozen=True)
class ErpOrderInput:
    """Order row from ``orders`` joined with ``customers.erp_id``."""

    order_id: str
    order_number: int | None
    customer_code: str
    order_date: date
    total_cents: int
    status: str


@dataclass(frozen=True)
class UnifiedOrder:
    """Deduplicated invoiced order event ready for feature aggregation."""

    order_key: str
    customer_code: str
    order_date: date
    total_cents: int


@dataclass(frozen=True)
class ReceivableInput:
    """Receivable row from either ``historical_receivables`` or ``receivables``."""

    title_id: int
    customer_code: str
    issued_at: date
    due_date: date
    paid_at: date | None
    amount_cents: int
    status: str
    source: str


@dataclass(frozen=True)
class ChurnFeatureRow:
    """Single Gold-layer monthly row persisted to ``churn_features``."""

    customer_code: str
    month: str
    orders_last_3m: int
    revenue_last_3m_cents: int
    revenue_prev_3m_cents: int
    days_since_last_order: int | None
    overdue_receivables: int
    segment: str
    churned_90d: bool | None


@dataclass(frozen=True)
class ChurnFeatureSummary:
    """Execution summary reported by the churn feature pipeline."""

    customers_count: int
    months_count: int
    rows_written: int
    labeled_rows: int
    positive_rows: int
    negative_rows: int
    null_rows: int
    distinct_churned_customers: int


class ChurnFeatureStore(Protocol):
    """Storage abstraction for persisting and reading churn feature rows."""

    def upsert_features(self, rows: Sequence[ChurnFeatureRow]) -> int:
        """Persist feature rows idempotently keyed by (customer_code, month)."""

    def fetch_all(self) -> list[ChurnFeatureRow]:
        """Return all stored feature rows sorted by (customer_code, month)."""


class InMemoryChurnFeatureStore:
    """Deterministic in-memory store used for unit tests and dry runs."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str], ChurnFeatureRow] = {}

    def upsert_features(self, rows: Sequence[ChurnFeatureRow]) -> int:
        for row in rows:
            self._rows[(row.customer_code, row.month)] = row
        return len(rows)

    def fetch_all(self) -> list[ChurnFeatureRow]:
        return [self._rows[key] for key in sorted(self._rows.keys())]


def _to_date(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    return value


def _parse_month(month_str: str) -> tuple[int, int]:
    parts = month_str.split("-", maxsplit=1)
    if len(parts) != 2 or len(parts[0]) != 4 or len(parts[1]) != 2:
        raise ValueError(f"Expected month in YYYY-MM format, got: {month_str!r}")
    year, month = int(parts[0]), int(parts[1])
    if not 1 <= month <= 12:
        raise ValueError(f"Month out of range (01..12), got: {month_str!r}")
    return year, month


def _shift_month(year: int, month: int, delta_months: int) -> tuple[int, int]:
    total = (year * 12 + (month - 1)) + delta_months
    shifted_year, shifted_month_zero = divmod(total, 12)
    return shifted_year, shifted_month_zero + 1


def _month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def _month_end(year: int, month: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, last_day)


def generate_month_sequence(start_month: str, cutoff_date: date) -> list[str]:
    """Generate consecutive YYYY-MM strings from start_month through cutoff_date's month."""
    start_year, start_m = _parse_month(start_month)
    end_year, end_m = cutoff_date.year, cutoff_date.month

    months: list[str] = []
    year, month = start_year, start_m
    while (year, month) <= (end_year, end_m):
        months.append(f"{year:04d}-{month:02d}")
        year, month = _shift_month(year, month, 1)
    return months


def unify_invoiced_orders(
    historical_items: Sequence[HistoricalOrderItemInput],
    erp_orders: Sequence[ErpOrderInput],
) -> list[UnifiedOrder]:
    """Combine historical invoiced items and approved/sent ERP orders without double counting."""
    unified_by_key: dict[str, UnifiedOrder] = {}

    invoiced_rows = [
        {
            "order_number": item.order_number,
            "customer_code": item.customer_code,
            "order_date": item.order_date,
            "total_cents": item.total_cents,
        }
        for item in historical_items
        if item.status == INVOICED_HISTORICAL_STATUS
    ]

    if invoiced_rows:
        df_hist = pd.DataFrame(invoiced_rows)
        grouped = (
            df_hist.groupby(["order_number", "customer_code"], as_index=False)
            .agg(order_date=("order_date", "min"), total_cents=("total_cents", "sum"))
        )
        for rec in grouped.itertuples(index=False):
            key = f"ORD:{int(rec.order_number)}"
            unified_by_key[key] = UnifiedOrder(
                order_key=key,
                customer_code=str(rec.customer_code),
                order_date=_to_date(rec.order_date),  # type: ignore[arg-type]
                total_cents=int(rec.total_cents),
            )

    # ERP records take precedence when an order number overlaps (RN-09).
    for erp_order in erp_orders:
        if erp_order.status not in INVOICED_ERP_ORDER_STATUSES:
            continue
        key = (
            f"ORD:{erp_order.order_number}"
            if erp_order.order_number is not None
            else f"PORTAL:{erp_order.order_id}"
        )
        unified_by_key[key] = UnifiedOrder(
            order_key=key,
            customer_code=erp_order.customer_code,
            order_date=erp_order.order_date,
            total_cents=int(erp_order.total_cents),
        )

    return sorted(
        unified_by_key.values(),
        key=lambda o: (o.customer_code, o.order_date, o.order_key),
    )


def unify_receivables(
    historical_receivables: Sequence[ReceivableInput],
    erp_receivables: Sequence[ReceivableInput],
) -> list[ReceivableInput]:
    """Deduplicate historical and ERP receivables by title_id with ERP precedence (RN-09)."""
    by_title: dict[int, ReceivableInput] = {}
    for rec in historical_receivables:
        by_title[rec.title_id] = rec
    for rec in erp_receivables:
        by_title[rec.title_id] = rec

    return [
        rec
        for rec in by_title.values()
        if rec.status != REVERSED_RECEIVABLE_STATUS
    ]


def _reaches_inactivity_threshold_in_horizon(
    order_dates: Sequence[date],
    as_of: date,
    horizon_end: date,
    threshold_days: int = CHURN_INACTIVITY_DAYS,
) -> bool:
    """Return True iff on any day d in (as_of, horizon_end], days since latest order >= threshold."""
    last_order_before = max(d for d in order_dates if d <= as_of)
    future_orders = sorted({d for d in order_dates if as_of < d <= horizon_end})

    prev_order = last_order_before
    for next_order in future_orders:
        # On the day immediately before next_order, elapsed days since prev_order peaks.
        peak_day = next_order - timedelta(days=1)
        if peak_day > as_of and (peak_day - prev_order).days >= threshold_days:
            return True
        prev_order = next_order

    # Tail segment from the last order up through horizon_end.
    if prev_order < horizon_end and (horizon_end - prev_order).days >= threshold_days:
        return True

    return False


def _count_overdue_receivables_at(
    receivables: Sequence[ReceivableInput],
    as_of: date,
) -> int:
    """Count non-reversed receivables that were past due and unpaid on ``as_of``."""
    return sum(
        1
        for rec in receivables
        if rec.issued_at <= as_of
        and rec.due_date <= as_of
        and (rec.paid_at is None or rec.paid_at > as_of)
    )


def _compute_customer_month_row(
    customer: CustomerRecord,
    month_str: str,
    cust_orders: Sequence[UnifiedOrder],
    cust_order_dates: Sequence[date],
    cust_receivables: Sequence[ReceivableInput],
    cutoff_date: date,
) -> ChurnFeatureRow:
    """Compute one leak-free point-in-time ChurnFeatureRow for a (customer, month) pair."""
    year, month_num = _parse_month(month_str)
    month_end = _month_end(year, month_num)
    as_of = min(month_end, cutoff_date)

    last3m_start = _month_start(*_shift_month(year, month_num, -2))
    prev3m_start = _month_start(*_shift_month(year, month_num, -5))
    prev3m_end = _month_end(*_shift_month(year, month_num, -3))

    orders_last_3m = 0
    revenue_last_3m_cents = 0
    revenue_prev_3m_cents = 0
    latest_order_on_or_before: date | None = None

    for order in cust_orders:
        if order.order_date > as_of:
            continue
        if (
            latest_order_on_or_before is None
            or order.order_date > latest_order_on_or_before
        ):
            latest_order_on_or_before = order.order_date
        if last3m_start <= order.order_date <= as_of:
            orders_last_3m += 1
            revenue_last_3m_cents += order.total_cents
        elif prev3m_start <= order.order_date <= prev3m_end:
            revenue_prev_3m_cents += order.total_cents

    days_since_last_order = (
        (as_of - latest_order_on_or_before).days
        if latest_order_on_or_before is not None
        else None
    )
    overdue_receivables = _count_overdue_receivables_at(cust_receivables, as_of)

    horizon_end = as_of + timedelta(days=CHURN_INACTIVITY_DAYS)
    if latest_order_on_or_before is None or cutoff_date < horizon_end:
        churned_90d: bool | None = None
    else:
        churned_90d = _reaches_inactivity_threshold_in_horizon(
            order_dates=cust_order_dates,
            as_of=as_of,
            horizon_end=horizon_end,
        )

    return ChurnFeatureRow(
        customer_code=customer.customer_code,
        month=month_str,
        orders_last_3m=orders_last_3m,
        revenue_last_3m_cents=revenue_last_3m_cents,
        revenue_prev_3m_cents=revenue_prev_3m_cents,
        days_since_last_order=days_since_last_order,
        overdue_receivables=overdue_receivables,
        segment=customer.segment,
        churned_90d=churned_90d,
    )


def compute_churn_features(
    customers: Sequence[CustomerRecord],
    historical_order_items: Sequence[HistoricalOrderItemInput],
    erp_orders: Sequence[ErpOrderInput],
    historical_receivables: Sequence[ReceivableInput],
    erp_receivables: Sequence[ReceivableInput],
    cutoff_date: date,
    start_month: str = DEFAULT_START_MONTH,
) -> list[ChurnFeatureRow]:
    """Compute leak-free monthly features and 90-day churn labels for all customers."""
    months = generate_month_sequence(start_month=start_month, cutoff_date=cutoff_date)
    if not customers or not months:
        return []

    unified_orders = unify_invoiced_orders(historical_order_items, erp_orders)
    unified_receivables = unify_receivables(historical_receivables, erp_receivables)

    orders_by_customer: dict[str, list[UnifiedOrder]] = {}
    for order in unified_orders:
        orders_by_customer.setdefault(order.customer_code, []).append(order)

    receivables_by_customer: dict[str, list[ReceivableInput]] = {}
    for rec in unified_receivables:
        receivables_by_customer.setdefault(rec.customer_code, []).append(rec)

    sorted_customers = sorted(customers, key=lambda c: c.customer_code)
    results: list[ChurnFeatureRow] = []

    for customer in sorted_customers:
        cust_orders = orders_by_customer.get(customer.customer_code, [])
        cust_order_dates = [o.order_date for o in cust_orders]
        cust_receivables = receivables_by_customer.get(customer.customer_code, [])

        for month_str in months:
            results.append(
                _compute_customer_month_row(
                    customer=customer,
                    month_str=month_str,
                    cust_orders=cust_orders,
                    cust_order_dates=cust_order_dates,
                    cust_receivables=cust_receivables,
                    cutoff_date=cutoff_date,
                )
            )

    return results


def summarize_features(
    rows: Sequence[ChurnFeatureRow],
    customers_count: int,
    months_count: int,
) -> ChurnFeatureSummary:
    """Aggregate row counts and distinct churned customers for observability."""
    positive_rows = sum(1 for r in rows if r.churned_90d is True)
    negative_rows = sum(1 for r in rows if r.churned_90d is False)
    null_rows = sum(1 for r in rows if r.churned_90d is None)
    distinct_churned = len({r.customer_code for r in rows if r.churned_90d is True})

    return ChurnFeatureSummary(
        customers_count=customers_count,
        months_count=months_count,
        rows_written=len(rows),
        labeled_rows=positive_rows + negative_rows,
        positive_rows=positive_rows,
        negative_rows=negative_rows,
        null_rows=null_rows,
        distinct_churned_customers=distinct_churned,
    )


def rows_to_dataframe(rows: Sequence[ChurnFeatureRow]) -> pd.DataFrame:
    """Convert computed feature rows to a pandas DataFrame for inspection or export."""
    return pd.DataFrame(
        [
            {
                "customer_code": r.customer_code,
                "month": r.month,
                "orders_last_3m": r.orders_last_3m,
                "revenue_last_3m_cents": r.revenue_last_3m_cents,
                "revenue_prev_3m_cents": r.revenue_prev_3m_cents,
                "days_since_last_order": r.days_since_last_order,
                "overdue_receivables": r.overdue_receivables,
                "segment": r.segment,
                "churned_90d": r.churned_90d,
            }
            for r in rows
        ]
    )


def run_churn_feature_pipeline(
    customers: Sequence[CustomerRecord],
    historical_order_items: Sequence[HistoricalOrderItemInput],
    erp_orders: Sequence[ErpOrderInput],
    historical_receivables: Sequence[ReceivableInput],
    erp_receivables: Sequence[ReceivableInput],
    cutoff_date: date,
    store: ChurnFeatureStore,
    start_month: str = DEFAULT_START_MONTH,
) -> ChurnFeatureSummary:
    """Compute monthly churn features, persist idempotently, and return summary metrics."""
    months = generate_month_sequence(start_month=start_month, cutoff_date=cutoff_date)
    rows = compute_churn_features(
        customers=customers,
        historical_order_items=historical_order_items,
        erp_orders=erp_orders,
        historical_receivables=historical_receivables,
        erp_receivables=erp_receivables,
        cutoff_date=cutoff_date,
        start_month=start_month,
    )
    store.upsert_features(rows)
    return summarize_features(
        rows=rows,
        customers_count=len(customers),
        months_count=len(months),
    )


class PostgresChurnFeatureStore:
    """PostgreSQL reader and idempotent writer for the ``churn_features`` table."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def load_inputs(
        self,
    ) -> tuple[
        list[CustomerRecord],
        list[HistoricalOrderItemInput],
        list[ErpOrderInput],
        list[ReceivableInput],
        list[ReceivableInput],
    ]:
        """Load customers, historical transactions, and ERP transactions from PostgreSQL."""
        import psycopg

        with psycopg.connect(self._database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT erp_id, segment FROM customers ORDER BY erp_id"
                )
                customers = [
                    CustomerRecord(customer_code=str(r[0]), segment=str(r[1]))
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT order_number, customer_code, date, total_cents, status::text
                    FROM historical_order_items
                    """
                )
                historical_items = [
                    HistoricalOrderItemInput(
                        order_number=int(r[0]),
                        customer_code=str(r[1]),
                        order_date=_to_date(r[2]),  # type: ignore[arg-type]
                        total_cents=int(r[3]),
                        status=str(r[4]),
                    )
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT o.id, o.erp_order_number, c.erp_id, o.created_at, o.total_cents, o.status::text
                    FROM orders o
                    INNER JOIN customers c ON c.id = o.customer_id
                    """
                )
                erp_orders = [
                    ErpOrderInput(
                        order_id=str(r[0]),
                        order_number=int(r[1]) if r[1] is not None else None,
                        customer_code=str(r[2]),
                        order_date=_to_date(r[3]),  # type: ignore[arg-type]
                        total_cents=int(r[4]),
                        status=str(r[5]),
                    )
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT title_id, customer_code, issued_at, due_date, paid_at, amount_cents, status::text
                    FROM historical_receivables
                    """
                )
                historical_receivables = [
                    ReceivableInput(
                        title_id=int(r[0]),
                        customer_code=str(r[1]),
                        issued_at=_to_date(r[2]),  # type: ignore[arg-type]
                        due_date=_to_date(r[3]),  # type: ignore[arg-type]
                        paid_at=_to_date(r[4]),
                        amount_cents=int(r[5]),
                        status=str(r[6]),
                        source="HISTORICAL",
                    )
                    for r in cur.fetchall()
                ]

                cur.execute(
                    """
                    SELECT r.erp_id, c.erp_id, r.issued_at, r.due_date, r.paid_at, r.amount_cents, r.status::text
                    FROM receivables r
                    INNER JOIN customers c ON c.id = r.customer_id
                    """
                )
                erp_receivables = [
                    ReceivableInput(
                        title_id=int(r[0]),
                        customer_code=str(r[1]),
                        issued_at=_to_date(r[2]),  # type: ignore[arg-type]
                        due_date=_to_date(r[3]),  # type: ignore[arg-type]
                        paid_at=_to_date(r[4]),
                        amount_cents=int(r[5]),
                        status=str(r[6]),
                        source="ERP",
                    )
                    for r in cur.fetchall()
                ]

        return (
            customers,
            historical_items,
            erp_orders,
            historical_receivables,
            erp_receivables,
        )

    def upsert_features(self, rows: Sequence[ChurnFeatureRow]) -> int:
        if not rows:
            return 0
        import psycopg

        sql = """
            INSERT INTO churn_features (
                id,
                customer_code,
                month,
                orders_last_3m,
                revenue_last_3m_cents,
                revenue_prev_3m_cents,
                days_since_last_order,
                overdue_receivables,
                segment,
                churned_90d,
                created_at,
                updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (customer_code, month) DO UPDATE SET
                orders_last_3m = EXCLUDED.orders_last_3m,
                revenue_last_3m_cents = EXCLUDED.revenue_last_3m_cents,
                revenue_prev_3m_cents = EXCLUDED.revenue_prev_3m_cents,
                days_since_last_order = EXCLUDED.days_since_last_order,
                overdue_receivables = EXCLUDED.overdue_receivables,
                segment = EXCLUDED.segment,
                churned_90d = EXCLUDED.churned_90d,
                updated_at = CURRENT_TIMESTAMP
        """
        params = [
            (
                str(uuid.uuid4()),
                r.customer_code,
                r.month,
                r.orders_last_3m,
                r.revenue_last_3m_cents,
                r.revenue_prev_3m_cents,
                r.days_since_last_order,
                r.overdue_receivables,
                r.segment,
                r.churned_90d,
            )
            for r in rows
        ]

        with psycopg.connect(self._database_url) as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, params)
            conn.commit()
        return len(rows)

    def fetch_all(self) -> list[ChurnFeatureRow]:
        import psycopg

        with psycopg.connect(self._database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        customer_code,
                        month,
                        orders_last_3m,
                        revenue_last_3m_cents,
                        revenue_prev_3m_cents,
                        days_since_last_order,
                        overdue_receivables,
                        segment,
                        churned_90d
                    FROM churn_features
                    ORDER BY customer_code, month
                    """
                )
                return [
                    ChurnFeatureRow(
                        customer_code=str(r[0]),
                        month=str(r[1]),
                        orders_last_3m=int(r[2]),
                        revenue_last_3m_cents=int(r[3]),
                        revenue_prev_3m_cents=int(r[4]),
                        days_since_last_order=int(r[5]) if r[5] is not None else None,
                        overdue_receivables=int(r[6]),
                        segment=str(r[7]),
                        churned_90d=bool(r[8]) if r[8] is not None else None,
                    )
                    for r in cur.fetchall()
                ]


def infer_cutoff_date(
    historical_items: Sequence[HistoricalOrderItemInput],
    erp_orders: Sequence[ErpOrderInput],
    historical_receivables: Sequence[ReceivableInput],
    erp_receivables: Sequence[ReceivableInput],
) -> date:
    """Infer the dataset cutoff date from the latest transaction date across all sources."""
    candidate_dates: list[date] = []
    candidate_dates.extend(i.order_date for i in historical_items)
    candidate_dates.extend(o.order_date for o in erp_orders)
    candidate_dates.extend(r.issued_at for r in historical_receivables)
    candidate_dates.extend(r.issued_at for r in erp_receivables)
    if not candidate_dates:
        return date.today()
    return max(candidate_dates)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compute monthly point-in-time customer churn features (S1-08).",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="PostgreSQL connection string (defaults to DATABASE_URL env var).",
    )
    parser.add_argument(
        "--start-month",
        default=DEFAULT_START_MONTH,
        help="First calendar month in YYYY-MM format (default: 2025-01).",
    )
    parser.add_argument(
        "--cutoff-date",
        default=None,
        help="Explicit dataset cutoff date in YYYY-MM-DD format (inferred if omitted).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute features in memory without writing to churn_features.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for computing and persisting churn features."""
    args = _build_parser().parse_args(argv)
    if not args.database_url:
        print(
            "Error: --database-url or DATABASE_URL environment variable is required.",
            file=sys.stderr,
        )
        return 2

    pg_store = PostgresChurnFeatureStore(args.database_url)
    (
        customers,
        historical_items,
        erp_orders,
        historical_receivables,
        erp_receivables,
    ) = pg_store.load_inputs()

    cutoff = (
        date.fromisoformat(args.cutoff_date)
        if args.cutoff_date
        else infer_cutoff_date(
            historical_items,
            erp_orders,
            historical_receivables,
            erp_receivables,
        )
    )

    target_store: ChurnFeatureStore = (
        InMemoryChurnFeatureStore() if args.dry_run else pg_store
    )
    summary = run_churn_feature_pipeline(
        customers=customers,
        historical_order_items=historical_items,
        erp_orders=erp_orders,
        historical_receivables=historical_receivables,
        erp_receivables=erp_receivables,
        cutoff_date=cutoff,
        store=target_store,
        start_month=args.start_month,
    )

    mode = "DRY-RUN" if args.dry_run else "PERSISTED"
    print(
        f"[{mode}] cutoff={cutoff.isoformat()} | customers={summary.customers_count} | "
        f"months={summary.months_count} | rows={summary.rows_written} | "
        f"labeled={summary.labeled_rows} (churn=True: {summary.positive_rows}, "
        f"churn=False: {summary.negative_rows}) | null={summary.null_rows} | "
        f"distinct_churned_customers={summary.distinct_churned_customers}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
