"""Resolve the real client IP for chat rate-limit bucketing.

The ai_service is reached through Vercel's edge proxy — `middleware.js` rewrites
`/api/chat/*` here — and then Render's edge, so `request.client.host` is an
infrastructure address shared by every caller. Keying a rate limit on it puts
the whole internet in one bucket, which is both useless as abuse control and a
availability hazard (one caller can exhaust the limit for everyone).

The only client IP this service trusts is one Vercel's edge stamped into
`TRUSTED_CLIENT_IP_HEADER` and signed with the shared service secret. The edge
overwrites any client-supplied copy of that header, and a direct caller to the
Render host cannot forge the signature without the secret. When the header is
absent, unsigned, malformed, or its signature does not verify, the socket peer is
used — a misconfiguration degrades to the previous behaviour rather than failing
open. `X-Forwarded-For` is never read: Cloudflare appends to it rather than
replacing it, so its leftmost entry is whatever the caller sent.

Mirrors `backend/app/security/client_ip.py`, which trusts `CF-Connecting-IP` for
the same reason on the direct Cloudflare→Render path.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging

from fastapi import Request

from config.settings import settings

logger = logging.getLogger(__name__)

UNKNOWN_CLIENT_IP = "unknown"

# `middleware.js` sets the client IP in this header (the configured
# `TRUSTED_CLIENT_IP_HEADER`) and its HMAC-SHA256 hex digest in this one.
CLIENT_IP_HEADER = "x-vercel-client-ip"
SIGNATURE_HEADER = "x-vercel-client-ip-signature"

# Only headers the Vercel edge is known to set and overwrite are eligible.
# Anything else — especially `x-forwarded-for` — is refused so a misconfigured
# deployment cannot be talked into trusting a caller-controlled value.
_ALLOWED_TRUSTED_HEADERS = frozenset({CLIENT_IP_HEADER})

_warned_about_header = False


def _parse_ip(raw: str | None) -> str | None:
    """Return a canonical IP from a single header value, or `None` if unusable.

    The trusted header carries exactly one address, but accept a leading element
    of a comma list defensively. Bracketed IPv6 (`[2001:db8::1]`) and
    `IPv4:port` forms are unwrapped, because a proxy that adds a port should not
    be able to turn a valid client into a shared `unknown` bucket.
    """
    if raw is None:
        return None
    candidate = raw.split(",", 1)[0].strip()
    if not candidate:
        return None
    if candidate.startswith("["):
        end = candidate.find("]")
        if end == -1:
            return None
        candidate = candidate[1:end]
    elif candidate.count(":") == 1 and "." in candidate:
        candidate = candidate.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _sign(secret: str, value: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def client_ip(request: Request) -> str:
    """Return the client's IP for rate-limit bucketing.

    Trusts the configured, signed edge header when it verifies; otherwise falls
    back to the ASGI socket peer.
    """
    global _warned_about_header

    header = (settings.TRUSTED_CLIENT_IP_HEADER or "").strip().lower()
    secret = settings.CLIENT_IP_SIGNING_SECRET or ""

    if header and secret:
        if header not in _ALLOWED_TRUSTED_HEADERS:
            if not _warned_about_header:
                logger.warning(
                    "Ignoring TRUSTED_CLIENT_IP_HEADER=%r: only %s is trusted",
                    header,
                    ", ".join(sorted(_ALLOWED_TRUSTED_HEADERS)),
                )
                _warned_about_header = True
        else:
            raw = request.headers.get(header)
            signature = request.headers.get(SIGNATURE_HEADER)
            if raw is not None and signature and hmac.compare_digest(signature, _sign(secret, raw)):
                parsed = _parse_ip(raw)
                if parsed is not None:
                    return parsed

    peer = request.client
    if peer is None or not peer.host:
        return UNKNOWN_CLIENT_IP
    return peer.host
