"""`app.services.contact.send_via_resend` — the outbound Resend call.

The route suite (`test_contact_api.py`) monkeypatches `send_via_resend`, so the
actual HTTP request/response handling was previously untested. These tests drive
it through an `httpx.MockTransport`, which exercises the real client, request
construction and status-code handling without any network or API key.

They also lock in the privacy rule from the production incident: Resend error
bodies quote the account's own address, and that address must never appear in a
log record.
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest

from app.services import contact as contact_service

RESEND_URL = "https://api.resend.com/emails"


class _Settings:
    """A minimal stand-in for the application settings `send_via_resend` reads."""

    RESEND_API_KEY = "re_test_key"
    RESEND_API_URL = RESEND_URL
    CONTACT_FROM_EMAIL = "onboarding@resend.dev"
    CONTACT_TO_EMAIL = "inbox@example.com"


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(contact_service, "get_settings", lambda: _Settings())


def _capture(handler):
    """Wrap a handler so the last `httpx.Request` it saw is recorded."""
    captured: dict[str, httpx.Request] = {}

    def _handle(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        return handler(request)

    return _handle, captured


async def test_request_shape_matches_resend_contract() -> None:
    handle, captured = _capture(lambda _request: httpx.Response(200, json={"id": "abc123"}))
    transport = httpx.MockTransport(handle)

    result = await contact_service.send_via_resend(
        name="Ada Lovelace",
        email="ada@example.com",
        message="Hello there, this is a test.",
        transport=transport,
    )

    assert result == "abc123"
    request = captured["request"]
    assert request.method == "POST"
    assert str(request.url) == RESEND_URL
    assert request.headers["Authorization"] == "Bearer re_test_key"

    payload = json.loads(request.content)
    assert payload["from"] == "onboarding@resend.dev"
    assert payload["to"] == ["inbox@example.com"]
    # The visitor replies to the visitor, not to the sandbox sender.
    assert payload["reply_to"] == ["ada@example.com"]
    assert payload["subject"] == "Portfolio contact: Ada Lovelace"
    assert "Ada Lovelace" in payload["text"]
    assert "ada@example.com" in payload["text"]


async def test_success_without_json_id_returns_empty_string() -> None:
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, content=b"ok"))

    result = await contact_service.send_via_resend(
        name="Ada", email="ada@example.com", message="A long enough message.", transport=transport
    )

    assert result == ""


async def test_error_status_raises_http_status_error() -> None:
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(
            422, json={"name": "validation_error", "statusCode": 422, "message": "bad from"}
        )
    )

    with pytest.raises(httpx.HTTPStatusError) as excinfo:
        await contact_service.send_via_resend(
            name="Ada", email="ada@example.com", message="A long enough message.", transport=transport
        )

    assert excinfo.value.response.status_code == 422


async def test_sandbox_rejection_is_logged_without_personal_data(caplog) -> None:
    """The exact production failure: a 403 that quotes the account owner's address.

    The log must stay useful (status + provider error name) but must not leak the
    personal address Resend embedded in its message.
    """
    owner_address = "owner.person@example.com"
    body = {
        "message": (
            "You can only send testing emails to your own email address "
            f"({owner_address}). To send emails to other recipients, please verify "
            "a domain at resend.com/domains."
        ),
        "name": "validation_error",
        "statusCode": 403,
    }
    transport = httpx.MockTransport(lambda _request: httpx.Response(403, json=body))

    with caplog.at_level(logging.ERROR, logger="app.contact"):
        with pytest.raises(httpx.HTTPStatusError):
            await contact_service.send_via_resend(
                name="Ada", email="ada@example.com", message="A long enough message.", transport=transport
            )

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "403" in log_text
    assert "validation_error" in log_text
    assert owner_address not in log_text
    assert "<email>" in log_text


async def test_unparseable_error_body_is_not_dumped(caplog) -> None:
    body = f"<html>error for {_Settings.CONTACT_TO_EMAIL}</html>"
    transport = httpx.MockTransport(
        lambda _request: httpx.Response(500, content=body.encode(), headers={"content-type": "text/html"})
    )

    with caplog.at_level(logging.ERROR, logger="app.contact"):
        with pytest.raises(httpx.HTTPStatusError):
            await contact_service.send_via_resend(
                name="Ada", email="ada@example.com", message="A long enough message.", transport=transport
            )

    log_text = "\n".join(record.getMessage() for record in caplog.records)
    assert "unparseable error body" in log_text
    assert _Settings.CONTACT_TO_EMAIL not in log_text
    assert "<html>" not in log_text


async def test_missing_key_raises_runtime_error(monkeypatch) -> None:
    class _Unconfigured(_Settings):
        RESEND_API_KEY = ""

    monkeypatch.setattr(contact_service, "get_settings", lambda: _Unconfigured())

    with pytest.raises(RuntimeError):
        await contact_service.send_via_resend(
            name="Ada", email="ada@example.com", message="A long enough message."
        )
