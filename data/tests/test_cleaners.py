from datetime import date, datetime

import pytest

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


class TestParseMoneyCents:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("R$ 1.234,56", 123456),
            ("R$ 509.000,00", 50900000),
            ("R$ 325,50", 32550),
            ("9.346,12", 934612),
            ("2358,78", 235878),
            ("9346.14", 934614),
            ("10.5", 1050),
            ("187 mil", 18700000),
            ("93 MIL", 9300000),
            ("20.000", 2000000),
            ("377.000", 37700000),
            (1014.52, 101452),
            (235000, 23500000),
            ("-5542,18", -554218),
            ("-11206,17", -1120617),
        ],
    )
    def test_valid_money_formats(self, raw, expected):
        assert parse_money_cents(raw) == expected

    @pytest.mark.parametrize("raw", [None, float("nan"), "", "   ", "sem limite", "R$ abc"])
    def test_invalid_or_null_returns_none(self, raw):
        assert parse_money_cents(raw) is None


class TestParseDate:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (datetime(2025, 1, 2, 0, 0), date(2025, 1, 2)),
            (date(2026, 8, 17), date(2026, 8, 17)),
            ("2025-01-02", date(2025, 1, 2)),
            ("07/01/2025", date(2025, 1, 7)),
            ("08.01.2025", date(2025, 1, 8)),
            ("04-01-2025", date(2025, 1, 4)),
            ("04/01/25", date(2025, 1, 4)),
            ("45661", date(2025, 1, 4)),
            (45661, date(2025, 1, 4)),
        ],
    )
    def test_valid_date_formats(self, raw, expected):
        assert parse_date(raw) == expected

    @pytest.mark.parametrize("raw", [None, float("nan"), "", "31/02/2025", "data invalida"])
    def test_invalid_or_null_returns_none(self, raw):
        assert parse_date(raw) is None


class TestNormalizeCode:
    def test_normalizes_case_and_whitespace(self):
        assert normalize_code(" c0040 ", prefix="C") == "C0040"
        assert normalize_code("C0028", prefix="C") == "C0028"
        assert normalize_code("p00005", prefix="P") == "P00005"

    def test_non_code_text_returns_none_when_prefix_required(self):
        assert normalize_code("Construtora Timbaúba ME", prefix="C") is None
        assert normalize_code(None, prefix="C") is None
        assert normalize_code("TOTAL", prefix="C") is None


class TestNormalizeCnpj:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("83.353.800/0001-13", "83353800000113"),
            ("82124991000189", "82124991000189"),
            (89357622000185, "89357622000185"),
            (1234567000199, "01234567000199"),
        ],
    )
    def test_valid_cnpjs(self, raw, expected):
        assert normalize_cnpj(raw) == expected

    @pytest.mark.parametrize("raw", [None, float("nan"), "", "12345", "123456789012345"])
    def test_invalid_cnpjs(self, raw):
        assert normalize_cnpj(raw) is None


class TestNormalizeCityState:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Recife - PE", ("Recife", "PE")),
            ("Recife/PE", ("Recife", "PE")),
            ("RECIFE/PE", ("Recife", "PE")),
            ("recife", ("Recife", "PE")),
            ("JABOATÃO DOS GUARARAPES/PE", ("Jaboatão dos Guararapes", "PE")),
            ("maceió", ("Maceió", "AL")),
            ("natal", ("Natal", "RN")),
            ("campina grande", ("Campina Grande", "PB")),
            ("petrolina", ("Petrolina", "PE")),
            ("teresina", ("Teresina", "PI")),
        ],
    )
    def test_standardizes_city_and_uf(self, raw, expected):
        assert normalize_city_state(raw) == expected

    def test_null_or_empty(self):
        assert normalize_city_state(None) == (None, None)
        assert normalize_city_state("   ") == (None, None)


class TestNormalizeSeller:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Patricia Lins", "Patrícia Lins"),
            ("Patrícia", "Patrícia Lins"),
            ("Paty", "Patrícia Lins"),
            ("Juliana", "Juliana Freitas"),
            ("Ju Freitas", "Juliana Freitas"),
            ("Carla M.", "Carla Menezes"),
            ("Carlinha", "Carla Menezes"),
            ("Carla", "Carla Menezes"),
            ("Rodrigo", "Rodrigo Albuquerque"),
            ("Rodrigo A.", "Rodrigo Albuquerque"),
            ("Marcos", "Marcos Viana"),
            ("Marcos V.", "Marcos Viana"),
        ],
    )
    def test_maps_nicknames_to_official_names(self, raw, expected):
        assert normalize_seller(raw) == expected

    def test_unknown_seller_returns_none(self):
        assert normalize_seller("Vendedor Desconhecido") is None
        assert normalize_seller(None) is None


