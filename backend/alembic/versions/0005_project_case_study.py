"""project.case_study: nullable JSONB storage for the v1 case-study document

`U10.3` stores the project case study as one nullable JSONB document. SQL
`NULL` is the only representation of "no case study"; there is no default `{}`
and no backfill, so existing rows remain unchanged and public readers can
distinguish absence from an empty object.

The CHECK enforces the storage type only: `NULL` or a JSON object. The full v1
contract (required `schemaVersion`, allowed keys, size limit) stays in the
application model so a future schema version can evolve without a database
migration.

Revision ID: 0005_project_case_study
Revises: 0004_profile_resume_key
Create Date: 2026-11-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0005_project_case_study"
down_revision: str | None = "0004_profile_resume_key"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CASE_STUDY_OBJECT = "case_study IS NULL OR jsonb_typeof(case_study) = 'object'"


def upgrade() -> None:
    op.add_column(
        "project",
        sa.Column("case_study", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.create_check_constraint(
        op.f("ck_project_case_study_object"),
        "project",
        _CASE_STUDY_OBJECT,
    )


def downgrade() -> None:
    # Destructive: dropping the column permanently deletes every stored case
    # study. There is no backup in this migration.
    op.drop_constraint(
        op.f("ck_project_case_study_object"),
        "project",
        type_="check",
    )
    op.drop_column("project", "case_study")
