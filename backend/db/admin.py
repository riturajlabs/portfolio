"""Provision or explicitly reset the single local administrator account.

Examples::

    ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='...' \
      .venv/bin/python -m db.admin

    ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='new ...' \
      .venv/bin/python -m db.admin --reset

The command never prints credentials or hashes. Without ``--reset`` an
existing account is left untouched, including its password and email.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.db.session import create_engine
from app.models import AdminSession, AdminUser
from app.security.passwords import hash_password

MIN_PASSWORD_LENGTH = 12
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create or explicitly reset the local admin account.")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="explicitly replace the existing admin email/password",
    )
    return parser


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required; set it in backend/.env or the environment")
    return value


def _validated_credentials() -> tuple[str, str]:
    raw_email = _required_env("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD", "")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"ADMIN_PASSWORD must be at least {MIN_PASSWORD_LENGTH} characters; "
            "the value was not displayed"
        )
    try:
        email = TypeAdapter(EmailStr).validate_python(raw_email)
    except ValidationError as exc:
        raise ValueError("ADMIN_EMAIL must be a valid email address") from exc
    return str(email).casefold(), password


async def provision(*, reset: bool) -> str:
    email, password = _validated_credentials()
    engine = create_engine(get_settings())
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    try:
        async with session_factory() as session:
            result = await session.execute(select(AdminUser).order_by(AdminUser.created_at))
            users = list(result.scalars())
            if len(users) > 1:
                raise RuntimeError(
                    "more than one admin account exists; refusing to choose or overwrite one"
                )
            existing = users[0] if users else None
            if existing is not None and not reset:
                return (
                    "admin account already exists; no changes made. "
                    "Use --reset explicitly to replace its configured credentials."
                )
            if existing is None:
                session.add(
                    AdminUser(
                        email=email,
                        password_hash=hash_password(password),
                        role="ADMIN",
                        is_active=True,
                        failed_attempts=0,
                    )
                )
                action = "created"
            else:
                existing.email = email
                existing.password_hash = hash_password(password)
                existing.role = "ADMIN"
                existing.is_active = True
                existing.failed_attempts = 0
                existing.locked_until = None
                await session.execute(
                    update(AdminSession)
                    .where(
                        AdminSession.user_id == existing.id,
                        AdminSession.revoked_at.is_(None),
                    )
                    .values(revoked_at=datetime.now(UTC))
                )
                action = "reset"
            await session.commit()
            return f"admin account {action}; password hash stored with Argon2id"
    finally:
        await engine.dispose()


def main() -> int:
    args = _parser().parse_args()
    try:
        print(asyncio.run(provision(reset=args.reset)))
    except (ValueError, RuntimeError) as exc:
        print(f"admin setup failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
