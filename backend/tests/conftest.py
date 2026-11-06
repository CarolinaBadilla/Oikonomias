import os
import pytest
from datetime import date
from decimal import Decimal

# Fijar variables de entorno requeridas para el entorno de test
os.environ["SECRET_KEY"] = "test-secret-key-oikonomias-2026-audit-qa-test-only"
os.environ["ENVIRONMENT"] = "testing"
os.environ["OPENROUTER_API_KEY"] = "test-sk-or-v1-mock-key"
os.environ["AFIP_CUIT"] = "27463304624"
os.environ["AFIP_ENVIRONMENT"] = "homologacion"


@pytest.fixture
def sample_invoice_payload():
    """Genera un diccionario válido de comprobante que cumple estrictamente la ecuación impositiva."""
    return {
        "razon_social": "PROVEEDOR INDUSTRIAL S.A.",
        "cuit_emisor": "30712345678",
        "cuit_receptor": "27463304624",
        "tipo_comprobante": "FACTURA A",
        "punto_venta": 1,
        "numero_comprobante": 1045,
        "fecha_emision": "2026-05-15",
        "fecha_imputacion_iva": "2026-05-15",
        "moneda": "ARS",
        "tipo_cambio": "1.0000",
        "neto_gravado": "100000.00",
        "iva_monto": "21000.00",
        "percepcion_iva": "1500.00",
        "percepcion_iibb": "3000.00",
        "iibb_jurisdiccion": "BUENOS AIRES",
        "impuestos_internos": "500.00",
        "otros_conceptos": "0.00",
        "total": "126000.00",
        "cae": "74230192837465",
        "fecha_vto_cae": "2026-05-25",
    }

