from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import math
import re
import unicodedata

EXCEL_EPOCH = date(1899, 12, 30)

OFFICIAL_SELLERS: dict[str, str] = {
    "patricia lins": "Patrícia Lins",
    "patricia": "Patrícia Lins",
    "paty": "Patrícia Lins",
    "juliana freitas": "Juliana Freitas",
    "juliana": "Juliana Freitas",
    "ju freitas": "Juliana Freitas",
    "carla menezes": "Carla Menezes",
    "carla m": "Carla Menezes",
    "carla": "Carla Menezes",
    "carlinha": "Carla Menezes",
    "rodrigo albuquerque": "Rodrigo Albuquerque",
    "rodrigo a": "Rodrigo Albuquerque",
    "rodrigo": "Rodrigo Albuquerque",
    "marcos viana": "Marcos Viana",
    "marcos v": "Marcos Viana",
    "marcos": "Marcos Viana",
}

CANONICAL_CITIES: dict[str, tuple[str, str]] = {
    "aracaju": ("Aracaju", "SE"),
    "campina grande": ("Campina Grande", "PB"),
    "caruaru": ("Caruaru", "PE"),
    "feira de santana": ("Feira de Santana", "BA"),
    "fortaleza": ("Fortaleza", "CE"),
    "jaboatao dos guararapes": ("Jaboatão dos Guararapes", "PE"),
    "joao pessoa": ("João Pessoa", "PB"),
    "juazeiro do norte": ("Juazeiro do Norte", "CE"),
    "maceio": ("Maceió", "AL"),
    "mossoro": ("Mossoró", "RN"),
    "natal": ("Natal", "RN"),
    "olinda": ("Olinda", "PE"),
    "petrolina": ("Petrolina", "PE"),
    "recife": ("Recife", "PE"),
    "salvador": ("Salvador", "BA"),
    "teresina": ("Teresina", "PI"),
}

CUSTOMER_STATUS_MAP: dict[str, str] = {
    "ativo": "ACTIVE",
    "ok": "ACTIVE",
    "bloqueado": "BLOCKED",
    "inativo": "INACTIVE",
    "prospect": "PROSPECT",
}

ORDER_STATUS_MAP: dict[str, str] = {
    "faturado": "INVOICED",
    "cancelado": "CANCELLED",
}

RECEIVABLE_STATUS_MAP: dict[str, str] = {
    "pago": "PAID",
    "em aberto": "OPEN",
    "vencido": "OVERDUE",
    "estornado": "REVERSED",
}

_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y", "%d/%m/%y")


def _is_null(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, str) and not value.strip():
        return True
    # Handles pandas NaT / NA without requiring pandas at import time
    return str(value) in {"NaT", "<NA>", "nan", "NaN"}


