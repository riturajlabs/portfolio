"""`GET /health` — liveness.

`TESTING.md` §7.6 requires `200` with no database running. These tests assert
that both with a healthy database and with a database that cannot be reached,
which is the case that matters: a liveness probe that touches the database
causes a restart loop whenever the database is slow.
"""

from __future__ import annotations

from httpx import AsyncClient

from app.main import app


async def test_health_returns_200(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_does_not_require_the_database(isolated_client) -> None:
    """The database is unreachable here, and liveness must not notice."""
    http_client, _dead_engine = isolated_client

    response = await http_client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_is_get_only(client: AsyncClient) -> None:
    assert (await client.post("/health")).status_code == 405


async def test_health_discloses_nothing_about_the_environment(client: AsyncClient) -> None:
    """`SECURITY.md` §2.10: no environment name, hostname or version pin."""
    body = (await client.get("/health")).text

    assert "database" not in body.lower()
    assert "postgres" not in body.lower()
    assert "development" not in body.lower()
    assert app.version not in body