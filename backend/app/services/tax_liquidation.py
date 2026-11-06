from datetime import date
from decimal import Decimal
import re
from typing import Any, Dict, List, Optional
import uuid

from sqlalchemy import extract, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company
from app.models.invoice import Invoice


class TaxLiquidationService:
    @staticmethod
    def _get_afip_voucher_code(tipo: str) -> str:
        """Mapea el tipo de comprobante al código reglamentario de 3 dígitos de AFIP/ARCA."""
        t = (tipo or "").upper().strip()
        if "NOTA" in t and "CRED" in t:
            if "A" in t:
                return "003"
            elif "B" in t:
                return "008"
            elif "C" in t:
                return "013"
            return "003"
        elif "NOTA" in t and "DEB" in t:
            if "A" in t:
                return "002"
            elif "B" in t:
                return "007"
            elif "C" in t:
                return "012"
            return "002"
        elif "FACTURA" in t or "FAC" in t or "TICKET" in t:
            if "B" in t:
                return "006"
            elif "C" in t:
                return "011"
            return "001"
        return "001"

    @staticmethod
    def _format_fixed_amount(amount: Any, length: int = 15) -> str:
        """Formatea un monto decimal en longitud fija rellenada con ceros sin punto ni coma (2 decimales implícitos)."""
        try:
            val = float(amount or 0.0)
            cents = int(round(abs(val) * 100))
            return str(cents).zfill(length)[-length:]
        except Exception:
            return "0".zfill(length)

    @classmethod
    async def calcular_posicion_iva(
        cls,
        db: AsyncSession,
        anio: int,
        mes: int,
        empresa_id: Optional[uuid.UUID] = None,
    ) -> Dict[str, Any]:
        """
        Calcula la posición mensual neta de IVA consultando directamente la base de datos PostgreSQL:
        - Débito Fiscal (IVA Ventas)
        - Crédito Fiscal (IVA Compras)
        - Percepciones sufridas (IVA e IIBB)
        - Saldo Técnico y Saldo Final
        """
        # 1. Obtener CUIT de la empresa activa
        empresa_cuit = "30712345678"
        empresa_nombre = "Distribuidora SRL"
        if empresa_id:
            c_res = await db.execute(select(Company).where(Company.id == empresa_id))
            comp = c_res.scalar_one_or_none()
            if comp:
                empresa_cuit = comp.cuit
                empresa_nombre = comp.razon_social
        else:
            c_res = await db.execute(select(Company).limit(1))
            comp = c_res.scalar_one_or_none()
            if comp:
                empresa_cuit = comp.cuit
                empresa_nombre = comp.razon_social

        # 2. Filtrar comprobantes del período fiscal
        # Se toma fecha_imputacion_iva con fallback a fecha_emision
        query = select(Invoice).where(
            extract("year", func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)) == anio,
            extract("month", func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)) == mes,
        ).order_by(func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision).asc())

        res = await db.execute(query)
        invoices: List[Invoice] = res.scalars().all()

        debito_fiscal = 0.0
        credito_fiscal = 0.0
        credito_fiscal_21 = 0.0
        credito_fiscal_105 = 0.0
        credito_fiscal_27 = 0.0

        percepciones_iva = 0.0
        percepciones_iibb = 0.0
        impuestos_internos = 0.0
        otros_conceptos = 0.0
        neto_compras = 0.0
        neto_ventas = 0.0

        comprobantes_detalle = []

        for inv in invoices:
            tipo = (inv.tipo_comprobante or "").upper()
            is_nc = "NOTA" in tipo and "CRED" in tipo
            multiplier = -1.0 if is_nc else 1.0

            iva = float(inv.iva_monto or 0.0) * multiplier
            neto = float(inv.neto_gravado or 0.0) * multiplier
            perc_iva = float(inv.percepcion_iva or 0.0) * multiplier
            perc_iibb = float(inv.percepcion_iibb or 0.0) * multiplier
            imp_int = float(inv.impuestos_internos or 0.0) * multiplier
            otros = float(inv.otros_conceptos or 0.0) * multiplier
            total = float(inv.total or 0.0) * multiplier

            # Si el emisor es la empresa activa, es una VENTA (Débito Fiscal)
            # En caso contrario, se computa como COMPRA (Crédito Fiscal)
            is_venta = (inv.cuit_emisor == empresa_cuit)

            if is_venta:
                debito_fiscal += iva
                neto_ventas += neto
            else:
                credito_fiscal += iva
                neto_compras += neto
                # Estimación de desglose de alícuotas
                # Si el ratio iva/neto está cerca de 10.5% (entre 0.09 y 0.12)
                if neto > 0 and 0.09 <= (iva / neto) <= 0.12:
                    credito_fiscal_105 += iva
                elif neto > 0 and 0.25 <= (iva / neto) <= 0.29:
                    credito_fiscal_27 += iva
                else:
                    credito_fiscal_21 += iva

                # Percepciones sufridas en compras
                percepciones_iva += perc_iva
                percepciones_iibb += perc_iibb
                impuestos_internos += imp_int
                otros_conceptos += otros

            comprobantes_detalle.append({
                "id": str(inv.id),
                "tipo_comprobante": inv.tipo_comprobante,
                "punto_venta": inv.punto_venta,
                "numero_comprobante": inv.numero_comprobante,
                "fecha_emision": inv.fecha_emision.isoformat() if inv.fecha_emision else "",
                "fecha_imputacion_iva": (inv.fecha_imputacion_iva or inv.fecha_emision).isoformat() if (inv.fecha_imputacion_iva or inv.fecha_emision) else "",
                "cuit_emisor": inv.cuit_emisor,
                "razon_social": inv.razon_social,
                "cuit_receptor": inv.cuit_receptor,
                "moneda": inv.moneda,
                "tipo_cambio": float(inv.tipo_cambio or 1.0),
                "neto_gravado": round(float(inv.neto_gravado or 0.0), 2),
                "iva_monto": round(float(inv.iva_monto or 0.0), 2),
                "percepcion_iva": round(float(inv.percepcion_iva or 0.0), 2),
                "percepcion_iibb": round(float(inv.percepcion_iibb or 0.0), 2),
                "impuestos_internos": round(float(inv.impuestos_internos or 0.0), 2),
                "otros_conceptos": round(float(inv.otros_conceptos or 0.0), 2),
                "total": round(float(inv.total or 0.0), 2),
                "es_venta": is_venta,
                "estado_validacion": inv.estado_validacion,
            })

        # Redondeos contables a 2 decimales
        debito_fiscal = round(debito_fiscal, 2)
        credito_fiscal = round(credito_fiscal, 2)
        credito_fiscal_21 = round(credito_fiscal_21, 2)
        credito_fiscal_105 = round(credito_fiscal_105, 2)
        credito_fiscal_27 = round(credito_fiscal_27, 2)
        percepciones_iva = round(percepciones_iva, 2)
        percepciones_iibb = round(percepciones_iibb, 2)
        impuestos_internos = round(impuestos_internos, 2)
        otros_conceptos = round(otros_conceptos, 2)

        # Saldo Técnico = Débito Fiscal - Crédito Fiscal
        saldo_tecnico = round(debito_fiscal - credito_fiscal, 2)

        # Saldo Final = Saldo Técnico - Percepciones IVA
        saldo_final = round(saldo_tecnico - percepciones_iva, 2)

        resultado = "SALDO_A_FAVOR" if saldo_final <= 0.0 else "SALDO_A_PAGAR"

        return {
            "periodo": f"{anio}-{str(mes).zfill(2)}",
            "anio": anio,
            "mes": mes,
            "empresa": {
                "cuit": empresa_cuit,
                "razon_social": empresa_nombre,
            },
            "debito_fiscal": debito_fiscal,
            "credito_fiscal": credito_fiscal,
            "credito_fiscal_desglose": {
                "iva_21": credito_fiscal_21,
                "iva_105": credito_fiscal_105,
                "iva_27": credito_fiscal_27,
            },
            "percepciones_iva": percepciones_iva,
            "percepciones_iibb": percepciones_iibb,
            "impuestos_internos": impuestos_internos,
            "otros_conceptos": otros_conceptos,
            "saldo_tecnico": saldo_tecnico,
            "saldo_final": saldo_final,
            "resultado": resultado,
            "total_comprobantes": len(comprobantes_detalle),
            "comprobantes": comprobantes_detalle,
        }

    @classmethod
    async def exportar_libro_iva_txt(
        cls,
        db: AsyncSession,
        anio: int,
        mes: int,
        tipo: str,  # "COMPRAS" | "VENTAS"
        empresa_id: Optional[uuid.UUID] = None,
    ) -> str:
        """
        Genera el archivo de texto plano reglamentario según RG 4597 de ARCA/AFIP
        con registros de ancho fijo para importación en Libro IVA Digital.
        """
        posicion = await cls.calcular_posicion_iva(db=db, anio=anio, mes=mes, empresa_id=empresa_id)
        comprobantes = posicion.get("comprobantes", [])

        is_tipo_compras = tipo.upper() == "COMPRAS"
        lines = []

        for c in comprobantes:
            es_venta = c["es_venta"]
            # Filtrar según sea compras o ventas
            if is_tipo_compras and es_venta:
                continue
            if not is_tipo_compras and not es_venta:
                continue

            # Fecha (YYYYMMDD) - 8 chars
            fecha_raw = c["fecha_emision"].replace("-", "") if c["fecha_emision"] else "20261101"
            fecha_fija = fecha_raw[:8].ljust(8, "0")

            # Tipo Comprobante - 3 chars
            cod_cbte = cls._get_afip_voucher_code(c["tipo_comprobante"])

            # Punto de Venta - 5 chars
            punto_venta = str(c["punto_venta"]).zfill(5)[-5:]

            # Número Comprobante - 20 chars
            numero_cbte = str(c["numero_comprobante"]).zfill(20)[-20:]

            # CUIT y Denominación
            cuit_sujeto = re.sub(r"\D", "", str(c["cuit_emisor"] if is_tipo_compras else c["cuit_receptor"]))
            if len(cuit_sujeto) != 11:
                cuit_sujeto = cuit_sujeto.zfill(11)[-11:] if cuit_sujeto else "00000000000"

            razon_social = (c["razon_social"] or "PROVEEDOR GENERAL").strip()[:30].ljust(30, " ")

            # Importes en formato de 15 chars (13 enteros + 2 decimales sin punto)
            total_fijo = cls._format_fixed_amount(c["total"])
            no_gravado_fijo = cls._format_fixed_amount(c["otros_conceptos"])
            exento_fijo = cls._format_fixed_amount(0.0)
            perc_iva_fijo = cls._format_fixed_amount(c["percepcion_iva"])
            perc_nac_fijo = cls._format_fixed_amount(0.0)
            perc_iibb_fijo = cls._format_fixed_amount(c["percepcion_iibb"])
            perc_mun_fijo = cls._format_fixed_amount(0.0)
            imp_int_fijo = cls._format_fixed_amount(c["impuestos_internos"])

            moneda = "DOL" if c["moneda"] == "USD" else "PES"
            # Tipo de cambio: 10 chars (4 enteros + 6 decimales sin coma)
            tc = float(c["tipo_cambio"] or 1.0)
            tc_cents = int(round(tc * 1000000))
            tc_fijo = str(tc_cents).zfill(10)[-10:]

            # Cantidad de alícuotas
            cant_alicuotas = "1"
            cod_operacion = "0"
            credito_computable_fijo = cls._format_fixed_amount(c["iva_monto"])

            if is_tipo_compras:
                # ESTRUCTURA LIBRO IVA DIGITAL - COMPRAS (RG 4597)
                line = (
                    f"{fecha_fija}"                     # 1. Fecha (8)
                    f"{cod_cbte}"                       # 2. Tipo Cbte (3)
                    f"{punto_venta}"                   # 3. Punto Vta (5)
                    f"{numero_cbte}"                   # 4. Nro Cbte (20)
                    f"{''.ljust(16, ' ')}"             # 5. Despacho Importación (16)
                    f"80"                              # 6. Cod Doc Vendedor (80: CUIT) (2)
                    f"{cuit_sujeto.zfill(20)}"         # 7. Nro Doc Vendedor (20)
                    f"{razon_social}"                  # 8. Denominación (30)
                    f"{total_fijo}"                    # 9. Total (15)
                    f"{no_gravado_fijo}"               # 10. No Gravado (15)
                    f"{exento_fijo}"                   # 11. Exento (15)
                    f"{perc_iva_fijo}"                 # 12. Perc IVA (15)
                    f"{perc_nac_fijo}"                 # 13. Perc Nacionales (15)
                    f"{perc_iibb_fijo}"                # 14. Perc IIBB (15)
                    f"{perc_mun_fijo}"                 # 15. Perc Municipales (15)
                    f"{imp_int_fijo}"                  # 16. Imp Internos (15)
                    f"{moneda}"                        # 17. Moneda (3)
                    f"{tc_fijo}"                       # 18. Tipo Cambio (10)
                    f"{cant_alicuotas}"                # 19. Cantidad Alícuotas (1)
                    f"{cod_operacion}"                 # 20. Código Operación (1)
                    f"{credito_computable_fijo}"       # 21. Crédito Fiscal Computable (15)
                    f"{cls._format_fixed_amount(0.0)}" # 22. Otros Tributos (15)
                    f"{'0'.zfill(11)}"                 # 23. CUIT Emisor/Corredor (11)
                    f"{''.ljust(30, ' ')}"             # 24. Denom Corredor (30)
                    f"{cls._format_fixed_amount(0.0)}" # 25. IVA Comisión (15)
                )
            else:
                # ESTRUCTURA LIBRO IVA DIGITAL - VENTAS (RG 4597)
                line = (
                    f"{fecha_fija}"                     # 1. Fecha (8)
                    f"{cod_cbte}"                       # 2. Tipo Cbte (3)
                    f"{punto_venta}"                   # 3. Punto Vta (5)
                    f"{numero_cbte}"                   # 4. Nro Cbte Desde (20)
                    f"{numero_cbte}"                   # 5. Nro Cbte Hasta (20)
                    f"80"                              # 6. Cod Doc Comprador (80: CUIT) (2)
                    f"{cuit_sujeto.zfill(20)}"         # 7. Nro Doc Comprador (20)
                    f"{razon_social}"                  # 8. Denominación (30)
                    f"{total_fijo}"                    # 9. Total (15)
                    f"{no_gravado_fijo}"               # 10. No Gravado (15)
                    f"{cls._format_fixed_amount(0.0)}" # 11. Perc No Categorizados (15)
                    f"{exento_fijo}"                   # 12. Exento (15)
                    f"{perc_nac_fijo}"                 # 13. Perc Nacionales (15)
                    f"{perc_iibb_fijo}"                # 14. Perc IIBB (15)
                    f"{perc_mun_fijo}"                 # 15. Perc Municipales (15)
                    f"{imp_int_fijo}"                  # 16. Imp Internos (15)
                    f"{moneda}"                        # 17. Moneda (3)
                    f"{tc_fijo}"                       # 18. Tipo Cambio (10)
                    f"{cant_alicuotas}"                # 19. Cantidad Alícuotas (1)
                    f"{cod_operacion}"                 # 20. Código Operación (1)
                    f"{cls._format_fixed_amount(0.0)}" # 21. Otros Tributos (15)
                    f"{fecha_fija}"                     # 22. Vto Pago (8)
                )

            lines.append(line)

        return "\r\n".join(lines) + ("\r\n" if lines else "")

