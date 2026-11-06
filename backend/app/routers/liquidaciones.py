from datetime import date
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.routers.auth import get_current_user
from app.models.user import User
from app.services.tax_liquidation import TaxLiquidationService

router = APIRouter()


@router.get(
    "/iva/posicion",
    summary="Calcular posición mensual neta de IVA (Débito vs Crédito vs Percepciones)",
    status_code=status.HTTP_200_OK,
)
async def get_posicion_iva(
    anio: int = Query(default=2026, ge=2000, le=2100, description="Año fiscal (ej: 2026)"),
    mes: int = Query(default=11, ge=1, le=12, description="Mes fiscal (1 a 12)"),
    empresa_id: Optional[uuid.UUID] = Query(default=None, description="UUID de la empresa a liquidar"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Retorna la posición mensual de IVA con total de Débito Fiscal, Crédito Fiscal desglosado,
    Percepciones de IVA e IIBB, Saldo Técnico y Saldo Final a favor o a pagar.
    """
    active_company_id = empresa_id or (current_user.empresa_activa_id if current_user else None)

    try:
        resultado = await TaxLiquidationService.calcular_posicion_iva(
            db=db,
            anio=anio,
            mes=mes,
            empresa_id=active_company_id,
        )
        return resultado
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al calcular la posición impositiva de IVA: {str(exc)}",
        )


@router.get(
    "/iva/exportar/{tipo}",
    summary="Exportar archivo de texto plano reglamentario Libro IVA Digital (RG 4597 ARCA/AFIP)",
)
async def exportar_libro_iva_txt(
    tipo: str,
    anio: int = Query(default=2026, ge=2000, le=2100, description="Año fiscal"),
    mes: int = Query(default=11, ge=1, le=12, description="Mes fiscal"),
    empresa_id: Optional[uuid.UUID] = Query(default=None, description="UUID de la empresa"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user),
):
    """
    Genera y descarga el archivo .txt de formato fijo reglamentario para Libro IVA Digital (ARCA / AFIP).
    Tipos aceptados: 'compras' o 'ventas'.
    """
    tipo_normalizado = tipo.upper().strip()
    if tipo_normalizado not in ["COMPRAS", "VENTAS"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tipo de exportación inválido. Debe ser 'compras' o 'ventas'.",
        )

    active_company_id = empresa_id or (current_user.empresa_activa_id if current_user else None)

    try:
        txt_content = await TaxLiquidationService.exportar_libro_iva_txt(
            db=db,
            anio=anio,
            mes=mes,
            tipo=tipo_normalizado,
            empresa_id=active_company_id,
        )

        filename = f"LIBRO_IVA_{tipo_normalizado}_{anio}_{str(mes).zfill(2)}.txt"

        return Response(
            content=txt_content,
            media_type="text/plain; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
            },
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al generar archivo reglamentario Libro IVA Digital: {str(exc)}",
        )

