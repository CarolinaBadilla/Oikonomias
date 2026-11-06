"""
Módulo de extracción de comprobantes fiscales con VLM.
Re-exporta la implementación completa de extractor.py para compatibilidad de nomenclatura.
"""
from app.services.extractor import (
    DEFAULT_PROVIDER_CONFIG,
    FALLBACK_MODELS,
    MODEL_NAME,
    OPENROUTER_URL,
    PRIMARY_MODEL,
    SYSTEM_PROMPT,
    extract_invoice_with_vlm,
    _clean_json_response,
    _parse_argentine_number,
    _parse_exchange_rate,
    _safe_float,
    _sanitize_extracted_data,
)

__all__ = [
    "DEFAULT_PROVIDER_CONFIG",
    "FALLBACK_MODELS",
    "MODEL_NAME",
    "OPENROUTER_URL",
    "PRIMARY_MODEL",
    "SYSTEM_PROMPT",
    "extract_invoice_with_vlm",
    "_clean_json_response",
    "_parse_argentine_number",
    "_parse_exchange_rate",
    "_safe_float",
    "_sanitize_extracted_data",
]
