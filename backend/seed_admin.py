"""
Script CLI para sembrar o verificar el usuario administrador inicial en PostgreSQL.
Uso:
  python seed_admin.py
"""
import asyncio
import os
import sys

from sqlalchemy import select

# Asegurar path de imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.database import AsyncSessionLocal, engine, Base
from app.models.company import Company
from app.models.user import User
from app.core.security import get_password_hash


async def seed_initial_admin():
    print("Iniciando sembrado de usuario administrador...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # Asegurar empresa predeterminada
        comp_res = await session.execute(select(Company).limit(1))
        company = comp_res.scalar_one_or_none()

        if not company:
            company = Company(
                cuit="30712345678",
                razon_social="Distribuidora SRL",
                direccion="Av. Corrientes 1234, CABA",
                moneda="ARS",
            )
            session.add(company)
            await session.flush()
            print("✓ Empresa predeterminada 'Distribuidora SRL' creada.")

        # Verificar usuario admin
        admin_res = await session.execute(
            select(User).where(User.email == "admin@contala.com")
        )
        admin = admin_res.scalar_one_or_none()

        if admin:
            print("ℹ El usuario 'admin@contala.com' ya existe en la base de datos.")
            admin.is_active = True
            admin.is_superuser = True
            admin.hashed_password = get_password_hash("Admin123!")
            await session.commit()
            print("✓ Contraseña actualizada y permisos asegurados (is_superuser=True, is_active=True).")
        else:
            admin = User(
                email="admin@contala.com",
                hashed_password=get_password_hash("Admin123!"),
                nombre_completo="Administrador ContalA",
                rol="ADMIN",
                is_active=True,
                is_superuser=True,
                empresa_activa_id=company.id,
            )
            session.add(admin)
            await session.commit()
            print("✓ Usuario administrador 'admin@contala.com' creado con éxito.")

    await engine.dispose()
    print("Proceso de sembrado finalizado.")


if __name__ == "__main__":
    asyncio.run(seed_initial_admin())

