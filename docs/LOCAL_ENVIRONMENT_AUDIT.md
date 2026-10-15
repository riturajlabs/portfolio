# Local environment audit

## Scope

This audit covers the React/Vite frontend, FastAPI backend, AI FastAPI service,
local PostgreSQL, ChromaDB/embedding persistence, admin routes, build pipeline,
and Playwright workflow. No commit, push, deployment, database reset, volume
deletion, or production operation was performed.

## Findings and fixes

| Area | Finding | Resolution |
|---|---|---|
| Startup | Services had to be started manually and build/parity failed when backend was down | Added `scripts/local.mjs` and `local:*` npm commands |
| Python dependencies | Backend used `slowapi` without declaring it; AI test tools were not in requirements | Declared `slowapi`, `pytest`, and `ruff` |
| Seed | `seed:load` depended on a global `python` and did not load backend `.env` | Uses `.venv/bin/python`; seed loads `backend/.env` |
| E2E | Local E2E launcher assumed TCP PostgreSQL and global Python | Uses local Unix socket and backend virtualenv while retaining CI behavior |
| Lint | AI service had four Ruff findings | Applied safe Ruff fixes |
| Environment | Local templates did not list every effective variable | Added safe local names/defaults without exposing values |
| Admin authentication | Development database had no `admin_user` row, so login could never succeed | Added explicit server-side `admin:setup` and `admin:reset` commands using the existing Argon2id/session architecture |

## Verification

Observed passing results include 116 frontend tests, 442 backend tests, 47 AI
tests, 14 Playwright tests, frontend/backend/AI lint, Alembic drift checks,
migration validation, production build, seed load, and content parity.

The frontend unit tests intentionally run without the backend and log the
documented GitHub fallback. This is expected test isolation, not a failed
application startup.

The development database was queried without selecting or printing password
hashes, cookies, or tokens. At verification time it contained zero admin
accounts. The setup command was smoke-tested only against the disposable
`portfolio_test` database; no development admin account or CMS content remains
from that test.

## Remaining limitations

- Real Resend delivery requires a valid server-side `RESEND_API_KEY` and sender.
- Real Groq/Gemini responses require valid provider keys and quota.
- Local production-like testing does not reproduce hosted TLS, Vercel, Render,
  managed database networking, or production provider limits.
- The existing working tree contains broad pre-existing/uncommitted migration
  work; it was preserved and not committed.
