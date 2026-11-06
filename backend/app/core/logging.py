import logging
import sys
from typing import Any, Dict, Optional

# Configurar logger de auditoría y seguridad para ContalA
logger = logging.getLogger("contala.security")

if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    formatter = logging.Formatter(
        "[%(asctime)s] [SECURITY-%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def mask_sensitive_string(val: Optional[str], visible_chars: int = 4) -> str:
    """Enmascara cadenas sensibles (ej: CUITs, números de cuenta, tokens)."""
    if not val:
        return ""
    s = str(val).strip()
    if len(s) <= visible_chars:
        return "*" * len(s)
    return s[:visible_chars] + "*" * (len(s) - visible_chars)


def log_security_event(
    event_type: str,
    detail: str,
    level: str = "INFO",
    client_ip: Optional[str] = None,
    user_email: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> None:
    """Registra eventos de seguridad estructurados de forma segura sin revelar secretos."""
    parts = [f"EVENT={event_type}"]
    if client_ip:
        parts.append(f"IP={client_ip}")
    if user_email:
        parts.append(f"USER={user_email}")
    parts.append(f"DETAIL={detail}")

    if context:
        safe_ctx = {}
        for k, v in context.items():
            if "password" in k.lower() or "secret" in k.lower() or "token" in k.lower() or "key" in k.lower():
                safe_ctx[k] = "[REDACTED]"
            else:
                safe_ctx[k] = v
        parts.append(f"CONTEXT={safe_ctx}")

    msg = " | ".join(parts)
    log_func = getattr(logger, level.lower(), logger.info)
    log_func(msg)

