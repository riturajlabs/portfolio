"""`contact_message` — append-only; no hard delete, read-only and archivable.

`source_ip_hash` is an HMAC-SHA-256 over `"{day}:{ip}"` keyed by a
process-local, daily-regenerated secret (`app.services.auth.client_ip_hash`),
never a raw IP. `user_agent` is
truncated to 300 characters by the application; there is deliberately no CHECK
for it, because `DATABASE.md` states that rule as application behaviour and not
as a database constraint.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Text, text
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ContactMessage(Base):
    __tablename__ = "contact_message"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(CITEXT, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'unread'"))
    delivery_status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'pending'"))
    source_ip_hash: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 2 AND 100", name="name_length"),
        CheckConstraint("char_length(email) <= 254", name="email_length"),
        CheckConstraint("char_length(subject) BETWEEN 3 AND 150", name="subject_length"),
        CheckConstraint("char_length(message) BETWEEN 10 AND 2000", name="message_length"),
        CheckConstraint("status IN ('unread','read','archived')", name="status_valid"),
        CheckConstraint(
            "delivery_status IN ('pending','sent','failed')", name="delivery_status_valid"
        ),
        Index("ix_contact_message_status_created_at", "status", text("created_at DESC")),
    )