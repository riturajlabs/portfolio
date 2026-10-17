# Environment variables

This document is the source-of-truth map for local development and the three
deployment surfaces. Values in the committed example files are safe defaults or
empty placeholders only. Real secrets belong in ignored local files or the
hosting provider's secret store.

## Local development

| File | Consumed by | Required values |
|---|---|---|
| `.env` or `.env.local` | Vite/build scripts | `VITE_BACKEND_URL` for direct local chat; `CONTENT_API_URL` for a build |
| `backend/.env` | `backend/app/config.py` | `DATABASE_URL`; optionally object storage, Resend, GitHub, publish and AI re-ingest settings |
| `ai_service/.env` | `ai_service/config/settings.py` and direct `os.getenv` reads | Provider keys for real chat/ingestion; `AI_SERVICE_KEY` and `ADMIN_TOKEN` when testing protected routes |

The backend loads `backend/.env` through Pydantic settings. The AI service calls
`load_dotenv()` and therefore loads `.env` relative to its working directory.
Vite and Node build scripts read the root environment. A root `.env` is not a
substitute for either service-specific file.

Local defaults intentionally differ from production: `ENVIRONMENT=development`
and `ENV=development` allow local testing, while Render must use
`ENVIRONMENT=production` and `ENV=production`.

## Variable ownership matrix

### Frontend and build-time variables

| Variable | Consumer | Required | Secret | Classification |
|---|---|---:|---:|---|
| `VITE_BACKEND_URL` | `src/components/common/ChatAssistant.jsx` | Local chat only | No | Verified local default in `.env.example`; leave unset on Vercel |
| `CONTENT_API_URL` | `scripts/build-content.mjs`, `src/lib/content.js` build helpers | Production Vercel build | No | Local default is verified; production target is the checked-in backend URL `https://portfolio-api-j7xc.onrender.com/api/content`, but the Vercel setting itself is not readable from this repository |
| `CONTENT_API_TIMEOUT` | Build helpers | No | No | Verified default: 10 seconds |
| `CONTENT_API_ATTEMPTS` | Build helpers | No | No | Verified default: `4` bounded attempts (retries transient cold-start/timeout/5xx failures; capped at 10) |
| `BACKEND_API_KEY` | Vercel `middleware.js` only | Production chat | Yes | Missing from local files; must equal AI service `AI_SERVICE_KEY` |

No `VITE_*` variable may contain a secret. `BACKEND_API_KEY` is intentionally
server-side middleware configuration, not a Vite variable.

### Backend API (`backend/`)

