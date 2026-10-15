"""`admin_audit_log` — append-only, and load-bearing for the source-of-truth rule.

Once content lives in PostgreSQL instead of in git, this table is the only record
of who changed what. `actor_user_id` is nullable with `ON DELETE SET NULL` so
history survives the deletion of an account; passwords and tokens are never
written to `before` / `after`.

There is no `created_at` / `updated_at` here — the timestamp column is `at`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.admin_user import AdminUser


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("admin_user.id", ondelete="SET NULL"),
    )
    action: Mapped[str] = mapped_column(Text, nullable=False)
    entity: Mapped[str] = mapped_column(Text, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(Text)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    # Named explicitly: the naming convention cannot see through a DESC
    # expression and would otherwise emit `ix_admin_audit_log_entity_entity_id`.
    __table_args__ = (
        Index("ix_admin_audit_log_entity_entity_id_at", "entity", "entity_id", text("at DESC")),
    )

    actor: Mapped[AdminUser | None] = relationship(back_populates="audit_logs")