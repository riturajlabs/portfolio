"""`POST /api/contact` — the Phase 8 public write path (`API.md` §2.3, §5.2).

The tests exercise the real database: rows are inserted through the same
dependency-overridden session the `client` fixture provides, and assertions read
them back through the same engine. The only thing monkeypatched is the outbound
Resend call, which cannot run in the test suite.

Notable behaviours under test:

* the row is stored **before** delivery, so a send failure leaves it with
  `delivery_status='failed'` and still answers `502`;
* `source_ip_hash` is a daily keyed hash, never the raw IP;
* `user_agent` is truncated to 300 characters by the application;
* a honeypot submission is an indistinguishable `200` and stores nothing;
* the subject is derived when the form omits it (the shipped form does).
"""

from __future__ import annotations

import httpx
import pytest
from sqlalchemy import text

from app.routes import contact as contact_routes
from app.services import contact as contact_service
from app.services.auth import client_ip_hash

VALID_PAYLOAD = {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "message": "This is a message body long enough to pass the check.",
}

SUCCESS_MESSAGE = "Message sent successfully."


@pytest.fixture(autouse=True)
def _reset_contact_limiter():
    """Clear the process-wide contact limiter around every test.

    The limiter is process memory, so the per-test `TRUNCATE` cannot reach it —
    and because every request in the suite presents the same peer address, one
    test's five submissions would exhaust the next test's window. The github
    suite needed nothing like this because its cache keys are separate.
    """
    contact_routes.limiter.reset()
    yield
    contact_routes.limiter.reset()


async def _deliver_ok(*, name: str, email: str, message: str) -> str:
    return "resend_id_123"


async def _read_messages(engine) -> list[dict]:
    async with engine.begin() as connection:
        rows = (
            await connection.execute(
                text(
                    "SELECT name, email, subject, message, status, delivery_status, "
                    "source_ip_hash, user_agent, created_at FROM contact_message "
                    "ORDER BY created_at"
                )
            )
        ).mappings().all()
        return [dict(row) for row in rows]


async def test_valid_submission_succeeds_and_stores(
    client, engine, monkeypatch
) -> None:
    monkeypatch.setattr(contact_service, "send_via_resend", _deliver_ok)

    response = await client.post(
        "/api/contact",
        json=VALID_PAYLOAD,
        headers={"User-Agent": "picobrowser/1.0"},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True, "message": SUCCESS_MESSAGE}

    [row] = await _read_messages(engine)
    assert row["name"] == "Ada Lovelace"
    assert row["email"] == "ada@example.com"
    # The form sends no subject; the server derives it (`API.md` §2.3).
    assert row["subject"] == "Portfolio contact: Ada Lovelace"
    assert row["message"] == VALID_PAYLOAD["message"]
    assert row["status"] == "unread"
    assert row["delivery_status"] == "sent"
    assert row["user_agent"] == "picobrowser/1.0"
    assert row["created_at"] is not None


async def test_subject_is_used_when_provided(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(contact_service, "send_via_resend", _deliver_ok)

    payload = {**VALID_PAYLOAD, "subject": "Question about a project"}
    response = await client.post("/api/contact", json=payload)

    assert response.status_code == 200
    [row] = await _read_messages(engine)
    assert row["subject"] == "Question about a project"


async def test_user_agent_truncated_to_300(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(contact_service, "send_via_resend", _deliver_ok)

    long_agent = "".join(chr(97 + i % 26) for i in range(500))
    response = await client.post(
        "/api/contact", json=VALID_PAYLOAD, headers={"User-Agent": long_agent}
    )

    assert response.status_code == 200
    [row] = await _read_messages(engine)
    assert len(row["user_agent"] or "") == 300


async def test_source_ip_hash_is_not_the_raw_ip(client, engine, monkeypatch) -> None:
    monkeypatch.setattr(contact_service, "send_via_resend", _deliver_ok)

    response = await client.post("/api/contact", json=VALID_PAYLOAD)

    assert response.status_code == 200
    [row] = await _read_messages(engine)
    # A missing peer hash (None) is accepted on some transports; a present hash
    # must be a 64-hex-digit daily keyed hash and never the address itself.
    if row["source_ip_hash"] is not None:
        assert all(c in "0123456789abcdef" for c in row["source_ip_hash"])
        assert len(row["source_ip_hash"]) == 64
        assert row["source_ip_hash"] != "127.0.0.1"
    assert row["source_ip_hash"] != "127.0.0.1"


def test_client_ip_hash_round_trips() -> None:
    """A keyed daily hash is stable within a day and differs from a bare hash."""
    value = client_ip_hash("203.0.113.7")
    assert value is not None
    assert value != "203.0.113.7"
    assert value != b"203.0.113.7".hex()


async def test_resend_failure_keeps_row_and_returns_502(client, engine, monkeypatch) -> None:
    async def _fail_send(*, name: str, email: str, message: str) -> str:
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(contact_service, "send_via_resend", _fail_send)

    response = await client.post("/api/contact", json=VALID_PAYLOAD)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Failed to send message. Please try again or email me directly."
    }
    [row] = await _read_messages(engine)
    assert row["delivery_status"] == "failed"
    assert row["status"] == "unread"


async def test_resend_timeout_keeps_row_and_returns_502(client, engine, monkeypatch) -> None:
    """A timeout is a subclass of `httpx.HTTPError`, so it takes the 502 path."""

    async def _timeout(*, name: str, email: str, message: str) -> str:
        raise httpx.ReadTimeout("too slow")

    monkeypatch.setattr(contact_service, "send_via_resend", _timeout)

    response = await client.post("/api/contact", json=VALID_PAYLOAD)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Failed to send message. Please try again or email me directly."
    }
    [row] = await _read_messages(engine)
    assert row["delivery_status"] == "failed"


