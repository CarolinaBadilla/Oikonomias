import html
import os
import re
from typing import Any, Dict, List, Optional
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as sax_escape

import httpx
from app.core.logging import log_security_event, mask_sensitive_string
from app.services.afip_wsaa_service import WSAAService


def escape_xml(val: Any) -> str:
    """Escapa de forma segura valores para ser embebidos en XML SOAP evitando XML Injection (OWASP A03)."""
    if val is None:
        return ""
    return sax_escape(str(val))


def map_tipo_comprobante_to_afip_code(tipo: Any) -> int:
    """
    Convierte la denominación o código de comprobante al código numérico oficial de AFIP / ARCA.
    Ejemplos: 'FACTURA A' -> 1, 'FA-A' -> 1, 'FACTURA B' -> 6, 'FACTURA C' -> 11.
    """
    if isinstance(tipo, int):
        return tipo

    s = str(tipo).strip().upper()
    if s.isdigit():
        return int(s)

    # Limpieza de guiones y caracteres especiales
    clean = re.sub(r"[^A-Z0-9\s]", " ", s)

    if "CREDITO" in clean or "NC" in clean:
        if " A" in clean or clean.endswith("A"):
            return 3
        if " B" in clean or clean.endswith("B"):
            return 8
        if " C" in clean or clean.endswith("C"):
            return 13
        if " M" in clean or clean.endswith("M"):
            return 53
        return 3

    if "DEBITO" in clean or "ND" in clean:
        if " A" in clean or clean.endswith("A"):
            return 2
        if " B" in clean or clean.endswith("B"):
            return 7
        if " C" in clean or clean.endswith("C"):
            return 12
        if " M" in clean or clean.endswith("M"):
            return 52
        return 2

    if "RECIBO" in clean:
        if " A" in clean or clean.endswith("A"):
            return 4
        if " B" in clean or clean.endswith("B"):
            return 9
        if " C" in clean or clean.endswith("C"):
            return 15
        if " M" in clean or clean.endswith("M"):
            return 54
        return 4

    # Facturas estándar
    if " A" in clean or clean.endswith("A") or "FA A" in clean:
        return 1
    if " B" in clean or clean.endswith("B") or "FA B" in clean:
        return 6
    if " C" in clean or clean.endswith("C") or "FA C" in clean:
        return 11
    if " M" in clean or clean.endswith("M") or "FA M" in clean:
        return 51

    # Por defecto Factura A
    return 1


class WSFEService:
    """
    Servicio de Facturación Electrónica de AFIP/ARCA (WSFE v1).
    Permite consultar comprobantes fiscales mediante el método FECompConsultar.
    """

    WSFE_HOMO = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx"
    WSFE_PROD = "https://servicios1.afip.gov.ar/wsfev1/service.asmx"

    def __init__(self, wsaa_service: Optional[WSAAService] = None):
        self.wsaa = wsaa_service or WSAAService()
        self.cuit = os.getenv("AFIP_CUIT", "27463304624")
        self.environment = os.getenv("AFIP_ENVIRONMENT", "homologacion").lower()

    @property
    def endpoint_url(self) -> str:
        return self.WSFE_PROD if self.environment == "produccion" else self.WSFE_HOMO

    async def consultar_comprobante(
        self,
        cuit_emisor: int,
        tipo_cbte: int,
        punto_venta: int,
        numero_cbte: int,
    ) -> Dict[str, Any]:
        """
        Ejecuta la consulta SOAP FECompConsultar ante el WSFE de AFIP.
        
        Parámetros:
        - cuit_emisor: CUIT emisor del comprobante
        - tipo_cbte: Código numérico AFIP (1: Factura A, 6: Factura B, 11: Factura C, etc.)
        - punto_venta: Número de punto de venta (1..99999)
        - numero_cbte: Número de comprobante (1..99999999)
        
        Retorna:
        Diccionario con CAE (CodAutorizacion), FchVto, ImpTotal, Resultado ('A', 'R') y detalles.
        """
        # 1. Obtener Token y Sign vigentes desde WSAA
        token, sign = await self.wsaa.get_credentials(service="wsfe")

        # CUIT a informar en Auth: utilizar el CUIT autenticado de la app o el emisor
        auth_cuit = int(self.cuit) if self.cuit else int(cuit_emisor)

        # 2. Armar envoltorio SOAP para FECompConsultar (con XML escaping)
        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompConsultar xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>{escape_xml(token)}</Token>
        <Sign>{escape_xml(sign)}</Sign>
        <Cuit>{int(auth_cuit)}</Cuit>
      </Auth>
      <FeCompConsReq>
        <CbteTipo>{int(tipo_cbte)}</CbteTipo>
        <PtoVta>{int(punto_venta)}</PtoVta>
        <CbteNro>{int(numero_cbte)}</CbteNro>
      </FeCompConsReq>
    </FECompConsultar>
  </soap:Body>
