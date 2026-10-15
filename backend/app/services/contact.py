"""Contact message persistence and delivery via Resend.

`POST /api/contact` is the contact form's write path. This module owns the two
things the route composes: storing a `contact_message` row, and delivering the
same contents by email.

The ordering is fixed by `DATABASE.md` §5.6 and `API.md` §5.2: **store first,
then send**. The row is committed as `status='unread'`,
`delivery_status='pending'` before Resend is called, so a Resend outage loses
nothing — the message exists, and the route marks it `failed` instead of letting
it disappear with the request.

Resend speaks HTTPS rather than SMTP because Render's free tier blocks outbound
SMTP; the same endpoint `ai_service` used is reused here so the outbound contract
does not change.
"""

from __future__ import annotations

import logging

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import ContactMessage

logger = logging.getLogger("app.contact")

# Characters that can terminate an SMTP header line. A contact `name` or a
# subject must never contain one: even though Resend's HTTPS API takes JSON (not
# raw headers), a value that later reaches an `email.message` header writer or a
# log line must not be able to forge one. The request schema rejects these too;
# this is the last boundary before the outbound call, so it defends even a direct
# caller of `send_via_resend`.
_HEADER_UNSAFE = str.maketrans({"\r": " ", "\n": " ", "\x00": " "})


def _single_line(value: str) -> str:
    """Collapse CR/LF/NUL to spaces so a value cannot inject a header line."""
    return value.translate(_HEADER_UNSAFE)


def derive_subject(name: str) -> str:
    """The subject stored when the form supplies none.

    The frontend that exists today sends only name/email/message (`API.md` §2.3),
    but the database requires a subject (3–150 chars). Deriving it server-side
    keeps an unmodified form working without inventing a page-level field; the
    text mirrors what `ai_service` put on the outgoing email.
    """
    return f"Portfolio contact: {name}"


async def create_message(
    db: AsyncSession,
    *,
    name: str,
    email: str,
    subject: str,
    message: str,
    source_ip_hash: str | None,
    user_agent: str | None,
) -> ContactMessage:
    """Insert the row as `unread`/`pending` and commit it before any send attempt."""
    record = ContactMessage(
        name=name,
        email=email,
        subject=subject,
        message=message,
        source_ip_hash=source_ip_hash,
        user_agent=user_agent,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


async def mark_delivery(db: AsyncSession, record: ContactMessage, delivery_status: str) -> None:
    """Record the Resend outcome. `failed` is a real state, not an error: the
    row must survive a send outage so nothing is lost (`DATABASE.md` §5.6)."""
    record.delivery_status = delivery_status
    await db.commit()


async def send_via_resend(*, name: str, email: str, message: str) -> str:
    """Deliver `name`/`email`/`message` through Resend's HTTPS API and return the message id.

    Asynchronous (`httpx.AsyncClient`): this runs inside the async request path,
    and the synchronous client would block the event loop for the duration of the
    outbound call — stalling every other request on the same worker.

    Raises:
        RuntimeError: Resend is not configured (`RESEND_API_KEY` unset).
        httpx.HTTPError: The API was unreachable or answered with an error.
    """
    settings = get_settings()
    if not settings.RESEND_API_KEY:
        raise RuntimeError(
            "Resend is not configured on the server (RESEND_API_KEY missing)."
        )

    safe_name = _single_line(name)
    # `email` is an `EmailStr` (no CR/LF possible), but run it through the same
    # transform so no header path can be forged if that validation ever loosens.
    safe_email = _single_line(email)

    payload = {
        "from": settings.CONTACT_FROM_EMAIL,
        "to": [settings.CONTACT_TO_EMAIL],
        "reply_to": [safe_email],
        "subject": f"Portfolio contact: {safe_name}",
        "text": (
            f"Name:    {safe_name}\n"
            f"Email:   {safe_email}\n"
            f"Message:\n\n{message}\n"
        ),
    }
    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "riturajlabs-portfolio/1.0",
    }

    # 10 s: Resend is normally sub-second, and the route stores the row first, so
    # a long hang would otherwise occupy a server worker for nothing.
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            settings.RESEND_API_URL, json=payload, headers=headers
        )

    if response.status_code >= 400:
        logger.error("Resend API error %s: %s", response.status_code, response.text[:500])
        raise httpx.HTTPStatusError(
            f"Resend returned {response.status_code}",
            request=response.request,
            response=response,
        )

    try:
        return response.json().get("id", "")
    except Exception:  # pragma: no cover - a 2xx without a JSON id is a Resend change
        return ""