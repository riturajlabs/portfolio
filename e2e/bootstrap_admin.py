"""Create (or reset) the admin account the e2e specs log in with.

Runs against the disposable `portfolio_e2e` database only — it must never be
pointed at a real deployment database. All values come from the environment
(`DATABASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`).
"""

from __future__ import annotations

import asyncio
import os
import re
from urllib.parse import parse_qs, urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import AdminUser
from app.security.passwords import hash_password

# The only database names this script may reset: targets that are explicitly
# disposable E2E/test databases, never a dev/production name.
_DISPOSABLE_DB_NAME = re.compile(r"[A-Za-z0-9_]+(?:_e2e|_test)\Z", re.IGNORECASE)

# Loopback hosts and unix sockets are the only local, disposable targets.
_LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def verify_disposable_e2e_target(url: str) -> None:
    """Refuse to reset the admin unless DATABASE_URL is verifiably disposable.

    The admin reset deletes and re-creates a row, so before any connection is
    opened the target must be *verifiably* a disposable E2E/test database: the
    database name must explicitly look disposable (`*_e2e` / `*_test`) and the
    connection must be local (loopback host or unix socket). Anything that
    cannot be verified fails loudly rather than guessing.
    """
    parsed = urlsplit(url)
    database = parsed.path.lstrip("/").split("/", 1)[0]

    # `?host=...` (peer/socket-style URL used by e2e/start-backend.mjs) wins;
    # otherwise fall back to the authority's hostname.
    query_host = parse_qs(parsed.query).get("host", [])
    host = query_host[0] if query_host else (parsed.hostname or "")

    problems: list[str] = []

    if not database:
        problems.append("DATABASE_URL names no database")
    elif not _DISPOSABLE_DB_NAME.fullmatch(database):
        problems.append(
            f"database name {database!r} is not disposable: expected a *_e2e or *_test "
            "suffix (e.g. 'portfolio_e2e'), not a dev/production name"
        )

    if not (host.startswith("/") or host in _LOCAL_HOSTS):
        problems.append(
            f"database host {host!r} is not a loopback address or unix socket"
        )

    if problems:
        raise RuntimeError(
            "REFUSED to reset the admin: DATABASE_URL cannot be verified as a "
            "disposable E2E/test database.\n  - " + "\n  - ".join(problems)
        )


async def main() -> None:
    url = os.environ["DATABASE_URL"]
    email = os.environ["E2E_ADMIN_EMAIL"]
    password = os.environ["E2E_ADMIN_PASSWORD"]

    # Hard safety guard: verify the target *before* opening any connection.
    verify_disposable_e2e_target(url)

    engine = create_async_engine(url)
    try:
        async with async_sessionmaker(engine)() as session:
            row = (await session.execute(select(AdminUser).where(AdminUser.email == email))).scalar_one_or_none()
            if row is not None:
                await session.delete(row)
                await session.flush()
            session.add(
                AdminUser(
                    email=email,
                    password_hash=hash_password(password),
                    role="ADMIN",
                    is_active=True,
                    failed_attempts=0,
                )
            )
            await session.commit()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())