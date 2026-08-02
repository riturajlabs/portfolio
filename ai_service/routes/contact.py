"""
Public contact form endpoint.

Receives a name/email/message triple from the public contact form on the
portfolio frontend (POST /api/contact), validates it server-side, and
relays it to Ritu's inbox via SMTP.

Why this exists:
  - The frontend previously used EmailJS directly, which leaked the
    public key into the JS bundle and exposed quota to abuse.
  - Moving delivery server-side lets us rate-limit, log, and swap
    providers without touching the frontend.

Authentication:
  - Public endpoint (no X-API-Key). Bots are deterred via the honeypot
    field on the frontend + server-side length/regex validation +
    per-IP rate limiting (slowapi).
"""
import logging
import os
import smtplib
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["contact"])


# --- Request schema -----------------------------------------------------
class ContactRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    message: str = Field(min_length=10, max_length=2000)


# --- Response schema ----------------------------------------------------
class ContactResponse(BaseModel):
    success: bool
    message: str


# --- SMTP configuration -------------------------------------------------
# All values come from environment variables so secrets stay out of the
# repo. The .env.example file documents the required keys.
_SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
_SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
_SMTP_USER = os.getenv("SMTP_USER", "")
_SMTP_PASS = os.getenv("SMTP_PASS", "")          # Gmail App Password
_FROM_EMAIL = os.getenv("CONTACT_FROM_EMAIL", _SMTP_USER)
_TO_EMAIL = os.getenv("CONTACT_TO_EMAIL", "riturajlabs@outlook.com")


def _send_via_smtp(req: ContactRequest) -> None:
    """Build and send the email via SMTP. Raises on any failure."""
    if not (_SMTP_USER and _SMTP_PASS and _FROM_EMAIL):
        # Fail loud in logs but return a generic message to the client.
        raise RuntimeError(
            "SMTP is not configured on the server "
            "(SMTP_USER/SMTP_PASS/CONTACT_FROM_EMAIL missing)."
        )

    msg = EmailMessage()
    msg["Subject"] = f"Portfolio contact: {req.name}"
    msg["From"] = _FROM_EMAIL
    msg["To"] = _TO_EMAIL
    # Reply-To lets Ritu hit "Reply" in his mail client and have it go
    # straight back to the visitor, not to the SMTP relay user.
    msg["Reply-To"] = req.email

    msg.set_content(
        f"Name:    {req.name}\n"
        f"Email:   {req.email}\n"
        f"Message:\n\n{req.message}\n"
    )

    # Port 587 = STARTTLS (most common). Port 465 would use SMTP_SSL.
    with smtplib.SMTP(_SMTP_HOST, _SMTP_PORT, timeout=15) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.login(_SMTP_USER, _SMTP_PASS)
        smtp.send_message(msg)


# --- Route --------------------------------------------------------------
@router.post("/contact", response_model=ContactResponse)
@limiter.limit("5/minute")  # public endpoint — be conservative
async def send_contact(request: Request, payload: ContactRequest):
    """
    Receives a contact form submission and forwards it via SMTP.

    Returns 200 on success. On SMTP failure, returns 502 so the frontend
    can show a retry message — we deliberately do NOT echo back the
    provider's error to avoid leaking server internals.
    """
    try:
        _send_via_smtp(payload)
    except RuntimeError as cfg_err:
        # Configuration error — log loud, return generic 502.
        logger.error("Contact form SMTP misconfigured: %s", cfg_err)
        raise HTTPException(
            status_code=502,
            detail="Contact form is temporarily unavailable. Please email me directly.",
        ) from cfg_err
    except smtplib.SMTPException as smtp_err:
        logger.error("Contact form SMTP send failed: %s", smtp_err)
        raise HTTPException(
            status_code=502,
            detail="Failed to send message. Please try again or email me directly.",
        ) from smtp_err
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("Contact form unexpected error: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred. Please try again later.",
        ) from exc

    logger.info(
        "Contact form submission delivered from %s <%s>",
        payload.name,
        payload.email,
    )
    return ContactResponse(
        success=True,
        message="Message sent successfully.",
    )
