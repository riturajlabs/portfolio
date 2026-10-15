"""`core/security`: rejection logging must not echo caller-controlled headers.

Finding F-3: the warning for a rejected `X-API-Key` logged the raw
`x-forwarded-for` header, which any caller can set. It now logs the trusted
resolver's answer — the signed edge IP when the edge supplied one, otherwise the
socket peer — so a rejected caller can no longer write arbitrary text into the
logs and a shared load-balancer peer is never mistaken for the client.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from config.settings import settings
from core.client_ip import CLIENT_IP_HEADER, SIGNATURE_HEADER
from core.security import verify_api_key

SECRET = "test-shared-secret"
PEER = "203.0.113.7"
SPOOFED = "198.51.100.9"


def _request(headers: dict | None = None, peer: tuple | None = (PEER, 44321)) -> Request:
    raw = [
        (name.lower().encode("latin-1"), value.encode("latin-1"))
        for name, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/chat",
            "raw_path": b"/chat",
            "query_string": b"",
            "headers": raw,
            "client": peer,
        }
    )


def _sign(value: str) -> str:
    return hmac.new(SECRET.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(settings, "AI_SERVICE_KEY", SECRET)
    monkeypatch.setenv("ENV", "production")


def test_rejection_logs_the_peer_not_the_forwarded_header(production, caplog) -> None:
    request = _request({"x-forwarded-for": SPOOFED})

    with caplog.at_level("WARNING"), pytest.raises(HTTPException) as excinfo:
        verify_api_key(request, "wrong-key")

    assert excinfo.value.status_code == 401
    assert PEER in caplog.text
    assert SPOOFED not in caplog.text


def test_rejection_logs_the_signed_edge_ip_when_the_header_is_trusted(
    production, monkeypatch, caplog
) -> None:
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", CLIENT_IP_HEADER)
    monkeypatch.setattr(settings, "CLIENT_IP_SIGNING_SECRET", SECRET)

    verified = "198.51.100.5"
    request = _request(
        {
            CLIENT_IP_HEADER: verified,
            SIGNATURE_HEADER: _sign(verified),
            "x-forwarded-for": SPOOFED,
        }
    )

    with caplog.at_level("WARNING"), pytest.raises(HTTPException):
        verify_api_key(request, "wrong-key")

    assert verified in caplog.text
    assert SPOOFED not in caplog.text
    assert PEER not in caplog.text


def test_a_rejected_request_still_says_why(production, caplog) -> None:
    """The fix must not hide the security-relevant failure from operators."""
    request = _request({"x-forwarded-for": SPOOFED})

    with caplog.at_level("WARNING"), pytest.raises(HTTPException):
        verify_api_key(request, "wrong-key")

    assert "X-API-Key" in caplog.text
    assert "/chat" in caplog.text


def test_a_valid_key_is_accepted_without_a_rejection_log(production, caplog) -> None:
    request = _request({"x-forwarded-for": SPOOFED})

    with caplog.at_level("WARNING"):
        assert verify_api_key(request, SECRET) is True

    assert "Rejected" not in caplog.text
