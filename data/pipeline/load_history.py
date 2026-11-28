from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import date
import json
from pathlib import Path
from typing import Any, Protocol
import uuid

import pandas as pd

from data.pipeline.cleaners import (
    is_noise_or_footer_row,
    normalize_city_state,
    normalize_cnpj,
    normalize_code,
    normalize_customer_status,
    normalize_installment,
    normalize_order_status,
    normalize_receivable_status,
    normalize_seller,
    normalize_text_key,
    parse_date,
    parse_money_cents,
    parse_quantity,
    resolve_unique_match,
)

CLIENTES_FILE = "Clientes - Comercial.xlsx"
PEDIDOS_FILE = "Pedidos 2025-2026 - Comercial.xlsx"
TITULOS_FILE = "titulos.csv"


@dataclass(frozen=True)
class LoadIssueRecord:
    source_file: str
    row_number: int
    raw_key: str | None
    reason: str
    raw_payload: dict[str, Any]


@dataclass
class FileAccount:
    source_file: str
    read_count: int = 0
    loaded_count: int = 0
    discarded_count: int = 0
    pending_count: int = 0

    @property
    def is_balanced(self) -> bool:
        return self.read_count == (
            self.loaded_count + self.discarded_count + self.pending_count
        )


@dataclass
class HistoricalOrderItemRecord:
    order_number: str
    order_date: date
    customer_erp_id: str
    seller_name: str | None
    product_erp_id: str
    description: str
    quantity: int
    unit: str
    unit_price_cents: int
    total_cents: int
    status: str  # INVOICED | CANCELLED
    corrections: list[str] = field(default_factory=list)

    def business_fingerprint(self) -> tuple[Any, ...]:
        return (
            self.order_number,
            self.order_date,
            self.customer_erp_id,
            self.product_erp_id,
            self.quantity,
            self.unit_price_cents,
            self.status,
        )


@dataclass
class HistoricalReceivableRecord:
    title_number: str
    customer_erp_id: str
    order_number: str
    installment: str
    amount_cents: int
    issue_date: date
    due_date: date
    payment_date: date | None
    status: str  # PAID | OPEN | OVERDUE | REVERSED
    corrections: list[str] = field(default_factory=list)

    def business_fingerprint(self) -> tuple[Any, ...]:
        return (
            self.title_number,
            self.customer_erp_id,
            self.order_number,
            self.installment,
            self.amount_cents,
            self.issue_date,
            self.due_date,
            self.payment_date,
            self.status,
        )


@dataclass
class ErpCatalog:
    customers_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    customers_by_name: dict[str, list[str]] = field(default_factory=dict)
    customers_by_cnpj: dict[str, list[str]] = field(default_factory=dict)
    products_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    products_by_name: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def from_records(
        cls,
        customers: list[dict[str, Any]],
        products: list[dict[str, Any]],
    ) -> ErpCatalog:
        catalog = cls()
        for cust in customers:
            erp_id = normalize_code(cust.get("erp_id"), prefix="C")
            if not erp_id:
                continue
            catalog.customers_by_id[erp_id] = dict(cust)

            name_key = normalize_text_key(cust.get("name"))
            if name_key:
                bucket = catalog.customers_by_name.setdefault(name_key, [])
                if erp_id not in bucket:
                    bucket.append(erp_id)

            cnpj = normalize_cnpj(cust.get("cnpj"))
            if cnpj:
                bucket = catalog.customers_by_cnpj.setdefault(cnpj, [])
                if erp_id not in bucket:
                    bucket.append(erp_id)

        for prod in products:
            erp_id = normalize_code(prod.get("erp_id"), prefix="P")
            if not erp_id:
                continue
            catalog.products_by_id[erp_id] = dict(prod)

            desc_key = normalize_text_key(prod.get("description") or prod.get("name"))
            if desc_key:
                bucket = catalog.products_by_name.setdefault(desc_key, [])
                if erp_id not in bucket:
                    bucket.append(erp_id)

        return catalog

    @classmethod
    def build_preview_from_spreadsheets(
        cls, df_customers: pd.DataFrame, df_orders: pd.DataFrame
    ) -> ErpCatalog:
        """Build a local preview catalog from raw spreadsheets for dry-run before ERP sync."""
        customers_map: dict[str, dict[str, Any]] = {}
        for _, row in df_customers.iterrows():
            if is_noise_or_footer_row(row.values):
                continue
            erp_id = normalize_code(row.get("Cód."), prefix="C")
            if not erp_id:
                continue
            updated_at = parse_date(row.get("Últ. atualização")) or date.min
            existing = customers_map.get(erp_id)
            if existing is None or updated_at >= existing["_updated_at"]:
                customers_map[erp_id] = {
                    "erp_id": erp_id,
                    "name": str(row.get("Razão Social") or "").strip(),
                    "cnpj": normalize_cnpj(row.get("CNPJ")),
                    "credit_limit_cents": parse_money_cents(row.get("Limite")),
                    "status": normalize_customer_status(row.get("Situação")),
                    "seller_name": normalize_seller(row.get("Vendedor")),
                    "_updated_at": updated_at,
                }

        products_map: dict[str, dict[str, Any]] = {}
        for _, row in df_orders.iterrows():
            if is_noise_or_footer_row(row.values):
                continue
            erp_id = normalize_code(row.get("Produto"), prefix="P")
            desc = row.get("Descrição")
            if erp_id and desc is not None and erp_id not in products_map:
                products_map[erp_id] = {
                    "erp_id": erp_id,
                    "description": str(desc).strip(),
                }

        return cls.from_records(
            customers=list(customers_map.values()),
            products=list(products_map.values()),
        )


