from datetime import date, datetime
from decimal import Decimal
import os
import re
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import log_security_event
from app.database import get_db
from app.models.company import Company
from app.models.invoice import Invoice
from app.models.user import User
from app.routers.auth import get_current_user
from app.schemas.invoice import (
    InvoiceCreate,
    InvoiceEmitirRequest,
    InvoiceResponse,
    InvoiceUpdate,
)
from app.services.afip_wsfe_service import WSFEService, map_tipo_comprobante_to_afip_code
from app.services.extractor import extract_invoice_with_vlm
from app.services.image_processor import preprocess_image

router = APIRouter()


def ensure_date(val: Any) -> Optional[date]:
    """Convierte con seguridad strings, datetime o date a objetos datetime.date de Python para asyncpg."""
    if not val:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, str):
        clean_val = val.strip().split("T")[0]
        try:
            return datetime.strptime(clean_val, "%Y-%m-%d").date()
        except Exception:
            return None
    return None


@router.get(
    "/",
    response_model=List[InvoiceResponse],
    status_code=status.HTTP_200_OK,
    summary="Listar comprobantes del estudio contable ordenados descendentemente",
)
async def list_invoices(
    empresa_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Retorna la lista ordenada descendentemente por fecha/creación de todos los
    comprobantes del estudio contable sin excluir facturas preexistentes.
    - Si se especifica el parámetro opcional `empresa_id` (UUID o CUIT), filtra por esa empresa específica.
    - En la vista global del estudio contable, no restringe por CUIT permitiendo visualizar todos los comprobantes.
    """
    query = select(Invoice).order_by(Invoice.created_at.desc())

    if empresa_id:
        try:
            uid_comp = uuid.UUID(str(empresa_id))
            comp_res = await db.execute(select(Company).where(Company.id == uid_comp))
            comp = comp_res.scalar_one_or_none()
            if comp:
                query = query.where(
                    (Invoice.cuit_emisor == comp.cuit) | (Invoice.cuit_receptor == comp.cuit)
                )
        except ValueError:
            clean_cuit = re.sub(r"\D", "", str(empresa_id))
            if clean_cuit:
                query = query.where(
                    (Invoice.cuit_emisor == clean_cuit) | (Invoice.cuit_receptor == clean_cuit)
                )

    result = await db.execute(query)
    invoices = result.scalars().all()
    return invoices


@router.patch(
    "/{invoice_id}/approve",
    response_model=InvoiceResponse,
    status_code=status.HTTP_200_OK,
    summary="Aprobar comprobante y registrar asiento contable",
)
async def approve_invoice(
    invoice_id: str,
    payload: Optional[Dict[str, Any]] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Actualiza el campo estado_validacion del comprobante a 'ASIENTO REGISTRADO'.
    Verifica que el comprobante pertenezca al tenant del usuario autenticado (anti-IDOR).
    Permite opcionalmente actualizar campos editados en la misma operación.
    """
    try:
        uid = uuid.UUID(str(invoice_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Identificador de comprobante inválido: '{invoice_id}'. Debe ser un UUID válido.",
        )

    result = await db.execute(select(Invoice).where(Invoice.id == uid))
    db_invoice = result.scalar_one_or_none()

    if not db_invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún comprobante con ID '{invoice_id}'.",
        )

    # Verificación de Rol / Tenant (OWASP A01)
    es_profesional_estudio = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    # Solo restringir si el usuario tiene un rol limitado de cliente no-contador
    if not es_profesional_estudio and empresa_cuit and db_invoice.cuit_emisor != empresa_cuit and db_invoice.cuit_receptor != empresa_cuit:
        log_security_event(
            event_type="IDOR_ACCESS_ATTEMPT",
            detail=f"Usuario intentó aprobar comprobante {invoice_id} ajeno a su empresa activa {empresa_cuit}",
            level="WARNING",
            user_email=current_user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún comprobante con ID '{invoice_id}'.",
        )

    # Actualizar estado de validación a ASIENTO REGISTRADO
    db_invoice.estado_validacion = "ASIENTO REGISTRADO"

    if payload:
        date_fields = {"fecha_emision", "fecha_imputacion_iva"}
        integer_fields = {"punto_venta", "numero_comprobante"}
        decimal_fields = {
            "neto_gravado",
            "iva_monto",
            "percepcion_iva",
            "percepcion_iibb",
            "impuestos_internos",
            "otros_conceptos",
            "total",
            "tipo_cambio",
        }
        string_fields = {
            "razon_social",
            "cuit_emisor",
            "cuit_receptor",
            "tipo_comprobante",
            "provincia_facturacion",
            "moneda",
            "iibb_jurisdiccion",
            "cae",
        }

        for field, raw_val in payload.items():
            if raw_val is None or raw_val == "":
                continue
            if field in date_fields:
                parsed_date = ensure_date(raw_val)
                if parsed_date:
                    setattr(db_invoice, field, parsed_date)
            elif field in integer_fields:
                try:
                    # Limpia cualquier caracter no numérico antes de castear
                    clean_int = "".join(filter(str.isdigit, str(raw_val)))
                    if clean_int:
                        setattr(db_invoice, field, int(clean_int))
                except Exception:
                    pass
            elif field in decimal_fields:
                try:
                    cleaned_num = str(raw_val).replace("$", "").replace("u$s", "").replace("U$S", "").strip()
                    if "." in cleaned_num and "," in cleaned_num:
                        cleaned_num = cleaned_num.replace(".", "").replace(",", ".")
                    elif "," in cleaned_num:
                        cleaned_num = cleaned_num.replace(",", ".")
                    setattr(db_invoice, field, Decimal(cleaned_num))
                except Exception:
                    pass
            elif field in string_fields:
                setattr(db_invoice, field, str(raw_val).strip())

    await db.commit()
    await db.refresh(db_invoice)
    return db_invoice


@router.post(
    "/emitir",
    status_code=status.HTTP_201_CREATED,
    summary="Emitir factura electrónica oficial y solicitar CAE ante AFIP / ARCA (WSFE v1)",
)
async def emitir_factura_afip(
    payload: InvoiceEmitirRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    1. Valida el payload de entrada y la autorización del tenant.
    2. Mapea el tipo de comprobante al código numérico oficial de AFIP.
    3. Consulta el último número de comprobante autorizado (FECompUltimoAutorizado).
    4. Define cbte_nro = ultimo_nro + 1.
    5. Envía la solicitud oficial de autorización mediante FECAESolicitar.
    6. Si resultado == 'A':
       - Persiste la factura con CAE, fecha de vencimiento y estado 'VALIDADO AFIP'.
       - Retorna 201 Created con los datos de AFIP y la entidad Invoice persistida.
    7. Si resultado == 'R':
       - Retorna 422 Unprocessable Entity con el listado de errores y observaciones de AFIP.
    """
    # 1. Mapear tipo de comprobante a código numérico de AFIP
    tipo_cbte = map_tipo_comprobante_to_afip_code(payload.tipo_comprobante)

    # 2. Determinar CUIT del emisor y validar contra Tenant
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None
    cuit_raw = payload.cuit_emisor or empresa_cuit or os.getenv("AFIP_CUIT", "27463304624")
    cuit_digits = re.sub(r"\D", "", str(cuit_raw))
    if not cuit_digits or len(cuit_digits) != 11:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El CUIT emisor '{cuit_raw}' no es válido para operar ante AFIP.",
        )

    es_profesional_estudio = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    if not es_profesional_estudio and empresa_cuit and cuit_digits != empresa_cuit:
        log_security_event(
            event_type="UNAUTHORIZED_INVOICE_EMISSION_ATTEMPT",
            detail=f"Usuario {current_user.email} intentó emitir para CUIT {cuit_digits} no coincidente con su empresa {empresa_cuit}",
            level="WARNING",
            user_email=current_user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No posee autorización para emitir comprobantes fiscales en nombre de un CUIT distinto a su empresa activa.",
        )
    cuit_emisor_int = int(cuit_digits)

    # CUIT / DNI del receptor
    doc_receptor_digits = re.sub(r"\D", "", str(payload.nro_doc_receptor))
    if not doc_receptor_digits:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El número de documento del receptor no puede estar vacío.",
        )
    nro_doc_receptor_int = int(doc_receptor_digits)

    wsfe = WSFEService()

    # 3. Obtener el último número de comprobante autorizado
    try:
        ultimo_nro = await wsfe.get_ultimo_comprobante(
            cuit_emisor=cuit_emisor_int,
            punto_venta=payload.punto_venta,
            tipo_cbte=tipo_cbte,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error consultando el último número de comprobante en AFIP: {str(exc)}",
        )

    cbte_nro = ultimo_nro + 1
    cbte_fch = datetime.now().strftime("%Y%m%d")

    # 4. Preparar lista de alícuotas
    alicuotas_data = [
        {"id": a.id, "base_imp": float(a.base_imp), "importe": float(a.importe)}
        for a in payload.alicuotas_iva
    ]
    if not alicuotas_data and float(payload.imp_iva) > 0:
        alicuotas_data = [{"id": 5, "base_imp": float(payload.imp_neto), "importe": float(payload.imp_iva)}]

    # 5. Solicitar CAE ante AFIP (FECAESolicitar)
    try:
        afip_res = await wsfe.solicitar_cae(
            cuit_emisor=cuit_emisor_int,
            punto_venta=payload.punto_venta,
            tipo_cbte=tipo_cbte,
            concepto=payload.concepto,
            tipo_doc_receptor=payload.tipo_doc_receptor,
            nro_doc_receptor=nro_doc_receptor_int,
            cbte_nro=cbte_nro,
            cbte_fch=cbte_fch,
            imp_total=float(payload.imp_total),
            imp_neto=float(payload.imp_neto),
            imp_iva=float(payload.imp_iva),
            alicuotas_iva=alicuotas_data,
            imp_trib=float(payload.imp_trib),
            imp_op_ex=float(payload.imp_op_ex),
            fch_serv_desde=payload.fch_serv_desde,
            fch_serv_hasta=payload.fch_serv_hasta,
            fch_vto_pago=payload.fch_vto_pago,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fallo de comunicación durante la solicitud de CAE ante AFIP: {str(exc)}",
        )

    resultado = afip_res.get("resultado")

    # 6. Evaluar dictamen de AFIP
    if resultado == "A":
        cae = afip_res.get("cae")
        fch_vto_str = afip_res.get("fch_vto")
        fecha_vto_cae = None
        if fch_vto_str and len(fch_vto_str) == 8 and fch_vto_str.isdigit():
            try:
                fecha_vto_cae = datetime.strptime(fch_vto_str, "%Y%m%d").date()
            except Exception:
                pass

        today_date = datetime.now().date()

        # Guardar en base de datos PostgreSQL
        db_invoice = Invoice(
            razon_social=payload.razon_social_receptor or "CLIENTE GENERAL",
            cuit_emisor=str(cuit_emisor_int),
            cuit_receptor=str(nro_doc_receptor_int),
            tipo_comprobante=str(payload.tipo_comprobante).upper(),
            punto_venta=payload.punto_venta,
            numero_comprobante=cbte_nro,
            fecha_emision=today_date,
            fecha_imputacion_iva=today_date,
            moneda=payload.moneda,
            tipo_cambio=payload.tipo_cambio,
            neto_gravado=payload.imp_neto,
            iva_monto=payload.imp_iva,
            percepcion_iva=Decimal("0.00"),
            percepcion_iibb=Decimal("0.00"),
            impuestos_internos=Decimal("0.00"),
            otros_conceptos=payload.imp_trib,
            total=payload.imp_total,
            estado_validacion="VALIDADO AFIP",
            cae=cae,
            fecha_vto_cae=fecha_vto_cae,
        )
        db.add(db_invoice)
        await db.commit()
        await db.refresh(db_invoice)

        return {
            "status": "success",
            "mensaje": f"Comprobante fiscal N° {payload.punto_venta:04d}-{cbte_nro:08d} autorizado con éxito por AFIP / ARCA.",
            "afip_data": afip_res,
            "invoice": InvoiceResponse.model_validate(db_invoice),
        }
    else:
        # Resultado 'R' (Rechazado)
        errores = afip_res.get("errores", [])
        observaciones = afip_res.get("observaciones", [])
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "mensaje": "AFIP rechazó la emisión del comprobante fiscal.",
                "resultado": "R",
                "cbte_nro_intentado": cbte_nro,
                "errores": errores,
                "observaciones": observaciones,
            },
        )


@router.post(
    "/{invoice_id}/verify-afip",
    status_code=status.HTTP_200_OK,
    summary="Verificar y contrastar comprobante fiscal ante el WSFE de AFIP / ARCA",
)
async def verify_invoice_with_afip(
    invoice_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    1. Recupera la factura por UUID y valida el tenant del usuario (anti-IDOR).
    2. Convierte el tipo de comprobante a código numérico de AFIP.
    3. Llama a WSFEService.consultar_comprobante(...) para consultar en FECompConsultar.
    4. Compara el CAE devuelto por AFIP con el CAE registrado en la factura:
       - Si coincide: actualiza estado_validacion a 'VALIDADO AFIP' y persiste.
       - Si no existe o difiere: retorna advertencia de discrepancia sin fallar.
    """
    try:
        uid = uuid.UUID(str(invoice_id))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Identificador de comprobante inválido: '{invoice_id}'. Debe ser un UUID válido.",
        )

    result = await db.execute(select(Invoice).where(Invoice.id == uid))
    db_invoice = result.scalar_one_or_none()

    if not db_invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún comprobante con ID '{invoice_id}'.",
        )

    # Verificación de Rol / Tenant (OWASP A01)
    es_profesional_estudio = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    if not es_profesional_estudio and empresa_cuit and db_invoice.cuit_emisor != empresa_cuit and db_invoice.cuit_receptor != empresa_cuit:
        log_security_event(
            event_type="IDOR_ACCESS_ATTEMPT",
            detail=f"Usuario intentó verificar comprobante {invoice_id} ajeno a su empresa {empresa_cuit}",
            level="WARNING",
            user_email=current_user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No se encontró ningún comprobante con ID '{invoice_id}'.",
        )

    # 1. Preparar parámetros de consulta
    cuit_digits = re.sub(r"\D", "", db_invoice.cuit_emisor or "")
    if not cuit_digits or len(cuit_digits) != 11:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El CUIT emisor del comprobante '{db_invoice.cuit_emisor}' no es válido para consultar en AFIP.",
        )

    tipo_cbte_afip = map_tipo_comprobante_to_afip_code(db_invoice.tipo_comprobante)
    cuit_emisor_int = int(cuit_digits)
    pto_vta = int(db_invoice.punto_venta)
    cbte_nro = int(db_invoice.numero_comprobante)

    # 2. Consultar servicio WSFE de AFIP / ARCA
    wsfe = WSFEService()
    try:
        afip_data = await wsfe.consultar_comprobante(
            cuit_emisor=cuit_emisor_int,
            tipo_cbte=tipo_cbte_afip,
            punto_venta=pto_vta,
            numero_cbte=cbte_nro,
        )
    except Exception as exc:
        return {
            "status": "error",
            "validado": False,
            "estado_validacion": db_invoice.estado_validacion,
            "mensaje": f"No se pudo consultar el servicio de AFIP/ARCA: {str(exc)}",
            "afip_data": None,
            "invoice": InvoiceResponse.model_validate(db_invoice),
        }

    afip_cae = afip_data.get("cae")
    afip_resultado = afip_data.get("resultado")
    afip_fch_vto = afip_data.get("fch_vto")
    afip_imp_total = afip_data.get("imp_total")
    afip_errores = afip_data.get("errores", [])
    afip_observaciones = afip_data.get("observaciones", [])

    # 3. Comparación y contrastación de CAE
    es_valido_afip = bool(afip_cae and (afip_resultado == "A" or afip_resultado is None))

    cae_registrado = (db_invoice.cae or "").strip()
    coincide_cae = True

    if cae_registrado and afip_cae:
        coincide_cae = (cae_registrado == afip_cae)
    elif cae_registrado and not afip_cae:
        coincide_cae = False

    if es_valido_afip and coincide_cae:
        # Asignar estado validado y persistir CAE y vencimiento
        db_invoice.estado_validacion = "VALIDADO AFIP"
        if afip_cae:
            db_invoice.cae = afip_cae
        if afip_fch_vto:
            try:
                if len(afip_fch_vto) == 8 and afip_fch_vto.isdigit():
                    db_invoice.fecha_vto_cae = datetime.strptime(afip_fch_vto, "%Y%m%d").date()
                else:
                    db_invoice.fecha_vto_cae = ensure_date(afip_fch_vto)
            except Exception:
                pass

        await db.commit()
        await db.refresh(db_invoice)

        return {
            "status": "success",
            "validado": True,
            "estado_validacion": db_invoice.estado_validacion,
            "mensaje": "Comprobante verificado y validado exitosamente ante los registros oficiales de AFIP / ARCA.",
            "afip_data": {
                "cae": afip_cae,
                "fch_vto": afip_fch_vto,
                "resultado": afip_resultado,
                "imp_total": afip_imp_total,
                "observaciones": afip_observaciones,
            },
            "invoice": InvoiceResponse.model_validate(db_invoice),
        }
    else:
        # Advertencia de discrepancia sin fallar la operación
        mensaje_adv = "El comprobante no pudo ser validado o presenta discrepancias con AFIP / ARCA."
        if afip_errores:
            detalles_str = "; ".join(
                f"({e['code']}) {e['msg']}" if isinstance(e, dict) and "code" in e and "msg" in e else str(e)
                for e in afip_errores
            )
            mensaje_adv += f" Detalle: {detalles_str}"
        elif not coincide_cae:
            mensaje_adv += f" El CAE registrado en la factura ({cae_registrado}) difiere del informado por AFIP ({afip_cae})."

        return {
            "status": "warning",
            "validado": False,
            "estado_validacion": db_invoice.estado_validacion,
            "mensaje": mensaje_adv,
            "detalles_discrepancia": {
                "cae_registrado": cae_registrado,
                "cae_afip": afip_cae,
                "resultado_afip": afip_resultado,
                "errores_afip": afip_errores,
                "observaciones_afip": afip_observaciones,
            },
            "invoice": InvoiceResponse.model_validate(db_invoice),
        }

