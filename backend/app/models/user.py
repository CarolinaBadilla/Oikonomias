import uuid
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "usuarios"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    nombre_completo = Column(String(255), nullable=False, default="Nicolás Badilla")
    rol = Column(String(50), nullable=False, default="CONTADOR")
    is_active = Column(Boolean, nullable=False, default=True)
    is_superuser = Column(Boolean, nullable=False, default=False)
    empresa_activa_id = Column(UUID(as_uuid=True), ForeignKey("empresas.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    empresa_activa = relationship("Company", back_populates="usuarios")

