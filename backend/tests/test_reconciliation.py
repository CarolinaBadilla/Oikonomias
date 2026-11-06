import io
import pytest
from app.services.reconciliation import (
    _clean_text,
    _load_dataframe,
    _normalize_bank_dataframe,
    _parse_amount,
)


def test_parse_amount_various_formats():
    """Verifica que el parser de importes maneje formatos monetarios argentinos e internacionales."""
    # 1. Decimal argentino estándar con punto de miles y coma decimal
    monto, tipo = _parse_amount("$ 1.234,56")
    assert monto == 1234.56
    assert tipo == "CREDITO"

    # 2. Formato anglosajón
    monto, tipo = _parse_amount("1,250.50")
    assert monto == 1250.50
    assert tipo == "CREDITO"

    # 3. Formato contable negativo con paréntesis
    monto, tipo = _parse_amount("(450.75)")
    assert monto == 450.75
    assert tipo == "DEBITO"

    # 4. Formato negativo con signo menos
    monto, tipo = _parse_amount("-1500,00")
    assert monto == 1500.00
    assert tipo == "DEBITO"

    # 5. Cero y valores vacíos o nulos
    assert _parse_amount(None) == (0.0, None)
    assert _parse_amount("") == (0.0, None)


def test_clean_text_normalization():
    """Verifica la normalización y limpieza de texto para matching bancario."""
    assert _clean_text("  PAGO PROVEEDOR 30-71234567-8  ") == "pago proveedor 30-71234567-8"
    assert _clean_text(None) == ""


def test_parse_bank_statement_csv():
    """Verifica el parseo estructurado de un archivo CSV de extracto bancario con Pandas."""
    csv_content = """Fecha;Descripcion;Debito;Credito
15/05/2026;TRANSFERENCIA PROVEEDOR INDUSTRIAL 30712345678;126000,00;0,00
16/05/2026;COBRO CLIENTE DISTRIBUIDORA;0,00;54000,00
"""
    df = _load_dataframe(csv_content.encode("utf-8"), "extracto_banco_mayo.csv")
    movements = _normalize_bank_dataframe(df)

    assert len(movements) == 2
    assert movements[0]["monto"] == 126000.00
    assert movements[0]["tipo"] == "DEBITO"
    assert "30712345678" in movements[0]["descripcion"]

    assert movements[1]["monto"] == 54000.00
    assert movements[1]["tipo"] == "CREDITO"
