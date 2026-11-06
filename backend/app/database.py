import os
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base

# Obtener URL de base de datos desde variables de entorno
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://contala_user:contala_secret_2026@localhost:5432/contala_db",
)

# Garantizar compatibilidad con el driver asíncrono asyncpg si viene con esquema postgresql://
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    future=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Generador de dependencias para inyectar sesiones asíncronas de base de datos."""
    async with AsyncSessionLocal() as session:
        yield session

