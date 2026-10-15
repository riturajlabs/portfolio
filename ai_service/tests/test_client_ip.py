"""core/client_ip: trusted vs untrusted peers, spoofed/malformed headers, and
distinct rate-limit buckets.

Context: docs/SECURITY.md and docs/DEPLOYMENT.md §3.2. The AI service sits
behind Vercel's edge proxy, so the socket peer is shared by every caller; only a
signature the edge produced with the shared secret is trusted.
"""

from __future__ import annotations

import hashlib
import hmac

import pytest
from starlette.requests import Request

from config.settings import settings
from core.client_ip import CLIENT_IP_HEADER, SIGNATURE_HEADER, client_ip
from core.rate_limit import _build_key

SECRET = "test-shared-secret"
PEER = "203.0.113.7"


def _sign(secret: str, value: str) -> str:
    return hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def _signed(ip: str, secret: str = SECRET) -> dict:
    return {CLIENT_IP_HEADER: ip, SIGNATURE_HEADER: _sign(secret, ip)}


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


@pytest.fixture
def trusted(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", CLIENT_IP_HEADER)
    monkeypatch.setattr(settings, "CLIENT_IP_SIGNING_SECRET", SECRET)
    return SECRET


def test_disabled_by_default_uses_socket_peer(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "")
    monkeypatch.setattr(settings, "CLIENT_IP_SIGNING_SECRET", SECRET)

    assert client_ip(_request(_signed("198.51.100.5"))) == PEER


def test_valid_signature_is_trusted(trusted):
    assert client_ip(_request(_signed("198.51.100.5"))) == "198.51.100.5"


def test_missing_signature_falls_back_to_peer(trusted):
    assert client_ip(_request({CLIENT_IP_HEADER: "198.51.100.5"})) == PEER


def test_forged_signature_falls_back_to_peer(trusted):
    assert client_ip(_request(_signed("198.51.100.5", secret="wrong"))) == PEER


def test_signature_for_a_different_ip_is_rejected(trusted):
    headers = {
        CLIENT_IP_HEADER: "198.51.100.5",
        SIGNATURE_HEADER: _sign(SECRET, "198.51.100.9"),
    }
    assert client_ip(_request(headers)) == PEER


def test_malformed_ip_with_valid_signature_falls_back_to_peer(trusted):
    assert client_ip(_request(_signed("not-an-ip"))) == PEER


def test_unvetted_header_name_is_refused(monkeypatch):
    # An operator pointing TRUSTED_CLIENT_IP_HEADER at a caller-controlled
    # header (e.g. x-forwarded-for) must not enable trust for it.
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for")
    monkeypatch.setattr(settings, "CLIENT_IP_SIGNING_SECRET", SECRET)

    assert client_ip(_request({"x-forwarded-for": "198.51.100.5"})) == PEER


def test_ipv6_and_bracketed_values_are_canonicalized(trusted):
    assert client_ip(_request(_signed("2001:db8::1"))) == "2001:db8::1"
    assert client_ip(_request(_signed("[2001:db8::1]"))) == "2001:db8::1"


def test_ipv4_with_port_is_unwrapped(trusted):
    assert client_ip(_request(_signed("198.51.100.5:1234"))) == "198.51.100.5"


def test_missing_peer_falls_back_to_unknown(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_CLIENT_IP_HEADER", "")
    monkeypatch.setattr(settings, "CLIENT_IP_SIGNING_SECRET", SECRET)

    assert client_ip(_request(peer=None)) == "unknown"


def test_rate_limit_buckets_are_per_signed_client(trusted):
    same_a = _request(_signed("198.51.100.1"))
    same_b = _request(_signed("198.51.100.1"))
    other = _request(_signed("198.51.100.2"))

    assert _build_key(same_a) == _build_key(same_b) == "198.51.100.1"
    assert _build_key(same_a) != _build_key(other)


def test_unsigned_requests_share_the_peer_bucket(trusted):
    untouched = _request({}, peer=("10.0.0.1", 1))
    spoofed = _request({CLIENT_IP_HEADER: "198.51.100.1"}, peer=("10.0.0.1", 2))

    assert _build_key(untouched) == _build_key(spoofed) == "10.0.0.1"
