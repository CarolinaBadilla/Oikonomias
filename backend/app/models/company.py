import uuid
from sqlalchemy import Column, Date, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Company(Base):
    __tablename__ = "empresas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cuit = Column(String(11), unique=True, nullable=False, index=True)
    razon_social = Column(String(255), nullable=False, default="Distribuidora SRL")
    direccion = Column(String(255), nullable=True, default="Av. Corrientes 1234, CABA")
    inicio_actividades = Column(Date, nullable=True)
    moneda = Column(String(10), nullable=False, default="ARS")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    usuarios = relationship("User", back_populates="empresa_activa")

