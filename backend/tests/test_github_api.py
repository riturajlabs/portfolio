"""`GET /api/github` — the Phase 8 server-side proxy (`API.md` §2.2).

The endpoint itself is exercised through the HTTP client; the upstream calls are
faked by replacing `httpx.AsyncClient` *inside the service module* so the real
cache and error-mapping paths run. The error-mapping table is tested directly on
`_github_get`:

* network error → 502
* 403 rate limit → 429
* 404 → 404
* other non-2xx → upstream status, stable body (the upstream body is never echoed)
"""

from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.services import github as github_service


@pytest.fixture(autouse=True)
def _clear_github_cache():
    github_service._cache_clear()
    yield
    github_service._cache_clear()


def _github_settings() -> Settings:
    """Settings with a real username and no token, isolated from the environment."""
    return Settings(
        DATABASE_URL="postgresql://user@localhost:5432/portfolio_test",
        ENVIRONMENT="development",
        GITHUB_USERNAME="riturajlabs",
        GITHUB_TOKEN="",
    )


class FakeResponse:
    def __init__(
        self,
        status_code: int,
        *,
        text: str = "",
        json_payload=None,
        path: str = "",
    ) -> None:
        self.status_code = status_code
        self.text = text
        self._json_payload = json_payload
        self._path = path
        self.is_success = 200 <= status_code < 300
        self.request = httpx.Request("GET", "https://api.github.com/users/riturajlabs")

    def json(self):
        return self._json_payload

    def matches(self, url: str) -> int:
        """Where this canned response's path appears in `url`; -1 if it does not.

        Empty path matches anywhere. The rightmost occurrence wins, so a matcher
        that appears later in the URL (e.g. `/repos?` in
        `/users/riturajlabs/repos?...`) beats one that only shares a prefix.
        """
        return url.rfind(self._path) if self._path else 0


class FakeAsyncClient:
    """A context-manager stand-in for `httpx.AsyncClient` limited to `.get`.

    The two upstream calls run concurrently (`asyncio.gather`), so responses are
    matched by URL rather than consumed in order — position-based popping would
    be nondeterministic across the two tasks.
    """

    def __init__(
        self,
        responses: list[FakeResponse] | None = None,
        error: Exception | None = None,
    ) -> None:
        self._responses = list(responses or [])
        self._error = error

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def get(self, url, headers=None):
        if self._error is not None:
            raise self._error
        # Rightmost match wins: the repos URL shares the `/users/riturajlabs`
        # prefix with the profile URL, so `/repos?` must beat the profile matcher.
        best = None
        best_index = -1
        for response in self._responses:
            index = response.matches(url)
            if index > best_index:
                best = response
                best_index = index
        if best is None:
            raise AssertionError(f"Unexpected upstream request: {url}")
        return best


def _stub_httpx(monkeypatch, responses=None, error=None) -> None:
    """Point the service module's httpx at a fake client."""
    monkeypatch.setattr(
        github_service.httpx,
        "AsyncClient",
        lambda timeout=None: FakeAsyncClient(responses or [], error=error),
    )
    monkeypatch.setattr(github_service, "get_settings", _github_settings)


PROFILE = {
    "login": "riturajlabs",
    "name": "Ritu Raj",
    "avatar_url": "https://avatars.githubusercontent.com/u/1",
    "public_repos": 5,
    "followers": 42,
}
REPOSITORIES = [
    {
        "id": 1,
        "name": "portfolio",
        "html_url": "https://github.com/riturajlabs/portfolio",
        "description": "The site",
        "stargazers_count": 3,
        "language": "JavaScript",
    }
]


async def test_endpoint_shape_and_cached_flag(client, monkeypatch) -> None:
    _stub_httpx(
        monkeypatch,
        responses=[
            FakeResponse(200, json_payload=PROFILE, path="/users/riturajlabs"),
            FakeResponse(200, json_payload=REPOSITORIES, path="/repos?"),
        ],
    )

    first = await client.get("/api/github")

    assert first.status_code == 200
    body = first.json()
    assert body["profile"] == PROFILE
    assert body["repositories"] == REPOSITORIES
    assert body["cached"] is False

    second = await client.get("/api/github")

    assert second.status_code == 200
    assert second.json() == {**body, "cached": True}