</soap:Envelope>"""

        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://ar.gov.afip.dif.FEV1/FECompConsultar",
        }

        # 3. Llamada HTTP asíncrona a AFIP
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    self.endpoint_url,
                    content=soap_body.encode("utf-8"),
                    headers=headers,
                )
            except httpx.RequestError as exc:
                raise RuntimeError(
                    f"Fallo de conexión al consultar WSFE de AFIP: {exc}"
                ) from exc

        if response.status_code != 200:
            log_security_event(
                event_type="AFIP_WSFE_HTTP_ERROR",
                detail=f"FECompConsultar falló con status {response.status_code}",
                level="ERROR",
            )
            raise RuntimeError(
                f"Error HTTP devuelto por WSFE AFIP ({response.status_code})."
            )

        resp_text = response.text

        # 4. Parsear la respuesta XML del WSFE
        return self._parse_consultar_response(resp_text)

    def _parse_consultar_response(self, xml_text: str) -> Dict[str, Any]:
        """Extrae de manera resiliente los campos de resultado de FECompConsultarResult."""
        parsed: Dict[str, Any] = {
            "resultado": None,
            "cae": None,
            "fch_vto": None,
            "imp_total": None,
            "cbte_fch": None,
            "emision_tipo": None,
            "errores": [],
            "observaciones": [],
            "raw_xml": xml_text,
        }

        raw_xml = html.unescape(xml_text)

        try:
            root = ET.fromstring(raw_xml)
            # Buscar sin importar namespaces
            for elem in root.iter():
                tag_lower = elem.tag.split("}")[-1].lower() if "}" in elem.tag else elem.tag.lower()

                if tag_lower == "codautorizacion" and elem.text:
                    parsed["cae"] = elem.text.strip()
                elif tag_lower == "fchvto" and elem.text:
                    parsed["fch_vto"] = elem.text.strip()
                elif tag_lower == "resultado" and elem.text:
                    parsed["resultado"] = elem.text.strip()
                elif tag_lower == "imptotal" and elem.text:
                    try:
                        parsed["imp_total"] = float(elem.text.strip())
                    except ValueError:
                        parsed["imp_total"] = elem.text.strip()
                elif tag_lower == "cbtefch" and elem.text:
                    parsed["cbte_fch"] = elem.text.strip()
                elif tag_lower == "emisiontipo" and elem.text:
                    parsed["emision_tipo"] = elem.text.strip()
        except Exception:
            # Fallback a expresiones regulares si el XML estuviera malformado
            cae_match = re.search(r"<CodAutorizacion>(.*?)</CodAutorizacion>", raw_xml, re.IGNORECASE)
            if cae_match:
                parsed["cae"] = cae_match.group(1).strip()

            vto_match = re.search(r"<FchVto>(.*?)</FchVto>", raw_xml, re.IGNORECASE)
            if vto_match:
                parsed["fch_vto"] = vto_match.group(1).strip()

            res_match = re.search(r"<Resultado>(.*?)</Resultado>", raw_xml, re.IGNORECASE)
            if res_match:
                parsed["resultado"] = res_match.group(1).strip()

            imp_match = re.search(r"<ImpTotal>(.*?)</ImpTotal>", raw_xml, re.IGNORECASE)
            if imp_match:
                try:
                    parsed["imp_total"] = float(imp_match.group(1).strip())
                except ValueError:
                    parsed["imp_total"] = imp_match.group(1).strip()

        # 1. Extracción de Errores (<Errors><Err><Code>...</Code><Msg>...</Msg></Err></Errors>)
        for err in re.findall(r"<Err>(.*?)</Err>", raw_xml, re.DOTALL | re.IGNORECASE):
            code = re.search(r"<Code>(\d+)</Code>", err, re.IGNORECASE)
            msg = re.search(r"<Msg>(.*?)</Msg>", err, re.IGNORECASE)
            if code and msg:
                parsed["errores"].append({
                    "code": int(code.group(1)),
                    "msg": msg.group(1).strip(),
                })

        # 2. Extracción de Observaciones (<Observaciones><Obs><Code>...</Code><Msg>...</Msg></Obs></Observaciones>)
        for obs in re.findall(r"<Obs>(.*?)</Obs>", raw_xml, re.DOTALL | re.IGNORECASE):
            code = re.search(r"<Code>(\d+)</Code>", obs, re.IGNORECASE)
            msg = re.search(r"<Msg>(.*?)</Msg>", obs, re.IGNORECASE)
            if code and msg:
                parsed["observaciones"].append({
                    "code": int(code.group(1)),
                    "msg": msg.group(1).strip(),
                })

        # 3. Categorización de resultado si no vino en el XML pero hay errores (ej. Código 602)
        if parsed["errores"] and not parsed["resultado"]:
            error_codes = [e["code"] for e in parsed["errores"] if isinstance(e, dict) and "code" in e]
            if 602 in error_codes:
                parsed["resultado"] = "NO_ENCONTRADO"
            else:
                parsed["resultado"] = "ERROR"

        return parsed

    async def get_ultimo_comprobante(
        self,
        cuit_emisor: int,
        punto_venta: int,
        tipo_cbte: int,
    ) -> int:
        """
        Consulta en AFIP el último número de comprobante autorizado (FECompUltimoAutorizado)
        para el punto de venta y tipo de comprobante especificados.
        Retorna el número (entero) o 0 si nunca se emitió un comprobante en ese punto de venta.
        """
        token, sign = await self.wsaa.get_credentials(service="wsfe")
        auth_cuit = int(self.cuit) if self.cuit else int(cuit_emisor)

        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECompUltimoAutorizado xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>{escape_xml(token)}</Token>
        <Sign>{escape_xml(sign)}</Sign>
        <Cuit>{int(auth_cuit)}</Cuit>
      </Auth>
      <PtoVta>{int(punto_venta)}</PtoVta>
      <CbteTipo>{int(tipo_cbte)}</CbteTipo>
    </FECompUltimoAutorizado>
  </soap:Body>
</soap:Envelope>"""

        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    self.endpoint_url,
                    content=soap_body.encode("utf-8"),
                    headers=headers,
                )
            except httpx.RequestError as exc:
                raise RuntimeError(
                    f"Fallo de conexión al consultar FECompUltimoAutorizado ante AFIP: {exc}"
                ) from exc

        if response.status_code != 200:
            log_security_event(
                event_type="AFIP_WSFE_HTTP_ERROR",
                detail=f"FECompUltimoAutorizado falló con status {response.status_code}",
                level="ERROR",
            )
            raise RuntimeError(
                f"Error HTTP devuelto por AFIP WSFE ({response.status_code})."
            )

        raw_xml = html.unescape(response.text)
        cbte_match = re.search(r"<CbteNro>(\d+)</CbteNro>", raw_xml, re.IGNORECASE)
        if cbte_match:
            try:
                return int(cbte_match.group(1))
            except ValueError:
                return 0
        return 0

    async def solicitar_cae(
        self,
        cuit_emisor: int,
        punto_venta: int,
        tipo_cbte: int,
        concepto: int,
        tipo_doc_receptor: int,
        nro_doc_receptor: int,
        cbte_nro: int,
        cbte_fch: str,
        imp_total: float,
        imp_neto: float,
        imp_iva: float,
        alicuotas_iva: list,
        imp_trib: float = 0.0,
        imp_op_ex: float = 0.0,
        fch_serv_desde: Optional[str] = None,
        fch_serv_hasta: Optional[str] = None,
        fch_vto_pago: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Emite un comprobante fiscal oficial ante AFIP solicitando el Código de Autorización Electrónico (CAE)
        mediante el método FECAESolicitar.
        """
        token, sign = await self.wsaa.get_credentials(service="wsfe")
        auth_cuit = int(self.cuit) if self.cuit else int(cuit_emisor)

        # Formatear fechas a AAAAMMDD
        def format_afip_date(d: Optional[str]) -> Optional[str]:
            if not d:
                return None
            clean = str(d).replace("-", "").replace("/", "").strip()
            return clean[:8] if len(clean) >= 8 else clean

        fch_cbte_clean = format_afip_date(cbte_fch)

        # Bloque condicional de fechas para servicios (Concepto 2 o 3)
        fechas_serv_xml = ""
        if int(concepto) in (2, 3) or (fch_serv_desde and fch_serv_hasta and fch_vto_pago):
            f_desde = format_afip_date(fch_serv_desde) or fch_cbte_clean
            f_hasta = format_afip_date(fch_serv_hasta) or fch_cbte_clean
            f_vto = format_afip_date(fch_vto_pago) or fch_cbte_clean
            fechas_serv_xml = f"""            <FchServDesde>{escape_xml(f_desde)}</FchServDesde>
            <FchServHasta>{escape_xml(f_hasta)}</FchServHasta>
            <FchVtoPago>{escape_xml(f_vto)}</FchVtoPago>"""

        # Bloque de Alícuotas de IVA (<Iva><AlicIva>...</AlicIva></Iva>)
        iva_xml = ""
        alics = list(alicuotas_iva or [])
        if not alics and imp_iva > 0:
            alics = [{"id": 5, "base_imp": imp_neto, "importe": imp_iva}]

        if alics and imp_iva > 0:
            alic_items = []
            for a in alics:
                if isinstance(a, dict):
                    a_id = a.get("id") or a.get("Id") or 5
                    a_base = float(a.get("base_imp") if "base_imp" in a else a.get("BaseImp", imp_neto))
                    a_imp = float(a.get("importe") if "importe" in a else a.get("Importe", imp_iva))
                else:
                    a_id = getattr(a, "id", 5)
                    a_base = float(getattr(a, "base_imp", imp_neto))
                    a_imp = float(getattr(a, "importe", imp_iva))

                alic_items.append(f"""              <AlicIva>
                <Id>{int(a_id)}</Id>
                <BaseImp>{a_base:.2f}</BaseImp>
                <Importe>{a_imp:.2f}</Importe>
              </AlicIva>""")

            iva_xml = f"""          <Iva>
{chr(10).join(alic_items)}
          </Iva>"""

        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <FECAESolicitar xmlns="http://ar.gov.afip.dif.FEV1/">
      <Auth>
        <Token>{escape_xml(token)}</Token>
        <Sign>{escape_xml(sign)}</Sign>
        <Cuit>{int(auth_cuit)}</Cuit>
      </Auth>
      <FeCAEReq>
        <FeCabReq>
          <CantReg>1</CantReg>
          <PtoVta>{int(punto_venta)}</PtoVta>
          <CbteTipo>{int(tipo_cbte)}</CbteTipo>
        </FeCabReq>
        <FeDetReq>
          <FECAEDetRequest>
            <Concepto>{int(concepto)}</Concepto>
            <DocTipo>{int(tipo_doc_receptor)}</DocTipo>
            <DocNro>{int(nro_doc_receptor)}</DocNro>
            <CbteDesde>{int(cbte_nro)}</CbteDesde>
            <CbteHasta>{int(cbte_nro)}</CbteHasta>
            <CbteFch>{escape_xml(fch_cbte_clean)}</CbteFch>
            <ImpTotal>{imp_total:.2f}</ImpTotal>
            <ImpTotConc>0.00</ImpTotConc>
            <ImpNeto>{imp_neto:.2f}</ImpNeto>
            <ImpOpEx>{imp_op_ex:.2f}</ImpOpEx>
            <ImpTrib>{imp_trib:.2f}</ImpTrib>
            <ImpIVA>{imp_iva:.2f}</ImpIVA>
{fechas_serv_xml}
{iva_xml}
          </FECAEDetRequest>
        </FeDetReq>
      </FeCAEReq>
    </FECAESolicitar>
  </soap:Body>
</soap:Envelope>"""

        headers = {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
        }

        async with httpx.AsyncClient(timeout=35.0) as client:
            try:
                response = await client.post(
                    self.endpoint_url,
                    content=soap_body.encode("utf-8"),
                    headers=headers,
                )
            except httpx.RequestError as exc:
                raise RuntimeError(
                    f"Fallo de conexión al enviar FECAESolicitar ante AFIP: {exc}"
                ) from exc

        if response.status_code != 200:
            log_security_event(
                event_type="AFIP_WSFE_HTTP_ERROR",
                detail=f"FECAESolicitar falló con status {response.status_code}",
                level="ERROR",
            )
            raise RuntimeError(
                f"Error HTTP devuelto por AFIP WSFE ({response.status_code})."
            )

        raw_xml = html.unescape(response.text)

        # Parsear respuesta FECAESolicitarResult
        resultado = "R"
        cae = None
        fch_vto = None
        errores = []
        observaciones = []

        res_match = re.search(r"<Resultado>(.*?)</Resultado>", raw_xml, re.IGNORECASE)
        if res_match:
            resultado = res_match.group(1).strip().upper()

        cae_match = re.search(r"<CAE>(.*?)</CAE>", raw_xml, re.IGNORECASE)
        if cae_match:
            cae = cae_match.group(1).strip()

        vto_match = re.search(r"<CAEFchVto>(.*?)</CAEFchVto>", raw_xml, re.IGNORECASE)
        if vto_match:
            fch_vto = vto_match.group(1).strip()

        # Extraer Errores
        for err in re.findall(r"<Err>(.*?)</Err>", raw_xml, re.DOTALL | re.IGNORECASE):
            code = re.search(r"<Code>(\d+)</Code>", err, re.IGNORECASE)
            msg = re.search(r"<Msg>(.*?)</Msg>", err, re.IGNORECASE)
            if code and msg:
                errores.append({
                    "code": int(code.group(1)),
                    "msg": msg.group(1).strip(),
                })

        # Extraer Observaciones
        for obs in re.findall(r"<Obs>(.*?)</Obs>", raw_xml, re.DOTALL | re.IGNORECASE):
            code = re.search(r"<Code>(\d+)</Code>", obs, re.IGNORECASE)
            msg = re.search(r"<Msg>(.*?)</Msg>", obs, re.IGNORECASE)
            if code and msg:
                observaciones.append({
                    "code": int(code.group(1)),
                    "msg": msg.group(1).strip(),
                })

        return {
            "resultado": resultado,
            "cae": cae,
            "fch_vto": fch_vto,
            "cbte_nro": cbte_nro,
            "errores": errores,
            "observaciones": observaciones,
            "raw_xml": raw_xml,
        }

