"""Typed application configuration.

Settings are read from the process environment (optionally from a local `.env`).
`DATABASE_URL` is mandatory and is never defaulted: a hard-coded host, port,
user, password or database name would leak into the deployment configuration and
would silently point a production process at the wrong server.

`DATABASE_URL` is normalised so the async driver is always used, regardless of
the dialect prefix the platform supplies. Render/Neon/Supabase commonly hand out
`postgresql://` (a psycopg2/sync prefix) while the application speaks asyncpg.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production"]

_SYNC_DRIVER_PREFIXES = (
    "postgresql://",
    "postgres://",
    "postgresql+psycopg://",
    "postgresql+psycopg2://",
    "postgresql+psycopg2cffi://",
)

# Query keys `asyncpg.connect()` accepts as keyword arguments. SQLAlchemy's
# asyncpg dialect forwards every URL query parameter straight into that call, so
# any *other* key raises `TypeError: connect() got an unexpected keyword
# argument ...` on the first connection. `host`/`port`/`user`/`password` are
# normally taken from the netloc; they are listed because a unix-socket URL
# carries the socket directory in `?host=` (see `package.json` `test:api`).
_ASYNCPG_QUERY_KEYS = frozenset(
    {
        "host",
        "port",
        "user",
        "password",
        "database",
        "passfile",
        "service",
        "servicefile",
        "timeout",
        "statement_cache_size",
        "max_cached_statement_lifetime",
        "max_cacheable_statement_size",
        "command_timeout",
        "ssl",
        "direct_tls",
        "server_settings",
        "target_session_attrs",
        "krbsrvname",
        "gsslib",
    }
)

# libpq spellings that map onto a key asyncpg *does* accept. `sslmode` and
# `ssl` take the same values (`require`, `verify-full`, ...); asyncpg parses the
# string itself (asyncpg `connect_utils.SSLMode.parse`).
_QUERY_PARAMETER_ALIASES = {"sslmode": "ssl"}

# `SECURITY.md` §2.3: the same default allow-list `ai_service` uses, so the two
# services cannot disagree about who the browser is. The Vercel domain is
# authoritative in this repository (`seo.js` `url`, the README badge and
# `vercel.json`), and `ALLOWED_ORIGINS` overrides the whole list.
DEFAULT_ALLOWED_ORIGINS = (
    "https://riturajlabs.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)

# Environments where a wildcard origin is fatal. Development is deliberately absent:
# a local `*` is a convenience, and the loud startup warning covers it.
_WILDCARD_FORBIDDEN_ENVIRONMENTS = frozenset({"production", "staging"})

# Headers this service is willing to treat as carrying the real client IP. A header
# qualifies only when the documented edge proxy *overwrites* any copy a caller
# supplied, so the value cannot be forged. Cloudflare fronts every Render web
# service and sets `CF-Connecting-IP` to the peer it accepted the connection from
# (`SECURITY.md` §3.6a). `x-forwarded-for` is deliberately absent: Cloudflare
# *appends* to it, so the leftmost entry is caller-controlled.
TRUSTED_PROXY_HEADERS = frozenset({"cf-connecting-ip"})


def normalise_database_url(url: str) -> str:
    """Return `url` pointed at the asyncpg driver, with an asyncpg-safe query.

    Any supported sync prefix is rewritten to `postgresql+asyncpg`. A URL that
    already names a driver is left alone, except for the sync psycopg drivers
    that a platform is most likely to supply.

    The query string is then normalised for asyncpg. Every managed PostgreSQL
    provider hands out a *libpq* DSN, and their default query carries parameters
    asyncpg does not accept as keyword arguments: `sslmode` everywhere, plus
    `channel_binding` on Neon. SQLAlchemy forwards those verbatim into
    `asyncpg.connect()`, which fails the first connection with `TypeError:
    connect() got an unexpected keyword argument 'sslmode'` — a defect that only
    appears in the deployed environment, never against a local socket. So
    `sslmode` is translated to asyncpg's `ssl` (same accepted values) and
    libpq-only parameters are dropped. Parameters asyncpg understands
    (`statement_cache_size`, `target_session_attrs`, a unix-socket `host`, ...)
    are preserved.
    """
    candidate = url.strip()
    for prefix in _SYNC_DRIVER_PREFIXES:
        if candidate.startswith(prefix):
            candidate = f"postgresql+asyncpg://{candidate[len(prefix) :]}"
            break
    if not candidate.startswith("postgresql+asyncpg://"):
        raise ValueError(
            "DATABASE_URL must be a PostgreSQL URL "
            "(expected 'postgresql://' or 'postgresql+asyncpg://')."
        )
    return _normalise_asyncpg_query(candidate)


def _normalise_asyncpg_query(url: str) -> str:
    """Drop or rename query parameters asyncpg cannot accept as keywords."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept: list[tuple[str, str]] = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        translated = _QUERY_PARAMETER_ALIASES.get(key, key)
        if translated in _ASYNCPG_QUERY_KEYS:
            kept.append((translated, value))
    return urlunsplit(parts._replace(query=urlencode(kept)))