@router.post(
    "/",
    response_model=InvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Crear comprobante y validar consistencia matemática",
)
async def create_invoice(
    invoice_in: InvoiceCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Enforce Human-in-the-loop (OWASP LLM06): Comprobantes creados inician en PENDIENTE
    estado_seguro = invoice_in.estado_validacion if invoice_in.estado_validacion in ["PENDIENTE", "REVISION"] else "PENDIENTE"

    db_invoice = Invoice(
        razon_social=invoice_in.razon_social,
        cuit_emisor=invoice_in.cuit_emisor,
        cuit_receptor=invoice_in.cuit_receptor,
        tipo_comprobante=invoice_in.tipo_comprobante,
        punto_venta=invoice_in.punto_venta,
        numero_comprobante=invoice_in.numero_comprobante,
        fecha_emision=invoice_in.fecha_emision,
        fecha_imputacion_iva=invoice_in.fecha_imputacion_iva or invoice_in.fecha_emision,
        provincia_facturacion=invoice_in.provincia_facturacion,
        moneda=invoice_in.moneda,
        tipo_cambio=invoice_in.tipo_cambio,
        neto_gravado=invoice_in.neto_gravado,
        iva_monto=invoice_in.iva_monto,
        percepcion_iva=invoice_in.percepcion_iva,
        percepcion_iibb=invoice_in.percepcion_iibb,
        iibb_jurisdiccion=invoice_in.iibb_jurisdiccion,
        impuestos_internos=invoice_in.impuestos_internos,
        otros_conceptos=invoice_in.otros_conceptos,
        total=invoice_in.total,
        estado_validacion=estado_seguro,
        cae=invoice_in.cae,
        fecha_vto_cae=invoice_in.fecha_vto_cae,
    )
    db.add(db_invoice)
    await db.commit()
    await db.refresh(db_invoice)
    return db_invoice


@router.post(
    "/upload",
    response_model=InvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Subir imagen/PDF de comprobante, procesar con VLM y persistir",
)
async def upload_invoice(
    file: UploadFile = File(..., description="Archivo de comprobante en formato imagen (JPEG, PNG, WebP) o PDF"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    allowed_content_types = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "application/pdf",
    }
    filename = file.filename or ""
    extension = filename.split(".")[-1].lower() if "." in filename else ""
    allowed_extensions = {"jpg", "jpeg", "png", "webp", "pdf"}

    if file.content_type not in allowed_content_types and extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de archivo no soportado. Se aceptan únicamente imágenes (JPEG, PNG, WebP) o documentos PDF.",
        )

    # Protección DoS: Límite de tamaño de archivo a 15 MB
    MAX_FILE_SIZE = 15 * 1024 * 1024
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo proporcionado está vacío.",
        )
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="El tamaño del archivo excede el límite máximo permitido de 15 MB.",
        )

    try:
        optimized_image_bytes = preprocess_image(file_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Error durante el preprocesamiento de la imagen: {str(exc)}",
        )
    except Exception as exc:
        log_security_event("IMAGE_PREPROCESS_ERROR", f"Fallo al procesar imagen: {exc}", level="ERROR")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Fallo inesperado al procesar la imagen del comprobante.",
        )

    try:
        extracted_data = await extract_invoice_with_vlm(optimized_image_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Error en la extracción de datos fiscales: {str(exc)}",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Error de comunicación con el servicio VLM: {str(exc)}",
        )
    except Exception as exc:
        log_security_event("VLM_INFERENCE_ERROR", f"Fallo en inferencia VLM: {exc}", level="ERROR")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Fallo durante la inferencia VLM del comprobante fiscal.",
        )

    try:
        invoice_in = InvoiceCreate(**extracted_data)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Los datos extraídos no satisfacen el esquema de validación: {str(exc)}",
        )

    # OWASP LLM06 (Excessive Agency): El comprobante procesado por IA SIEMPRE inicia en PENDIENTE
    # impidiendo cualquier impacto contable automático sin revisión profesional previa
    db_invoice = Invoice(
        razon_social=invoice_in.razon_social,
        cuit_emisor=invoice_in.cuit_emisor,
        cuit_receptor=invoice_in.cuit_receptor,
        tipo_comprobante=invoice_in.tipo_comprobante,
        punto_venta=invoice_in.punto_venta,
        numero_comprobante=invoice_in.numero_comprobante,
        fecha_emision=invoice_in.fecha_emision,
        fecha_imputacion_iva=invoice_in.fecha_imputacion_iva or invoice_in.fecha_emision,
        provincia_facturacion=invoice_in.provincia_facturacion,
        moneda=invoice_in.moneda,
        tipo_cambio=invoice_in.tipo_cambio,
        neto_gravado=invoice_in.neto_gravado,
        iva_monto=invoice_in.iva_monto,
        percepcion_iva=invoice_in.percepcion_iva,
        percepcion_iibb=invoice_in.percepcion_iibb,
        iibb_jurisdiccion=invoice_in.iibb_jurisdiccion,
        impuestos_internos=invoice_in.impuestos_internos,
        otros_conceptos=invoice_in.otros_conceptos,
        total=invoice_in.total,
        estado_validacion="PENDIENTE",
        cae=invoice_in.cae,
        fecha_vto_cae=invoice_in.fecha_vto_cae,
    )
    db.add(db_invoice)
    await db.commit()
    await db.refresh(db_invoice)

    return db_invoice