def _strip_accents(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def parse_money_cents(value: object) -> int | None:
    """Convert monetary values in BRL (numbers, 'R$', 'mil', BR/US formats) to integer cents."""
    if _is_null(value) or isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        dec = Decimal(str(value))
        return int((dec * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    text = str(value).strip()
    text = re.sub(r"(?i)^r\$\s*", "", text).strip()

    mil_match = re.fullmatch(r"(-?\d+(?:[.,]\d+)?)\s*mil", text, flags=re.IGNORECASE)
    if mil_match:
        num = mil_match.group(1).replace(",", ".")
        try:
            dec = Decimal(num) * Decimal("1000")
            return int((dec * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except InvalidOperation:
            return None

    # Brazilian thousands without decimals: e.g. '20.000' or '1.250.000'
    if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", text):
        cleaned = text.replace(".", "")
    elif "," in text:
        # Brazilian format with comma decimal: '1.234,56' or '2358,78'
        cleaned = text.replace(".", "").replace(",", ".")
    else:
        # US decimal or plain integer string: '9346.14' or '53000'
        cleaned = text

    try:
        dec = Decimal(cleaned)
    except InvalidOperation:
        return None

    return int((dec * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def parse_date(value: object) -> date | None:
    """Parse datetime/date objects, common BR/ISO string formats, and Excel serial numbers."""
    if _is_null(value) or isinstance(value, bool):
        return None

    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    if isinstance(value, (int, float)):
        serial = int(value)
        if 20000 <= serial <= 80000:
            return EXCEL_EPOCH + timedelta(days=serial)
        return None

    text = str(value).strip()

    if re.fullmatch(r"\d{5}", text):
        serial = int(text)
        if 20000 <= serial <= 80000:
            return EXCEL_EPOCH + timedelta(days=serial)
        return None

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    return None


def normalize_code(value: object, prefix: str | None = None) -> str | None:
    """Trim and uppercase ERP codes (e.g. ' c0040 ' -> 'C0040')."""
    if _is_null(value):
        return None
    text = str(value).strip().upper()
    if prefix is not None:
        if not re.fullmatch(rf"{re.escape(prefix.upper())}\d+", text):
            return None
    return text


def normalize_cnpj(value: object) -> str | None:
    """Return 14-digit CNPJ string, restoring leading zeros when Excel stored it as an integer."""
    if _is_null(value) or isinstance(value, bool):
        return None

    if isinstance(value, int):
        digits = str(value)
        if 11 <= len(digits) <= 14:
            return digits.zfill(14)
        return None

    digits = re.sub(r"\D", "", str(value))
    if len(digits) == 14:
        return digits
    return None


def normalize_city_state(value: object) -> tuple[str | None, str | None]:
    """Standardize 'City - UF', 'CITY/UF', or city-only strings to canonical (City, UF)."""
    if _is_null(value):
        return (None, None)

    text = str(value).strip()
    uf: str | None = None

    match = re.match(r"^(.*?)\s*(?:/|-)\s*([A-Za-z]{2})$", text)
    if match:
        city_raw = match.group(1).strip()
        uf = match.group(2).strip().upper()
    else:
        city_raw = text

    city_key = re.sub(r"\s+", " ", _strip_accents(city_raw).lower()).strip()
    if city_key in CANONICAL_CITIES:
        canonical_city, canonical_uf = CANONICAL_CITIES[city_key]
        return (canonical_city, uf or canonical_uf)

    return (city_raw.title(), uf)


def normalize_seller(value: object) -> str | None:
    """Map commercial nicknames and variants to the 5 official DistriLux seller names."""
    if _is_null(value):
        return None
    key = re.sub(r"[.\s]+", " ", _strip_accents(str(value)).lower()).strip()
    return OFFICIAL_SELLERS.get(key)


def normalize_customer_status(value: object) -> str | None:
    if _is_null(value):
        return None
    key = _strip_accents(str(value).strip().lower())
    return CUSTOMER_STATUS_MAP.get(key)


def normalize_order_status(value: object) -> str | None:
    if _is_null(value):
        return None
    key = _strip_accents(str(value).strip().lower())
    return ORDER_STATUS_MAP.get(key)


def normalize_receivable_status(
    value: object, payment_date: date | None = None
) -> tuple[str | None, str | None]:
    """Normalize receivable status and reconcile OPEN/OVERDUE when payment_date is present."""
    if _is_null(value):
        return (None, None)

    key = _strip_accents(str(value).strip().lower())
    status = RECEIVABLE_STATUS_MAP.get(key)
    if status is None:
        return (None, None)

    if status in {"OPEN", "OVERDUE"} and payment_date is not None:
        return ("PAID", "status_reconciled_from_payment_date")

    return (status, None)


def parse_quantity(value: object) -> int | None:
    """Parse positive integer quantities, stripping unit suffixes like '21 un' or '90,0'."""
    if _is_null(value) or isinstance(value, bool):
        return None

    if isinstance(value, int):
        return value if value > 0 else None

    if isinstance(value, float):
        if value > 0 and value.is_integer():
            return int(value)
        return None

    text = str(value).strip().lower()
    text = re.sub(r"\s*(un|rl|cx|m)$", "", text).strip()
    text = text.replace(",", ".")

    try:
        dec = Decimal(text)
    except InvalidOperation:
        return None

    if dec <= 0 or dec != int(dec):
        return None
    return int(dec)


def normalize_installment(value: object) -> str | None:
    """Standardize installment strings ('02/03', '1 de 1', '1/2') to 'N/M'."""
    if _is_null(value):
        return None

    text = str(value).strip().lower()
    match = re.fullmatch(r"(\d+)\s*(?:/|de)\s*(\d+)", text)
    if not match:
        return None

    current, total = int(match.group(1)), int(match.group(2))
    if current < 1 or total < 1 or current > total:
        return None
    return f"{current}/{total}"


def normalize_text_key(value: object) -> str | None:
    """Build accent-free, case-folded comparison key for customer/product matching."""
    if _is_null(value):
        return None
    text = _strip_accents(str(value)).lower()
    text = re.sub(r"\bs\.?\s*a\.?\b", "sa", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def resolve_unique_match(
    query: object, catalog: dict[str, list[str]]
) -> tuple[str | None, str | None]:
    """Match a free-text customer or product name only when there is exactly one ERP match."""
    key = normalize_text_key(query)
    if key is None:
        return (None, "empty_lookup_value")

    matches = catalog.get(key, [])
    if len(matches) == 1:
        return (matches[0], None)
    if len(matches) == 0:
        return (None, "no_match")
    return (None, "ambiguous_match")


def is_noise_or_footer_row(row_values: Iterable[object]) -> bool:
    """Return True for completely empty rows or summary footer rows like 'TOTAL'."""
    values = list(row_values)
    non_null = [v for v in values if not _is_null(v)]
    if not non_null:
        return True
    if len(non_null) == 1 and str(non_null[0]).strip().upper() == "TOTAL":
        return True
    return False
