from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import log_security_event
from app.core.security import get_password_hash
from app.database import AsyncSessionLocal, Base, engine, get_db
from app.models.company import Company
from app.models.invoice import Invoice
from app.models.user import User
from app.routers.auth import get_current_user, router as auth_router
from app.routers.invoices import router as invoices_router
from app.routers.liquidaciones import router as liquidaciones_router
from app.routers.reports import router as reports_router
from app.services.reconciliation import reconcile_bank_statement


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Inicialización: Crear tablas si no existen y asegurar compatibilidad de esquema
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            # Migraciones automáticas idempotentes de columnas adicionales
            migration_queries = [
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS razon_social VARCHAR(255) DEFAULT 'PROVEEDOR GENERAL';",
                "UPDATE comprobantes SET razon_social = 'PROVEEDOR GENERAL' WHERE razon_social IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS fecha_imputacion_iva DATE;",
                "UPDATE comprobantes SET fecha_imputacion_iva = fecha_emision WHERE fecha_imputacion_iva IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS provincia_facturacion VARCHAR(100);",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS moneda VARCHAR(3) DEFAULT 'ARS';",
                "UPDATE comprobantes SET moneda = 'ARS' WHERE moneda IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS tipo_cambio NUMERIC(12, 4) DEFAULT 1.0000;",
                "UPDATE comprobantes SET tipo_cambio = 1.0000 WHERE tipo_cambio IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS percepcion_iva NUMERIC(12, 2) DEFAULT 0.00;",
                "UPDATE comprobantes SET percepcion_iva = 0.00 WHERE percepcion_iva IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS percepcion_iibb NUMERIC(12, 2) DEFAULT 0.00;",
                "UPDATE comprobantes SET percepcion_iibb = 0.00 WHERE percepcion_iibb IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS iibb_jurisdiccion VARCHAR(100);",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS impuestos_internos NUMERIC(12, 2) DEFAULT 0.00;",
                "UPDATE comprobantes SET impuestos_internos = 0.00 WHERE impuestos_internos IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS otros_conceptos NUMERIC(12, 2) DEFAULT 0.00;",
                "UPDATE comprobantes SET otros_conceptos = 0.00 WHERE otros_conceptos IS NULL;",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS cae VARCHAR(14);",
                "ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS fecha_vto_cae DATE;",
                "ALTER TABLE comprobantes ALTER COLUMN estado_validacion TYPE VARCHAR(50);",
                "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS is_superuser BOOLEAN DEFAULT FALSE;",
            ]
            for query in migration_queries:
                await conn.execute(text(query))
        except Exception as exc:
            print(f"Nota en actualización de columnas de comprobantes: {exc}")

    # 2. Sembrado inicial: Crear empresa, usuario contador y usuario administrador si no existen
    try:
        async with AsyncSessionLocal() as session:
            comp_check = await session.execute(
                select(Company).where(Company.cuit == "30712345678")
            )
            company = comp_check.scalar_one_or_none()

            if not company:
                company = Company(
                    cuit="30712345678",
                    razon_social="Distribuidora SRL",
                    direccion="Av. Corrientes 1234, CABA",
                    moneda="ARS",
                )
                session.add(company)
                await session.flush()

            # Usuario Contador Demo
            contador_check = await session.execute(
                select(User).where(User.email == "contador@contala.com")
            )
            if not contador_check.scalar_one_or_none():
                default_user = User(
                    email="contador@contala.com",
                    hashed_password=get_password_hash("contala123"),
                    nombre_completo="Nicolás Badilla",
                    rol="CONTADOR",
                    is_active=True,
                    is_superuser=False,
                    empresa_activa_id=company.id,
                )
                session.add(default_user)
                print("✓ Usuario contador ('contador@contala.com') inicializado.")

            # Usuario Administrador Inicial
            admin_check = await session.execute(
                select(User).where(User.email == "admin@contala.com")
            )
            if not admin_check.scalar_one_or_none():
                admin_user = User(
                    email="admin@contala.com",
                    hashed_password=get_password_hash("Admin123!"),
                    nombre_completo="Administrador ContalA",
                    rol="ADMIN",
                    is_active=True,
                    is_superuser=True,
                    empresa_activa_id=company.id,
                )
                session.add(admin_user)
                print("✓ Usuario administrador ('admin@contala.com') inicializado.")

            await session.commit()
    except Exception as exc:
        print(f"Nota al inicializar usuarios del sistema: {exc}")

    # 3. Inicialización de Almacenamiento Local de Comprobantes
    try:
        from app.services.storage import get_storage_dir
        storage_path = get_storage_dir()
        print(f"✓ Almacenamiento local de comprobantes inicializado en: {storage_path}")
    except Exception as exc:
        print(f"Nota al inicializar almacenamiento local: {exc}")

    yield

    # Finalización: Liberar recursos del pool de conexiones
    await engine.dispose()


