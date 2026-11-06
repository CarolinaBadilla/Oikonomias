import uuid
from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Invoice(Base):
    __tablename__ = "comprobantes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    razon_social = Column(
        String(255),
        nullable=False,
        server_default="PROVEEDOR GENERAL",
        default="PROVEEDOR GENERAL",
    )
    cuit_emisor = Column(String(11), nullable=False, index=True)
    cuit_receptor = Column(String(11), nullable=False, index=True)
    tipo_comprobante = Column(String(10), nullable=False)
    punto_venta = Column(Integer, nullable=False)
    numero_comprobante = Column(BigInteger, nullable=False)
    
    # Fechas fiscales
    fecha_emision = Column(Date, nullable=False)
    fecha_imputacion_iva = Column(Date, nullable=True)

    # Localización y Moneda
    provincia_facturacion = Column(String(100), nullable=True)
    moneda = Column(String(3), nullable=False, server_default="ARS", default="ARS")
    tipo_cambio = Column(Numeric(12, 4), nullable=False, server_default="1.0000", default=1.0000)

    # Importes base
    neto_gravado = Column(Numeric(12, 2), nullable=False, default=0.00)
    iva_monto = Column(Numeric(12, 2), nullable=False, default=0.00)

    # Otros Tributos y Percepciones
    percepcion_iva = Column(Numeric(12, 2), nullable=False, server_default="0.00", default=0.00)
    percepcion_iibb = Column(Numeric(12, 2), nullable=False, server_default="0.00", default=0.00)
    iibb_jurisdiccion = Column(String(100), nullable=True)
    impuestos_internos = Column(Numeric(12, 2), nullable=False, server_default="0.00", default=0.00)
    otros_conceptos = Column(Numeric(12, 2), nullable=False, server_default="0.00", default=0.00)

    # Total y control
    total = Column(Numeric(12, 2), nullable=False)
    estado_validacion = Column(String(50), default="PENDIENTE")
    
    # Datos de Validación Fiscal (AFIP / ARCA)
    cae = Column(String(14), nullable=True, index=True)
    fecha_vto_cae = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
