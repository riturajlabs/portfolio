"""certification: add the documented `(title, issuer)` unique constraint

`DATABASE.md` §5.5 documents `(title, issuer)` as the `certification` natural key,
§12 lists it under "Invariant → Why it exists", and `db/seed.py` upserts on the
pair. `0001_initial` created the table without the constraint, so two identical
badges could be inserted through the admin API or a re-run of the seed.

The columns are NOT NULL, so no `NULLS NOT DISTINCT` handling is needed. The
constraint is added without a deduplication step on purpose: a database that
already holds duplicates is one whose contents disagree with the documented key,
and a migration that silently deleted rows to make itself succeed would hide
that. On such a row set the `ALTER TABLE` fails and names the offending key.

Revision ID: 0002_certification_unique
Revises: 0001_initial
Create Date: 2026-10-10
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_certification_unique"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_certification_title_issuer", "certification", ["title", "issuer"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_certification_title_issuer", "certification", type_="unique")
