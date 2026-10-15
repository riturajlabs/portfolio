# Local development

The supported daily workflow is managed by `scripts/local.mjs`; it does not
use Docker because this repository has no Compose configuration. PostgreSQL is
the existing local PostgreSQL server, while the three application processes use
the repository's existing virtual environments and npm scripts.

## First-time setup

```bash
npm install
cd backend && .venv/bin/python -m pip install -e '.[dev]' && cd ..
ai_service/.venv/bin/python -m pip install -r ai_service/requirements.txt
npm run local:setup
```

`local:setup` checks the three ignored `.env` files, local PostgreSQL,
migrations, and the idempotent content seed. It never prints secret values and
does not drop or recreate a database.

Configure and provision the local admin with the instructions in
[LOCAL_ADMIN_AUTH.md](./LOCAL_ADMIN_AUTH.md). `local:up` never creates or
changes admin credentials automatically.

## Daily commands

```bash
npm run local:up       # start/reuse backend, AI service, and Vite frontend
npm run local:status   # non-secret service table
npm run local:check    # health, readiness, API, database, and admin checks
npm run local:stop     # stop only process groups started by local:up
```

`local:dev` is an alias for `local:up`. A healthy service already listening on
the expected port is reused. An occupied port with an unhealthy or unknown
process causes a clear failure; the script never kills an unrelated process.
Logs from processes started by the workflow are written under `.cache/local/`.

## Local URLs

| Service | URL |
|---|---|
| Frontend | http://127.0.0.1:5173 |
| Admin | http://127.0.0.1:5173/admin |
| Backend health | http://127.0.0.1:8001/health |
| Backend readiness | http://127.0.0.1:8001/ready |
| Backend content | http://127.0.0.1:8001/api/content |
| AI health | http://127.0.0.1:8000/health |
| AI readiness | http://127.0.0.1:8000/ready |

The backend uses the existing `backend/.env` development database. The AI
service uses the configured provider keys and persistent `ai_service/chroma_db`
and `ai_service/embedding_cache.sqlite` paths. Contact delivery and GitHub
requests are real integrations only when their server-side variables are
configured; otherwise the application reports the provider failure rather than
pretending delivery succeeded.

## Manual smoke test

1. Run `npm run local:up`, then `npm run local:check`.
2. Open the frontend and verify navigation, projects, resume, theme switching,
   GitHub, and contact validation.
3. Open `/admin`; use the existing local admin account. Do not reset its
   password unless the application owner explicitly approves it.
4. Submit a contact message and verify the message appears in the admin inbox.
   A missing Resend key stores the message but cannot prove email delivery.
5. Open chat and ask a question about one of the five projects. Verify the
   response streams and that `/ready` was 200 first.
6. Use browser DevTools Network and Console tabs to check status codes, CORS,
   failed requests, and exposed values. Server-only values must never appear in
   the browser bundle.

Automated checks remain available through the scripts in `package.json`,
including `npm run test:e2e`.
