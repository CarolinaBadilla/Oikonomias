import uuid
from typing import Optional
from pydantic import BaseModel, Field


class CompanyResponse(BaseModel):
    id: uuid.UUID
    cuit: str
    razon_social: str
    direccion: Optional[str] = None
    moneda: str = "ARS"

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    nombre_completo: str
    rol: str
    is_active: bool
    empresa_activa: Optional[CompanyResponse] = None

    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    email: str = Field(..., description="Correo electrónico del usuario")
    password: str = Field(..., description="Contraseña del usuario")


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UpdateProfileRequest(BaseModel):
    nombre_completo: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class UpdateCompanyRequest(BaseModel):
    razon_social: Optional[str] = None
    cuit: Optional[str] = None
    direccion: Optional[str] = None
    moneda: Optional[str] = None

