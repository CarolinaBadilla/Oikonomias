import logging
import os
import re
import uuid
from typing import Optional, Tuple

from app.core.config import settings

logger = logging.getLogger("oikonomias.storage")


def get_storage_dir() -> str:
    """
    Obtiene y asegura la existencia del directorio de almacenamiento local.
    Compatible tanto con entornos Docker (/app/uploads) como ejecuciones locales en Windows.
    """
    configured_dir = settings.STORAGE_DIR or "/app/uploads"

    # En Windows, si la ruta apunta a '/app/uploads' y no existe esa raíz, usar './uploads'
    if os.name == "nt" and (configured_dir.startswith("/app") or configured_dir.startswith("\\app")):
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        target_dir = os.path.join(base_dir, "uploads")
    else:
        target_dir = os.path.abspath(configured_dir)

    os.makedirs(target_dir, exist_ok=True)
    return target_dir


def get_absolute_path(file_path_or_name: str) -> str:
    """
    Resuelve la ruta absoluta en disco dado un nombre de archivo o ruta relativa ('uploads/...').
    """
    if not file_path_or_name:
        raise ValueError("El nombre o ruta del archivo no puede estar vacío.")

    storage_dir = get_storage_dir()

    # Si ya es una ruta absoluta existente
    if os.path.isabs(file_path_or_name) and os.path.exists(file_path_or_name):
        return file_path_or_name

    # Si viene con prefijo 'uploads/' o 'uploads\\'
    cleaned = file_path_or_name.replace("\\", "/").strip("/")
    if cleaned.startswith("uploads/"):
        cleaned = cleaned[len("uploads/") :]

    filename = os.path.basename(cleaned)
    return os.path.join(storage_dir, filename)


def save_file_locally(
    file_bytes: bytes,
    filename: str,
    prefix: str = "inv",
) -> Tuple[str, str]:
    """
    Persiste un archivo binario en el volumen de almacenamiento local compartido.
    Retorna una tupla: (ruta_relativa_para_bd, ruta_absoluta_en_disco).
    Ejemplo de ruta relativa: 'uploads/inv_a1b2c3d4_factura.pdf'.
    """
    if not file_bytes:
        raise ValueError("El archivo a persistir no puede estar vacío.")

    storage_dir = get_storage_dir()

    # Limpieza de nombre de archivo para evitar Path Traversal (OWASP A01 / A05)
    base_name = os.path.basename(filename or "documento.pdf")
    ext = base_name.split(".")[-1].lower() if "." in base_name else "pdf"
    clean_stem = re.sub(r"[^a-zA-Z0-9_\-]", "_", os.path.splitext(base_name)[0])[:40]

    unique_id = uuid.uuid4().hex[:12]
    safe_filename = f"{prefix}_{unique_id}_{clean_stem}.{ext}"

    absolute_path = os.path.join(storage_dir, safe_filename)

    with open(absolute_path, "wb") as f:
        f.write(file_bytes)

    relative_path = f"uploads/{safe_filename}"
    logger.info(f"Comprobante almacenado exitosamente en volumen local: '{absolute_path}'")

    return relative_path, absolute_path


def read_file_bytes(file_path_or_name: str) -> bytes:
    """
    Lee y devuelve los bytes de un archivo almacenado en el disco local.
    """
    abs_path = get_absolute_path(file_path_or_name)
    if not os.path.exists(abs_path):
        raise FileNotFoundError(f"No se encontró el archivo solicitado en disco: '{abs_path}'")

    with open(abs_path, "rb") as f:
        return f.read()


def delete_file_locally(file_path_or_name: str) -> bool:
    """
    Elimina de forma segura un archivo del volumen de almacenamiento local.
    """
    try:
        abs_path = get_absolute_path(file_path_or_name)
        if os.path.exists(abs_path):
            os.remove(abs_path)
            logger.info(f"Archivo eliminado del almacenamiento local: '{abs_path}'")
            return True
        return False
    except Exception as exc:
        logger.error(f"Error al eliminar archivo '{file_path_or_name}': {exc}")
        return False
