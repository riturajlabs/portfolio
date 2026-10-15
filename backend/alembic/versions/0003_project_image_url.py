"""project.image: admit an object-storage URL alongside the in-repo path

`POST /api/admin/uploads` (Phase 10) stores an image in object storage and returns
its anonymous public URL. The admin then saves that URL as `project.image`, so the
`image_path` CHECK has to admit it — otherwise every upload would be followed by a
`409`/`IntegrityError` at save time and the feature would be unusable.

The constraint keeps both shapes:

* the original `/images/projects/<slug>.webp` path, still the contract for the
  images committed to `public/`, and still what the build verifies against the
  local WebP header;
* an absolute `http(s)` URL with no whitespace, quote or angle bracket, because
  the value is emitted verbatim as an `<img src>` — a `javascript:`/`data:`
  scheme or an embedded `"` must never be storable.

Only the CHECK changes; no column, no data. The constraint name is unchanged
(`ck_project_image_path`), so the model, the naming convention and this migration
stay in agreement.

Revision ID: 0003_project_image_url
Revises: 0002_certification_unique
Create Date: 2026-10-14
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_project_image_url"
down_revision: str | None = "0002_certification_unique"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PATH_ONLY = "image ~ '^/images/projects/[a-z0-9-]+\\.webp$'"
_PATH_OR_URL = (
    "image ~ '^/images/projects/[a-z0-9-]+\\.webp$' "
    "OR image ~ '^https?://[^[:space:]\"<>]+$'"
)


def upgrade() -> None:
    op.drop_constraint(op.f("ck_project_image_path"), "project", type_="check")
    op.create_check_constraint(op.f("ck_project_image_path"), "project", _PATH_OR_URL)


def downgrade() -> None:
    # Restoring the path-only rule fails on a row that holds a URL, which is the
    # honest outcome: the data would violate the old contract, and a silent
    # rewrite would lose the image the owner uploaded.
    op.drop_constraint(op.f("ck_project_image_path"), "project", type_="check")
    op.create_check_constraint(op.f("ck_project_image_path"), "project", _PATH_ONLY)
