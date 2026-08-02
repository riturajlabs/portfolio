"""
Public contact form endpoint.

Receives a name/email/message triple from the public contact form on the
portfolio frontend (POST /api/contact), validates it server-side, and
relays it to Ritu's inbox via Resend's HTTPS API.

Why HTTPS not SMTP?
  Render's free tier blocks outbound SMTP (port 587) — the OS raises
  `OSError: [Errno 101] Network is unreachable` before we can even
  authenticate. Resend's HTTPS API works reliably on Render.

Why not just use the frontend with EmailJS?
  - Leaked the public key into the JS bundle.
  - Exposed quota to abuse.
  - Backend lets us rate-limit, log, and swap providers transparently.

Authentication:
  Public endpoint (no X-API-Key). Bots are deterred via:
    - Honeypot field on the frontend.
    - Server-side length/regex validation.
    - Per-IP rate limiting (slowapi, 5/min).
"""
import logging
import os

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["contact"])


# --- Request / Response schemas ----------------------------------------
class ContactRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    message: str = Field(min_length=10, max_length=2000)


class ContactResponse(BaseModel):
    success: bool
    message: str


# --- Resend configuration ----------------------------------------------
# All values come from environment variables so secrets stay out of the
# repo. The .env.example file documents the required keys.
#
# To set up Resend:
#   1. Sign up at https://resend.com (free, 100 emails/day).
#   2. Verify the sending domain (or use the sandbox sender
#      `onboarding@resend.dev` for testing).
#   3. Create an API key at https://resend.com/api-keys.
#   4. Set RESEND_API_KEY and CONTACT_FROM_EMAIL in Render env vars.
_RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
_FROM_EMAIL = os.getenv("CONTACT_FROM_EMAIL", "onboarding@resend.dev")
_TO_EMAIL = os.getenv("CONTACT_TO_EMAIL", "riturajlabs@outlook.com")
_RESEND_URL = "https://api.resend.com/emails"


def _send_via_resend(req: ContactRequest) -> str:
    """
    POST the email via Resend's HTTPS API. Returns the Resend message id
    on success. Raises RuntimeError on misconfiguration or httpx errors
    on transient failures (caller maps to HTTPException).
    """
    if not _RESEND_API_KEY:
        raise RuntimeError(
            "Resend is not configured on the server "
            "(RESEND_API_KEY missing)."
        )

    payload = {
        "from": _FROM_EMAIL,
        "to": [_TO_EMAIL],
        "reply_to": [req.email],
        "subject": f"Portfolio contact: {req.name}",
        "text": (
            f"Name:    {req.name}\n"
            f"Email:   {req.email}\n"
            f"Message:\n\n{req.message}\n"
        ),
    }
    headers = {
        "Authorization": f"Bearer {_RESEND_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "riturajlabs-portfolio/1.0",
    }

    # Short timeout — Resend is normally <1s, but Render free tier
    # cold-starts can stall on outbound HTTPS too. 10s is enough.
    resp = httpx.post(_RESEND_URL, json=payload, headers=headers, timeout=10.0)

    if resp.status_code >= 400:
        # Log the body for debugging, but raise without it so the caller
        # can decide the user-facing message.
        logger.error(
            "Resend API error %s: %s", resp.status_code, resp.text[:500]
        )
        raise httpx.HTTPStatusError(
            f"Resend returned {resp.status_code}",
            request=resp.request,
            response=resp,
        )

    # Resend returns {"id": "..."} on success.
    try:
        return resp.json().get("id", "")
    except Exception:
        return ""


# --- Route --------------------------------------------------------------
@router.post("/contact", response_model=ContactResponse)
@limiter.limit("5/minute")  # public endpoint — be conservative
async def send_contact(request: Request, payload: ContactRequest):
    """
    Receives a contact form submission and forwards it via Resend.

    Returns 200 on success. On failure, returns 502 with a generic
    message — we deliberately do NOT echo back the provider's error
    to avoid leaking server internals.
    """
    try:
        message_id = _send_via_resend(payload)
    except RuntimeError as cfg_err:
        # Configuration error — log loud, return generic 502.
        logger.error("Contact form misconfigured: %s", cfg_err)
        raise HTTPException(
            status_code=502,
            detail="Contact form is temporarily unavailable. Please email me directly.",
        ) from cfg_err
    except (httpx.HTTPError, httpx.HTTPStatusError) as send_err:
        logger.error("Contact form Resend send failed: %s", send_err)
        raise HTTPException(
            status_code=502,
            detail="Failed to send message. Please try again or email me directly.",
        ) from send_err
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("Contact form unexpected error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred. Please try again later.",
        ) from exc

    logger.info(
        "Contact form submission delivered from %s <%s> (resend_id=%s)",
        payload.name,
        payload.email,
        message_id,
    )
    return ContactResponse(
        success=True,
        message="Message sent successfully.",
    )