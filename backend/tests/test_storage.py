import os
import pytest

from app.core.config import settings
from app.services.storage import (
    delete_file_locally,
    get_absolute_path,
    get_storage_dir,
    read_file_bytes,
    save_file_locally,
)


def test_storage_dir_configuration():
    """Verifica que STORAGE_DIR esté definido y el directorio exista o se cree."""
    assert hasattr(settings, "STORAGE_DIR")
    storage_dir = get_storage_dir()
    assert os.path.exists(storage_dir)
    assert os.path.isdir(storage_dir)


def test_save_and_read_file_locally():
    """Verifica el guardado y posterior lectura directa de comprobantes en disco."""
    test_bytes = b"%PDF-1.4 Mock local invoice bytes for testing"
    test_filename = "factura_test_1045.pdf"

    rel_path, abs_path = save_file_locally(test_bytes, test_filename, prefix="test")

    try:
        # Verificar rutas devueltas
        assert rel_path.startswith("uploads/test_")
        assert rel_path.endswith(".pdf")
        assert os.path.exists(abs_path)

        # Verificar contenido en disco
        read_bytes = read_file_bytes(rel_path)
        assert read_bytes == test_bytes

        # Verificar lectura usando ruta absoluta
        assert read_file_bytes(abs_path) == test_bytes
    finally:
        # Limpieza del archivo de prueba
        delete_file_locally(rel_path)
        assert not os.path.exists(abs_path)


def test_get_absolute_path_resolution():
    """Verifica la resolución correcta de rutas absolutas y relativas con prefijo uploads/."""
    storage_dir = get_storage_dir()

    # 1. Con prefijo uploads/
    p1 = get_absolute_path("uploads/comprobante_123.pdf")
    assert p1 == os.path.join(storage_dir, "comprobante_123.pdf")

    # 2. Nombre simple de archivo
    p2 = get_absolute_path("comprobante_123.pdf")
    assert p2 == os.path.join(storage_dir, "comprobante_123.pdf")


def test_read_non_existent_file_raises_error():
    """Verifica que leer un archivo inexistente lance FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        read_file_bytes("uploads/archivo_inexistente_99999.pdf")


def test_delete_non_existent_file_returns_false():
    """Verifica que eliminar un archivo que no existe retorne False sin excepciones."""
    assert delete_file_locally("uploads/archivo_inexistente_99999.pdf") is False