| Variable | Required | Secret | Default / condition |
|---|---:|---:|---|
| `DATABASE_URL` | Yes | Yes | No default; PostgreSQL URL is validated and normalized |
| `ENVIRONMENT` | No | No | `development`; Render `production` |
| `LOG_LEVEL` | No | No | `INFO` |
| `TRUSTED_PROXY_HEADER` | No | No | Empty locally; Render `cf-connecting-ip` |
| `ALLOWED_ORIGINS` | No | No | Exact Vercel and local origins |
| `CONTENT_RATE_LIMIT`, `CONTENT_RATE_WINDOW_SECONDS` | No | No | `300`, `60` |
| `ADMIN_SESSION_IDLE_SECONDS`, `ADMIN_SESSION_ABSOLUTE_SECONDS` | No | No | `43200`, `604800` |
| `ADMIN_LOGIN_IP_LIMIT`, `ADMIN_LOGIN_IP_WINDOW_SECONDS` | No | No | `10`, `900` |
| `ADMIN_LOGIN_EMAIL_FAILURE_LIMIT`, `ADMIN_LOGIN_EMAIL_WINDOW_SECONDS` | No | No | `5`, `900` |
| `ADMIN_READ_RATE_LIMIT`, `ADMIN_READ_RATE_WINDOW_SECONDS` | No | No | `600`, `60` |
| `CONTACT_RATE_LIMIT`, `CONTACT_RATE_WINDOW_SECONDS` | No | No | `5`, `60` |
| `RESEND_API_KEY` | Production contact delivery | Yes | Empty disables delivery with an explicit error |
| `RESEND_API_URL` | No | No | `https://api.resend.com/emails` |
| `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` | Contact delivery | No | Sandbox sender and project inbox. With the `onboarding@resend.dev` sandbox sender, the recipient must be the Resend account owner (see `DEPLOYMENT.md` §1.4) |
| `GITHUB_USERNAME`, `GITHUB_TOKEN` | GitHub proxy | Token optional | `GITHUB_USERNAME` is empty in code; Render sets `riturajlabs` |
| `DEPLOY_HOOK_URL` | Optional publish rebuild | Yes | Empty disables the rebuild step |
| `DEPLOY_HOOK_TIMEOUT_SECONDS` | No | No | `10` |
| `AI_SERVICE_URL` | Optional publish re-ingestion | No | Empty disables the step |
| `AI_SERVICE_ADMIN_TOKEN` | Optional publish re-ingestion | Yes | Must equal AI `ADMIN_TOKEN` |
| `AI_SERVICE_TIMEOUT_SECONDS` | No | No | `30` |
| `ADMIN_BOOTSTRAP_TOKEN` | One-time production bootstrap | Yes | Empty disables; configured value must be at least 32 characters |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Object storage | Yes when storage is enabled | Yes | Neon Object Storage credentials |
| `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | Object storage | Endpoint required when enabled | Endpoint is non-secret; region is non-secret | Endpoint is branch-scoped |
| `S3_BUCKET`, `S3_IMAGE_MAX_BYTES` | Project images | No | No | `media`, `5000000`; bucket must be `public_read` |
| `S3_RESUME_BUCKET`, `S3_RESUME_MAX_BYTES` | Resume | No | No | `uploads`, `10000000`; bucket must remain private |
| `RESUME_RATE_LIMIT`, `RESUME_RATE_WINDOW_SECONDS` | Resume download | No | No | `60`, `60` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Explicit local admin CLI only | Password yes | Empty | Never needed by the running API |
| `TEST_DATABASE_URL` | Backend tests | Yes for isolated tests | Yes | Disposable test database only |

### AI service (`ai_service/`)

| Variable | Required | Secret | Default / condition |
|---|---:|---:|---|
| `ENV` | No | No | `development` locally; Render must set `production` |
| `PORT` | Render-provided | No | `8000` locally |
| `AI_SERVICE_KEY` | Protected production chat | Yes | Must equal Vercel `BACKEND_API_KEY` |
| `TRUSTED_CLIENT_IP_HEADER` | Render rate-limit bucketing | No | Empty locally; Render `x-vercel-client-ip` |
| `CLIENT_IP_SIGNING_SECRET` | No | Yes | Defaults to `AI_SERVICE_KEY`; if set separately, it must equal Vercel `BACKEND_API_KEY` |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | Real chat/embeddings | Yes | Provider credentials; both are used by the current routing and ingestion paths |
| `GROQ_MODEL`, `CHAT_GEMINI_MODEL` | No | No | `llama-3.3-70b-versatile`, `gemini-2.5-flash` |
| `CHAT_TOP_K`, `CHAT_SCORE_THRESHOLD`, `SCORE_THRESHOLD` | No | No | `5`, `0.7`, `0.65` |
| `SHORT_QUERY_TOKEN_THRESHOLD`, `PRIMARY_PROVIDER` | No | No | `100`, `auto` |
| `CHAT_MAX_TOKENS`, `CHAT_QUERY_TIMEOUT`, `CHAT_SSE_KEEPALIVE`, `CHAT_TEMPERATURE` | No | No | `512`, `10`, `15`, `0.1` |
| `CHAT_RATE_LIMIT`, `CHAT_RATE_WINDOW` | No | No | `10`, `60` |
| `LLM_CACHE_ENABLED`, `LLM_CACHE_TTL_SECONDS`, `LLM_CACHE_MAX_ENTRIES` | No | No | `1`, `120`, `256` |
| `EMBEDDING_CACHE_DISABLED`, `EMBEDDING_CACHE_MAX_ROWS`, `EMBEDDING_CACHE_PATH` | No | No | `0`, `1000`, `./embedding_cache.sqlite` |
| `CHROMA_DB_PATH`, `KNOWLEDGE_FILE`, `COLLECTION_NAME` | No | No | Local filesystem and collection defaults |
| `CONTENT_API_URL`, `CONTENT_API_TIMEOUT`, `KNOWLEDGE_SOURCE` | Production ingestion | No | Local API URL, `10`, `api`; Render must point to the backend content endpoint |
| `ADMIN_TOKEN` | Optional `/admin/*` routes | Yes | Must equal backend `AI_SERVICE_ADMIN_TOKEN` |
| `GITHUB_USERNAME`, `GITHUB_TOKEN` | Legacy direct GitHub route | Token optional | Server-side only |
| `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` | Legacy direct contact route | Key yes | Supported by the currently mounted AI contact route; production traffic is rewritten to the backend |
| `ALLOWED_ORIGINS` | CORS | No | Exact Vercel and local origins |
| `FORCE_REINGEST` | One-time startup control | No | Unset normally; `1` only for deliberate re-ingestion |

## Deployment matrix

### Render `portfolio-api`

`render.yaml` manages the non-secret values `PYTHON_VERSION`, `ENVIRONMENT`,
`LOG_LEVEL`, `TRUSTED_PROXY_HEADER`, `ALLOWED_ORIGINS`, `AI_SERVICE_URL`,
timeouts, `GITHUB_USERNAME`, contact addresses and both bucket names. It prompts
for the secret values marked `sync: false`: `DATABASE_URL`,
`ADMIN_BOOTSTRAP_TOKEN`, `DEPLOY_HOOK_URL`, `AI_SERVICE_ADMIN_TOKEN`,
`RESEND_API_KEY`, `GITHUB_TOKEN`, and the four `AWS_*` storage credentials.

The Blueprint does not currently declare every optional backend setting. Add
those manually only when overriding the defaults in `backend/.env.example`.
Do not put the AI provider keys in this service.

### Render AI service (`portfolio-lxdx`)

Configure the service manually with `ENV=production`, `CONTENT_API_URL` set to
`https://portfolio-api-j7xc.onrender.com/api/content`, `AI_SERVICE_KEY` matching
Vercel `BACKEND_API_KEY`, `ADMIN_TOKEN` matching backend
`AI_SERVICE_ADMIN_TOKEN`, `TRUSTED_CLIENT_IP_HEADER=x-vercel-client-ip`, and
the provider keys. Add the optional tuning variables only when an override is
intended. The current repository cannot verify the deployed dashboard values.

### Vercel frontend

Set `CONTENT_API_URL=https://portfolio-api-j7xc.onrender.com/api/content` and
`BACKEND_API_KEY` in the Production environment, then rebuild. The same
non-secret content URL may be set for Preview if previews should build from the
production content API; otherwise use a preview backend URL. Keep
`VITE_BACKEND_URL` unset in Preview and Production unless deliberately testing a
direct local-style chat connection. Never set a `VITE_*` secret.

The production backend is a Render free-tier service that cold-starts after
idling; the build already retries transient failures (default `CONTENT_API_ATTEMPTS=4`,
`CONTENT_API_TIMEOUT=10` per attempt) so a cold start does not fail the build. Override
those two non-secret values only to widen the budget further.

## Current local value audit

The ignored local files `.env`, `.env.local`, `backend/.env`, and
`ai_service/.env` are present. Their values were checked only for presence and
format; no secret values are reproduced here. The root files contain local
Neon/Vercel tooling values, `backend/.env` contains a local database and
development settings, and `ai_service/.env` contains local provider/service
configuration. Existing local values were preserved.

## Validation and remaining blockers

Useful checks after changing a local file:

```sh
npx yaml-lint render.yaml
npm run lint
npm test
npm run lint:ai_service
npm run test:ai_service
npm run test:api
```

The production build requires a reachable, seeded `CONTENT_API_URL`; it should
be run only with that intended non-secret URL configured. Deployment remains
blocked until the operator verifies the Render database URL, provider keys,
storage credentials/bucket state, Resend key, both shared authentication
secrets, and the Vercel Production variables in their respective dashboards.