class HistoryStore(Protocol):
    def upsert_order_item(self, item: HistoricalOrderItemRecord) -> None: ...
    def upsert_receivable(self, item: HistoricalReceivableRecord) -> None: ...
    def upsert_issue(self, issue: LoadIssueRecord) -> None: ...


class InMemoryHistoryStore:
    """In-memory idempotent store used for tests and --dry-run execution."""

    def __init__(self) -> None:
        self.order_items: dict[tuple[str, str], HistoricalOrderItemRecord] = {}
        self.receivables: dict[str, HistoricalReceivableRecord] = {}
        self.issues: dict[tuple[str, int, str], LoadIssueRecord] = {}

    def upsert_order_item(self, item: HistoricalOrderItemRecord) -> None:
        self.order_items[(item.order_number, item.product_erp_id)] = item

    def upsert_receivable(self, item: HistoricalReceivableRecord) -> None:
        self.receivables[item.title_number] = item

    def upsert_issue(self, issue: LoadIssueRecord) -> None:
        self.issues[(issue.source_file, issue.row_number, issue.reason)] = issue

    def counts(self) -> dict[str, int]:
        return {
            "order_items": len(self.order_items),
            "receivables": len(self.receivables),
            "issues": len(self.issues),
        }


class PostgresHistoryStore:
    """PostgreSQL idempotent store aligned with s1-01-data-model snake_case schema."""

    def __init__(self, conn: Any, run_id: str | None = None) -> None:
        self._conn = conn
        self._run_id = run_id or str(uuid.uuid4())

    def upsert_order_item(self, item: HistoricalOrderItemRecord) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO historical_order_items (
                    id, order_number, date, customer_code, seller_name,
                    product_code, description, unit, quantity,
                    unit_price_cents, total_cents, status, corrections
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::"HistoricalItemStatus", %s::jsonb
                )
                ON CONFLICT (order_number, product_code) DO UPDATE SET
                    date = EXCLUDED.date,
                    customer_code = EXCLUDED.customer_code,
                    seller_name = EXCLUDED.seller_name,
                    description = EXCLUDED.description,
                    unit = EXCLUDED.unit,
                    quantity = EXCLUDED.quantity,
                    unit_price_cents = EXCLUDED.unit_price_cents,
                    total_cents = EXCLUDED.total_cents,
                    status = EXCLUDED.status,
                    corrections = EXCLUDED.corrections
                """,
                (
                    str(uuid.uuid4()),
                    int(item.order_number),
                    item.order_date,
                    item.customer_erp_id,
                    item.seller_name or "",
                    item.product_erp_id,
                    item.description,
                    item.unit,
                    item.quantity,
                    item.unit_price_cents,
                    item.total_cents,
                    item.status,
                    json.dumps(item.corrections, ensure_ascii=False),
                ),
            )

    def upsert_receivable(self, item: HistoricalReceivableRecord) -> None:
        parsed_order = (
            int(item.order_number)
            if str(item.order_number).strip().isdigit()
            else 0
        )
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO historical_receivables (
                    id, title_id, customer_code, order_number, installment,
                    amount_cents, issued_at, due_date, paid_at, status, corrections
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::"HistoricalReceivableStatus", %s::jsonb
                )
                ON CONFLICT (title_id) DO UPDATE SET
                    customer_code = EXCLUDED.customer_code,
                    order_number = EXCLUDED.order_number,
                    installment = EXCLUDED.installment,
                    amount_cents = EXCLUDED.amount_cents,
                    issued_at = EXCLUDED.issued_at,
                    due_date = EXCLUDED.due_date,
                    paid_at = EXCLUDED.paid_at,
                    status = EXCLUDED.status,
                    corrections = EXCLUDED.corrections
                """,
                (
                    str(uuid.uuid4()),
                    int(item.title_number),
                    item.customer_erp_id,
                    parsed_order,
                    item.installment,
                    item.amount_cents,
                    item.issue_date,
                    item.due_date,
                    item.payment_date,
                    item.status,
                    json.dumps(item.corrections, ensure_ascii=False),
                ),
            )

    def upsert_issue(self, issue: LoadIssueRecord) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO load_issues (
                    id, run_id, source_file, row_number, problem_type,
                    raw_value, resolution
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (source_file, row_number, problem_type) DO UPDATE SET
                    run_id = EXCLUDED.run_id,
                    raw_value = EXCLUDED.raw_value,
                    resolution = EXCLUDED.resolution
                """,
                (
                    str(uuid.uuid4()),
                    self._run_id,
                    issue.source_file,
                    issue.row_number,
                    issue.reason,
                    issue.raw_key,
                    json.dumps(issue.raw_payload, ensure_ascii=False, default=str),
                ),
            )

    def counts(self) -> dict[str, int]:
        """Return current persisted row counts across the three historical tables."""
        with self._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM historical_order_items")
            order_items = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM historical_receivables")
            receivables = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM load_issues")
            issues = int(cur.fetchone()[0])
        return {
            "order_items": order_items,
            "receivables": receivables,
            "issues": issues,
        }


@dataclass
class PipelineSummary:
    accounts: list[FileAccount]
    reconciled_customers: list[dict[str, Any]]
    order_items: list[HistoricalOrderItemRecord]
    receivables: list[HistoricalReceivableRecord]
    issues: list[LoadIssueRecord]
    net_sales_cents: int


def _safe_payload(row: pd.Series) -> dict[str, Any]:
    return {str(k): (None if pd.isna(v) else str(v)) for k, v in row.items()}


def calculate_net_sales_cents(items: list[HistoricalOrderItemRecord]) -> int:
    """Sum revenue in cents strictly for INVOICED items (excluding CANCELLED)."""
    return sum(item.total_cents for item in items if item.status == "INVOICED")


def audit_customers_sheet(
    df: pd.DataFrame,
    erp_catalog: ErpCatalog,
    source_file: str = CLIENTES_FILE,
) -> tuple[list[dict[str, Any]], list[LoadIssueRecord], FileAccount]:
    """Clean, deduplicate, and audit Clientes against ERP (RN-09: ERP always wins)."""
    account = FileAccount(source_file=source_file, read_count=len(df))
    issues: list[LoadIssueRecord] = []
    by_erp_id: dict[str, tuple[date, dict[str, Any]]] = {}

    for idx, row in df.iterrows():
        row_number = int(idx) + 1
        if is_noise_or_footer_row(row.values):
            account.discarded_count += 1
            continue

        raw_code = normalize_code(row.get("Cód."), prefix="C", width=4)
        cnpj = normalize_cnpj(row.get("CNPJ"))
        status = normalize_customer_status(row.get("Situação"))
        limit_cents = parse_money_cents(row.get("Limite"))
        seller = normalize_seller(row.get("Vendedor"))
        city, uf = normalize_city_state(row.get("Cidade/UF"))
        updated_at = parse_date(row.get("Últ. atualização")) or date.min
        name = str(row.get("Razão Social") or "").strip()

        resolved_id = raw_code
        if not resolved_id and cnpj:
            cnpj_matches = erp_catalog.customers_by_cnpj.get(cnpj, [])
            if len(cnpj_matches) == 1:
                resolved_id = cnpj_matches[0]
            elif len(cnpj_matches) > 1:
                issues.append(
                    LoadIssueRecord(
                        source_file=source_file,
                        row_number=row_number,
                        raw_key=cnpj,
                        reason="customer_cnpj_ambiguous",
                        raw_payload=_safe_payload(row),
                    )
                )
                account.pending_count += 1
                continue

        if not resolved_id:
            reason = "prospect_not_in_erp" if status == "PROSPECT" else "missing_customer_code"
            issues.append(
                LoadIssueRecord(
                    source_file=source_file,
                    row_number=row_number,
                    raw_key=name or None,
                    reason=reason,
                    raw_payload=_safe_payload(row),
                )
            )
            account.pending_count += 1
            continue

        erp_record = erp_catalog.customers_by_id.get(resolved_id)
        if erp_record is None:
            issues.append(
                LoadIssueRecord(
                    source_file=source_file,
                    row_number=row_number,
                    raw_key=resolved_id,
                    reason="customer_not_in_erp",
                    raw_payload=_safe_payload(row),
                )
            )
            account.pending_count += 1
            continue

        # RN-09: when spreadsheet and ERP disagree, ERP wins
        divergences: list[str] = []
        final_limit = erp_record.get("credit_limit_cents")
        if limit_cents is not None and final_limit is not None and limit_cents != final_limit:
            divergences.append("erp_override_credit_limit")

        final_status = erp_record.get("status")
        if status is not None and final_status is not None and status != final_status:
            divergences.append("erp_override_status")

        final_seller = erp_record.get("seller_name")
        if seller is not None and final_seller is not None and seller != final_seller:
            divergences.append("erp_override_seller")

        reconciled_entry = {
            "erp_id": resolved_id,
            "name": erp_record.get("name") or name,
            "cnpj": erp_record.get("cnpj") or cnpj,
            "city": city,
            "state": uf,
            "credit_limit_cents": final_limit if final_limit is not None else limit_cents,
            "status": final_status or status,
            "seller_name": final_seller or seller,
            "divergences": divergences,
        }

        if resolved_id in by_erp_id:
            prev_date, _ = by_erp_id[resolved_id]
            account.discarded_count += 1
            if updated_at >= prev_date:
                by_erp_id[resolved_id] = (updated_at, reconciled_entry)
        else:
            by_erp_id[resolved_id] = (updated_at, reconciled_entry)

    reconciled_list = [entry for _, entry in by_erp_id.values()]
    account.loaded_count = len(reconciled_list)
    return reconciled_list, issues, account


def process_orders_sheet(
    df: pd.DataFrame,
    erp_catalog: ErpCatalog,
    source_file: str = PEDIDOS_FILE,
) -> tuple[list[HistoricalOrderItemRecord], list[LoadIssueRecord], FileAccount]:
    """Clean, resolve customer/product against ERP, and deduplicate Pedidos."""
    account = FileAccount(source_file=source_file, read_count=len(df))
    issues: list[LoadIssueRecord] = []
    grouped: dict[tuple[str, str], list[tuple[int, pd.Series, HistoricalOrderItemRecord]]] = {}

    for idx, row in df.iterrows():
        row_number = int(idx) + 1
        if is_noise_or_footer_row(row.values):
            account.discarded_count += 1
            continue

        corrections: list[str] = []
        raw_order = row.get("Nº Pedido")
        order_number = None if pd.isna(raw_order) else str(raw_order).strip()
        if order_number and order_number.endswith(".0"):
            order_number = order_number[:-2]

        order_date = parse_date(row.get("Data"))
        quantity = parse_quantity(row.get("Qtd"))
        unit_price_cents = parse_money_cents(row.get("Preço Unit."))
        status = normalize_order_status(row.get("Status"))
        seller = normalize_seller(row.get("Vendedor"))
        unit = str(row.get("Un") or "").strip().upper()
        description = str(row.get("Descrição") or "").strip()

        if not order_number:
            issues.append(
                LoadIssueRecord(source_file, row_number, None, "missing_order_number", _safe_payload(row))
            )
            account.pending_count += 1
            continue

        if order_date is None or quantity is None or unit_price_cents is None or status is None:
            reason = (
                "invalid_order_date"
                if order_date is None
                else "invalid_quantity"
                if quantity is None
                else "invalid_unit_price"
                if unit_price_cents is None
                else "invalid_order_status"
            )
            issues.append(
                LoadIssueRecord(source_file, row_number, order_number, reason, _safe_payload(row))
            )
            account.pending_count += 1
            continue

        # Resolve Customer
        raw_customer = row.get("Cliente")
        customer_code = normalize_code(raw_customer, prefix="C", width=4)
        if customer_code:
            if customer_code not in erp_catalog.customers_by_id:
                issues.append(
                    LoadIssueRecord(
                        source_file, row_number, customer_code, "customer_code_not_in_erp", _safe_payload(row)
                    )
                )
                account.pending_count += 1
                continue
        else:
            customer_code, err = resolve_unique_match(raw_customer, erp_catalog.customers_by_name)
            if not customer_code:
                issues.append(
                    LoadIssueRecord(
                        source_file,
                        row_number,
                        str(raw_customer),
                        f"customer_{err}",
                        _safe_payload(row),
                    )
                )
                account.pending_count += 1
                continue
            corrections.append("customer_resolved_by_name")

        # Resolve Product
        raw_product = row.get("Produto")
        product_code = normalize_code(raw_product, prefix="P", width=5)
        if product_code:
            if product_code not in erp_catalog.products_by_id:
                issues.append(
                    LoadIssueRecord(
                        source_file, row_number, product_code, "product_code_not_in_erp", _safe_payload(row)
                    )
                )
                account.pending_count += 1
                continue
        else:
            product_code, err = resolve_unique_match(description, erp_catalog.products_by_name)
            if not product_code:
                issues.append(
                    LoadIssueRecord(
                        source_file,
                        row_number,
                        description or order_number,
                        f"product_{err}",
                        _safe_payload(row),
                    )
                )
                account.pending_count += 1
                continue
            corrections.append("product_resolved_by_description")

        record = HistoricalOrderItemRecord(
            order_number=order_number,
            order_date=order_date,
            customer_erp_id=customer_code,
            seller_name=seller,
            product_erp_id=product_code,
            description=description,
            quantity=quantity,
            unit=unit,
            unit_price_cents=unit_price_cents,
            total_cents=quantity * unit_price_cents,
            status=status,
            corrections=corrections,
        )
        grouped.setdefault((order_number, product_code), []).append((row_number, row, record))

    loaded_items: list[HistoricalOrderItemRecord] = []
    for (order_number, product_code), entries in grouped.items():
        if len(entries) == 1:
            loaded_items.append(entries[0][2])
            continue

        fingerprints = {entry[2].business_fingerprint() for entry in entries}
        if len(fingerprints) == 1:
            # Identical after cleaning -> keep 1, discard duplicates
            loaded_items.append(entries[0][2])
            account.discarded_count += len(entries) - 1
        else:
            # Conflicting duplicate for same (order_number, product_code) -> pendência
            for row_number, raw_row, _ in entries:
                issues.append(
                    LoadIssueRecord(
                        source_file=source_file,
                        row_number=row_number,
                        raw_key=f"{order_number}:{product_code}",
                        reason="conflicting_duplicate_order_item",
                        raw_payload=_safe_payload(raw_row),
                    )
                )
            account.pending_count += len(entries)

    account.loaded_count = len(loaded_items)
    return loaded_items, issues, account


def process_receivables_csv(
    df: pd.DataFrame,
    erp_catalog: ErpCatalog,
    source_file: str = TITULOS_FILE,
) -> tuple[list[HistoricalReceivableRecord], list[LoadIssueRecord], FileAccount]:
    """Clean, reconcile reversals/conflicts, and deduplicate titulos.csv."""
    account = FileAccount(source_file=source_file, read_count=len(df))
    issues: list[LoadIssueRecord] = []
    grouped: dict[str, list[tuple[int, pd.Series, HistoricalReceivableRecord]]] = {}

    for idx, row in df.iterrows():
        row_number = int(idx) + 1
        if is_noise_or_footer_row(row.values):
            account.discarded_count += 1
            continue

        corrections: list[str] = []
        raw_title = row.get("id_titulo")
        title_number = None if pd.isna(raw_title) else str(raw_title).strip()
        raw_order = row.get("num_pedido")
        order_number = "" if pd.isna(raw_order) else str(raw_order).strip()

        raw_customer = row.get("id_cliente")
        customer_code = normalize_code(raw_customer, prefix="C", width=4)
        if customer_code is None:
            if pd.isna(raw_customer) or not str(raw_customer).strip():
                reason = "missing_customer_id"
                raw_key = title_number
            else:
                customer_code, err = resolve_unique_match(raw_customer, erp_catalog.customers_by_name)
                if not customer_code:
                    reason = f"customer_{err}"
                    raw_key = str(raw_customer)
                else:
                    corrections.append("customer_resolved_by_name")
                    reason = ""
                    raw_key = None
            if customer_code is None:
                issues.append(
                    LoadIssueRecord(source_file, row_number, raw_key, reason, _safe_payload(row))
                )
                account.pending_count += 1
                continue
        elif customer_code not in erp_catalog.customers_by_id:
            issues.append(
                LoadIssueRecord(
                    source_file, row_number, customer_code, "customer_code_not_in_erp", _safe_payload(row)
                )
            )
            account.pending_count += 1
            continue

        installment = normalize_installment(row.get("parcela"))
        amount_cents = parse_money_cents(row.get("valor"))
        issue_date = parse_date(row.get("data_emissao"))
        due_date = parse_date(row.get("data_vencimento"))
        payment_date = parse_date(row.get("data_pagamento"))
        status, status_correction = normalize_receivable_status(
            row.get("status"), payment_date=payment_date
        )
        if status_correction:
            corrections.append(status_correction)

        if (
            not title_number
            or installment is None
            or amount_cents is None
            or issue_date is None
            or due_date is None
            or status is None
        ):
            reason = (
                "missing_title_number"
                if not title_number
                else "invalid_installment"
                if installment is None
                else "invalid_amount"
                if amount_cents is None
                else "invalid_issue_date"
                if issue_date is None
                else "invalid_due_date"
                if due_date is None
                else "invalid_receivable_status"
            )
            issues.append(
                LoadIssueRecord(source_file, row_number, title_number, reason, _safe_payload(row))
            )
            account.pending_count += 1
            continue

        record = HistoricalReceivableRecord(
            title_number=title_number,
            customer_erp_id=customer_code,
            order_number=order_number,
            installment=installment,
            amount_cents=amount_cents,
            issue_date=issue_date,
            due_date=due_date,
            payment_date=payment_date,
            status=status,
            corrections=corrections,
        )
        grouped.setdefault(title_number, []).append((row_number, row, record))

    loaded_receivables: list[HistoricalReceivableRecord] = []
    for title_number, entries in grouped.items():
        if len(entries) == 1:
            loaded_receivables.append(entries[0][2])
            continue

        fingerprints = {entry[2].business_fingerprint() for entry in entries}
        if len(fingerprints) == 1:
            loaded_receivables.append(entries[0][2])
            account.discarded_count += len(entries) - 1
            continue

        # Check for reversal pair: original positive entry + negative REVERSED entry of equal magnitude
        reversed_entries = [e[2] for e in entries if e[2].status == "REVERSED"]
        normal_entries = [e[2] for e in entries if e[2].status != "REVERSED"]
        if (
            len(reversed_entries) >= 1
            and len(normal_entries) >= 1
            and len({abs(e[2].amount_cents) for e in entries}) == 1
        ):
            base = normal_entries[0]
            reconciled = HistoricalReceivableRecord(
                title_number=base.title_number,
                customer_erp_id=base.customer_erp_id,
                order_number=base.order_number,
                installment=base.installment,
                amount_cents=abs(base.amount_cents),
                issue_date=base.issue_date,
                due_date=base.due_date,
                payment_date=None,
                status="REVERSED",
                corrections=[*base.corrections, "reconciled_with_reversal_entry"],
            )
            loaded_receivables.append(reconciled)
            account.discarded_count += len(entries) - 1
            continue

        # Conflicting duplicate title (e.g., different amounts for same id_titulo) -> pendência
        for row_number, raw_row, _ in entries:
            issues.append(
                LoadIssueRecord(
                    source_file=source_file,
                    row_number=row_number,
                    raw_key=title_number,
                    reason="conflicting_duplicate_title",
                    raw_payload=_safe_payload(raw_row),
                )
            )
        account.pending_count += len(entries)

    account.loaded_count = len(loaded_receivables)
    return loaded_receivables, issues, account


def run_pipeline(
    df_customers: pd.DataFrame,
    df_orders: pd.DataFrame,
    df_receivables: pd.DataFrame,
    erp_catalog: ErpCatalog,
    store: HistoryStore,
) -> PipelineSummary:
    reconciled_customers, cust_issues, cust_account = audit_customers_sheet(
        df_customers, erp_catalog
    )
    order_items, order_issues, order_account = process_orders_sheet(df_orders, erp_catalog)
    receivables, rec_issues, rec_account = process_receivables_csv(
        df_receivables, erp_catalog
    )

    all_issues = [*cust_issues, *order_issues, *rec_issues]

    for item in order_items:
        store.upsert_order_item(item)
    for rec in receivables:
        store.upsert_receivable(rec)
    for issue in all_issues:
        store.upsert_issue(issue)

    return PipelineSummary(
        accounts=[cust_account, order_account, rec_account],
        reconciled_customers=reconciled_customers,
        order_items=order_items,
        receivables=receivables,
        issues=all_issues,
        net_sales_cents=calculate_net_sales_cents(order_items),
    )


def load_raw_dataframes(raw_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    df_customers = pd.read_excel(raw_dir / CLIENTES_FILE, header=2, dtype=object)
    df_orders = pd.read_excel(raw_dir / PEDIDOS_FILE, header=3, dtype=object)
    df_receivables = pd.read_csv(
        raw_dir / TITULOS_FILE, sep=";", encoding="utf-8-sig", dtype=object
    )
    return df_customers, df_orders, df_receivables


def load_erp_catalog_from_postgres(conn: Any) -> ErpCatalog:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT erp_id, name, cnpj, credit_limit_cents, status::text, erp_seller_name
            FROM customers
            """
        )
        customers = [
            {
                "erp_id": row[0],
                "name": row[1],
                "cnpj": row[2],
                "credit_limit_cents": row[3],
                "status": row[4],
                "seller_name": row[5],
            }
            for row in cur.fetchall()
        ]
        cur.execute("SELECT erp_id, description FROM products")
        products = [{"erp_id": row[0], "description": row[1]} for row in cur.fetchall()]
    return ErpCatalog.from_records(customers=customers, products=products)


