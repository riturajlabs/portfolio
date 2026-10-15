"""Phase 4 security primitives.

Password hashing, opaque session tokens, the derived CSRF token and the one
trustworthy way to learn a client IP. Each piece lives in its own module so the
reasoning behind a cryptographic choice stays next to the code that makes it.

Nothing in this package touches the database or the HTTP layer; the service and
dependency layers do that.
"""

from __future__ import annotations

from app.security.client_ip import client_ip
from app.security.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.security.tokens import (
    CSRF_TOKEN_BYTES,
    SESSION_TOKEN_BYTES,
    csrf_token_for_session,
    generate_session_token,
    hash_session_token,
    is_valid_csrf_token,
)

__all__ = (
    "CSRF_TOKEN_BYTES",
    "DUMMY_PASSWORD_HASH",
    "SESSION_TOKEN_BYTES",
    "client_ip",
    "csrf_token_for_session",
    "generate_session_token",
    "hash_password",
    "hash_session_token",
    "is_valid_csrf_token",
    "needs_rehash",
    "verify_password",
)