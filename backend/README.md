# Portfolio Backend — Content Service

FastAPI + PostgreSQL service that will own portfolio content.

**Stage: Admin authentication & server sessions (Phase 4).** The schema, migrations, health endpoints,
`GET /api/content`, Argon2id admin authentication, session management, CSRF protection, and login rate limiting
exist and are fully tested. The admin dashboard UI and content seed do **not** exist yet, so all content still
lives in `src/data/` and the deployed site is unaffected — nothing calls these endpoints until later phases.

Design authority: [`docs/DATABASE.md`](../docs/DATABASE.md) (9 tables),
[`docs/API.md`](../docs/API.md) (endpoint contracts),
[`docs/MIGRATION.md`](../docs/MIGRATION.md) (phase plan).

---

## Stack

| Choice | Note |
|---|---|
| Python 3.11+ | Typed `X \| None` syntax, `match`-free, `from __future__ import annotations` |
| FastAPI | ASGI, OpenAPI for free |
| SQLAlchemy 2.x, async | `AsyncSession`, `async_sessionmaker` |
| asyncpg | No C extension to compile |
| Alembic | One revision per phase group |
| pytest + pytest-asyncio | Against a real PostgreSQL instance |
| Ruff | Lint and import order |

---

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env               # then fill in DATABASE_URL
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL URL. A plain `postgresql://` URL is rewritten to `postgresql+asyncpg://` automatically, so a platform-supplied sync URL works unchanged. Production requires `?sslmode=require`; keep it in the URL — `app/config.py` translates it to the `ssl` keyword asyncpg accepts and drops libpq-only parameters such as Neon's `channel_binding` |
| `ENVIRONMENT` | no | `development` \| `staging` \| `production`. Defaults to `development` |
| `LOG_LEVEL` | no | Standard logging level. Defaults to `INFO` |
| `TEST_DATABASE_URL` | tests only | A **throwaway** database for `pytest`. Never point this at development or production |
| `ALLOWED_ORIGINS` | no | Comma-separated CORS allow-list for `GET /api/content`. Defaults to the Vercel domain plus `localhost:5173` and `127.0.0.1:5173`. Entries must be bare origins; `*` is refused in `production` and `staging` |
| `CONTENT_RATE_LIMIT` | no | Requests per window per client IP on `GET /api/content`. Defaults to `300` (`API.md` §8) |
| `CONTENT_RATE_WINDOW_SECONDS` | no | Rate-limit window. Defaults to `60` |
| `ADMIN_SESSION_IDLE_SECONDS` | no | Session idle timeout, also used as the cookie `Max-Age`. Defaults to `43200` (12 h) |
| `ADMIN_SESSION_ABSOLUTE_SECONDS` | no | Absolute session lifetime, which no amount of activity extends. Defaults to `604800` (7 d). Must be ≥ the idle timeout |
| `ADMIN_LOGIN_IP_LIMIT` | no | Login attempts per IP per window. Defaults to `10` |
| `ADMIN_LOGIN_IP_WINDOW_SECONDS` | no | Per-IP window. Defaults to `900` |
| `ADMIN_LOGIN_EMAIL_FAILURE_LIMIT` | no | Failed logins per email per window. Defaults to `5` |
| `ADMIN_LOGIN_EMAIL_WINDOW_SECONDS` | no | Per-email window. Defaults to `900` |

`Secure` is set on the session cookie whenever `ENVIRONMENT` is not
`development`, so a local `http://localhost:8000` still works while staging and
production refuse to send the cookie over plaintext.

There is no default for `DATABASE_URL`. A hard-coded host, port, user, password
or database name would leak into the deployment configuration and would
silently point a production process at the wrong server, so the application
refuses to start without one. `alembic.ini` has an empty `sqlalchemy.url` for the
same reason — `alembic/env.py` takes the URL from application settings.

---

## Database

