"""The one trustworthy way to learn a client's IP address.

`SECURITY.md` §3.6a: the address a request *appears* to come from depends on the
infrastructure in front of the service. Behind the documented edge — Cloudflare,
which fronts every Render web service — the socket peer is a Render load balancer,
so keying a rate limit on it puts every caller in one bucket. The real client IP
is in `CF-Connecting-IP`, a header Cloudflare writes on the request it forwards to
the origin and overwrites if a caller supplied one of their own.

Trust is therefore explicit and narrow:

* With `TRUSTED_PROXY_HEADER` unset (the default, and the only correct setting for
  local development and tests), only the socket peer is used.
* With it set to `cf-connecting-ip`, that header is read and validated as an IP
  address; anything malformed falls back to the peer.

`X-Forwarded-For` is never read. Cloudflare *appends* to it rather than replacing
it, so its leftmost entry is whatever the caller sent, and trusting it would let
anyone mint a fresh rate-limit bucket per request.
"""

from __future__ import annotations

import ipaddress

from fastapi import Request

from app.config import get_settings

# `SECURITY.md` §3.6a: an ASGI scope without a client (a raw socket call, or a
# test transport) yields no address. Falling back to a fixed sentinel keeps the
# rate limiter's dictionary keyed by a bounded set of values instead of raising
# inside request handling; such requests share one bucket.
UNKNOWN_CLIENT_IP = "unknown"


def _parse_forwarded_ip(raw: str | None) -> str | None:
    """Return a canonical IP from a single header value, or `None` if unusable.

    The trusted header carries exactly one address, but accept a leading element
    of a comma list defensively. Bracketed IPv6 (`[2001:db8::1]`) and `IPv4:port`
    forms are unwrapped, because a proxy that adds a port should not be able to
    turn a valid client into a shared `unknown` bucket.
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


def client_ip(request: Request) -> str:
    """Return the client's IP for rate-limit bucketing.

    Reads the configured trusted header first when the deployment has declared
    one, and otherwise the ASGI peer. A missing or malformed trusted header falls
    through to the peer rather than raising, so a proxy misconfiguration degrades
    to the previous behaviour instead of breaking the request.
    """
    trusted_header = get_settings().trusted_proxy_header
    if trusted_header is not None:
        forwarded = _parse_forwarded_ip(request.headers.get(trusted_header))
        if forwarded is not None:
            return forwarded

    client = request.client
    if client is None or not client.host:
        return UNKNOWN_CLIENT_IP
    return client.host
