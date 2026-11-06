import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Configuración global de la aplicación (entorno, base de datos, Redis,
    OpenRouter y almacenamiento local de comprobantes).
    """
    # Entorno y Seguridad
    ENVIRONMENT: str = "development"
    DEBUG: bool = False
    SECRET_KEY: str = "clave_secreta_super_segura_para_desarrollo_local_2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8

    # Base de Datos PostgreSQL y Redis
    DATABASE_URL: Optional[str] = "postgresql+asyncpg://contala_user:contala_secret_2026@postgres:5432/contala_db"
    REDIS_URL: str = "redis://redis:6379/0"

    # Inferencia IA / OpenRouter
    OPENROUTER_API_KEY: Optional[str] = None
    OPENROUTER_MODEL: str = "qwen/qwen2.5-vl-72b-instruct"
    OPENROUTER_FALLBACK_MODEL: str = "google/gemini-2.0-flash-001"

    # Almacenamiento Local de Comprobantes (Volumen Compartido)
    STORAGE_DIR: str = os.getenv("STORAGE_DIR", "/app/uploads")

    # AFIP / ARCA
    AFIP_CUIT: str = "27463304624"
    AFIP_ENVIRONMENT: str = "homologacion"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

