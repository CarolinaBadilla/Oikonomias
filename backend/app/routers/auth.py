from collections import defaultdict
import time
from typing import Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)
from app.database import get_db
from app.models.company import Company
from app.models.user import User
from app.schemas.auth import (
    CompanyResponse,
    LoginRequest,
    TokenResponse,
    UpdateCompanyRequest,
    UpdateProfileRequest,
    UserResponse,
)

router = APIRouter()

security_bearer = HTTPBearer(auto_error=False)

# =========================================================================
# RATE LIMITING: Máximo 5 intentos por minuto por IP (HTTP 429)
# =========================================================================
_login_attempts: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_WINDOW_SECONDS = 60.0
MAX_ATTEMPTS_PER_WINDOW = 5


def enforce_login_rate_limit(request: Request) -> None:
    """Valida que una IP no supere 5 intentos por minuto en el endpoint de login."""
    client_ip = request.client.host if request.client else "unknown"
    # Tomar en cuenta header X-Forwarded-For si está detrás de un proxy
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()

    now = time.time()
    # Limpiar marcas de tiempo fuera de la ventana de 60 segundos
    _login_attempts[client_ip] = [
        t for t in _login_attempts[client_ip] if now - t < RATE_LIMIT_WINDOW_SECONDS
    ]

    if len(_login_attempts[client_ip]) >= MAX_ATTEMPTS_PER_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos de inicio de sesión. Por favor, intente nuevamente en 1 minuto.",
        )

    _login_attempts[client_ip].append(now)


# =========================================================================
# DEPENDENCIA: get_current_user (Bearer Token, Rol CONTADOR)
# =========================================================================
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Extrae y valida el token Bearer del header Authorization.
    Verifica que el usuario exista, esté activo y tenga rol 'CONTADOR'.
    """
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se proporcionó token de autenticación Bearer.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de acceso inválido o expirado.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_email = payload.get("sub")
    if not user_email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token con formato inválido.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    query = (
        select(User)
        .options(selectinload(User.empresa_activa))
        .where(User.email == user_email)
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El usuario asociado a este token no existe.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cuenta de usuario inactiva.",
        )

    if user.rol != "CONTADOR":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso restringido: Se requiere rol de CONTADOR.",
        )

    return user


# =========================================================================
# ENDPOINTS
# =========================================================================

@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Iniciar sesión con Rate Limiting (5 intentos/min)",
)
async def login(
    request: Request,
    credentials: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Inicia sesión, aplica Rate Limiting estricto por IP y retorna JWT token con rol CONTADOR.
    """
    # 1. Aplicar Rate Limit
    enforce_login_rate_limit(request)

    # 2. Buscar usuario por email con su empresa activa
    query = (
        select(User)
        .options(selectinload(User.empresa_activa))
        .where(User.email == credentials.email.lower().strip())
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    # 3. Validar credenciales
    if not user or not verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales de acceso incorrectas.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La cuenta se encuentra desactivada.",
        )

    # 4. Generar Token JWT
    token_data = {
        "sub": user.email,
        "user_id": str(user.id),
        "rol": user.rol,
        "nombre": user.nombre_completo,
    }
    access_token = create_access_token(data=token_data)

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Obtener perfil del usuario autenticado y su empresa activa",
)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)


@router.patch(
    "/profile",
    response_model=UserResponse,
    summary="Actualizar nombre, email o cambiar contraseña del usuario",
)
async def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.nombre_completo and body.nombre_completo.strip():
        current_user.nombre_completo = body.nombre_completo.strip()

    if body.email and body.email.strip():
        new_email = body.email.strip().lower()
        if new_email != current_user.email:
            # Comprobar que no esté en uso
            chk = await db.execute(select(User).where(User.email == new_email))
            if chk.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El correo electrónico ya se encuentra registrado por otro usuario.",
                )
            current_user.email = new_email

    if body.new_password:
        if not body.current_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debe ingresar la contraseña actual para establecer una nueva contraseña.",
            )
        if not verify_password(body.current_password, current_user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La contraseña actual ingresada es incorrecta.",
            )
        if len(body.new_password) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La nueva contraseña debe tener al menos 6 caracteres.",
            )
        current_user.hashed_password = get_password_hash(body.new_password)

    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)


@router.put(
    "/company",
    response_model=CompanyResponse,
    summary="Actualizar la empresa activa del contador",
)
async def update_company(
    body: UpdateCompanyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    company = current_user.empresa_activa

    if not company:
        # Si no tiene empresa asignada, crear una
        company = Company(
            cuit=body.cuit or "30712345678",
            razon_social=body.razon_social or "Distribuidora SRL",
            direccion=body.direccion or "Av. Corrientes 1234, CABA",
            moneda=body.moneda or "ARS",
        )
        db.add(company)
        await db.flush()
        current_user.empresa_activa_id = company.id
    else:
        if body.razon_social:
            company.razon_social = body.razon_social.strip()
        if body.cuit:
            company.cuit = body.cuit.strip()
        if body.direccion is not None:
            company.direccion = body.direccion.strip()
        if body.moneda:
            company.moneda = body.moneda.strip()

    await db.commit()
    await db.refresh(company)
    return CompanyResponse.model_validate(company)

