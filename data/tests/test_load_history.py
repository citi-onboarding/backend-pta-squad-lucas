from datetime import date, datetime

import pandas as pd

from data.pipeline.load_history import (
    ErpCatalog,
    InMemoryHistoryStore,
    audit_customers_sheet,
    calculate_net_sales_cents,
    process_orders_sheet,
    process_receivables_csv,
    run_pipeline,
)


def _sample_catalog() -> ErpCatalog:
    return ErpCatalog.from_records(
        customers=[
            {
                "erp_id": "C0028",
                "name": "Construtora Maracatu Ltda",
                "cnpj": "85320070000180",
                "credit_limit_cents": 80000000,  # R$ 800.000,00 no ERP (diverge da planilha)
                "status": "BLOCKED",
                "seller_name": "Patrícia Lins",
            },
            {
                "erp_id": "C0067",
                "name": "Serviços Elétricos Belo Jardim ME",
                "cnpj": "43568149000184",
                "credit_limit_cents": 5000000,
                "status": "ACTIVE",
                "seller_name": "Marcos Viana",
            },
            {
                "erp_id": "C0010",
                "name": "Comercial Duplicada Ltda",
                "cnpj": "11111111000101",
                "credit_limit_cents": 1000000,
                "status": "ACTIVE",
                "seller_name": "Juliana Freitas",
            },
            {
                "erp_id": "C0011",
                "name": "Comercial Duplicada LTDA",
                "cnpj": "22222222000102",
                "credit_limit_cents": 2000000,
                "status": "ACTIVE",
                "seller_name": "Juliana Freitas",
            },
        ],
        products=[
            {"erp_id": "P00018", "description": "Disjuntor DIN tripolar 63A"},
            {"erp_id": "P00050", "description": "Interruptor paralelo"},
        ],
    )


