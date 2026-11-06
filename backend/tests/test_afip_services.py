import html
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.afip_wsaa_service import WSAAService
from app.services.afip_wsfe_service import WSFEService, map_tipo_comprobante_to_afip_code


def test_map_tipo_comprobante_to_afip_code():
    """Verifica el mapeo canónico de tipos de comprobante a códigos AFIP."""
    assert map_tipo_comprobante_to_afip_code("FACTURA A") == 1
    assert map_tipo_comprobante_to_afip_code("FACTURA B") == 6
    assert map_tipo_comprobante_to_afip_code("FACTURA C") == 11
    assert map_tipo_comprobante_to_afip_code("FACTURA M") == 51
    assert map_tipo_comprobante_to_afip_code("NOTA DE DEBITO A") == 2
    assert map_tipo_comprobante_to_afip_code("NOTA DE CREDITO A") == 3
    assert map_tipo_comprobante_to_afip_code("RECIBO A") == 4
    assert map_tipo_comprobante_to_afip_code("1") == 1


@pytest.mark.asyncio
async def test_wsaa_get_credentials_from_redis_cache():
    """Verifica que WSAAService devuelva credenciales desde Redis si están en caché sin invocar a AFIP."""
    service = WSAAService()

    mock_redis = AsyncMock()

    async def fake_get(key):
        if "token" in key:
            return "TOKEN_EN_CACHE_12345"
        if "sign" in key:
            return "SIGN_EN_CACHE_67890"
        return None

    mock_redis.get.side_effect = fake_get

    with patch.object(service, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
        mock_get_redis.return_value = mock_redis
        with patch.object(service, "_sign_tra_openssl") as mock_sign:
            token, sign = await service.get_credentials("wsfe")

            assert token == "TOKEN_EN_CACHE_12345"
            assert sign == "SIGN_EN_CACHE_67890"
            mock_sign.assert_not_called()


@pytest.mark.asyncio
async def test_wsaa_get_credentials_cache_miss_calls_soap():
    """Verifica que ante cache miss en Redis, se ejecute la solicitud SOAP a AFIP y se guarden en caché."""
    service = WSAAService()

    mock_redis = AsyncMock()
    mock_redis.get.return_value = None

    mock_soap_resp = MagicMock()
    mock_soap_resp.status_code = 200
    mock_soap_resp.text = """
    <loginCmsReturn>&lt;loginTicketResponse&gt;&lt;credentials&gt;&lt;token&gt;TOKEN_NUEVO_AFIP&lt;/token&gt;&lt;sign&gt;SIGN_NUEVO_AFIP&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn>
    """

    with patch.object(service, "_get_redis", new_callable=AsyncMock) as mock_get_redis:
        mock_get_redis.return_value = mock_redis
        with patch.object(service, "_sign_tra_openssl", return_value="CMS_SIGNED_MOCK_BASE64"):
            with patch("httpx.AsyncClient.post", return_value=mock_soap_resp):
                token, sign = await service.get_credentials("wsfe")

                assert token == "TOKEN_NUEVO_AFIP"
                assert sign == "SIGN_NUEVO_AFIP"
                assert mock_redis.setex.call_count == 2


@pytest.mark.asyncio
async def test_wsfe_consultar_comprobante_valid_xml():
    """Verifica el parseo de la respuesta SOAP de FECompConsultar cuando el comprobante es válido."""
    service = WSFEService()

    mock_wsaa = AsyncMock()
    mock_wsaa.get_credentials.return_value = ("TOKEN_MOCK", "SIGN_MOCK")

    soap_response_xml = """<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompConsultarResult>
            <ResultGet>
              <Resultado>A</Resultado>
              <CodAutorizacion>74230192837465</CodAutorizacion>
              <FchVto>20260525</FchVto>
              <ImpTotal>126000.00</ImpTotal>
              <CbteFch>20260515</CbteFch>
            </ResultGet>
          </FECompConsultarResult>
        </FECompConsultarResponse>
      </soap:Body>
    </soap:Envelope>"""

    mock_http_resp = MagicMock()
    mock_http_resp.status_code = 200
    mock_http_resp.text = soap_response_xml

    with patch.object(service, "wsaa", mock_wsaa):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_http_resp
            res = await service.consultar_comprobante(
                cuit_emisor=27463304624,
                punto_venta=1,
                tipo_cbte=1,
                cbte_nro=1045,
            )

            assert res["resultado"] == "A"
            assert res["cae"] == "74230192837465"
            assert res["fch_vto"] == "20260525"
            assert res["imp_total"] == 126000.00
            assert len(res["errores"]) == 0


@pytest.mark.asyncio
async def test_wsfe_consultar_comprobante_error_602():
    """Verifica la extracción de errores y resultado NO_ENCONTRADO cuando AFIP devuelve código 602."""
    service = WSFEService()

    mock_wsaa = AsyncMock()
    mock_wsaa.get_credentials.return_value = ("TOKEN_MOCK", "SIGN_MOCK")

    soap_error_xml = """<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompConsultarResult>
            <Errors>
              <Err>
                <Code>602</Code>
                <Msg>No existen datos en los registros de AFIP para los parametros de consulta ingresados</Msg>
              </Err>
            </Errors>
          </FECompConsultarResult>
        </FECompConsultarResponse>
      </soap:Body>
    </soap:Envelope>"""

    mock_http_resp = MagicMock()
    mock_http_resp.status_code = 200
    mock_http_resp.text = soap_error_xml

    with patch.object(service, "wsaa", mock_wsaa):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_http_resp
            res = await service.consultar_comprobante(
                cuit_emisor=27463304624,
                punto_venta=1,
                tipo_cbte=1,
                cbte_nro=99999,
            )

            assert res["resultado"] == "NO_ENCONTRADO"
            assert len(res["errores"]) == 1
            assert res["errores"][0]["code"] == 602


@pytest.mark.asyncio
async def test_wsfe_get_ultimo_comprobante():
    """Verifica el parseo de FECompUltimoAutorizado para obtener el próximo comprobante."""
    service = WSFEService()

    mock_wsaa = AsyncMock()
    mock_wsaa.get_credentials.return_value = ("TOKEN_MOCK", "SIGN_MOCK")

    soap_ultimo_xml = """<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECompUltimoAutorizadoResult>
            <PtoVta>1</PtoVta>
            <CbteTipo>1</CbteTipo>
            <CbteNro>1044</CbteNro>
          </FECompUltimoAutorizadoResult>
        </FECompUltimoAutorizadoResponse>
      </soap:Body>
    </soap:Envelope>"""

    mock_http_resp = MagicMock()
    mock_http_resp.status_code = 200
    mock_http_resp.text = soap_ultimo_xml

    with patch.object(service, "wsaa", mock_wsaa):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_http_resp
            ultimo_nro = await service.get_ultimo_comprobante(
                cuit_emisor=27463304624,
                punto_venta=1,
                tipo_cbte=1,
            )

            assert ultimo_nro == 1044


@pytest.mark.asyncio
async def test_wsfe_solicitar_cae_aprobado():
    """Verifica la solicitud y aprobación de CAE mediante FECAESolicitar."""
    service = WSFEService()

    mock_wsaa = AsyncMock()
    mock_wsaa.get_credentials.return_value = ("TOKEN_MOCK", "SIGN_MOCK")

    soap_fecae_xml = """<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">
          <FECAESolicitarResult>
            <FeCabResp>
              <Resultado>A</Resultado>
            </FeCabResp>
            <FeDetResp>
              <FECAEDetResponse>
                <Resultado>A</Resultado>
                <CAE>74230192837465</CAE>
                <CAEFchVto>20260525</CAEFchVto>
              </FECAEDetResponse>
            </FeDetResp>
          </FECAESolicitarResult>
        </FECAESolicitarResponse>
      </soap:Body>
    </soap:Envelope>"""

    mock_http_resp = MagicMock()
    mock_http_resp.status_code = 200
    mock_http_resp.text = soap_fecae_xml

    with patch.object(service, "wsaa", mock_wsaa):
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_http_resp
            res = await service.solicitar_cae(
                cuit_emisor=27463304624,
                punto_venta=1,
                tipo_cbte=1,
                concepto=1,
                tipo_doc_receptor=80,
                nro_doc_receptor=30712345678,
                cbte_nro=1045,
                cbte_fch="20260515",
                imp_total=126000.00,
                imp_neto=100000.00,
                imp_iva=21000.00,
            )

            assert res["resultado"] == "A"
            assert res["cae"] == "74230192837465"
            assert res["fch_vto"] == "20260525"
            assert len(res["errores"]) == 0

