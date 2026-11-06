import os
import datetime
import urllib.request
import subprocess

cert_path = "/app/certs/afip_certificado.crt"
key_path = "/app/certs/afip_privada.key"

now = datetime.datetime.utcnow()
gen_time = (now - datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S-00:00")
exp_time = (now + datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S-00:00")

tra_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>{int(now.timestamp())}</uniqueId>
    <generationTime>{gen_time}</generationTime>
    <expirationTime>{exp_time}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>"""

with open("/tmp/tra.xml", "w", encoding="utf-8") as f:
    f.write(tra_xml)

cmd = f"openssl cms -sign -in /tmp/tra.xml -out /tmp/tra.cms -signer {cert_path} -inkey {key_path} -nodetach -outform PEM"
res = subprocess.run(cmd, shell=True, capture_output=True, text=True)

if res.returncode != 0:
    print("Error al firmar con OpenSSL:", res.stderr)
    exit(1)

with open("/tmp/tra.cms", "r", encoding="utf-8") as f:
    cms_pem = f.read().replace("-----BEGIN CMS-----", "").replace("-----END CMS-----", "").replace("\n", "").strip()

soap_req = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>{cms_pem}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>"""

req = urllib.request.Request(
    "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    data=soap_req.encode("utf-8"),
    headers={"Content-Type": "text/xml;charset=UTF-8", "SOAPAction": ""}
)

try:
    with urllib.request.urlopen(req) as resp:
        body = resp.read().decode("utf-8")
        if "token" in body.lower() and "sign" in body.lower():
            print(">>> CONEXION EXITOSA CON AFIP <<<")
            print("Ticket de Acceso (Token y Sign) obtenido correctamente.")
        else:
            print("Respuesta de AFIP:\n", body)
except urllib.error.HTTPError as e:
    print(f"Error HTTP de AFIP ({e.code}):", e.read().decode("utf-8"))
except Exception as e:
    print("Error general:", e)