class TestOrderPipelineAndDeduplication:
    def test_deduplicates_after_cleaning_different_formats(self):
        df = pd.DataFrame(
            [
                {
                    "Nº Pedido": 40541,
                    "Data": datetime(2025, 1, 10),
                    "Cliente": "C0067",
                    "Vendedor": "Marcos",
                    "Produto": "P00018",
                    "Descrição": "Disjuntor DIN tripolar 63A",
                    "Qtd": 9,
                    "Un": "UN",
                    "Preço Unit.": 52.13,
                    "Total": float("nan"),
                    "Status": "Faturado",
                },
                {
                    "Nº Pedido": 40541,
                    "Data": "10.01.2025",
                    "Cliente": "c0067",
                    "Vendedor": "Marcos V.",
                    "Produto": "P00018",
                    "Descrição": "Disjuntor DIN tripolar 63A",
                    "Qtd": "9 un",
                    "Un": "UN",
                    "Preço Unit.": 52.13,
                    "Total": float("nan"),
                    "Status": "FATURADO",
                },
            ]
        )

        items, issues, account = process_orders_sheet(df, _sample_catalog())

        assert len(items) == 1
        assert items[0].total_cents == 9 * 5213
        assert len(issues) == 0
        assert account.read_count == 2
        assert account.loaded_count == 1
        assert account.discarded_count == 1
        assert account.pending_count == 0
        assert account.is_balanced

    def test_resolves_unique_customer_name_and_null_product_and_flags_unresolved(self):
        df = pd.DataFrame(
            [
                # Cliente por nome (match único -> C0067) e Produto nulo (match único -> P00018)
                {
                    "Nº Pedido": 40481,
                    "Data": "02/01/2025",
                    "Cliente": "Serviços Elétricos Belo Jardim ME",
                    "Vendedor": "Marcos V.",
                    "Produto": float("nan"),
                    "Descrição": "disjuntor din tripolar 63a",
                    "Qtd": 2,
                    "Un": "UN",
                    "Preço Unit.": 100.00,
                    "Total": float("nan"),
                    "Status": "Faturado",
                },
                # Cliente ambíguo (C0010 e C0011) -> pendência
                {
                    "Nº Pedido": 40482,
                    "Data": "02/01/2025",
                    "Cliente": "Comercial Duplicada Ltda",
                    "Vendedor": "Juliana",
                    "Produto": "P00050",
                    "Descrição": "Interruptor paralelo",
                    "Qtd": 5,
                    "Un": "UN",
                    "Preço Unit.": 10.00,
                    "Total": float("nan"),
                    "Status": "Faturado",
                },
                # Produto inexistente -> pendência
                {
                    "Nº Pedido": 40483,
                    "Data": "02/01/2025",
                    "Cliente": "C0067",
                    "Vendedor": "Marcos",
                    "Produto": float("nan"),
                    "Descrição": "Produto Fantasma XYZ",
                    "Qtd": 1,
                    "Un": "UN",
                    "Preço Unit.": 50.00,
                    "Total": float("nan"),
                    "Status": "Faturado",
                },
            ]
        )

        items, issues, account = process_orders_sheet(df, _sample_catalog())

        assert len(items) == 1
        assert items[0].customer_erp_id == "C0067"
        assert items[0].product_erp_id == "P00018"
        assert "customer_resolved_by_name" in items[0].corrections
        assert "product_resolved_by_description" in items[0].corrections

        reasons = {issue.reason for issue in issues}
        assert reasons == {"customer_ambiguous_match", "product_no_match"}
        assert account.read_count == 3
        assert account.loaded_count == 1
        assert account.pending_count == 2
        assert account.is_balanced

    def test_cancelled_orders_are_marked_and_excluded_from_net_sales(self):
        df = pd.DataFrame(
            [
                {
                    "Nº Pedido": 50001,
                    "Data": "2025-05-01",
                    "Cliente": "C0067",
                    "Vendedor": "Marcos",
                    "Produto": "P00050",
                    "Descrição": "Interruptor paralelo",
                    "Qtd": 10,
                    "Un": "UN",
                    "Preço Unit.": 10.00,
                    "Total": float("nan"),
                    "Status": "Faturado",
                },
                {
                    "Nº Pedido": 50002,
                    "Data": "2025-05-02",
                    "Cliente": "C0067",
                    "Vendedor": "Marcos",
                    "Produto": "P00018",
                    "Descrição": "Disjuntor DIN tripolar 63A",
                    "Qtd": 5,
                    "Un": "UN",
                    "Preço Unit.": 100.00,
                    "Total": float("nan"),
                    "Status": "cancelado ",
                },
            ]
        )

        items, issues, account = process_orders_sheet(df, _sample_catalog())

        assert len(items) == 2
        assert len(issues) == 0
        assert {item.status for item in items} == {"INVOICED", "CANCELLED"}
        # Apenas o faturado (10 * R$ 10,00 = 10000 centavos) conta nas vendas
        assert calculate_net_sales_cents(items) == 10000
        assert account.is_balanced


