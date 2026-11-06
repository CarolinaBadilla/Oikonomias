from datetime import date
from decimal import Decimal
import pytest
from pydantic import ValidationError

from app.schemas.invoice import InvoiceCreate, InvoiceResponse, InvoiceUpdate


def test_invoice_create_valid_exact_balance(sample_invoice_payload):
    """Verifica que un comprobante con balance exacto se cree con estado VALIDADO."""
    inv = InvoiceCreate(**sample_invoice_payload)

    assert inv.razon_social == "PROVEEDOR INDUSTRIAL S.A."
    assert inv.cuit_emisor == "30712345678"
    assert inv.cuit_receptor == "27463304624"
    assert inv.punto_venta == 1
    assert inv.numero_comprobante == 1045
    assert inv.neto_gravado == Decimal("100000.00")
    assert inv.iva_monto == Decimal("21000.00")
    assert inv.percepcion_iva == Decimal("1500.00")
    assert inv.percepcion_iibb == Decimal("3000.00")
    assert inv.impuestos_internos == Decimal("500.00")
    assert inv.total == Decimal("126000.00")
    assert inv.estado_validacion == "VALIDADO"
    assert inv.cae == "74230192837465"
    assert inv.fecha_vto_cae == date(2026, 5, 25)


def test_invoice_create_rounding_tolerance(sample_invoice_payload):
    """Verifica que una diferencia menor a 0.10 centavos se tolere como VALIDADO."""
    payload = sample_invoice_payload.copy()
    # Diferencia de 0.05 centavos (redondeo bancario habitual)
    payload["total"] = "126000.05"
    inv = InvoiceCreate(**payload)

    assert inv.estado_validacion == "VALIDADO"


def test_invoice_create_discrepancy_flags_revision(sample_invoice_payload):
    """Verifica que una discrepancia impositiva mayor a 0.10 asigne el estado REVISION."""
    payload = sample_invoice_payload.copy()
    payload["total"] = "135000.00"  # $9000 de diferencia injustificada
    inv = InvoiceCreate(**payload)

    assert inv.estado_validacion == "REVISION"


def test_invoice_create_default_fecha_imputacion(sample_invoice_payload):
    """Verifica que fecha_imputacion_iva se iguale a fecha_emision si no se especifica."""
    payload = sample_invoice_payload.copy()
    payload["fecha_imputacion_iva"] = None
    inv = InvoiceCreate(**payload)

    assert inv.fecha_imputacion_iva == inv.fecha_emision


def test_invoice_create_moneda_normalization(sample_invoice_payload):
    """Verifica la normalización de códigos monetarios (U$S / Dólar a USD, vacío a ARS)."""
    p1 = sample_invoice_payload.copy()
    p1["moneda"] = "u$s"
    assert InvoiceCreate(**p1).moneda == "USD"

    p2 = sample_invoice_payload.copy()
    p2["moneda"] = "dolares"
    assert InvoiceCreate(**p2).moneda == "USD"

    p3 = sample_invoice_payload.copy()
    p3["moneda"] = ""
    assert InvoiceCreate(**p3).moneda == "ARS"


def test_invoice_create_razon_social_fallback(sample_invoice_payload):
    """Verifica el fallback automático para razon_social vacía o con espacios."""
    payload = sample_invoice_payload.copy()
    payload["razon_social"] = "   "
    inv = InvoiceCreate(**payload)

    assert inv.razon_social == "PROVEEDOR GENERAL"


def test_invoice_update_optional_date_types():
    """Verifica que InvoiceUpdate acepte fechas como date o None."""
    up = InvoiceUpdate(fecha_emision=date(2026, 6, 1), neto_gravado=Decimal("5000.00"))
    assert up.fecha_emision == date(2026, 6, 1)
    assert up.neto_gravado == Decimal("5000.00")
    assert up.fecha_imputacion_iva is None