def print_report(summary: PipelineSummary) -> None:
    print("\n=== CONTA POR ARQUIVO (lidas = carregadas + descartadas + pendentes) ===")
    for acc in summary.accounts:
        status = "OK" if acc.is_balanced else "DESBALANCEADO"
        print(
            f"- {acc.source_file}: "
            f"lidas={acc.read_count} | "
            f"carregadas={acc.loaded_count} | "
            f"descartadas={acc.discarded_count} | "
            f"pendentes={acc.pending_count} [{status}]"
        )

    cancelled_count = sum(1 for i in summary.order_items if i.status == "CANCELLED")
    invoiced_count = sum(1 for i in summary.order_items if i.status == "INVOICED")
    print(
        f"\nPedidos carregados: {len(summary.order_items)} "
        f"(INVOICED={invoiced_count}, CANCELLED={cancelled_count})"
    )
    print(f"Faturamento líquido (excluindo CANCELLED): R$ {summary.net_sales_cents / 100:,.2f}")

    print(f"\nTotal de pendências (LoadIssue): {len(summary.issues)}")
    for issue in summary.issues[:5]:
        print(
            f"  - [{issue.source_file} linha {issue.row_number}] "
            f"chave={issue.raw_key!r} | motivo={issue.reason}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Carga e limpeza do histórico das planilhas da DistriLux."
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "raw",
        help="Pasta contendo as 3 planilhas originais.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Executa limpeza e auditoria em memória sem gravar no PostgreSQL.",
    )
    parser.add_argument(
        "--database-url",
        type=str,
        default=None,
        help="URL de conexão PostgreSQL (ex: postgresql://user:pass@localhost:5432/db).",
    )
    args = parser.parse_args()

    df_customers, df_orders, df_receivables = load_raw_dataframes(args.raw_dir)

    if args.dry_run or not args.database_url:
        catalog = ErpCatalog.build_preview_from_spreadsheets(df_customers, df_orders)
        store = InMemoryHistoryStore()
        summary = run_pipeline(df_customers, df_orders, df_receivables, catalog, store)
        print_report(summary)
        # Prova de idempotência em memória
        first_counts = store.counts()
        run_pipeline(df_customers, df_orders, df_receivables, catalog, store)
        assert store.counts() == first_counts
        print(f"\nVerificação de idempotência (2x): OK -> {store.counts()}")
        return

    import psycopg

    with psycopg.connect(args.database_url) as conn:
        catalog = load_erp_catalog_from_postgres(conn)
        store = PostgresHistoryStore(conn)
        summary = run_pipeline(df_customers, df_orders, df_receivables, catalog, store)
        conn.commit()
        print_report(summary)
        print(f"\nContagens persistidas no PostgreSQL: {store.counts()}")


if __name__ == "__main__":
    main()
