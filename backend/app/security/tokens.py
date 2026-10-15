"""Opaque session tokens and the derived CSRF token.

`SECURITY.md` §3.2 fixes the whole scheme in three rules, implemented literally
here:

* the cookie value is a 256-bit random token from the OS CSPRNG;
* only its SHA-256 hash is stored, so a database leak does not yield usable
  cookies;
* the CSRF token is bound to that session and cannot be replayed elsewhere.

Nothing is reversible or signed. There is no JWT and no signature to verify,
because a token that can be decoded is a token an attacker can tamper with and
still present, and the single-admin case gains nothing from statelessness.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

# 32 bytes = 256 bits, the entropy `SECURITY.md` §3.2 requires. `token_urlsafe`
# encodes them with base64url, so the value is cookie-safe without escaping.
SESSION_TOKEN_BYTES = 32

# The CSRF token is the full width of the SHA-256 digest it is derived from, so it
# carries the same 256 bits as the session token itself.
CSRF_TOKEN_BYTES = 32

# Domain separation. The two hashes must never be interchangeable, so the CSRF
# digest is computed over a label the plain session hash does not use. If they
# shared an input, `csrf_token` would equal `admin_session.token_hash` and the
# CSRF token would become a database credential that the audit trail would happily
# log.
_CSRF_LABEL = b"portfolio.admin.csrf.v1\x00"


def generate_session_token() -> str:
    """Return a fresh 256-bit opaque session token.

    `secrets.token_bytes` draws from the operating system's CSPRNG. `secrets` is
    used rather than `random`: a predictable session token is an authentication
    bypass, and the difference between the two modules is the entire reason this
    is not a one-line helper.
    """
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    """Return the lowercase hex SHA-256 of `token` for `admin_session.token_hash`.

    A plain SHA-256, not bcrypt or Argon2. The input is 256 bits of CSPRNG
    output, so there is nothing to brute-force: an attacker who has the database
    still faces 2^256 candidates. Slow hashing would only add latency to every
    authenticated admin request. The column is a unique index, so the hash is
    also the lookup key.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_token_for_session(session_token: str) -> str:
    """Return the CSRF token bound to `session_token`.

    `DATABASE.md` §11 stores no CSRF column, and Phase 4 is not permitted to add
    one for a token that is derivable rather than secret in its own right. The
    value is therefore `SHA-256(label || session token)`, truncated to 128 bits
    and hex-encoded.

    Deriving it is what makes the double-submit check *bound* to the session
    rather than merely *paired* with it: a token minted for one session cannot
    satisfy the check for another, so a token captured from one browser is
    useless against another admin cookie. Because it is a pure function of a
    secret value the browser already presents, nothing new has to be persisted or
    rotated, and a revoked session cannot leave a usable CSRF token behind.
    """
    derived = hmac.new(
        _CSRF_LABEL,
        session_token.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    assert len(derived) == CSRF_TOKEN_BYTES, "SHA-256 output width is fixed"
    return derived.hex()


def is_valid_csrf_token(session_token: str, candidate: str | None) -> bool:
    """Return whether `candidate` is the correct CSRF token for `session_token`.

    `hmac.compare_digest` rather than `==`, so a mismatching token's position
    cannot be learned from response timing.
    """
    if not candidate:
        return False
    return hmac.compare_digest(csrf_token_for_session(session_token), candidate)