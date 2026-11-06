from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import case, cast, extract, func, select, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.invoice import Invoice
from app.models.user import User
from app.routers.auth import get_current_user

router = APIRouter()


@router.get(
    "/kpis",
    status_code=status.HTTP_200_OK,
    summary="Obtener KPIs consolidados de compras y crédito fiscal",
)
async def get_kpis(
    anio: Optional[int] = Query(None, description="Año fiscal"),
    mes: Optional[int] = Query(None, description="Mes fiscal (1 a 12)"),
    empresa_id: Optional[str] = Query(None, description="Filtrar por empresa o CUIT"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Retorna métricas clave (KPIs) calculadas íntegramente mediante agregaciones SQL en PostgreSQL:
    - Total de compras
    - Cantidad de comprobantes
    - IVA Crédito fiscal acumulado
    - Percepciones totales (IVA + IIBB)
    - Ticket promedio de compra
    """
    date_col = func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)
    conditions = []

    es_profesional = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    if empresa_id:
        clean_cuit = re.sub(r"\D", "", str(empresa_id))
        if clean_cuit:
            conditions.append(
                (Invoice.cuit_emisor == clean_cuit) | (Invoice.cuit_receptor == clean_cuit)
            )
    elif not es_profesional and empresa_cuit:
        conditions.append(
            (Invoice.cuit_emisor == empresa_cuit) | (Invoice.cuit_receptor == empresa_cuit)
        )

    if anio is not None:
        conditions.append(extract("year", date_col) == anio)
    if mes is not None:
        conditions.append(extract("month", date_col) == mes)

    query = select(
        func.count(Invoice.id).label("total_comprobantes"),
        func.coalesce(func.sum(Invoice.total), 0.0).label("total_compras"),
        func.coalesce(func.sum(Invoice.iva_monto), 0.0).label("total_iva_credito"),
        func.coalesce(
            func.sum(Invoice.percepcion_iva + Invoice.percepcion_iibb), 0.0
        ).label("total_percepciones"),
        func.coalesce(func.sum(Invoice.neto_gravado), 0.0).label("total_neto"),
    )

    if conditions:
        query = query.where(*conditions)

    result = await db.execute(query)
    row = result.one()

    total_comprobantes = int(row.total_comprobantes or 0)
    total_compras = round(float(row.total_compras or 0.0), 2)
    total_iva_credito = round(float(row.total_iva_credito or 0.0), 2)
    total_percepciones = round(float(row.total_percepciones or 0.0), 2)
    total_neto = round(float(row.total_neto or 0.0), 2)
    ticket_promedio = (
        round(total_compras / total_comprobantes, 2) if total_comprobantes > 0 else 0.0
    )

    return {
        "anio": anio,
        "mes": mes,
        "total_compras": total_compras,
        "total_comprobantes": total_comprobantes,
        "total_iva_credito": total_iva_credito,
        "total_percepciones": total_percepciones,
        "total_neto": total_neto,
        "ticket_promedio": ticket_promedio,
    }


@router.get(
    "/evolucion-iva",
    status_code=status.HTTP_200_OK,
    summary="Evolución mensual de Crédito Fiscal IVA y saldo del período",
)
async def get_evolucion_iva(
    anio: Optional[int] = Query(None, description="Año de consulta (por defecto actual)"),
    empresa_id: Optional[str] = Query(None, description="Filtrar por empresa o CUIT"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """
    Retorna un array de 12 meses con la evolución del crédito fiscal IVA,
    débito fiscal (preparado para integración de ventas) y saldo mensual.
    """
    selected_year = anio if anio is not None else datetime.now().year
    date_col = func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)

    conditions = [extract("year", date_col) == selected_year]
    es_profesional = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    if empresa_id:
        clean_cuit = re.sub(r"\D", "", str(empresa_id))
        if clean_cuit:
            conditions.append(
                (Invoice.cuit_emisor == clean_cuit) | (Invoice.cuit_receptor == clean_cuit)
            )
    elif not es_profesional and empresa_cuit:
        conditions.append(
            (Invoice.cuit_emisor == empresa_cuit) | (Invoice.cuit_receptor == empresa_cuit)
        )

    # Consulta agrupada por mes
    query = (
        select(
            extract("month", date_col).label("mes_num"),
            func.coalesce(func.sum(Invoice.iva_monto), 0.0).label("credito_fiscal"),
            func.coalesce(func.sum(Invoice.total), 0.0).label("total_compras"),
            func.count(Invoice.id).label("cantidad_facturas"),
        )
        .where(*conditions)
        .group_by(extract("month", date_col))
        .order_by(extract("month", date_col))
    )

    result = await db.execute(query)
    rows = result.all()

    # Mapeo por mes indexado 1 a 12
    month_data = {
        int(r.mes_num): {
            "credito_fiscal": round(float(r.credito_fiscal or 0.0), 2),
            "total_compras": round(float(r.total_compras or 0.0), 2),
            "cantidad_facturas": int(r.cantidad_facturas or 0),
        }
        for r in rows
        if r.mes_num is not None
    }

    nombres_meses = [
        "Ene", "Feb", "Mar", "Abr", "May", "Jun",
        "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"
    ]

    evolucion = []
    for m in range(1, 13):
        m_info = month_data.get(m, {"credito_fiscal": 0.0, "total_compras": 0.0, "cantidad_facturas": 0})
        credito = m_info["credito_fiscal"]
        debito = 0.0  # Compras genera crédito fiscal; las ventas generarán débito
        saldo_mes = round(credito - debito, 2)
        evolucion.append({
            "mes": m,
            "mes_nombre": nombres_meses[m - 1],
            "credito_fiscal": credito,
            "debito_fiscal": debito,
            "saldo_mes": saldo_mes,
            "total_compras": m_info["total_compras"],
            "cantidad_facturas": m_info["cantidad_facturas"],
        })

    return evolucion


@router.get(
    "/proveedores-top",
    status_code=status.HTTP_200_OK,
    summary="Top proveedores clasificados por volumen acumulado de compras",
)
async def get_top_proveedores(
    anio: Optional[int] = Query(None, description="Año fiscal"),
    mes: Optional[int] = Query(None, description="Mes fiscal (1 a 12)"),
    limit: int = Query(5, ge=1, le=50, description="Cantidad de proveedores a listar"),
    empresa_id: Optional[str] = Query(None, description="Filtrar por empresa o CUIT"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """
    Retorna los principales proveedores agrupados por razón social y CUIT,
    con su volumen de compra acumulado y participación porcentual sobre el total.
    """
    date_col = func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)
    conditions = []

    es_profesional = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    if empresa_id:
        clean_cuit = re.sub(r"\D", "", str(empresa_id))
        if clean_cuit:
            conditions.append(
                (Invoice.cuit_emisor == clean_cuit) | (Invoice.cuit_receptor == clean_cuit)
            )
    elif not es_profesional and empresa_cuit:
        conditions.append(
            (Invoice.cuit_emisor == empresa_cuit) | (Invoice.cuit_receptor == empresa_cuit)
        )

    if anio is not None:
        conditions.append(extract("year", date_col) == anio)
    if mes is not None:
        conditions.append(extract("month", date_col) == mes)

    # 1. Total general del período para cálculo de porcentaje
    total_period_query = select(func.coalesce(func.sum(Invoice.total), 0.0))
    if conditions:
        total_period_query = total_period_query.where(*conditions)
    total_period_result = await db.execute(total_period_query)
    gran_total = float(total_period_result.scalar() or 0.0)

    # 2. Agrupación por proveedor
    query = (
        select(
            Invoice.razon_social,
            Invoice.cuit_emisor,
            func.coalesce(func.sum(Invoice.total), 0.0).label("total_acumulado"),
            func.coalesce(func.sum(Invoice.iva_monto), 0.0).label("total_iva"),
            func.count(Invoice.id).label("cantidad_comprobantes"),
        )
        .group_by(Invoice.razon_social, Invoice.cuit_emisor)
        .order_by(func.sum(Invoice.total).desc())
        .limit(limit)
    )

    if conditions:
        query = query.where(*conditions)

    result = await db.execute(query)
    rows = result.all()

    top_proveedores = []
    for r in rows:
        total_acumulado = round(float(r.total_acumulado or 0.0), 2)
        porcentaje = (
            round((total_acumulado / gran_total) * 100, 1) if gran_total > 0 else 0.0
        )
        top_proveedores.append({
            "razon_social": r.razon_social or "PROVEEDOR GENERAL",
            "cuit_emisor": r.cuit_emisor,
            "total_acumulado": total_acumulado,
            "total_iva": round(float(r.total_iva or 0.0), 2),
            "cantidad_comprobantes": int(r.cantidad_comprobantes or 0),
            "porcentaje": porcentaje,
        })

    return top_proveedores


@router.get(
    "/percepciones-jurisdiccion",
    status_code=status.HTTP_200_OK,
    summary="Desglose de percepciones de IIBB por provincia / jurisdicción",
)
async def get_percepciones_jurisdiccion(
    anio: Optional[int] = Query(None, description="Año fiscal"),
    mes: Optional[int] = Query(None, description="Mes fiscal (1 a 12)"),
    empresa_id: Optional[str] = Query(None, description="Filtrar por empresa o CUIT"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Dict[str, Any]]:
    """
    Retorna el desglose de percepciones de Ingresos Brutos (IIBB) agrupadas
    por jurisdicción fiscal para las declaraciones juradas del Convenio Multilateral (Sifere).
    """
    date_col = func.coalesce(Invoice.fecha_imputacion_iva, Invoice.fecha_emision)
    conditions = []

    es_profesional = getattr(current_user, "rol", "CONTADOR") in ["CONTADOR", "ADMIN", "ESTUDIO"]
    empresa_cuit = current_user.empresa_activa.cuit if current_user.empresa_activa else None

    if empresa_id:
        clean_cuit = re.sub(r"\D", "", str(empresa_id))
        if clean_cuit:
            conditions.append(
                (Invoice.cuit_emisor == clean_cuit) | (Invoice.cuit_receptor == clean_cuit)
            )
    elif not es_profesional and empresa_cuit:
        conditions.append(
            (Invoice.cuit_emisor == empresa_cuit) | (Invoice.cuit_receptor == empresa_cuit)
        )

    if anio is not None:
        conditions.append(extract("year", date_col) == anio)
    if mes is not None:
        conditions.append(extract("month", date_col) == mes)

    # Filtrar solo comprobantes que tengan percepciones
    conditions.append(
        (Invoice.percepcion_iibb > 0) | (Invoice.percepcion_iva > 0)
    )

    jurisdiccion_col = func.coalesce(
        Invoice.iibb_jurisdiccion,
        Invoice.provincia_facturacion,
        "Sin Jurisdicción",
    )

    query = (
        select(
            jurisdiccion_col.label("jurisdiccion"),
            func.coalesce(func.sum(Invoice.percepcion_iibb), 0.0).label("total_iibb"),
            func.coalesce(func.sum(Invoice.percepcion_iva), 0.0).label("total_iva"),
            func.count(Invoice.id).label("cantidad_comprobantes"),
        )
        .where(*conditions)
        .group_by(jurisdiccion_col)
        .order_by(func.sum(Invoice.percepcion_iibb).desc())
    )

    result = await db.execute(query)
    rows = result.all()

    total_iibb_global = sum(float(r.total_iibb or 0.0) for r in rows)

    desglose = []
    for r in rows:
        total_iibb = round(float(r.total_iibb or 0.0), 2)
        total_iva = round(float(r.total_iva or 0.0), 2)
        pct = (
            round((total_iibb / total_iibb_global) * 100, 1)
            if total_iibb_global > 0
            else 0.0
        )
        desglose.append({
            "jurisdiccion": r.jurisdiccion,
            "total_iibb": total_iibb,
            "total_iva": total_iva,
            "total_percepciones": round(total_iibb + total_iva, 2),
            "cantidad_comprobantes": int(r.cantidad_comprobantes or 0),
            "porcentaje_iibb": pct,
        })

    return desglose

