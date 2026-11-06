import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

celery_app = Celery(
    "contala_tasks",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="America/Argentina/Buenos_Aires",
    enable_utc=True,
)

@celery_app.task(name="test_celery_task")
def test_celery_task():
    return "Celery y Redis están funcionando correctamente en ContalA."


@celery_app.task(name="process_invoice_from_storage")
def process_invoice_from_storage(file_path_or_name: str) -> dict:
    """
    Lee directamente el archivo del comprobante desde el volumen local compartido (/app/uploads)
    sin clientes externos ni descargas HTTP, ejecutando el pipeline de visión y extracción.
    """
    import asyncio
    from app.services.storage import read_file_bytes, get_absolute_path
    from app.services.extractor import extract_invoice_with_vlm
    from app.services.image_processor import preprocess_image

    # 1. Leer directamente los bytes del comprobante desde el volumen local
    file_bytes = read_file_bytes(file_path_or_name)
    abs_path = get_absolute_path(file_path_or_name)

    # 2. Preprocesar imagen
    optimized_bytes = preprocess_image(file_bytes)

    # 3. Ejecutar inferencia VLM
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    if loop.is_running():
        extracted_data = asyncio.run(extract_invoice_with_vlm(optimized_bytes))
    else:
        extracted_data = loop.run_until_complete(extract_invoice_with_vlm(optimized_bytes))

    return {
        "status": "success",
        "file_path": file_path_or_name,
        "absolute_path": abs_path,
        "extracted_data": extracted_data,
    }