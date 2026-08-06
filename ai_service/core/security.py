import hmac
import logging
import os

from fastapi import Header, HTTPException, status, Request

from config.settings import settings

logger = logging.getLogger(__name__)


def verify_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
):
    """
    Guard for the /chat endpoint.

    Header: `X-API-Key: <shared secret>`

    In production this header is injected by the Vercel rewrite proxy
    (see `vercel.json` on the frontend repo), so the browser never sees
    the secret. The check is still important — it stops direct hits
    to the Render origin from anyone who knows the URL.

    Returns 401 if the header is missing or doesn't match `AI_SERVICE_KEY`.
    Uses `hmac.compare_digest` to defeat timing attacks.

    SECURITY:
    - Refuses to start serving traffic if `AI_SERVICE_KEY` is empty in
      production (fail-closed). On local dev (`ENV=development`) a missing
      key logs a warning so the dev server still boots.
    """
    expected = settings.AI_SERVICE_KEY
    is_dev = (os.getenv("ENV", "production") == "development")

    # Fail closed if the operator forgot to set AI_SERVICE_KEY in production.
    if not expected:
        if is_dev:
            logger.warning(
                "AI_SERVICE_KEY is unset — accepting /chat requests in dev only."
            )
            return True
        logger.error("AI_SERVICE_KEY is unset — refusing all /chat requests.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="API key not configured on server.",
        )

    # Constant-time comparison — defends against timing attacks.
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        # Log the request *id* and the remote IP, never the inbound key.
        # The IP comes from Render's proxy; we trust X-Forwarded-For only
        # because Render sets it correctly. If you ever put this behind a
        # different proxy, update accordingly.
        client_ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown")
        logger.warning(
            "Rejected /chat request: invalid or missing X-API-Key (ip=%s, path=%s)",
            client_ip,
            request.url.path,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    return True