app = FastAPI(
    title="ContalA API",
    version="1.0.0",
    lifespan=lifespan,
)

# Middleware de Cabeceras de Seguridad HTTP (OWASP A05)
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# Manejador seguro para excepciones no controladas 500 (Previene Information Disclosure)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log_security_event(
        event_type="UNHANDLED_EXCEPTION",
        detail=f"Excepción interna en {request.method} {request.url.path}: {str(exc)}",
        level="ERROR",
        client_ip=request.client.host if request.client else None,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Error interno del servidor. Por motivos de seguridad, los detalles han sido registrados en la auditoría interna."
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://oikonomias.com.ar",
        "https://www.oikonomias.com.ar",
        "https://api.oikonomias.com.ar",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Incluir Routers Modulares
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(invoices_router, prefix="/api/v1/invoices", tags=["Invoices"])
app.include_router(liquidaciones_router, prefix="/api/v1/liquidaciones", tags=["Liquidaciones"])
app.include_router(reports_router, prefix="/api/v1/reports", tags=["Reports"])

# Montar Directorio Estático de Comprobantes para Visor Split-Screen
from fastapi.staticfiles import StaticFiles
from app.services.storage import get_storage_dir

uploads_path = get_storage_dir()
app.mount("/uploads", StaticFiles(directory=uploads_path), name="uploads")


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "ok", "app": "ContalA"}


@app.post(
    "/api/v1/reconciliation/process",
    status_code=status.HTTP_200_OK,
    summary="Procesar extracto bancario y ejecutar conciliación algorítmica",
    tags=["Reconciliation"],
)
async def process_bank_reconciliation(
    file: UploadFile = File(..., description="Extracto bancario en formato .csv, .xlsx o .xls"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    # 1. Validar extensión permitida
    filename = file.filename or ""
    extension = filename.split(".")[-1].lower() if "." in filename else ""
    if extension not in ["csv", "xlsx", "xls"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Formato de archivo no soportado. Se requiere un archivo CSV o Excel (.xlsx, .xls).",
        )

    # 2. Leer contenido binario del archivo con límite de tamaño (20 MB)
    MAX_STATEMENT_SIZE = 20 * 1024 * 1024
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo proporcionado está vacío.",
        )
    if len(file_bytes) > MAX_STATEMENT_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="El extracto bancario excede el tamaño máximo permitido de 20 MB.",
        )

    # 3. Ejecutar algoritmo de conciliación bancaria
    try:
        reconciliation_result = await reconcile_bank_statement(
            file_bytes=file_bytes,
            filename=filename,
            db_session=db,
        )
        return reconciliation_result
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )
    except Exception as exc:
        log_security_event(
            event_type="RECONCILIATION_PROCESSING_ERROR",
            detail=f"Fallo al procesar extracto bancario: {exc}",
            level="ERROR",
            user_email=current_user.email,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error durante el procesamiento del extracto bancario.",
        )
