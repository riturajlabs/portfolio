"""`project` — one indexable URL each, and the home of everything `project_*` used to be.

`category` and `tech_stack` are columns, not tables (`DATABASE.md` §1.3), and
three columns carry build-critical contracts that are CHECK-enforced so an
invalid value cannot reach the production build:

* `image` must be `/images/projects/<slug>.webp` **or** an absolute `http(s)`
  URL to an object-storage object (`generate-project-pages.mjs`). The URL form is
  what `POST /api/admin/uploads` writes; the path form is the committed-image
  contract that predates it. The pattern admits no `javascript:`/`data:` scheme
  and no whitespace/quote, because the value is emitted as an `<img src>`.
* `image_width` / `image_height` must be positive, because the generator
  cross-checks them against the real WebP header
* `seo_title` / `seo_description` are NOT NULL, because `discover.mjs` asserts
  both exist
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Index, Integer, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Project(Base):
    __tablename__ = "project"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    short_description: Mapped[str] = mapped_column(Text, nullable=False)
    long_description: Mapped[str | None] = mapped_column(Text)
    image: Mapped[str] = mapped_column(Text, nullable=False)
    image_width: Mapped[int] = mapped_column(Integer, nullable=False)
    image_height: Mapped[int] = mapped_column(Integer, nullable=False)
    image_alt: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str | None] = mapped_column(Text)
    tech_stack: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'"))
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'published'"))
    featured: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    indexable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    live_url: Mapped[str | None] = mapped_column(Text)
    github_url: Mapped[str | None] = mapped_column(Text)
    seo_title: Mapped[str] = mapped_column(Text, nullable=False)
    seo_description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint("slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'", name="slug_format"),
        CheckConstraint("char_length(slug) <= 80", name="slug_length"),
        CheckConstraint(
            "image ~ '^/images/projects/[a-z0-9-]+\\.webp$' "
            "OR image ~ '^https?://[^[:space:]\"<>]+$'",
            name="image_path",
        ),
        CheckConstraint("image_width > 0", name="image_width_positive"),
        CheckConstraint("image_height > 0", name="image_height_positive"),
        CheckConstraint("status IN ('published','hidden')", name="status_valid"),
        CheckConstraint("category IS NULL OR char_length(category) <= 60", name="category_length"),
        CheckConstraint("char_length(seo_title) <= 70", name="seo_title_length"),
        CheckConstraint("char_length(seo_description) <= 185", name="seo_description_length"),
        Index(None, "status", "display_order"),
        Index(None, "status", "indexable"),
        Index(None, "status", "featured"),
    )