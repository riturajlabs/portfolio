"""site_profile.resume_key: track the uploaded resume object

`POST /api/admin/profile/resume` (Phase 11) stores a PDF in the private `uploads`
bucket and points `site_profile.resume` at the stable public route `/api/resume`.
The object's key has to be persisted so `GET /api/resume` can find it and so a
replacement upload can delete the object it supersedes; `resume` itself cannot
hold it, because the build and the public components treat `resume` as a URL.

The column is nullable: every existing row keeps serving the in-repo
`/Ritu_Raj_Full_Stack_Developer_Resume.pdf`, and a row that has never had an
object uploaded simply has no key. A `NULL` key is the public route's 404 case,
not an error.

Only a column is added; no data moves and no constraint changes.

Revision ID: 0004_profile_resume_key
Revises: 0003_project_image_url
Create Date: 2026-10-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_profile_resume_key"
down_revision: str | None = "0003_project_image_url"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("site_profile", sa.Column("resume_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("site_profile", "resume_key")
