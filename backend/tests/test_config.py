"""`DATABASE_URL` normalisation.

Managed PostgreSQL (Render, Neon, Supabase) hands out a libpq DSN whose query
carries parameters `asyncpg` rejects as keyword arguments. SQLAlchemy forwards
the whole query into `asyncpg.connect()`, so an un-normalised URL makes the
first connection raise `TypeError: connect() got an unexpected keyword argument
'sslmode'`. These tests pin the translation so the production URL shape cannot
regress unnoticed: the local test suite connects over a unix socket, which
carries no `sslmode`, so the deployed failure would otherwise be invisible here.
"""

from __future__ import annotations

import inspect

import asyncpg
import pytest
from sqlalchemy.dialects.postgresql.asyncpg import PGDialect_asyncpg
from sqlalchemy.engine import make_url

from app.config import Settings, normalise_database_url


def _connect_args(url: str) -> dict[str, object]:
    dialect = PGDialect_asyncpg()
    _, connect_args = dialect.create_connect_args(make_url(normalise_database_url(url)))
    return connect_args


def _asyncpg_rejected_keys(url: str) -> list[str]:
    accepted = inspect.signature(asyncpg.connect).parameters
    return [key for key in _connect_args(url) if key not in accepted]


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://user:pass@host:5432/db",
        "postgres://user:pass@host:5432/db",
        "postgresql+psycopg://user:pass@host:5432/db",
        "postgresql+psycopg2://user:pass@host:5432/db",
    ],
)
def test_sync_prefix_is_rewritten_to_asyncpg(url: str) -> None:
    assert normalise_database_url(url).startswith("postgresql+asyncpg://")


def test_asyncpg_url_is_left_on_the_asyncpg_driver() -> None:
    url = "postgresql+asyncpg://user:pass@host:5432/db"
    assert normalise_database_url(url) == url


def test_sslmode_is_translated_to_asyncpg_ssl() -> None:
    connect_args = _connect_args("postgresql://user:pass@host:5432/db?sslmode=require")
    assert connect_args["ssl"] == "require"
    assert "sslmode" not in connect_args


def test_channel_binding_is_dropped() -> None:
    # Neon's default connection string ends with
    # `?sslmode=require&channel_binding=require`.
    connect_args = _connect_args(
        "postgresql://user:pass@host:5432/db?sslmode=require&channel_binding=require"
    )
    assert "channel_binding" not in connect_args
    assert connect_args["ssl"] == "require"


def test_asyncpg_native_parameters_are_preserved() -> None:
    connect_args = _connect_args(
        "postgresql://user:pass@host:5432/db"
        "?sslmode=verify-full&statement_cache_size=0&target_session_attrs=read-write"
    )
    assert connect_args["statement_cache_size"] == "0"
    assert connect_args["target_session_attrs"] == "read-write"
    assert connect_args["ssl"] == "verify-full"


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://user:pass@host:5432/db?sslmode=require",
        "postgresql://user:pass@host:5432/db?sslmode=require&channel_binding=require",
        "postgresql://user:pass@host:5432/db?sslrootcert=/etc/ssl/root.crt&sslcert=/c.pem",
        "postgresql://user:pass@host:5432/db?application_name=portfolio&options=-csearch_path=x",
    ],
)
def test_no_libpq_parameter_reaches_asyncpg_as_a_keyword(url: str) -> None:
    assert _asyncpg_rejected_keys(url) == []


def test_unix_socket_host_is_preserved() -> None:
    # The form `package.json` `test:api` uses; percent-encoding of the socket
    # directory must decode back to the directory asyncpg expects.
    connect_args = _connect_args("postgresql://user@/portfolio_test?host=/var/run/postgresql")
    assert connect_args["host"] == "/var/run/postgresql"


def test_empty_query_is_untouched() -> None:
    url = normalise_database_url("postgresql://user:pass@host:5432/db")
    assert "?" not in url


@pytest.mark.parametrize(
    "url",
    [
        "mysql://user:pass@host/db",
        "sqlite:///local.db",
        "https://example.com",
        "",
    ],
)
def test_non_postgres_url_is_rejected(url: str) -> None:
    with pytest.raises(ValueError):
        normalise_database_url(url)


def test_settings_accepts_a_neon_style_url() -> None:
    settings = Settings(
        DATABASE_URL=(
            "postgresql://user:pass@ep-cool-name.us-east-2.aws.neon.tech/neondb"
            "?sslmode=require&channel_binding=require"
        ),
        ENVIRONMENT="production",
    )
    assert "sslmode" not in settings.DATABASE_URL
    assert "channel_binding" not in settings.DATABASE_URL
    assert "ssl=require" in settings.DATABASE_URL


def test_redacted_database_url_hides_the_password() -> None:
    settings = Settings(
        DATABASE_URL="postgresql://user:sup3r-s3cret@host:5432/db?sslmode=require",
        ENVIRONMENT="development",
    )
    redacted = settings.redacted_database_url
    assert "sup3r-s3cret" not in redacted
    assert "user" in redacted
    assert "host:5432" in redacted
