"""Argon2id password hashing.

`SECURITY.md` §3.1 names Argon2id and forbids bcrypt, scrypt and PBKDF2. This
module is the only place in the codebase allowed to produce or check a password
hash, so "which algorithm is this?" has exactly one answer.

The parameters are the OWASP-recommended Argon2id baseline (19 MiB, t=2, p=1).
They are named constants rather than configuration on purpose: they are a
security decision, not a deployment knob, and `DATABASE.md` §11.3 fixes them for
the lifetime of the database. Making them env-tunable would let one deployment
silently downgrade every future hash.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from argon2.low_level import Type

# OWASP Password Storage Cheat Sheet: Argon2id, m=19456 KiB, t=2, p=1.
ARGON2_MEMORY_COST_KIB = 19_456
ARGON2_TIME_COST = 2
ARGON2_PARALLELISM = 1
ARGON2_HASH_LENGTH = 32
ARGON2_SALT_LENGTH = 16

# `Type.ID` is stated explicitly even though it is argon2-cffi's default: the
# whole point of `SECURITY.md` §3.1 is that the algorithm is never left to an
# implicit library default that a future version could change.
_hasher = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST_KIB,
    parallelism=ARGON2_PARALLELISM,
    hash_len=ARGON2_HASH_LENGTH,
    salt_len=ARGON2_SALT_LENGTH,
    type=Type.ID,
)

# A real Argon2id hash of a value nothing can guess, used to spend the same CPU
# on a login attempt for an email that does not exist. Without it, an unknown
# email would return measurably faster than a wrong password, which is enough to
# enumerate the one administrator account.
#
# Verified at import below rather than pasted in, so the constant cannot drift
# out of sync with the parameters above: if someone raises the memory cost and
# pastes an old hash here, this call fails loudly instead of leaving the timing
# defence weaker than it looks.
_DUMMY_SECRET = "portfolio-timing-equaliser-not-a-credential"


def _build_dummy_hash() -> str:
    return _hasher.hash(_DUMMY_SECRET)


DUMMY_PASSWORD_HASH = _build_dummy_hash()


def hash_password(password: str) -> str:
    """Return an Argon2id PHC string for `password`.

    The plaintext is never logged, returned alongside the hash, or written
    anywhere else; this string is the only surviving representation.
    """
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Return whether `password` produced `password_hash`.

    False covers both "wrong password" and "this stored string is not a hash I
    can check". Collapsing them means a corrupted or foreign-format row cannot
    become an authentication bypass, and the caller has one thing to do about a
    failure.
    """
    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def needs_rehash(password_hash: str) -> bool:
    """Return whether `password_hash` was made with outdated parameters.

    Used to re-hash a still-valid password on the next successful login after
    the cost parameters are raised, which is the only moment the plaintext is
    available to do it.
    """
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False