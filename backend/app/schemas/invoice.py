from datetime import date, datetime
from decimal import Decimal
from typing import Any, List, Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class InvoiceBase(BaseModel):
    razon_social: str = Field(
        default="PROVEEDOR GENERAL",
        description="Razón social o denominación del emisor",
    )
    cuit_emisor: str
    cuit_receptor: str
    tipo_comprobante: str
    punto_venta: int
    numero_comprobante: int

    # Fechas fiscales
    fecha_emision: date
    fecha_imputacion_iva: Optional[date] = None

    # Localización y Moneda
    provincia_facturacion: Optional[str] = None
    moneda: str = Field(default="ARS", description="Código de moneda (ARS, USD)")
    tipo_cambio: Decimal = Field(default=Decimal("1.0000"), description="Cotización de cambio respecto al ARS")

    # Importes base
    neto_gravado: Decimal = Field(default=Decimal("0.00"))
    iva_monto: Decimal = Field(default=Decimal("0.00"))

    # Otros Tributos y Percepciones
    percepcion_iva: Decimal = Field(default=Decimal("0.00"))
    percepcion_iibb: Decimal = Field(default=Decimal("0.00"))
    iibb_jurisdiccion: Optional[str] = None
    impuestos_internos: Decimal = Field(default=Decimal("0.00"))
    otros_conceptos: Decimal = Field(default=Decimal("0.00"))

    # Total general
    total: Decimal

    # Datos AFIP / CAE
    cae: Optional[str] = None
    fecha_vto_cae: Optional[date] = None

    @field_validator("razon_social", mode="before")
    @classmethod
    def validate_razon_social(cls, v: Any) -> str:
        if not v or not str(v).strip():
            return "PROVEEDOR GENERAL"
        return str(v).strip().upper()

    @field_validator("moneda", mode="before")
    @classmethod
    def validate_moneda(cls, v: Any) -> str:
        if not v or not str(v).strip():
            return "ARS"
        val = str(v).strip().upper()
        if any(term in val for term in ["USD", "U$S", "DOLAR", "DÓLAR", "US$"]):
            return "USD"
        return "ARS"


class InvoiceCreate(InvoiceBase):
    estado_validacion: str = "PENDIENTE"

    @model_validator(mode="after")
    def validate_totals(self) -> "InvoiceCreate":
        # Asegurar fecha_imputacion_iva por defecto igual a fecha_emision
        if not self.fecha_imputacion_iva:
            self.fecha_imputacion_iva = self.fecha_emision

        # Consistencia matemática:
        # Total == round(Neto_Gravado + IVA_Total + Conceptos_No_Gravados + Operaciones_Exentas + Percepcion_IVA + Percepcion_IIBB + Impuestos_Internos + Otros_Conceptos, 2)
        total_calculado = round(
            self.neto_gravado
            + self.iva_monto
            + self.percepcion_iva
            + self.percepcion_iibb
            + self.impuestos_internos
            + self.otros_conceptos,
            2,
        )

        diferencia = abs(total_calculado - self.total)
        # Tolerancia de redondeo ampliada a 0.10 para contemplar diferencias de alícuotas AFIP / SAP
        if diferencia <= Decimal("0.10"):
            self.estado_validacion = "VALIDADO"
        else:
            self.estado_validacion = "REVISION"

        return self


class InvoiceResponse(InvoiceBase):
    id: UUID
    estado_validacion: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvoiceUpdate(BaseModel):
    razon_social: Optional[str] = None
    cuit_emisor: Optional[str] = None
    cuit_receptor: Optional[str] = None
    tipo_comprobante: Optional[str] = None
    punto_venta: Optional[int] = None
    numero_comprobante: Optional[int] = None
    fecha_emision: Optional[date] = None
    fecha_imputacion_iva: Optional[date] = None
    provincia_facturacion: Optional[str] = None
    moneda: Optional[str] = None
    tipo_cambio: Optional[Decimal] = None
    neto_gravado: Optional[Decimal] = None
    iva_monto: Optional[Decimal] = None
    percepcion_iva: Optional[Decimal] = None
    percepcion_iibb: Optional[Decimal] = None
    iibb_jurisdiccion: Optional[str] = None
    impuestos_internos: Optional[Decimal] = None
    otros_conceptos: Optional[Decimal] = None
    total: Optional[Decimal] = None
    cae: Optional[str] = None
    fecha_vto_cae: Optional[date] = None

    @field_validator("fecha_emision", "fecha_imputacion_iva", "fecha_vto_cae", mode="before")
    @classmethod
    def validate_dates(cls, v: Any) -> Optional[date]:
        if not v:
            return None
        if isinstance(v, date) and not isinstance(v, datetime):
            return v
        if isinstance(v, datetime):
            return v.date()
        if isinstance(v, str):
            clean = v.strip().split("T")[0]
            try:
                return datetime.strptime(clean, "%Y-%m-%d").date()
            except Exception:
                return None
        return None


class AlicuotaIva(BaseModel):
    id: int = Field(default=5, description="Código de alícuota AFIP (3: 0%, 4: 10.5%, 5: 21%, 6: 27%)")
    base_imp: Decimal = Field(..., description="Base imponible gravada")
    importe: Decimal = Field(..., description="Importe de IVA liquidado")


class InvoiceEmitirRequest(BaseModel):
    cuit_emisor: Optional[str] = Field(None, description="CUIT del emisor fiscal (opcional, usa AFIP_CUIT)")
    punto_venta: int = Field(..., ge=1, le=99999, description="Punto de venta fiscal habilitado")
    tipo_comprobante: Any = Field(..., description="Tipo de comprobante ('FACTURA A', 1, 'FACTURA B', 6, etc.)")
    concepto: int = Field(default=1, ge=1, le=3, description="1: Productos, 2: Servicios, 3: Productos y Servicios")
    tipo_doc_receptor: int = Field(default=80, description="Tipo documento receptor (80: CUIT, 86: CUIL, 96: DNI, 99: Consumidor Final)")
    nro_doc_receptor: str = Field(..., description="Número de documento o CUIT del receptor")
    razon_social_receptor: Optional[str] = Field("CLIENTE GENERAL", description="Razón social o denominación del receptor")
    imp_neto: Decimal = Field(..., ge=0, description="Importe neto gravado")
    imp_iva: Decimal = Field(default=Decimal("0.00"), ge=0, description="Importe total liquidado de IVA")
    imp_total: Decimal = Field(..., ge=0, description="Importe total final del comprobante")
    imp_trib: Decimal = Field(default=Decimal("0.00"), ge=0, description="Importe de otros tributos y percepciones")
    imp_op_ex: Decimal = Field(default=Decimal("0.00"), ge=0, description="Importe de operaciones exentas")
    alicuotas_iva: List[AlicuotaIva] = Field(default_factory=list, description="Desglose de alícuotas de IVA")
    fch_serv_desde: Optional[str] = Field(None, description="Fecha inicio de servicio (YYYYMMDD o YYYY-MM-DD)")
    fch_serv_hasta: Optional[str] = Field(None, description="Fecha fin de servicio (YYYYMMDD o YYYY-MM-DD)")
    fch_vto_pago: Optional[str] = Field(None, description="Fecha vencimiento para el pago (YYYYMMDD o YYYY-MM-DD)")
    moneda: str = Field(default="ARS", description="Código de moneda (ARS, USD)")
    tipo_cambio: Decimal = Field(default=Decimal("1.0000"), description="Cotización respecto al peso")
