import datetime
import html
import os
import re
import subprocess
import tempfile
from typing import Optional, Tuple

import httpx
import redis.asyncio as aioredis
from app.core.logging import log_security_event

ALLOWED_AFIP_SERVICES = {"wsfe", "wscdc", "wsbfe", "wsfex", "wsct"}


class WSAAService:
    """
    Servicio de Autenticación y Autorización de AFIP/ARCA (WSAA).
    Genera el Ticket de Requerimiento de Acceso (TRA), lo firma con OpenSSL (PKCS#7 / CMS)
    y obtiene las credenciales (Token y Sign) con caché persistente en Redis por 11 horas (39.600 seg).
    """

    WSAA_HOMO = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms"
    WSAA_PROD = "https://wsaa.afip.gov.ar/ws/services/LoginCms"

    def __init__(self):
        self.cuit = os.getenv("AFIP_CUIT", "27463304624")
        self.environment = os.getenv("AFIP_ENVIRONMENT", "homologacion").lower()
        self.redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.cert_path = self._resolve_path(
            os.getenv("AFIP_CERT_PATH", "/app/certs/afip_certificado.crt"),
            "afip_certificado.crt",
        )
        self.key_path = self._resolve_path(
            os.getenv("AFIP_KEY_PATH", "/app/certs/afip_privada.key"),
            "afip_privada.key",
        )

        self._redis_client: Optional[aioredis.Redis] = None

    def _resolve_path(self, configured_path: str, filename: str) -> str:
        """Resuelve la ruta del certificado/clave soportando Docker (/app/certs) y host local."""
        if os.path.exists(configured_path):
            return configured_path

        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        candidate_paths = [
            os.path.join(base_dir, "certs", filename),
            os.path.join(base_dir, "..", "certs-afip", filename),
            os.path.join(os.getcwd(), "backend", "certs", filename),
            os.path.join(os.getcwd(), "certs-afip", filename),
        ]
        for p in candidate_paths:
            if os.path.exists(p):
                return os.path.abspath(p)

        return configured_path

    async def _get_redis(self) -> Optional[aioredis.Redis]:
        """Obtiene o inicializa el cliente asíncrono de Redis con fallback tolerante a fallos."""
        if self._redis_client is not None:
            return self._redis_client

        try:
            client = aioredis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2.0,
            )
            await client.ping()
            self._redis_client = client
            return self._redis_client
        except Exception as exc:
            # Si redis no responde en localhost, intentar con 127.0.0.1
            if "redis:6379" in self.redis_url:
                try:
                    fallback_url = "redis://127.0.0.1:6379/0"
                    client = aioredis.from_url(
                        fallback_url,
                        encoding="utf-8",
                        decode_responses=True,
                        socket_connect_timeout=2.0,
                    )
                    await client.ping()
                    self._redis_client = client
                    return self._redis_client
                except Exception:
                    pass
            print(f"Aviso: Conexión con Redis no disponible ({exc}). Continuando sin caché persistente.")
            return None

    def _generate_tra_xml(self, service: str) -> str:
        """Crea el XML del Ticket de Requerimiento de Acceso (TRA) con ventana de tiempo de 10 min."""
        now = datetime.datetime.now(datetime.timezone.utc)
        gen_time = (now - datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S-00:00")
        exp_time = (now + datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S-00:00")
        unique_id = int(now.timestamp())
        safe_service = html.escape(service.strip())

        return f"""<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>{unique_id}</uniqueId>
    <generationTime>{gen_time}</generationTime>
    <expirationTime>{exp_time}</expirationTime>
  </header>
  <service>{safe_service}</service>
</loginTicketRequest>"""

    def _sign_tra_openssl(self, tra_xml: str) -> str:
        """Firma el TRA usando OpenSSL CMS (PKCS#7) y extrae el payload en Base64 sin delimitadores."""
        if not os.path.exists(self.cert_path):
            raise FileNotFoundError(
                f"No se encontró el certificado AFIP en '{self.cert_path}'."
            )
        if not os.path.exists(self.key_path):
            raise FileNotFoundError(
                f"No se encontró la clave privada AFIP en '{self.key_path}'."
            )

        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".xml", encoding="utf-8") as f_tra:
            f_tra.write(tra_xml)
            tra_file = f_tra.name

        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".cms", encoding="utf-8") as f_cms:
            cms_file = f_cms.name

        try:
            # OWASP A03 Hardening: shell=False y lista estricta de argumentos para prevenir Command Injection
            cmd = [
                "openssl",
                "cms",
                "-sign",
                "-in",
                tra_file,
                "-out",
                cms_file,
                "-signer",
                self.cert_path,
                "-inkey",
                self.key_path,
                "-nodetach",
                "-outform",
                "PEM",
            ]
            result = subprocess.run(cmd, shell=False, capture_output=True, text=True)

            if result.returncode != 0:
                log_security_event(
                    event_type="OPENSSL_SIGN_FAILED",
                    detail="Error ejecutando firma criptográfica OpenSSL para WSAA",
                    level="ERROR",
                )
                raise RuntimeError(
                    f"Fallo al firmar el TRA con OpenSSL: {result.stderr.strip()}"
                )

            with open(cms_file, "r", encoding="utf-8") as f:
                raw_cms = f.read()

            cms_clean = (
                raw_cms.replace("-----BEGIN CMS-----", "")
                .replace("-----END CMS-----", "")
                .replace("\r", "")
                .replace("\n", "")
                .strip()
            )
            return cms_clean

        finally:
            if os.path.exists(tra_file):
                try:
                    os.remove(tra_file)
                except Exception:
                    pass
            if os.path.exists(cms_file):
                try:
                    os.remove(cms_file)
                except Exception:
                    pass

    async def get_credentials(self, service: str = "wsfe") -> Tuple[str, str]:
        """
        Obtiene el Token y Sign para el servicio de AFIP solicitado (por defecto 'wsfe').
        1. Consulta en Redis si existen tokens válidos (TTL 11 horas).
        2. Si no existen, realiza el handshake con WSAA y los almacena en Redis.
        """
        # Validación contra lista blanca estricta de servicios AFIP autorizados
        clean_service = service.strip().lower()
        if clean_service not in ALLOWED_AFIP_SERVICES:
            log_security_event(
                event_type="UNAUTHORIZED_AFIP_SERVICE_REQUESTED",
                detail=f"Intento de acceso a servicio no autorizado: {clean_service}",
                level="WARNING",
            )
            raise ValueError(f"Servicio AFIP no autorizado o no reconocido: '{service}'")

        token_key = f"afip:token:{clean_service}"
        sign_key = f"afip:sign:{clean_service}"

        redis = await self._get_redis()
        if redis:
            try:
                cached_token = await redis.get(token_key)
                cached_sign = await redis.get(sign_key)
                if cached_token and cached_sign:
                    return str(cached_token), str(cached_sign)
            except Exception as exc:
                print(f"Error consultando caché en Redis: {exc}")

        # 2. Generar TRA y firmar con OpenSSL
        tra_xml = self._generate_tra_xml(service=clean_service)
        cms_base64 = self._sign_tra_openssl(tra_xml=tra_xml)

        # 3. Construir solicitud SOAP para LoginCms
        soap_req = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>{cms_base64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>"""

        wsaa_url = self.WSAA_PROD if self.environment == "produccion" else self.WSAA_HOMO

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    wsaa_url,
                    content=soap_req.encode("utf-8"),
                    headers={
                        "Content-Type": "text/xml;charset=UTF-8",
                        "SOAPAction": "",
                    },
                )
            except httpx.RequestError as exc:
                raise RuntimeError(f"Error de conexión con el WSAA de AFIP: {exc}") from exc

        if response.status_code != 200:
            log_security_event(
                event_type="AFIP_WSAA_HTTP_ERROR",
                detail=f"WSAA respondió con código de estado {response.status_code}",
                level="ERROR",
            )
            raise RuntimeError(
                f"Error HTTP devuelto por AFIP WSAA ({response.status_code})."
            )

        # 4. Extraer Token y Sign del XML retornado
        clean_xml = html.unescape(response.text)
        token_match = re.search(r"<token>(.*?)</token>", clean_xml, re.DOTALL)
        sign_match = re.search(r"<sign>(.*?)</sign>", clean_xml, re.DOTALL)

        if token_match and sign_match:
            token = token_match.group(1).strip()
            sign = sign_match.group(1).strip()
        else:
            log_security_event(
                event_type="AFIP_WSAA_INVALID_CREDENTIALS_RESPONSE",
                detail="WSAA no devolvió las etiquetas token y sign esperadas.",
                level="ERROR",
            )
            raise RuntimeError("Respuesta de WSAA sin credenciales válidas.")

        # 5. Guardar en Redis con TTL de 39600 segundos (11 horas)
        if redis:
            try:
                await redis.setex(token_key, 39600, token)
                await redis.setex(sign_key, 39600, sign)
            except Exception as exc:
                print(f"Aviso: No se pudo guardar credenciales en Redis: {exc}")

        return token, sign

