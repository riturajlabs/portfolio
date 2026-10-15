"""`site_profile` — the primary aggregate, one row by constraint.

`singleton` is `NOT NULL DEFAULT true` with a UNIQUE constraint, which is what
makes a second row impossible. The primary key stays a generated uuid so the
column set matches `DATABASE.md` §5.1 exactly.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SiteProfile(Base):
    __tablename__ = "site_profile"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    singleton: Mapped[bool] = mapped_column(
        Boolean, nullable=False, unique=True, server_default=text("true")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    greeting: Mapped[str | None] = mapped_column(Text)
    roles: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    available_for_internship: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    internship_text: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(Text)
    resume: Mapped[str] = mapped_column(Text, nullable=False)
    # Phase 11 — the object key of the admin-uploaded resume, or `NULL` when the
    # resume is the in-repo PDF (or any other path). While set, `resume` holds the
    # stable public route `/api/resume` and `GET /api/resume` reads this key from
    # the private bucket. The key is never exposed publicly.
    resume_key: Mapped[str | None] = mapped_column(Text)
    stats: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'"))
    social: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    about: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    seo: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )