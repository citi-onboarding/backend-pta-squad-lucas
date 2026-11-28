"""PostgreSQL integration tests for S1-07 historical load store and ERP catalog reader."""

from __future__ import annotations

import os
import subprocess
import time
import uuid
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pandas as pd
import psycopg
import pytest

from data.pipeline.load_history import (
    HistoricalOrderItemRecord,
    HistoricalReceivableRecord,
    LoadIssueRecord,
    PostgresHistoryStore,
    load_erp_catalog_from_postgres,
    run_pipeline,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


def _wait_for_postgres(dsn: str, timeout_seconds: float = 30.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with psycopg.connect(dsn) as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                    return
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            time.sleep(0.5)
    raise RuntimeError(f"PostgreSQL container did not become ready: {last_err}")


@pytest.fixture(scope="module")
def migrated_postgres_dsn() -> Iterator[str]:
    """Start an ephemeral PostgreSQL 17 container and apply Prisma migrations."""
    container_name = f"s1-07-pg-test-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            container_name,
            "-e",
            "POSTGRES_USER=postgres",
            "-e",
            "POSTGRES_PASSWORD=postgres",
            "-e",
            "POSTGRES_DB=history_integration",
            "-P",
            "postgres:17-alpine",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    try:
        port_proc = subprocess.run(
            ["docker", "port", container_name, "5432/tcp"],
            check=True,
            capture_output=True,
            text=True,
        )
        host_port = port_proc.stdout.strip().splitlines()[0].rsplit(":", maxsplit=1)[1]
        dsn = f"postgresql://postgres:postgres@127.0.0.1:{host_port}/history_integration"
        _wait_for_postgres(dsn)

        env = {**os.environ, "DATABASE_URL": dsn}
        subprocess.run(
            ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"],
            cwd=str(REPO_ROOT),
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        yield dsn
    finally:
        subprocess.run(
            ["docker", "rm", "-f", container_name],
            check=False,
            capture_output=True,
            text=True,
        )


def test_load_erp_catalog_and_idempotent_postgres_store(
    migrated_postgres_dsn: str,
) -> None:
    """Verify PostgresHistoryStore and ERP catalog SQL match migrated snake_case schema."""
    with psycopg.connect(migrated_postgres_dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO customers (
                    id, erp_id, name, cnpj, city, state, segment, status,
                    credit_limit_cents, erp_seller_name, updated_at
                )
                VALUES (
                    %s, 'C0028', 'Servicos Eletricos Belo Jardim ME', '12345678000195',
                    'Belo Jardim', 'PE', 'Varejo', 'ACTIVE', 5000000, 'Marcos Viana',
                    CURRENT_TIMESTAMP
                )
                """,
                (str(uuid.uuid4()),),
            )
            cur.execute(
                """
                INSERT INTO products (
                    id, erp_id, description, category, unit, list_price_cents,
                    active, updated_at
                )
                VALUES (
                    %s, 'P00010', 'Cabo Flexivel 35mm² Preto', 'Cabos', 'MT',
                    2500, true, CURRENT_TIMESTAMP
                )
                """,
                (str(uuid.uuid4()),),
            )
        conn.commit()

        catalog = load_erp_catalog_from_postgres(conn)
        assert "C0028" in catalog.customers_by_id
        assert "P00010" in catalog.products_by_id

        store = PostgresHistoryStore(conn)
        order_item = HistoricalOrderItemRecord(
            order_number="40480",
            order_date=date(2025, 1, 10),
            customer_erp_id="C0028",
            seller_name="Marcos Viana",
            product_erp_id="P00010",
            description="Cabo Flexivel 35mm² Preto",
            quantity=10,
            unit="MT",
            unit_price_cents=2500,
            total_cents=25000,
            status="INVOICED",
            corrections=["resolved_customer_by_name"],
        )
        receivable = HistoricalReceivableRecord(
            title_number="893951",
            customer_erp_id="C0028",
            order_number="40480",
            installment="1/1",
            amount_cents=25000,
            issue_date=date(2025, 1, 10),
            due_date=date(2025, 2, 10),
            payment_date=None,
            status="REVERSED",
            corrections=["reconciled_with_reversal_entry"],
        )
        issue = LoadIssueRecord(
            source_file="Clientes - Comercial.xlsx",
            row_number=8,
            raw_key="Iluminar Comercio Ltda",
            reason="prospect_not_in_erp",
            raw_payload={"Razão Social": "Iluminar Comercio Ltda"},
        )

        # Upsert twice to verify idempotency against real PostgreSQL unique constraints
        for _ in range(2):
            store.upsert_order_item(order_item)
            store.upsert_receivable(receivable)
            store.upsert_issue(issue)
        conn.commit()

        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), total_cents, status::text FROM historical_order_items GROUP BY total_cents, status")
            oi_row = cur.fetchone()
            assert oi_row == (1, 25000, "INVOICED")

            cur.execute("SELECT COUNT(*), amount_cents, status::text FROM historical_receivables GROUP BY amount_cents, status")
            hr_row = cur.fetchone()
            assert hr_row == (1, 25000, "REVERSED")

            cur.execute("SELECT COUNT(*), problem_type FROM load_issues GROUP BY problem_type")
            li_row = cur.fetchone()
            assert li_row == (1, "prospect_not_in_erp")