class TestReceivablesReconciliation:
    def test_reconciles_reversals_flags_conflicts_and_deduplicates_exact_copies(self):
        df = pd.DataFrame(
            [
                # Par idêntico após limpeza -> 1 carregada + 1 descartada
                {
                    "id_titulo": "900001",
                    "id_cliente": "C0067",
                    "num_pedido": "40481",
                    "parcela": "01/02",
                    "valor": "1.000,00",
                    "data_emissao": "02/01/2025",
                    "data_vencimento": "01/02/2025",
                    "data_pagamento": "01/02/2025",
                    "status": "Pago",
                },
                {
                    "id_titulo": "900001",
                    "id_cliente": "c0067",
                    "num_pedido": "40481",
                    "parcela": "1 de 2",
                    "valor": "1000.00",
                    "data_emissao": "2025-01-02",
                    "data_vencimento": "2025-02-01",
                    "data_pagamento": "2025-02-01",
                    "status": "PAGO",
                },
                # Par de estorno (positivo Pago + negativo Estornado) -> 1 REVERSED + 1 descartada
                {
                    "id_titulo": "893993",
                    "id_cliente": "C0067",
                    "num_pedido": "40504",
                    "parcela": "2/3",
                    "valor": "5.542,18",
                    "data_emissao": "07/01/2025",
                    "data_vencimento": "08/03/2025",
                    "data_pagamento": "08/03/2025",
                    "status": "pago",
                },
                {
                    "id_titulo": "893993",
                    "id_cliente": "C0067",
                    "num_pedido": "40504",
                    "parcela": "2/3",
                    "valor": "-5542,18",
                    "data_emissao": "07/01/2025",
                    "data_vencimento": "08/03/2025",
                    "data_pagamento": float("nan"),
                    "status": "Estornado",
                },
                # Conflito real de valor no mesmo id_titulo -> 2 pendências
                {
                    "id_titulo": "895947",
                    "id_cliente": "C0067",
                    "num_pedido": "41735",
                    "parcela": "1/3",
                    "valor": "3173,35",
                    "data_emissao": "28/06/2025",
                    "data_vencimento": "28/07/2025",
                    "data_pagamento": "28/07/2025",
                    "status": "Pago",
                },
                {
                    "id_titulo": "895947",
                    "id_cliente": "C0067",
                    "num_pedido": "41735",
                    "parcela": "1/3",
                    "valor": "3490,68",
                    "data_emissao": "28/06/2025",
                    "data_vencimento": "28/07/2025",
                    "data_pagamento": "28/07/2025",
                    "status": "Pago",
                },
                # Cliente nulo -> pendência
                {
                    "id_titulo": "894362",
                    "id_cliente": float("nan"),
                    "num_pedido": "40718",
                    "parcela": "1/1",
                    "valor": "7017,28",
                    "data_emissao": "10/02/2025",
                    "data_vencimento": "10/03/2025",
                    "data_pagamento": "10/03/2025",
                    "status": "Pago",
                },
            ]
        )

        receivables, issues, account = process_receivables_csv(df, _sample_catalog())

        by_id = {r.title_number: r for r in receivables}
        assert set(by_id.keys()) == {"900001", "893993"}
        assert by_id["900001"].status == "PAID"
        assert by_id["893993"].status == "REVERSED"
        assert by_id["893993"].amount_cents == 554218
        assert "reconciled_with_reversal_entry" in by_id["893993"].corrections

        issue_reasons = [i.reason for i in issues]
        assert issue_reasons.count("conflicting_duplicate_title") == 2
        assert issue_reasons.count("missing_customer_id") == 1

        assert account.read_count == 7
        assert account.loaded_count == 2
        assert account.discarded_count == 2
        assert account.pending_count == 3
        assert account.is_balanced


class TestCustomerAuditAndRn09:
    def test_erp_wins_on_divergence_and_noise_rows_are_discarded(self):
        df = pd.DataFrame(
            [
                # Diverge do ERP em limite (375 mil vs 800 mil) e status (Ativo vs BLOCKED)
                {
                    "Cód.": "C0028",
                    "Razão Social": "Construtora Maracatu Ltda",
                    "CNPJ": "85.320.070/0001-80",
                    "Cidade/UF": "recife",
                    "Segmento": "Construtora",
                    "Vendedor": "Paty",
                    "Limite": "R$ 375.000,00",
                    "Situação": "Ativo",
                    "Contato": "Cláudia",
                    "Telefone": "(81) 98111-2544",
                    "Últ. atualização": datetime(2026, 3, 2),
                },
                # Linha 100% vazia -> descartada
                {
                    "Cód.": float("nan"),
                    "Razão Social": float("nan"),
                    "CNPJ": float("nan"),
                    "Cidade/UF": float("nan"),
                    "Segmento": float("nan"),
                    "Vendedor": float("nan"),
                    "Limite": float("nan"),
                    "Situação": float("nan"),
                    "Contato": float("nan"),
                    "Telefone": float("nan"),
                    "Últ. atualização": float("nan"),
                },
                # Rodapé TOTAL -> descartada
                {
                    "Cód.": "TOTAL",
                    "Razão Social": float("nan"),
                    "CNPJ": float("nan"),
                    "Cidade/UF": float("nan"),
                    "Segmento": float("nan"),
                    "Vendedor": float("nan"),
                    "Limite": float("nan"),
                    "Situação": float("nan"),
                    "Contato": float("nan"),
                    "Telefone": float("nan"),
                    "Últ. atualização": float("nan"),
                },
                # Prospect sem código nem CNPJ -> pendência
                {
                    "Cód.": float("nan"),
                    "Razão Social": "Elétrica Cabo Branco Ltda",
                    "CNPJ": float("nan"),
                    "Cidade/UF": "João Pessoa/PB",
                    "Segmento": "Revenda",
                    "Vendedor": "Rodrigo",
                    "Limite": float("nan"),
                    "Situação": "Prospect",
                    "Contato": "Edson",
                    "Telefone": float("nan"),
                    "Últ. atualização": datetime(2026, 8, 12),
                },
            ]
        )

        reconciled, issues, account = audit_customers_sheet(df, _sample_catalog())

        assert len(reconciled) == 1
        # RN-09: prevalecem os valores do ERP
        assert reconciled[0]["credit_limit_cents"] == 80000000
        assert reconciled[0]["status"] == "BLOCKED"
        assert "erp_override_credit_limit" in reconciled[0]["divergences"]
        assert "erp_override_status" in reconciled[0]["divergences"]

        assert len(issues) == 1
        assert issues[0].reason == "prospect_not_in_erp"

        assert account.read_count == 4
        assert account.loaded_count == 1
        assert account.discarded_count == 2
        assert account.pending_count == 1
        assert account.is_balanced


