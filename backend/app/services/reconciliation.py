import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd
from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import Invoice


def _parse_amount(val: Any) -> Tuple[float, Optional[str]]:
    """
    Parsea un monto bancario que puede venir en formato numérico o string
    (ej: '$ 1.234,56', '-1500.00', '(250.00)', '1,250.50').
    Retorna una tupla: (monto_absoluto: float, tipo_detectado: Optional[str]).
    """
    if pd.isna(val) or val is None:
        return 0.0, None

    if isinstance(val, (int, float)):
        fval = float(val)
        tipo = "DEBITO" if fval < 0 else "CREDITO"
        return abs(fval), tipo

    s = str(val).strip().replace("$", "").replace(" ", "")
    if not s:
        return 0.0, None

    # Detectar negativos con formato contable: (123.45)
    is_negative = False
    if s.startswith("(") and s.endswith(")"):
        is_negative = True
        s = s[1:-1].strip()
    elif s.startswith("-"):
        is_negative = True
        s = s[1:].strip()
    elif s.endswith("-"):
        is_negative = True
        s = s[:-1].strip()

    # Normalizar separadores decimales y de miles
    if "," in s and "." in s:
        if s.find(".") < s.find(","):
            # Formato argentino/europeo: 1.234,56
            s = s.replace(".", "").replace(",", ".")
        else:
            # Formato anglosajón: 1,234.56
            s = s.replace(",", "")
    elif "," in s:
        # Formato con coma decimal: 1234,56
        s = s.replace(",", ".")

    try:
        fval = float(s)
        if is_negative:
            fval = -fval
        tipo = "DEBITO" if fval < 0 else "CREDITO"
        return abs(fval), tipo
    except ValueError:
        return 0.0, None


def _clean_text(text: Any) -> str:
    """Limpia cadenas de texto a minúsculas y caracteres alfanuméricos básicos."""
    if pd.isna(text) or text is None:
        return ""
    s = str(text).lower().strip()
    # Reemplazar múltiples espacios y saltos de línea
    s = re.sub(r"\s+", " ", s)
    return s


def _load_dataframe(file_bytes: bytes, filename: str) -> pd.DataFrame:
    """Carga los bytes en un DataFrame de Pandas según la extensión del archivo."""
    fn = filename.lower()
    buffer = io.BytesIO(file_bytes)

    if fn.endswith(".csv"):
        encodings = ["utf-8", "latin-1", "cp1252"]
        df = None
        for enc in encodings:
            buffer.seek(0)
            try:
                df = pd.read_csv(buffer, sep=None, engine="python", encoding=enc)
                if not df.empty and len(df.columns) > 1:
                    break
            except Exception:
                continue

        if df is None or df.empty or len(df.columns) <= 1:
            for enc in encodings:
                for sep in [";", ",", "\t", "|"]:
                    buffer.seek(0)
                    try:
                        df = pd.read_csv(buffer, sep=sep, encoding=enc)
                        if not df.empty and len(df.columns) > 1:
                            break
                    except Exception:
                        continue
                if df is not None and not df.empty and len(df.columns) > 1:
                    break

        if df is None or df.empty:
            buffer.seek(0)
            df = pd.read_csv(buffer)
    elif fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(buffer)
    else:
        raise ValueError(
            f"Extensión no soportada para el archivo '{filename}'. Se requiere formato .csv, .xlsx o .xls."
        )

    if df.empty:
        raise ValueError("El archivo extracto bancario no contiene filas ni datos procesables.")

    return df