async def test_cache_serves_without_a_new_upstream_request(client, monkeypatch) -> None:
    consumed: list[str] = []

    async def _counting_get(url, headers=None):
        consumed.append(url)
        if url.endswith("/users/riturajlabs"):
            return FakeResponse(200, json_payload=PROFILE)
        return FakeResponse(200, json_payload=REPOSITORIES)

    class CountingClient(FakeAsyncClient):
        async def get(self, url, headers=None):  # type: ignore[override]
            return await _counting_get(url, headers)

    monkeypatch.setattr(github_service.httpx, "AsyncClient", lambda timeout=None: CountingClient())
    monkeypatch.setattr(github_service, "get_settings", _github_settings)

    await client.get("/api/github")
    await client.get("/api/github")

    assert len(consumed) == 2


async def test_upstream_network_error_maps_to_502(client, monkeypatch) -> None:
    _stub_httpx(monkeypatch, error=httpx.ConnectError("boom"))

    response = await client.get("/api/github")

    assert response.status_code == 502
    assert response.json() == {"detail": "Unable to reach GitHub. Please try again later."}


async def test_upstream_403_rate_limit_maps_to_429(client, monkeypatch) -> None:
    # `fetch` fires two concurrent upstream requests; one canned 403 answers both.
    _stub_httpx(monkeypatch, responses=[FakeResponse(403, text="API rate limit exceeded")])

    response = await client.get("/api/github")

    assert response.status_code == 429
    assert response.json() == {"detail": "GitHub API rate limit reached."}


async def test_upstream_404_maps_to_404(client, monkeypatch) -> None:
    _stub_httpx(monkeypatch, responses=[FakeResponse(404, text='{"message":"Not Found"}')])

    response = await client.get("/api/github")

    assert response.status_code == 404
    assert response.json() == {"detail": "GitHub user not found."}


async def test_other_upstream_error_keeps_status_and_hides_body(client, monkeypatch) -> None:
    """The status is preserved; the upstream body is never reflected.

    `SECURITY.md` §2.9: a public response must not carry upstream internals. The
    status still tells the client whether the dependency failed (5xx) or rejected
    the request (4xx), but the body is a fixed, safe sentence.
    """
    upstream_body = "secret upstream detail: /internal/path token=abc123"
    _stub_httpx(monkeypatch, responses=[FakeResponse(500, text=upstream_body)])

    response = await client.get("/api/github")

    assert response.status_code == 500
    assert response.json() == {"detail": "GitHub API error. Please try again later."}
    assert "secret upstream detail" not in response.text
    assert "token=abc123" not in response.text


async def test_upstream_401_keeps_status_and_hides_body(client, monkeypatch) -> None:
    _stub_httpx(monkeypatch, responses=[FakeResponse(401, text="Bad credentials")])

    response = await client.get("/api/github")

    assert response.status_code == 401
    assert response.json() == {"detail": "GitHub API error. Please try again later."}
    assert "Bad credentials" not in response.text


async def test_token_goes_to_authorization_header_only(monkeypatch) -> None:
    """A configured GITHUB_TOKEN travels in `Authorization`, never in the URL."""
    seen_auth: list[str | None] = []

    async def _getting(url, headers=None):
        seen_auth.append((headers or {}).get("Authorization"))
        if url.endswith("/users/riturajlabs"):
            return FakeResponse(200, json_payload=PROFILE)
        return FakeResponse(200, json_payload=REPOSITORIES)

    class HeaderClient(FakeAsyncClient):
        async def get(self, url, headers=None):
            return await _getting(url, headers)

    monkeypatch.setattr(github_service.httpx, "AsyncClient", lambda timeout=None: HeaderClient())

    with_token = Settings(
        DATABASE_URL="postgresql://user@localhost:5432/portfolio_test",
        ENVIRONMENT="development",
        GITHUB_USERNAME="riturajlabs",
        GITHUB_TOKEN="github_pat_123",
    )
    monkeypatch.setattr(github_service, "get_settings", lambda: with_token)

    await github_service.fetch_profile_and_repositories()

    assert seen_auth == ["Bearer github_pat_123", "Bearer github_pat_123"]

    github_service._cache_clear()
    monkeypatch.setattr(
        github_service,
        "get_settings",
        lambda: _github_settings(),
    )
    await github_service.fetch_profile_and_repositories()
    assert seen_auth[-2:] == [None, None]