class TestPipelineIdempotency:
    def test_running_pipeline_twice_does_not_duplicate_records_or_issues(self):
        catalog = _sample_catalog()
        store = InMemoryHistoryStore()

        df_customers = pd.DataFrame(
            [
                {
                    "Cód.": "C0067",
                    "Razão Social": "Serviços Elétricos Belo Jardim ME",
                    "CNPJ": "43.568.149/0001-84",
                    "Cidade/UF": "Recife/PE",
                    "Segmento": "Instaladora",
                    "Vendedor": "Marcos",
                    "Limite": "50.000",
                    "Situação": "Ativo",
                    "Contato": "Ana",
                    "Telefone": "(81) 99999-0000",
                    "Últ. atualização": datetime(2026, 5, 1),
                }
            ]
        )
        df_orders = pd.DataFrame(
            [
                {
                    "Nº Pedido": 40481,
                    "Data": date(2025, 1, 2),
                    "Cliente": "C0067",
                    "Vendedor": "Marcos",
                    "Produto": "P00050",
                    "Descrição": "Interruptor paralelo",
                    "Qtd": 3,
                    "Un": "UN",
                    "Preço Unit.": 10.50,
                    "Total": float("nan"),
                    "Status": "Faturado",
                }
            ]
        )
        df_receivables = pd.DataFrame(
            [
                {
                    "id_titulo": "893950",
                    "id_cliente": "C0067",
                    "num_pedido": "40481",
                    "parcela": "1/1",
                    "valor": "31,50",
                    "data_emissao": "02/01/2025",
                    "data_vencimento": "01/02/2025",
                    "data_pagamento": "01/02/2025",
                    "status": "Pago",
                },
                {
                    "id_titulo": "894362",
                    "id_cliente": float("nan"),
                    "num_pedido": "40718",
                    "parcela": "1/1",
                    "valor": "500,00",
                    "data_emissao": "02/01/2025",
                    "data_vencimento": "01/02/2025",
                    "data_pagamento": "01/02/2025",
                    "status": "Pago",
                },
            ]
        )

        first_summary = run_pipeline(df_customers, df_orders, df_receivables, catalog, store)
        counts_after_first = store.counts()

        second_summary = run_pipeline(df_customers, df_orders, df_receivables, catalog, store)
        counts_after_second = store.counts()

        assert counts_after_first == {"order_items": 1, "receivables": 1, "issues": 1}
        assert counts_after_second == counts_after_first
        assert all(acc.is_balanced for acc in first_summary.accounts)
        assert all(acc.is_balanced for acc in second_summary.accounts)
