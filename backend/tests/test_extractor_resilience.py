import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from app.services.extractor import (
    DEFAULT_PROVIDER_CONFIG,
    PRIMARY_MODEL,
    FALLBACK_MODELS,
    decode_afip_qr_url,
    extraer_cae_por_regex,
    extraer_fecha_vto_cae_por_regex,
    validar_cuit_modulo11,
    _call_openrouter_with_model,
    extract_invoice_with_vlm,
)


def test_validar_cuit_modulo11():
    """Verifica el cálculo y validación del algoritmo Módulo 11 argentino."""
    # CUITs con dígito verificador matemáticamente válido
    assert validar_cuit_modulo11("27463304624") is True
    assert validar_cuit_modulo11("20301234568") is False  # dígito 8 incorrecto
    assert validar_cuit_modulo11("27-46330462-4") is True

    # Casos borde
    assert validar_cuit_modulo11("00000000000") is False
    assert validar_cuit_modulo11("11111111111") is False
    assert validar_cuit_modulo11("123") is False
    assert validar_cuit_modulo11(None) is False


def test_extraer_cae_por_regex():
    """Verifica el rescate de CAE de 14 dígitos en texto con keywords de AFIP."""
    texto_1 = "Comprobante Autorizado por AFIP con C.A.E.: 74230192837465 Fecha Vto: 2026-05-25"
    assert extraer_cae_por_regex(texto_1) == "74230192837465"

    texto_2 = "CAE Nº 69123456789012 Vencimiento 25/05/2026"
    assert extraer_cae_por_regex(texto_2) == "69123456789012"

    assert extraer_cae_por_regex("Factura sin autorizar") is None


def test_extraer_fecha_vto_cae_por_regex():
    """Verifica la extracción de fecha de vencimiento de CAE."""
    texto = "CAE 74230192837465 Fecha de Vto. CAE: 2026-05-25"
    assert extraer_fecha_vto_cae_por_regex(texto) == "2026-05-25"

    texto_slash = "Vencimiento CAE: 25/05/2026"
    assert extraer_fecha_vto_cae_por_regex(texto_slash) == "2026-05-25"


def test_decode_afip_qr_url():
    """Verifica la decodificación del JSON base64 en URLs oficiales de QR AFIP / ARCA."""
    data_dict = {
        "ver": 1,
        "fecha": "2026-05-15",
        "cuit": 30712345678,
        "ptoVta": 1,
        "tipoCmp": 1,
        "nroCmp": 1045,
        "importe": 126000.00,
        "moneda": "PES",
        "ctz": 1.0,
        "tipoDocRec": 80,
        "nroDocRec": 27463304624,
        "tipoCodAut": "E",
        "codAut": 74230192837465,
    }
    b64_json = base64.b64encode(json.dumps(data_dict).encode("utf-8")).decode("utf-8")
    afip_url = f"https://www.afip.gob.ar/fe/qr/?p={b64_json}"

    decoded = decode_afip_qr_url(afip_url)
    assert decoded is not None
    assert decoded["cuit_emisor"] == "30712345678"
    assert decoded["cuit_receptor"] == "27463304624"
    assert decoded["tipo_comprobante"] == "FACTURA A"
    assert decoded["punto_venta"] == 1
    assert decoded["numero_comprobante"] == 1045
    assert decoded["total"] == 126000.00
    assert decoded["cae"] == "74230192837465"
    assert decoded["fecha_emision"] == "2026-05-15"


@pytest.mark.asyncio
async def test_openrouter_retry_on_429():
    """Verifica que _call_openrouter_with_model maneje respuestas 429 con reintentos antes de éxito."""
    mock_client = AsyncMock()

    resp_429 = MagicMock()
    resp_429.status_code = 429
    resp_429.headers = {"Retry-After": "0"}
    resp_429.text = "Too Many Requests"

    resp_200 = MagicMock()
    resp_200.status_code = 200
    resp_200.raise_for_status = MagicMock()
    resp_200.json.return_value = {
        "choices": [{"message": {"content": '{"total": 500}'}}]
    }

    mock_client.post.side_effect = [resp_429, resp_200]

    with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
        content, model = await _call_openrouter_with_model(
            client=mock_client,
            model=PRIMARY_MODEL,
            headers={"Authorization": "Bearer test"},
            messages=[{"role": "user", "content": "test"}],
            provider_config=DEFAULT_PROVIDER_CONFIG,
            max_retries=3,
        )

        assert content == '{"total": 500}'
        assert model == PRIMARY_MODEL
        assert mock_sleep.call_count == 1


@pytest.mark.asyncio
async def test_extract_invoice_fallback_on_72b_exhaustion():
    """Verifica la conmutación a modelo secundario si el 72B agota sus 3 reintentos por 429."""
    resp_429 = MagicMock()
    resp_429.status_code = 429
    resp_429.headers = {}
    resp_429.text = "Rate limit exceeded"
    resp_429.raise_for_status.side_effect = httpx.HTTPStatusError(
        message="429 Too Many Requests",
        request=MagicMock(),
        response=resp_429,
    )

    resp_200 = MagicMock()
    resp_200.status_code = 200
    resp_200.raise_for_status = MagicMock()
    invoice_json = json.dumps({
        "razon_social": "EMPRESA INDUSTRIAL SA",
        "cuit_emisor": "30712345678",
        "cuit_receptor": "27463304624",
        "tipo_comprobante": "FACTURA A",
        "punto_venta": 1,
        "numero_comprobante": 1045,
        "fecha_emision": "2026-05-15",
        "total": 126000.00,
        "neto_gravado": 100000.00,
        "iva_monto": 21000.00,
        "percepcion_iva": 1500.00,
        "percepcion_iibb": 3000.00,
        "impuestos_internos": 500.00,
    })
    resp_200.json.return_value = {
        "choices": [{"message": {"content": invoice_json}}]
    }

    async def mock_post(url, headers, json):
        if json.get("model") == PRIMARY_MODEL:
            return resp_429
        return resp_200

    with patch("httpx.AsyncClient.post", side_effect=mock_post):
        with patch("asyncio.sleep", new_callable=AsyncMock):
            with patch("app.services.extractor.extract_afip_qr_from_bytes", return_value=None):
                with patch("app.services.extractor.logger") as mock_logger:
                    result = await extract_invoice_with_vlm(b"fake_image_bytes")

                    assert result["total"] == 126000.00
                    assert result["razon_social"] == "EMPRESA INDUSTRIAL SA"
                    mock_logger.warning.assert_any_call("Conmutando a modelo fallback por rate limit en 72B")