```bash
export DATABASE_URL="postgresql://user@localhost:5432/portfolio_dev"

python -m alembic upgrade head       # create the schema
python -m alembic current            # 0002_certification_unique (head)
python -m alembic check              # detect model/migration drift
python -m alembic downgrade base     # drops the 9 tables; keeps alembic_version + citext
```

`0001_initial` creates **exactly the 9 tables** in `DATABASE.md` §0 and ensures
the `citext` extension. It seeds nothing. `0002_certification_unique` adds the
documented `certification (title, issuer)` unique constraint. `downgrade base`
removes the tables but deliberately leaves `citext` in place: it is database-level
infrastructure that may have pre-existed the migration or be shared, so removing
it is a DBA action, never an automatic side effect of a downgrade.

> **`citext` needs superuser rights once per database.** `citext` is not a core
> PostgreSQL type, so the migration issues `CREATE EXTENSION IF NOT EXISTS citext`.
> On Neon, Supabase or RDS where the application role cannot create extensions, a
> DBA must run it once before the first migration:
>
> ```sql
> CREATE EXTENSION IF NOT EXISTS citext;
> ```
>
> Because the extension may be DBA-managed, `alembic downgrade base` does **not**
> drop `citext` — it drops only the 9 tables. To remove the extension, a DBA runs
> `DROP EXTENSION citext;` explicitly.
>
> `gen_random_uuid()` needs no extension on PostgreSQL 13+.

**Never edit an applied revision.** Change the model and generate a new one:

```bash
python -m alembic revision --autogenerate -m "describe the change"
```

---

## Running

```bash
python -m uvicorn app.main:app --reload --port 8001
```

| Endpoint | Response | Notes |
|---|---|---|
| `GET /health` | `200 {"status":"ok"}` | No database call. 200 even when the database is down |
| `GET /ready` | `200 {"status":"ready"}` / `503 {"detail":"database not ready"}` | Checks reachability, applied revision, and table presence |
| `GET /api/content` | `200` | Aggregated public content payload, ETag/304, cacheable |
| `POST /api/admin/auth/login` | `200` / `401` / `429` | Argon2id verify, sets HttpOnly session cookie, login rate limited |
| `POST /api/admin/auth/logout` | `204` / `401` / `403` | Revokes server session, clears cookie, requires CSRF token |
| `GET /api/admin/me` | `200` / `401` | Returns safe admin identity and session-bound CSRF token |

The two are deliberately different. `/ready` reporting 503 on a database outage
is useful information; `/health` reporting the same would make an infrastructure
problem indistinguishable from an application crash and cause a restart loop.
`/ready` logs the specific reason server-side as a `readiness_failed` event and
returns one generic detail string — a probe response is not an error channel.

---

## Tests

```bash
TEST_DATABASE_URL="postgresql://user@localhost:5432/portfolio_test" python -m pytest -q
python -m ruff check .
```

**324 tests, against a real PostgreSQL instance.** Not SQLite: `citext`, `jsonb`,
`text[]`, UUID defaults, CHECK constraints and `ON DELETE CASCADE` either do not
exist or behave differently there, so a green SQLite run would prove nothing about
the target database.

`TEST_DATABASE_URL` alone is enough — the fixtures point application settings at
the test database before `app.main` is imported. `PGHOST`/`PGUSER`/`PGPASSWORD`/
`PGDATABASE` are used when it is unset, which is how CI supplies service-container
credentials without a password in the repository. With neither, collection fails
with instructions. Nothing is skipped: an unconfigured database is a failure.

