"""Admin authentication request and response bodies.

Shapes are taken verbatim from `API.md` §6.1 and §4.2. Nothing here is
"extended for later phases": `AdminUserOut` exposes the four documented identity
fields and no database column that is not part of the contract, so
`password_hash`, `failed_attempts`, `locked_until` and `is_active` cannot leak
into a response through a future edit to this file.
"""

from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

# `SECURITY.md` §3.1 sets no password policy, and Phase 4 is not permitted to
# invent one that would lock the owner out. The bound exists for a different
# reason: it caps how much work an unauthenticated caller can make Argon2 do per
# request, which is what actually matters on a login endpoint.
#
# The floor exists so that the documented 1 MiB request cap (§3.9) cannot be spent
# on one field. `bcrypt`'s 72-byte truncation is deliberately not applied — the
# project hashes with Argon2id, which has no such limit — so an upper bound that
# silently truncated passwords would be a lie.
MAX_PASSWORD_LENGTH = 1024

# A deliberately permissive shape check, not a delivery-format validator. The
# requirement is that an invalid *login attempt* is rejected; a stricter pattern
# would reject a real address that a future mail change made unusual.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(email: str) -> str:
    """Return `email` ready for lookup.

    Whitespace is stripped and the address is case-folded. Case folding is
    belt-and-braces here: `admin_user.email` is `citext`, so the database already
    treats `Admin@` and `admin@` as one identity and a case-sensitive Python
    comparison could not match a row the database would match. `SECURITY.md` §3.1
    requires exactly one identity per person, and normalising in both places is
    how that is guaranteed rather than hoped for.
    """
    return email.strip().casefold()


class LoginRequest(BaseModel):
    """`POST /api/admin/auth/login` body: `{"email": ..., "password": ...}`."""

    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def _validate_email(cls, value: str) -> str:
        candidate = normalise_email(value)
        if not _EMAIL_PATTERN.match(candidate):
            raise ValueError("Must be a valid email address.")
        return candidate


class AdminUserOut(BaseModel):
    """The safe identity fields of the single administrator.

    `role` is a fixed database CHECK (`admin_user_role_check` allows only
    `ADMIN`) and is still exposed because `API.md` §6.1 lists it and the admin UI
    uses it to decide it is talking to an admin.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    role: str
    last_login_at: datetime | None


class LoginResponse(BaseModel):
    """`200` body for a successful login: `{"user": {...}}`."""

    user: AdminUserOut


class MeResponse(LoginResponse):
    """`GET /api/admin/me` body: the user plus the session's CSRF token.

    The CSRF token is issued here rather than by `POST /api/admin/auth/login`
    because `API.md` §6.1's documented login body is `{"user": {...}}` and
    nothing else. The consequence is that a client must call `/me` after logging
    in to obtain a CSRF token before its first mutation — one extra GET on a
    request that happens once per session.
    """

    csrf_token: str