def _split_origins(value: str) -> list[str]:
    """Parse a comma-separated origin list, dropping blanks.

    Blank entries are dropped rather than rejected so a trailing comma or a
    blank line in a platform secret editor cannot take the service down.
    """
    return [origin.strip().rstrip("/") for origin in value.split(",") if origin.strip()]


class Settings(BaseSettings):
    """Environment-driven settings. Secrets live in the platform secret store."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    DATABASE_URL: str = Field(min_length=1)
    ENVIRONMENT: Environment = "development"
    LOG_LEVEL: str = "INFO"

    # `SECURITY.md` §3.6a: the name of the header, written by the trusted edge
    # proxy, that carries the real client IP for per-IP rate limiting. Empty (the
    # default) trusts only the socket peer, which is correct for local development
    # and tests. A Render deployment must set
    # `TRUSTED_PROXY_HEADER=cf-connecting-ip`; leaving it unset collapses every
    # caller into the proxy's single bucket.
    TRUSTED_PROXY_HEADER: str = ""

    # Comma-separated, the format `ai_service` already uses, so an operator
    # configuring this service already knows it.
    ALLOWED_ORIGINS: str = ",".join(DEFAULT_ALLOWED_ORIGINS)

    # `API.md` §8: 300 requests/minute per IP for `GET /api/content`.
    CONTENT_RATE_LIMIT: int = Field(default=300, ge=1)
    CONTENT_RATE_WINDOW_SECONDS: int = Field(default=60, ge=1)

    # `SECURITY.md` §3.3: a session cookie's Max-Age is 43200 s (12 h). Idle and
    # absolute lifetimes are the same number of seconds, so the cookie and the
    # server-side idle check are configured from one place and cannot drift.
    ADMIN_SESSION_IDLE_SECONDS: int = Field(default=43_200, ge=1)

    # `SECURITY.md` §3.2: absolute expiry after 7 days, never extended by activity.
    ADMIN_SESSION_ABSOLUTE_SECONDS: int = Field(default=604_800, ge=1)

    # `API.md` §8 and `SECURITY.md` §5.1: two independent login limits, both
    # 15-minute windows. The IP window counts *every* attempt; the email window
    # counts *failed* attempts only, so a correct password is never punished.
    ADMIN_LOGIN_IP_LIMIT: int = Field(default=10, ge=1)
    ADMIN_LOGIN_IP_WINDOW_SECONDS: int = Field(default=900, ge=1)
    ADMIN_LOGIN_EMAIL_FAILURE_LIMIT: int = Field(default=5, ge=1)
    ADMIN_LOGIN_EMAIL_WINDOW_SECONDS: int = Field(default=900, ge=1)

    # `API.md` §8: authenticated `GET /api/admin/*` is bounded at 600/min per
    # user. Reused by the Phase 4 dependency module's read budget.
    ADMIN_READ_RATE_LIMIT: int = Field(default=600, ge=1)
    ADMIN_READ_RATE_WINDOW_SECONDS: int = Field(default=60, ge=1)

    # Phase 8 — `POST /api/contact`. Resend credentials are the same names
    # `ai_service` used, so an operator migrating environment variables changes
    # nothing; they live in the platform secret store (`API.md` §2.3).
    RESEND_API_KEY: str = ""
    # Overridable so tests and e2e can point the contact sender at a local mock;
    # unset, the production endpoint is used and nothing changes.
    RESEND_API_URL: str = "https://api.resend.com/emails"
    CONTACT_FROM_EMAIL: str = "onboarding@resend.dev"
    CONTACT_TO_EMAIL: str = "riturajlabs@outlook.com"

    # `API.md` §8: contact is public and conservative at 5/minute per IP.
    CONTACT_RATE_LIMIT: int = Field(default=5, ge=1)
    CONTACT_RATE_WINDOW_SECONDS: int = Field(default=60, ge=1)

    # Phase 8 — `GET /api/github`. Same names `ai_service` used (`API.md` §2.2).
    # Empty by default; without `GITHUB_USERNAME` the proxy answers 404, exactly
    # as the misspelt-user path does.
    GITHUB_USERNAME: str = ""
    GITHUB_TOKEN: str = ""

    # Phase 4 — server-side publish (`ADR-017`). The Vercel Deploy Hook URL is
    # itself a capability token: anyone holding it can start a production build.
    # It therefore lives only in the platform secret store and is never sent to
    # the browser, which is why the admin "Rebuild site" button calls the backend
    # instead of the hook directly. Empty (the default) means the feature is not
    # configured: `POST /api/admin/publish` reports that plainly instead of
    # failing. This is a read-only integration — the backend never deploys.
    DEPLOY_HOOK_URL: str = ""

    # A deploy hook answers quickly; a long timeout would only make the admin UI
    # wait behind a wedged build trigger.
    DEPLOY_HOOK_TIMEOUT_SECONDS: float = Field(default=10.0, gt=0)

    # Phase 9 — AI re-ingestion (`ADR-017`). Once a build is requested, the
    # vector store that answers chat still holds the previous content until it
    # re-reads `GET /api/content`. `POST /api/admin/publish` therefore also asks
    # the AI service to re-ingest, so a hidden or deleted project stops being
    # quotable instead of lingering until the service restarts.
    #
    # `AI_SERVICE_URL` is the AI service's base URL (e.g.
    # `https://portfolio-lxdx.onrender.com`). `AI_SERVICE_ADMIN_TOKEN` is the
    # shared operator secret the AI service checks as `ADMIN_TOKEN`; it is
    # distinct from the chat key on purpose, so a leaked browser key cannot purge
    # caches or force re-ingestion. Both live only in the platform secret store.
    # Either being empty means the step is reported as not-configured, never a
    # silent no-op.
    AI_SERVICE_URL: str = ""
    AI_SERVICE_ADMIN_TOKEN: str = ""

    # Re-ingestion fetches the content API and re-embeds changed chunks, so it can
    # take a few seconds; far longer than the 10 s deploy hook.
    AI_SERVICE_TIMEOUT_SECONDS: float = Field(default=30.0, gt=0)

    # Phase 3 — One-time secure admin & CMS bootstrap token.
    # When non-empty, enables POST /api/admin/bootstrap for initial setup on free
    # tier hosting where shell/jobs are unavailable. Must be at least 32 characters.
    # Unset or empty disables the bootstrap endpoint completely.
    ADMIN_BOOTSTRAP_TOKEN: str = ""

    # Phase 10 — Object storage for admin-uploaded project images (Neon Object
    # Storage, or any S3-compatible endpoint). The names are the standard AWS
    # SDK names, which is exactly what `neon deploy` writes into the environment,
    # so the same variables work in a Neon branch and in the platform secret
    # store with no translation. `S3_BUCKET` is ours: the bucket has to be
    # `public_read` because a project image is baked into the static build as a
    # stable `<img src>` URL and an anonymous browser must be able to fetch it.
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_ENDPOINT_URL_S3: str = ""
    AWS_REGION: str = ""
    S3_BUCKET: str = "media"

    # A cover image is a web asset, not a document. 5 MiB is generous for a
    # 1600px WebP and small enough that a single upload cannot exhaust a
    # free-tier request's memory when the whole body is read for dimension
    # parsing.
    S3_IMAGE_MAX_BYTES: int = Field(default=5_000_000, ge=1)

    # Phase 11 — the administrator's resume. It lives in the *private* `uploads`
    # bucket (the one `neon init` creates and cannot make public), never in
    # `media`. A resume is a document, not a web asset: nothing links to
    # `<endpoint>/<bucket>/<key>` directly. `GET /api/resume` reads the object with
    # the server's credentials and streams it, so an anonymous visitor can neither
    # list nor fetch the bucket contents around the route.
    S3_RESUME_BUCKET: str = "uploads"

    # A resume PDF is a document, so the cap is larger than an image's but still
    # bounded: the whole body is read into memory to sniff the `%PDF-` signature
    # and handed to the SDK.
    S3_RESUME_MAX_BYTES: int = Field(default=10_000_000, ge=1)

    # `API.md` §8: `GET /api/resume` is public — it is the target of the site's
    # "Download resume" link — so it is rate limited per IP. 60/minute is roomy for
    # a person clicking a link without letting one caller pull the document (and
    # the bucket round-trip behind it) without bound.
    RESUME_RATE_LIMIT: int = Field(default=60, ge=1)
    RESUME_RATE_WINDOW_SECONDS: int = Field(default=60, ge=1)

    @property
    def object_storage_configured(self) -> bool:
        """Whether project-image uploads can reach object storage.

        All four credential/endpoint values are needed: an endpoint without keys
        cannot authenticate, and keys without an endpoint fall back to AWS proper
        — the wrong account entirely. `S3_BUCKET` has a default, so it never
        blocks. When this is false the upload route answers `503`, exactly as
        `rebuild_configured` makes `/api/admin/publish` answer plainly instead of
        failing part-way.
        """
        return bool(
            self.AWS_ACCESS_KEY_ID.strip()
            and self.AWS_SECRET_ACCESS_KEY.strip()
            and self.AWS_ENDPOINT_URL_S3.strip()
        )

    @property
    def object_public_base_url(self) -> str:
        """The anonymous base URL every stored object is served from.

        Neon Object Storage serves an object at `<endpoint>/<bucket>/<key>` when
        the bucket is `public_read`; no signing and no credentials are involved.
        The trailing slash is stripped from the endpoint so the join cannot
        produce a double slash.
        """
        return f"{self.AWS_ENDPOINT_URL_S3.strip().rstrip('/')}/{self.S3_BUCKET.strip()}"

    @property
    def rebuild_configured(self) -> bool:
        """Whether `POST /api/admin/publish` can trigger a public rebuild."""
        return bool(self.DEPLOY_HOOK_URL.strip())

    @property
    def reingest_configured(self) -> bool:
        """Whether the publish flow can refresh the AI service's knowledge.

        Both halves must be set: the base URL and the shared admin token. Setting
        only one is a configuration error indistinguishable from a silent no-op, so
        neither counts until both are present.
        """
        return bool(
            self.AI_SERVICE_URL.strip() and self.AI_SERVICE_ADMIN_TOKEN.strip()
        )

    @field_validator("DATABASE_URL")
    @classmethod
    def _validate_database_url(cls, value: str) -> str:
        if not value.strip():
            raise ValueError(
                "DATABASE_URL is set but empty. Copy backend/.env.example to "
                "backend/.env and fill it in, or set it in the platform secret store."
            )
        return normalise_database_url(value)

    @field_validator("DEPLOY_HOOK_URL")
    @classmethod
    def _validate_deploy_hook_url(cls, value: str) -> str:
        """A deploy hook that is set must be a real http(s) URL.

        The value is a capability token and is never logged, but a mis-typed value
        (an email, a bare hostname, a relative path) would silently never build.
        Refusing it at startup is the only chance to tell the operator *before*
        the admin UI reports `configured` and then fails every publish.
        """
        url = value.strip()
        if not url:
            return ""
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(
                "DEPLOY_HOOK_URL must be an absolute http(s) URL (the Vercel Deploy "
                "Hook). The value is a capability token and is never logged."
            )
        return url

    @field_validator("AI_SERVICE_URL")
    @classmethod
    def _validate_ai_service_url(cls, value: str) -> str:
        """An AI base URL that is set must be a bare http(s) origin.

        Publish joins `/admin/reingest` onto it, so a value carrying its own path
        (or a query/fragment) would built a wrong URL. A leading slash is removed
        so a trailing `/` entered in a secret editor cannot double it.
        """
        url = value.strip().rstrip("/")
        if not url:
            return ""
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError(
                "AI_SERVICE_URL must be an absolute http(s) base URL, e.g. "
                "https://portfolio-lxdx.onrender.com"
            )
        if parsed.path or parsed.query or parsed.fragment:
            raise ValueError(
                "AI_SERVICE_URL must be a bare origin (scheme://host[:port]) with no "
                "path, query or fragment; publish appends /admin/reingest itself."
            )
        return url

    @field_validator("AI_SERVICE_ADMIN_TOKEN")
    @classmethod
    def _validate_ai_service_admin_token(cls, value: str) -> str:
        """Reject a token that is shorter than its own documentation.

        A one-character token would pass the "not configured" check and then be
        trivially guessable by any caller. Eight characters is not a security
        posture — the deployed value must be a long random secret — but it turns
        "set to a placeholder" into a startup error instead of a silent live
        failure. The value is never logged.
        """
        token = value.strip()
        if not token:
            return ""
        if len(token) < 8:
            raise ValueError(
                "AI_SERVICE_ADMIN_TOKEN must be at least 8 characters. Use "
                "`python -c \"import secrets; print(secrets.token_urlsafe(32))\"`."
            )
        return token

    @field_validator("ADMIN_BOOTSTRAP_TOKEN")
    @classmethod
    def _validate_admin_bootstrap_token(cls, value: str) -> str:
        """Reject a bootstrap token that is shorter than 32 characters.

        The bootstrap token grants one-time full initialization of the database
        and initial admin user. It must be a high-entropy secret. Unset or empty
        string disables bootstrap entirely.
        """
        token = value.strip()
        if not token:
            return ""
        if len(token) < 32:
            raise ValueError(
                "ADMIN_BOOTSTRAP_TOKEN must be at least 32 characters. Use "
                "`python -c \"import secrets; print(secrets.token_urlsafe(32))\"`."
            )
        return token

    @field_validator("TRUSTED_PROXY_HEADER")
    @classmethod
    def _validate_trusted_proxy_header(cls, value: str) -> str:
        """Admit only headers the documented edge is known to overwrite.

        `SECURITY.md` §3.6a: a caller-supplied header is trusted only when the
        proxy in front of the service replaces it on every request. Cloudflare
        does that for `CF-Connecting-IP` and explicitly does not for
        `X-Forwarded-For`, which it appends to. A configuration naming an
        unvetted header is refused at startup rather than silently allowing a
        caller to rotate rate-limit buckets — the exact defect this setting
        exists to remove.
        """
        header = value.strip().lower()
        if not header:
            return ""
        if header not in TRUSTED_PROXY_HEADERS:
            allowed = ", ".join(sorted(TRUSTED_PROXY_HEADERS))
            raise ValueError(
                f"TRUSTED_PROXY_HEADER {value!r} is not a header this service trusts. "
                f"Trusted headers (overwritten by the edge proxy): {allowed}. "
                "'x-forwarded-for' is caller-controlled and must never be trusted here."
            )
        return header

    @field_validator("LOG_LEVEL")
    @classmethod
    def _validate_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        if level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}:
            raise ValueError(f"LOG_LEVEL must be a standard logging level, got {value!r}.")
        return level

    @field_validator("ALLOWED_ORIGINS")
    @classmethod
    def _validate_allowed_origins(cls, value: str) -> str:
        """Reject malformed input; whether `*` is fatal depends on the environment."""
        for origin in _split_origins(value):
            if origin == "*":
                continue
            parsed = urlsplit(origin)
            if not parsed.scheme or not parsed.netloc:
                raise ValueError(
                    f"ALLOWED_ORIGINS entry {origin!r} is not an absolute origin. "
                    "Use scheme://host[:port], comma-separated."
                )
            if parsed.path or parsed.query or parsed.fragment:
                raise ValueError(
                    f"ALLOWED_ORIGINS entry {origin!r} must be a bare origin with no path, "
                    "query or fragment."
                )
        return value

    @model_validator(mode="after")
    def _reject_wildcard_outside_development(self) -> Settings:
        """A wildcard origin is a configuration error, not a default.

        `SECURITY.md` §2.3 tolerates `*` in development with a loud warning because
        that is convenient locally. Anywhere reachable from the internet it would let
        any website read the content API through the victim's browser, so the process
        refuses to start instead of degrading quietly.

        Staging is included in the refusal. It is publicly reachable and normally
        backed by a copy of real data, so a wildcard there is a staging accident
        rather than a deliberate choice; treating it as valid would also mean the
        production posture was never exercised until the production deploy.
        """
        if self.ENVIRONMENT in _WILDCARD_FORBIDDEN_ENVIRONMENTS and "*" in self.allowed_origins:
            environments = ", ".join(sorted(_WILDCARD_FORBIDDEN_ENVIRONMENTS))
            raise ValueError(
                "ALLOWED_ORIGINS must not contain '*' when ENVIRONMENT is "
                f"{environments}. List the exact origins instead."
            )
        return self

    @model_validator(mode="after")
    def _reject_absurd_session_lifetimes(self) -> Settings:
        """The absolute ceiling must not be shorter than the idle window.

        If it were, every session would be killed by absolute expiry long before
        the idle rule could apply, and a setting pair that looks deliberate would
        silently disable idle expiry — the opposite of what an operator writing
        both numbers intended.
        """
        if self.ADMIN_SESSION_ABSOLUTE_SECONDS < self.ADMIN_SESSION_IDLE_SECONDS:
            raise ValueError(
                "ADMIN_SESSION_ABSOLUTE_SECONDS "
                f"({self.ADMIN_SESSION_ABSOLUTE_SECONDS}) must be greater than or equal to "
                f"ADMIN_SESSION_IDLE_SECONDS ({self.ADMIN_SESSION_IDLE_SECONDS}); a shorter "
                "absolute lifetime would make idle expiry unreachable."
            )
        return self

    @property
    def trusted_proxy_header(self) -> str | None:
        """The trusted client-IP header name, or `None` when header trust is off."""
        return self.TRUSTED_PROXY_HEADER or None

    @property
    def allowed_origins(self) -> list[str]:
        """The parsed allow-list, in declaration order."""
        return _split_origins(self.ALLOWED_ORIGINS)

    @property
    def has_wildcard_origin(self) -> bool:
        return "*" in self.allowed_origins

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def is_development(self) -> bool:
        return self.ENVIRONMENT == "development"

    @property
    def admin_cookie_secure(self) -> bool:
        """Whether the session cookie carries the `Secure` attribute.

        `SECURITY.md` §3.3 requires `Secure`. The only exception is local
        development, where the frontend is served over plain `http://localhost`
        and a browser drops a `Secure` cookie outright — which would make the
        documented login flow untestable rather than safer.

        Staging and production are HTTPS-only, so both always get `Secure`. The
        check is on *development* specifically rather than "not production",
        because "not production" would silently weaken staging.
        """
        return not self.is_development

    @property
    def redacted_database_url(self) -> str:
        """`DATABASE_URL` with the password replaced by `***`.

        Safe to log. The username, host, port and database name are kept because
        they are the parts needed to diagnose a connection failure; the password
        never is.
        """
        scheme, separator, remainder = self.DATABASE_URL.partition("://")
        if not separator:
            return "***"
        credentials, at, location = remainder.rpartition("@")
        if not at:
            return "***"
        user, colon, _password = credentials.partition(":")
        masked = f"{user}{colon}***" if colon else user
        return f"{scheme}://{masked}@{location}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings instance."""
    return Settings()