| File | Covers |
|---|---|
| `tests/test_database_schema.py` | Exactly 9 tables, every column/type/nullability, indexes, UUID defaults, `citext`, 3 FKs and their delete rules, no seed data |
| `tests/test_constraints.py` | Every CHECK in `DATABASE.md` §13 with a failing case, plus accepted values and defaults |
| `tests/test_relationships.py` | `ON DELETE CASCADE` and `SET NULL` behaviour |
| `tests/test_health.py` | Liveness with the database unreachable, 404 without a route listing |
| `tests/test_readiness.py` | 503 when unreachable, unmigrated, stale, or missing tables |
| `tests/test_content_api.py` | Response key set, strict `extra="forbid"`, visibility filters, deterministic ordering, derived fields, `generated_at`, ETag/304, payload budget, 404/500/503 paths, read-only transaction |
| `tests/test_payload_snapshot.py` | Whole payload matches `tests/snapshots/content_payload.json`; a seeded state is byte-stable |
| `tests/test_cors.py` | Allow-list parsing, malformed origins rejected at startup, wildcard refused outside development, preflight, credentials never enabled |
| `tests/test_rate_limit.py` | 300/min boundary, per-IP buckets, window rollover, `Retry-After` correctness, thread safety, `/health` + `/ready` exempt |
| `tests/test_auth.py` | Admin login, logout, /me, Argon2id verification, dummy hash timing, generic 401s, HttpOnly cookies, session creation, audit logging |
| `tests/test_sessions.py` | 12h idle timeout, 7d absolute timeout, activity non-extension of absolute, immediate revocation, token uniqueness/entropy |
| `tests/test_csrf.py` | CSRF token generation/binding, double-submit validation, safe methods exemption, 403 on missing/invalid token, all admin routes protected |
| `tests/test_login_rate_limit.py` | 10 attempts/15 min/IP, 5 failures/15 min/email, success non-failure, case-insensitive email normalization, 429 headers |

**Do not run this against a database you care about.** The session fixture drops
and recreates the `public` schema.

Constraint tests issue raw SQL rather than going through a model or a Pydantic
schema: the claim under test is that the *database* refuses the write, and a
validation layer that rejected the value first would leave the suite green while
the CHECK was missing.

---

## Layout

```text
backend/
├── app/
│   ├── __init__.py
│   ├── config.py            Settings, DATABASE_URL normalisation, redaction
│   ├── logging.py           JSON formatter, log_event()
│   ├── main.py              create_app(), lifespan, exception handlers
│   ├── db/
│   │   ├── base.py          DeclarativeBase, metadata naming conventions
│   │   ├── session.py       Lazy async engine + session factory
│   │   └── migrations.py    Head-revision discovery for /ready
│   ├── models/              One module per table (DATABASE.md §5)
│   ├── rate_limit.py        In-process fixed-window limiter (API.md §8)
│   ├── schemas/content.py   Strict Pydantic models for the public payload
│   ├── services/content.py  The only transformation layer; 4 named-column queries
│   └── routes/
│       ├── health.py        /health, /ready
│       └── content.py       GET /api/content, ETag/304, 429
├── alembic/
│   ├── env.py               Async migrations, URL from settings
│   └── versions/           0001_initial.py, 0002_certification_unique.py
├── tests/
├── alembic.ini              No credentials
├── pyproject.toml
└── .env.example             Names only, all values blank
```

The engine is created lazily, so importing the application never opens a socket.
That is what lets `/health` answer 200 while the database is unreachable, and lets
a test run point the process at a different database before the first connection.

---

## Not built yet

Deliberately absent — each belongs to a later phase in `docs/MIGRATION.md`:

| Absent | Phase |
|---|---|
| `POST`/`PUT`/`DELETE /api/admin/*` content mutations (auth itself exists) | 5 |
| Admin dashboard UI | 5 |
| Admin provisioning (no way to create the first user yet) | deployment/bootstrap |
| Seed data (`src/data/*.js` → PostgreSQL) | 6 |
| `POST /api/contact`, `GET /api/github` | 8 |
| AI service integration | 9 |
| Frontend build wiring, deployment config | 8 / 11 |

**No migration was added in Phase 4.** `admin_user`, `admin_session` and
`admin_audit_log` already exist from Phase 2, so Phase 4 only wrote to them.
One dependency *was* added: `argon2-cffi`, for Argon2id.