class TestNormalizeStatuses:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Ativo", "ACTIVE"),
            ("ativo", "ACTIVE"),
            ("ATIVO", "ACTIVE"),
            ("ok", "ACTIVE"),
            ("Bloqueado", "BLOCKED"),
            ("bloqueado", "BLOCKED"),
            ("Inativo", "INACTIVE"),
            ("Prospect", "PROSPECT"),
        ],
    )
    def test_customer_status(self, raw, expected):
        assert normalize_customer_status(raw) == expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("Faturado", "INVOICED"),
            ("faturado ", "INVOICED"),
            ("FATURADO", "INVOICED"),
            ("Cancelado", "CANCELLED"),
            ("cancelado ", "CANCELLED"),
            ("CANCELADO", "CANCELLED"),
        ],
    )
    def test_order_status(self, raw, expected):
        assert normalize_order_status(raw) == expected

    def test_receivable_status_and_payment_reconciliation(self):
        assert normalize_receivable_status("Pago ") == ("PAID", None)
        assert normalize_receivable_status("EM ABERTO") == ("OPEN", None)
        assert normalize_receivable_status("vencido") == ("OVERDUE", None)
        assert normalize_receivable_status("Estornado") == ("REVERSED", None)

        # Inconsistent raw status when payment_date is already recorded (RN-16 logs correction)
        status, correction = normalize_receivable_status(
            "Em aberto", payment_date=date(2025, 3, 24)
        )
        assert status == "PAID"
        assert correction == "status_reconciled_from_payment_date"

        status_v, correction_v = normalize_receivable_status(
            "Vencido", payment_date=date(2025, 2, 2)
        )
        assert status_v == "PAID"
        assert correction_v == "status_reconciled_from_payment_date"


class TestParseQuantity:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (7, 7),
            (14.0, 14),
            ("90,0", 90),
            ("14,0", 14),
            ("21 un", 21),
            ("6 rl", 6),
            ("3 cx", 3),
            ("12 m", 12),
        ],
    )
    def test_valid_quantities(self, raw, expected):
        assert parse_quantity(raw) == expected

    @pytest.mark.parametrize("raw", [None, float("nan"), 0, -5, "1.5", "abc"])
    def test_invalid_quantities(self, raw):
        assert parse_quantity(raw) is None


class TestNormalizeInstallment:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("1/2", "1/2"),
            ("02/03", "2/3"),
            ("01/01", "1/1"),
            ("1 de 1", "1/1"),
            ("2 de 3", "2/3"),
        ],
    )
    def test_valid_installments(self, raw, expected):
        assert normalize_installment(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "4/3", "0/2", "invalida"])
    def test_invalid_installments(self, raw):
        assert normalize_installment(raw) is None


class TestMatchingAndNoise:
    def test_normalize_text_key_ignores_accents_case_and_suffix_punctuation(self):
        assert normalize_text_key("Indústria Condado S.A.") == normalize_text_key(
            "Industria Condado SA"
        )
        assert normalize_text_key("Instaladora Candeias LTDA ") == normalize_text_key(
            "Instaladora Candeias Ltda"
        )

    def test_resolve_unique_match_handles_single_zero_and_ambiguous(self):
        catalog = {
            normalize_text_key("Construtora Timbaúba ME"): ["C0042"],
            normalize_text_key("Comercial Duplicada Ltda"): ["C0010", "C0011"],
        }
        assert resolve_unique_match("Construtora Timbauba ME", catalog) == ("C0042", None)
        assert resolve_unique_match("Empresa Inexistente", catalog) == (None, "no_match")
        assert resolve_unique_match("Comercial Duplicada Ltda", catalog) == (
            None,
            "ambiguous_match",
        )

    def test_detects_empty_and_footer_rows(self):
        assert is_noise_or_footer_row([None, float("nan"), ""]) is True
        assert is_noise_or_footer_row(["TOTAL", None, None]) is True
        assert is_noise_or_footer_row(["C0098", "Construtora Floresta ME", None]) is False
