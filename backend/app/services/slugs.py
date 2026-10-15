"""Server-side slug generation for admin-authored content.

The admin never authors a URL. A slug is derived from the human-readable title
on create and then treated as the project's permanent address (a permalink): it
is stored once, is globally unique, and does not change when the title is later
edited. That keeps a published `/projects/<slug>/` URL stable, which is the
opposite of "regenerate on every rename" — a rename that silently repointed every
inbound link would be the defect, not the feature (`ADR-016`).

The algorithm is deliberately small and dependency-free so the backend, the
build scripts and the tests all agree on one definition:

* lowercase, whitespace and punctuation collapse to single hyphens,
* leading/trailing hyphens are removed,
* the result is capped at `SLUG_MAX_LENGTH` (the `project.slug_length` CHECK).

A title that reduces to nothing (for example `"!!!"`) yields an empty string;
callers must supply a fallback rather than let an empty slug reach the database.
"""

from __future__ import annotations

import re

# `backend/app/schemas/admin_content.py` owns the same number for validation; the
# value is duplicated here as a plain int rather than imported so this module
# stays free of the FastAPI schema layer and can be reused by migrations/scripts.
MAX_SLUG_LENGTH = 80

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(value: str, *, max_length: int = MAX_SLUG_LENGTH) -> str:
    """Return the URL slug for `value`.

    `"Hello, World!"` → `"hello-world"`. Returns `""` for input that contains no
    slug-safe characters; the caller decides on a fallback.
    """
    hyphenated = _NON_SLUG.sub("-", value.strip().lower())
    return hyphenated.strip("-")[:max_length].strip("-")


def suffixed_slug(base: str, suffix: int, *, max_length: int = MAX_SLUG_LENGTH) -> str:
    """Return `base` with `-{suffix}` appended, trimmed so the total fits.

    Used to disambiguate a generated slug from one that already exists. The base
    is shortened rather than allowed to overflow the column length, so the result
    still satisfies the database CHECK.
    """
    tail = f"-{suffix}"
    room = max_length - len(tail)
    return f"{base[:room].strip('-')}{tail}"