async def test_misconfiguration_keeps_row_and_returns_502(client, engine, monkeypatch) -> None:
    async def _misconfigured(*, name: str, email: str, message: str) -> str:
        raise RuntimeError("Resend is not configured on the server (RESEND_API_KEY missing).")

    monkeypatch.setattr(contact_service, "send_via_resend", _misconfigured)

    response = await client.post("/api/contact", json=VALID_PAYLOAD)

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Contact form is temporarily unavailable. Please email me directly."
    }
    [row] = await _read_messages(engine)
    assert row["delivery_status"] == "failed"


async def test_honeypot_filled_returns_200_and_stores_nothing(client, engine) -> None:
    payload = {**VALID_PAYLOAD, "website": "http://spam.example.com/buy-now"}

    response = await client.post("/api/contact", json=payload)

    assert response.status_code == 200
    assert response.json() == {"success": True, "message": SUCCESS_MESSAGE}
    assert await _read_messages(engine) == []


async def test_unknown_field_is_rejected_422(client) -> None:
    response = await client.post(
        "/api/contact", json={**VALID_PAYLOAD, "messsage": "typo'd extra"}
    )
    assert response.status_code == 422


async def test_invalid_email_is_rejected_422(client) -> None:
    response = await client.post("/api/contact", json={**VALID_PAYLOAD, "email": "not-an-email"})
    assert response.status_code == 422


async def test_message_too_short_is_rejected_422(client) -> None:
    response = await client.post("/api/contact", json={**VALID_PAYLOAD, "message": "short"})
    assert response.status_code == 422


async def test_name_too_short_is_rejected_422(client) -> None:
    response = await client.post("/api/contact", json={**VALID_PAYLOAD, "name": "A"})
    assert response.status_code == 422


async def test_malformed_subject_is_rejected_422(client) -> None:
    response = await client.post(
        "/api/contact", json={**VALID_PAYLOAD, "subject": "ab"}
    )
    assert response.status_code == 422


async def test_crlf_in_name_is_rejected_422(client) -> None:
    """A name that could forge an email header is refused, not silently stripped."""
    response = await client.post(
        "/api/contact",
        json={**VALID_PAYLOAD, "name": "Ada\r\nBcc: attacker@example.com"},
    )
    assert response.status_code == 422


async def test_crlf_in_subject_is_rejected_422(client) -> None:
    response = await client.post(
        "/api/contact",
        json={**VALID_PAYLOAD, "subject": "Hello\r\nX-Injected: 1"},
    )
    assert response.status_code == 422


def test_single_line_collapses_header_breaks() -> None:
    """The service's last-boundary guard, independent of request validation."""
    assert contact_service._single_line("Ada\r\nBcc: x@y") == "Ada  Bcc: x@y"
    assert "\n" not in contact_service._single_line("a\nb")


async def test_rate_limit_returns_429_with_retry_after(client, monkeypatch) -> None:
    monkeypatch.setattr(contact_service, "send_via_resend", _deliver_ok)

    for _ in range(5):
        response = await client.post("/api/contact", json=VALID_PAYLOAD)
        assert response.status_code == 200

    limited = await client.post("/api/contact", json=VALID_PAYLOAD)

    assert limited.status_code == 429
    assert limited.json() == {"detail": "Too many requests. Please try again shortly."}
    assert "Retry-After" in limited.headers
    assert limited.headers["X-RateLimit-Limit"] == "5"


async def test_db_unreachable_returns_503(isolated_client) -> None:
    """A dependency outage is a 503 with a bare detail, never a stack trace.

    The `isolated_client` fixture points `get_session` at an unreachable
    database, exactly like the content-suite's dependency-outage test.
    """
    client, _dead_engine = isolated_client
    response = await client.post("/api/contact", json=VALID_PAYLOAD)
    assert response.status_code == 503
    assert response.json() == {
        "detail": "Contact is temporarily unavailable. Please try again later."
    }