import hmac
import logging

from fastapi import Header, HTTPException, status

from config.settings import settings

logger = logging.getLogger(__name__)


def verify_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
):
    """
    Guard for the /chat endpoint.

    Header: `X-API-Key: <shared secret>`
    Returns 401 if the header is missing or doesn't match `AI_SERVICE_KEY`.
    Uses `hmac.compare_digest` to defeat timing attacks.
    """
    expected = settings.AI_SERVICE_KEY

    # Fail closed if the operator forgot to set AI_SERVICE_KEY in production.
    if not expected:
        logger.error("AI_SERVICE_KEY is unset — refusing all /chat requests.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key not configured on server.",
        )

    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        logger.warning("Rejected /chat request: invalid or missing X-API-Key.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    return True