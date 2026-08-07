import hmac
import logging
import os

from fastapi import (
    Header,
    HTTPException,
    Request,
    status
)

from config.settings import settings


logger = logging.getLogger(__name__)



def verify_api_key(
    request: Request,
    x_api_key: str | None = Header(
        default=None,
        alias="X-API-Key"
    ),
):

    """
    API key protection.

    Development:
        ENV=development
        -> authentication bypass

    Production:
        ENV=production
        -> X-API-Key required


    Production flow:

    Browser
       |
       |
    Vercel Middleware
       |
       |
    X-API-Key
       |
       |
    FastAPI
    """



    environment = os.getenv(
        "ENV",
        "production"
    )


    is_dev = (
        environment.lower()
        == "development"
    )



    expected_key = settings.AI_SERVICE_KEY



    #
    # Development mode
    #
    if is_dev:

        if not expected_key:

            logger.warning(
                "AI_SERVICE_KEY missing. "
                "Auth bypass enabled in development."
            )

        return True



    #
    # Production validation
    #
    if not expected_key:

        logger.error(
            "AI_SERVICE_KEY missing in production."
        )


        raise HTTPException(
            status_code=
            status.HTTP_503_SERVICE_UNAVAILABLE,

            detail=
            "API key not configured on server."
        )



    #
    # Validate incoming key
    #
    if (
        not x_api_key
        or not hmac.compare_digest(
            x_api_key,
            expected_key
        )
    ):


        client_ip = request.headers.get(
            "x-forwarded-for",
            request.client.host
            if request.client
            else "unknown"
        )


        logger.warning(
            "Rejected /chat request: "
            "invalid or missing X-API-Key "
            "(ip=%s, path=%s)",

            client_ip,
            request.url.path
        )


        raise HTTPException(

            status_code=
            status.HTTP_401_UNAUTHORIZED,

            detail=
            "Invalid or missing API key.",

            headers={
                "WWW-Authenticate":
                "ApiKey"
            }
        )



    return True