def _normalize_bank_dataframe(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Detecta y normaliza dinámicamente las columnas del extracto bancario:
    fecha, descripcion/concepto, monto y tipo (DEBITO / CREDITO).
    """
    col_map = {str(c).strip().lower(): c for c in df.columns}
    normalized_cols = {re.sub(r"[^a-z0-9]", "", k): orig for k, orig in col_map.items()}

    # 1. Identificar columna de Fecha
    date_col = None
    for pattern in ["fecha", "date", "fecop", "fecvalor", "foperacion", "fec"]:
        for norm_name, orig_col in normalized_cols.items():
            if pattern in norm_name:
                date_col = orig_col
                break
        if date_col:
            break

    # 2. Identificar columna de Descripción / Concepto
    desc_col = None
    for pattern in ["descripcion", "concepto", "detalle", "referencia", "movimiento", "obs", "desc"]:
        for norm_name, orig_col in normalized_cols.items():
            if pattern in norm_name and orig_col != date_col:
                desc_col = orig_col
                break
        if desc_col:
            break

    # 3. Identificar montos (columna única o débito/crédito separados)
    amount_col = None
    debit_col = None
    credit_col = None

    for norm_name, orig_col in normalized_cols.items():
        if norm_name in ["debito", "debe", "egreso", "egresos", "cargo"]:
            debit_col = orig_col
        elif norm_name in ["credito", "haber", "ingreso", "ingresos", "abono"]:
            credit_col = orig_col
        elif any(p in norm_name for p in ["monto", "importe", "amount", "saldo", "valor", "neto"]):
            if amount_col is None and orig_col not in [date_col, desc_col]:
                amount_col = orig_col

    if not desc_col and len(df.columns) >= 2:
        for c in df.columns:
            if c != date_col and df[c].dtype == object:
                desc_col = c
                break

    if not amount_col and not (debit_col and credit_col):
        for c in df.columns:
            if c not in [date_col, desc_col]:
                amount_col = c
                break

    if not desc_col or (not amount_col and not (debit_col or credit_col)):
        raise ValueError(
            f"No fue posible identificar las columnas requeridas (concepto/monto) en el extracto. "
            f"Columnas detectadas: {list(df.columns)}"
        )

    movements: List[Dict[str, Any]] = []

    for idx, row in df.iterrows():
        # Extraer y normalizar fecha evitando inversión entre días y meses
        raw_date = row.get(date_col) if date_col else None
        fecha_str = ""
        if pd.notna(raw_date):
            try:
                parsed_date = pd.to_datetime(
                    raw_date,
                    dayfirst=True,
                    format="mixed",
                    errors="coerce",
                )
                if pd.notna(parsed_date):
                    fecha_str = parsed_date.strftime("%Y-%m-%d")
                else:
                    fecha_str = str(raw_date).strip()
            except Exception:
                fecha_str = str(raw_date).strip()
        else:
            fecha_str = date.today().isoformat()

        # Extraer y normalizar descripción
        raw_desc = row.get(desc_col, "")
        descripcion_limpia = _clean_text(raw_desc)
        if not descripcion_limpia:
            continue

        # Extraer monto y tipo
        monto = 0.0
        tipo = "DEBITO"

        if debit_col and credit_col:
            m_deb, _ = _parse_amount(row.get(debit_col))
            m_cred, _ = _parse_amount(row.get(credit_col))
            if m_deb > 0:
                monto = m_deb
                tipo = "DEBITO"
            elif m_cred > 0:
                monto = m_cred
                tipo = "CREDITO"
            else:
                continue
        elif amount_col:
            monto, detected_tipo = _parse_amount(row.get(amount_col))
            if monto == 0.0:
                continue
            tipo = detected_tipo or "DEBITO"
        else:
            continue

        movements.append(
            {
                "fila_origen": int(idx) + 1,
                "fecha": fecha_str,
                "descripcion": descripcion_limpia,
                "descripcion_original": str(raw_desc).strip(),
                "monto": round(monto, 2),
                "tipo": tipo,
            }
        )

    return movements


async def reconcile_bank_statement(
    file_bytes: bytes,
    filename: str,
    db_session: AsyncSession,
) -> Dict[str, Any]:
    """
    Realiza la conciliación bancaria algorítmica:
    1. Carga y normaliza el extracto bancario (.csv, .xlsx, .xls).
    2. Consulta los comprobantes guardados en PostgreSQL.
    3. Clasifica los movimientos en:
       a) Coincidencia Exacta (100%): Mismo monto (< 0.05) y CUIT emisor o número de comprobante en descripción.
       b) Coincidencia Difusa: Mismo monto (< 0.05) y similitud semántica con razon_social (score >= 70.0%).
       c) Partidas Pendientes: Movimientos sin coincidencia.
    """
    df = _load_dataframe(file_bytes, filename)
    bank_movements = _normalize_bank_dataframe(df)

    if not bank_movements:
        raise ValueError("No se encontraron transacciones monetarias válidas en el archivo proporcionado.")

    # Consultar todos los comprobantes persistidos en PostgreSQL
    result = await db_session.execute(select(Invoice))
    invoices: List[Invoice] = list(result.scalars().all())

    # Diagnóstico explícito
    print(
        f"--> [CONCILIACION] Movimientos en extracto: {len(bank_movements)} | Facturas en DB: {len(invoices)}"
    )

    coincidencias_exactas: List[Dict[str, Any]] = []
    coincidencias_difusas: List[Dict[str, Any]] = []
    partidas_pendientes: List[Dict[str, Any]] = []

    # Evitar emparejar la misma factura con múltiples movimientos bancarios
    matched_invoice_ids: Set[str] = set()

    for mov in bank_movements:
        mov_monto = float(mov["monto"])
        desc = mov["descripcion"]
        desc_digits = re.sub(r"[^0-9]", "", desc)

        exact_match_found = False
        best_fuzzy_match = None
        highest_score = 0.0

        # Evaluar contra facturas disponibles
        for inv in invoices:
            inv_id_str = str(inv.id)
            if inv_id_str in matched_invoice_ids:
                continue

            inv_total = float(inv.total)
            monto_diff = abs(mov_monto - inv_total)

            # Requisito de importe coincidente (margen menor a 5 centavos)
            if monto_diff < 0.05:
                # Sanitización de nulos
                cuit_emisor = str(inv.cuit_emisor or "").strip()
                cuit_emisor_digits = re.sub(r"[^0-9]", "", cuit_emisor)
                num_comp_str = str(inv.numero_comprobante or "").strip()
                razon_social_inv = str(inv.razon_social or "PROVEEDOR GENERAL").strip()
                tipo_comp = str(inv.tipo_comprobante or "").strip()

                # a) Coincidencia Exacta (100%):
                # El CUIT (dígitos limpios) o el número de comprobante (incluso de 1 dígito)
                # está contenido en los dígitos o texto de la descripción
                cuit_in_desc = bool(
                    cuit_emisor_digits and (cuit_emisor_digits in desc_digits or cuit_emisor in desc)
                )

                # Búsqueda numérica directa sin filtrar por longitud mínima
                num_in_desc = False
                if num_comp_str:
                    num_in_desc = bool(
                        num_comp_str in desc_digits
                        or re.search(r"\b0*" + re.escape(num_comp_str) + r"\b", desc)
                    )

                if cuit_in_desc or num_in_desc:
                    criterio = (
                        f"Monto exacto (${inv_total:.2f}) y CUIT emisor ({cuit_emisor}) en descripción bancaria"
                        if cuit_in_desc
                        else f"Monto exacto (${inv_total:.2f}) y Número de comprobante (#{num_comp_str}) en descripción bancaria"
                    )
                    coincidencias_exactas.append(
                        {
                            "transaccion_banco": {
                                "fecha": mov["fecha"],
                                "descripcion": mov["descripcion_original"],
                                "monto": mov["monto"],
                                "tipo": mov["tipo"],
                                "fila": mov["fila_origen"],
                            },
                            "comprobante": {
                                "id": inv_id_str,
                                "razon_social": razon_social_inv,
                                "cuit_emisor": inv.cuit_emisor,
                                "cuit_receptor": inv.cuit_receptor,
                                "tipo_comprobante": inv.tipo_comprobante,
                                "punto_venta": inv.punto_venta,
                                "numero_comprobante": inv.numero_comprobante,
                                "fecha_emision": inv.fecha_emision.isoformat()
                                if hasattr(inv.fecha_emision, "isoformat")
                                else str(inv.fecha_emision),
                                "total": inv_total,
                                "estado_validacion": inv.estado_validacion,
                            },
                            "tipo_coincidencia": "EXACTA",
                            "score": 100.0,
                            "criterio": criterio,
                        }
                    )
                    matched_invoice_ids.add(inv_id_str)
                    exact_match_found = True
                    break

                # b) Coincidencia Difusa (Fuzzy Match):
                # Evalúa con rapidfuzz.fuzz.token_set_ratio la descripción contra razon_social y tipo
                if razon_social_inv:
                    score_rs = float(fuzz.token_set_ratio(desc, razon_social_inv.lower()))
                    score_comb = float(
                        fuzz.token_set_ratio(desc, f"{razon_social_inv.lower()} {tipo_comp.lower()}")
                    )
                    score_final = max(score_rs, score_comb)

                    if score_final >= 70.0 and score_final > highest_score:
                        highest_score = score_final
                        best_fuzzy_match = {
                            "transaccion_banco": {
                                "fecha": mov["fecha"],
                                "descripcion": mov["descripcion_original"],
                                "monto": mov["monto"],
                                "tipo": mov["tipo"],
                                "fila": mov["fila_origen"],
                            },
                            "comprobante": {
                                "id": inv_id_str,
                                "razon_social": razon_social_inv,
                                "cuit_emisor": inv.cuit_emisor,
                                "cuit_receptor": inv.cuit_receptor,
                                "tipo_comprobante": inv.tipo_comprobante,
                                "punto_venta": inv.punto_venta,
                                "numero_comprobante": inv.numero_comprobante,
                                "fecha_emision": inv.fecha_emision.isoformat()
                                if hasattr(inv.fecha_emision, "isoformat")
                                else str(inv.fecha_emision),
                                "total": inv_total,
                                "estado_validacion": inv.estado_validacion,
                            },
                            "tipo_coincidencia": "COINCIDENCIA DIFUSA",
                            "score": round(score_final, 2),
                            "nombre_coincidente": razon_social_inv,
                            "criterio": f"Monto coincidente (${inv_total:.2f}) y similitud ({round(score_final, 1)}%) con razón social '{razon_social_inv}'",
                        }

        if exact_match_found:
            continue

        if best_fuzzy_match is not None and highest_score >= 70.0:
            matched_invoice_ids.add(best_fuzzy_match["comprobante"]["id"])
            coincidencias_difusas.append(best_fuzzy_match)
        else:
            # c) Partidas Pendientes: No coincide en (a) ni en (b)
            partidas_pendientes.append(
                {
                    "fecha": mov["fecha"],
                    "descripcion": mov["descripcion_original"],
                    "monto": mov["monto"],
                    "tipo": mov["tipo"],
                    "fila": mov["fila_origen"],
                    "motivo": "Sin comprobante coincidente por importe exacto con CUIT, número o razón social",
                }
            )

    total_transacciones = len(bank_movements)
    total_exactas = len(coincidencias_exactas)
    total_difusas = len(coincidencias_difusas)
    total_pendientes = len(partidas_pendientes)

    tasa_conciliacion = 0.0
    if total_transacciones > 0:
        tasa_conciliacion = round(((total_exactas + total_difusas) / total_transacciones) * 100, 2)

    return {
        "resumen": {
            "total_transacciones": total_transacciones,
            "total_exactas": total_exactas,
            "total_difusas": total_difusas,
            "total_pendientes": total_pendientes,
            "tasa_conciliacion_porcentaje": tasa_conciliacion,
        },
        "coincidencias_exactas": coincidencias_exactas,
        "coincidencias_difusas": coincidencias_difusas,
        "partidas_pendientes": partidas_pendientes,
    }
