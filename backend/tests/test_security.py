from datetime import timedelta
import pytest
from app.core.security import (
    create_access_token,
    decode_access_token,
    get_password_hash,
    verify_password,
)


def test_password_hashing_and_verification():
    """Verifica que el hashing con bcrypt sea determinista en validación y seguro."""
    password = "SuperPasswordSeguro2026!"
    hashed = get_password_hash(password)

    assert hashed != password
    assert verify_password(password, hashed) is True
    assert verify_password("PasswordErroneo123", hashed) is False


def test_password_verification_empty_or_none():
    """Verifica que contraseñas vacías o None sean rechazadas de inmediato."""
    assert verify_password("", "hash_falso") is False
    assert verify_password("password", "") is False
    assert verify_password(None, None) is False


def test_jwt_create_and_decode_valid_token():
    """Verifica la generación y decodificación de tokens JWT con claims de usuario."""
    payload = {
        "sub": "contador@oikonomias.app",
        "user_id": "usr-123456",
        "rol": "CONTADOR",
        "empresa_id": "emp-789",
    }
    token = create_access_token(data=payload, expires_delta=timedelta(minutes=30))

    assert isinstance(token, str)
    decoded = decode_access_token(token)

    assert decoded is not None
    assert decoded["sub"] == "contador@oikonomias.app"
    assert decoded["user_id"] == "usr-123456"
    assert decoded["rol"] == "CONTADOR"
    assert "exp" in decoded
    assert "iat" in decoded


def test_jwt_expired_token_returns_none():
    """Verifica que un token expirado devuelva None al intentar decodificarlo."""
    payload = {"sub": "contador@oikonomias.app"}
    # Token expirado hace 10 minutos
    token = create_access_token(data=payload, expires_delta=timedelta(minutes=-10))

    decoded = decode_access_token(token)
    assert decoded is None


def test_jwt_invalid_token_returns_none():
    """Verifica que un token malformado o adulterado devuelva None sin lanzar excepciones no controladas."""
    assert decode_access_token("token.invalido.falso") is None
    assert decode_access_token("") is None
    assert decode_access_token(None) is None

