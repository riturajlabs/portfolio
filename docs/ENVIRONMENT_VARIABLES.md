# Environment variables

Real values belong only in ignored `.env` files or a platform secret store.
The committed example files contain names and safe placeholders only.

| Variable | Service | Required locally | Exposure |
|---|---|---:|---|
| `VITE_BACKEND_URL` | frontend | yes for chat | public URL only |
| `BACKEND_API_KEY` | frontend (Vercel edge, `middleware.js`) | no (production only) | server-only; **must equal `AI_SERVICE_KEY`** |
| `DATABASE_URL` | backend | yes | server-only |
| `TEST_DATABASE_URL` | backend tests | yes for API tests | server-only, disposable DB |
| `ADMIN_EMAIL` | backend admin CLI | required when provisioning | server-only |
| `ADMIN_PASSWORD` | backend admin CLI | required when provisioning | server-only |
| `ADMIN_BOOTSTRAP_TOKEN` | backend | optional (one-time production bootstrap only) | server-only, capability token |
| `ENVIRONMENT` | backend | no | server-only |
| `PYTHON_VERSION` | backend (Render) | no | server-side configuration |
| `TRUSTED_PROXY_HEADER` | backend | no (set on Render) | server-side policy |
| `ALLOWED_ORIGINS` | backend/AI | no | server-only policy |
| `CONTENT_RATE_LIMIT` / `CONTENT_RATE_WINDOW_SECONDS` | backend | no | server-side configuration |
| `AI_SERVICE_KEY` | AI | needed for protected production chat | server-only |
| `ENV` | AI | no (defaults to `production`) | server-only; **must not be `development` in production** (disables chat auth) |
| `TRUSTED_CLIENT_IP_HEADER` | AI | no (set on Render) | server-side policy |
| `CLIENT_IP_SIGNING_SECRET` | AI | no (defaults to `AI_SERVICE_KEY`) | server-only |
| `GROQ_API_KEY` | AI | needed for Groq chat | server-only |
| `GEMINI_API_KEY` | AI | needed for Gemini fallback | server-only |
| `GITHUB_USERNAME` | backend/AI | optional | server-side configuration |
| `GITHUB_TOKEN` | backend | optional | server-only |
| `DEPLOY_HOOK_URL` | backend | optional (enables rebuild) | server-only, capability token |
| `DEPLOY_HOOK_TIMEOUT_SECONDS` | backend | no | server-side configuration |
| `AI_SERVICE_URL` | backend | optional (enables AI re-ingest) | server-side configuration |
| `AI_SERVICE_ADMIN_TOKEN` | backend/AI | optional (enables AI re-ingest) | server-only, capability token |
| `AI_SERVICE_TIMEOUT_SECONDS` | backend | no | server-side configuration |
| `ADMIN_TOKEN` | AI | optional (enables re-ingest/cache routes) | server-only, capability token |
| `RESEND_API_KEY` | backend/AI legacy | optional in development | server-only |
| `CONTACT_FROM_EMAIL` | backend | optional | server-side configuration |
| `CONTACT_TO_EMAIL` | backend | optional | server-side configuration |
| `AWS_ACCESS_KEY_ID` | backend | optional (enables image upload) | server-only, capability token |
| `AWS_SECRET_ACCESS_KEY` | backend | optional (enables image upload) | server-only, capability token |
| `AWS_ENDPOINT_URL_S3` | backend | optional (enables image upload) | server-side configuration; branch-scoped |
| `AWS_REGION` | backend | optional (enables image upload) | server-side configuration |
| `S3_BUCKET` | backend | no (defaults to `media`) | server-side configuration; bucket must be `public_read` |
| `S3_IMAGE_MAX_BYTES` | backend | no (defaults to 5000000) | server-side configuration |
| `S3_RESUME_BUCKET` | backend | no (defaults to `uploads`) | server-side configuration; bucket must be private |
| `S3_RESUME_MAX_BYTES` | backend | no (defaults to 10000000) | server-side configuration |
| `RESUME_RATE_LIMIT` | backend | no (defaults to 60) | server-side configuration |
| `RESUME_RATE_WINDOW_SECONDS` | backend | no (defaults to 60) | server-side configuration |
| `CHROMA_DB_PATH` | AI | no | server filesystem path |
| `EMBEDDING_CACHE_PATH` | AI | no | server filesystem path |
| `CONTENT_API_URL` | AI/build | no | server/build configuration |
| `CONTENT_API_TIMEOUT` | AI/build | no | server/build configuration |
| `KNOWLEDGE_SOURCE` | AI | no, defaults to `api` | server configuration |

Never place database URLs, provider keys, admin tokens, session secrets, or
passwords in a `VITE_*` variable. Missing provider credentials must produce a
visible provider error or unavailable feature; they must not be replaced with
fabricated success.

Three capability secrets are shared across platforms and must hold the same
value on both sides (`docs/DEPLOYMENT.md` §3.5): Vercel `BACKEND_API_KEY` =
AI service `AI_SERVICE_KEY` (the `X-API-Key` gate on `/api/chat/*`, and the key
the edge signs `x-vercel-client-ip` with); backend `AI_SERVICE_ADMIN_TOKEN` =
AI service `ADMIN_TOKEN` (`X-Admin-Token` on `POST /admin/reingest`). Setting
one side alone fails closed — the backend reports `configured: false` and the AI
service answers `401` or hides the route (`404`).

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are read only by the explicit
`npm run admin:setup` and `npm run admin:reset` server-side commands. They are
not read by the frontend and changing them does not silently alter an existing
database account.

`ADMIN_BOOTSTRAP_TOKEN` is a **one-time** capability token. While it is a
non-empty string of at least 32 characters it enables `POST /api/admin/bootstrap`
(`backend/app/routes/admin_bootstrap.py`), which creates the first administrator
and loads the initial CMS content in a single atomic transaction — the only
supported way to initialize production on a free Render web service, which has
no Shell and no one-off jobs. It is read only by the backend, never by the
frontend, and it is supplied to the client half (`npm run admin:bootstrap`) from
your workstation's environment. **Remove it from the backend service and redeploy
immediately after a successful bootstrap**; empty disables the endpoint (404) and
a completed bootstrap already answers 409. See `docs/DEPLOYMENT.md` §6.6.

`DEPLOY_HOOK_URL` is a capability token: anyone holding the URL can start a
production build. It is read only by the backend, which calls it on behalf of the
`POST /api/admin/publish` route (`ADR-017`); the browser never receives it.
Leaving it unset disables the rebuild feature without breaking anything — the
endpoint then reports `configured: false`.

`AI_SERVICE_ADMIN_TOKEN` (backend) and `ADMIN_TOKEN` (AI service) are one shared
capability token: the backend sends it as `X-Admin-Token` to the AI service's
`POST /admin/reingest`, which is what makes a publish refresh chat's knowledge
instead of leaving it stale until restart. It is deliberately distinct from
`AI_SERVICE_KEY` so a leaked chat key cannot purge caches or force re-ingestion.
Leaving it (or `AI_SERVICE_URL`) unset disables that step without breaking the
rest of publish; the endpoint reports it `not_configured`.

`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3` and
`AWS_REGION` are what `neon deploy` writes for the project's Object Storage
service, and the backend reads the same names unchanged
(`backend/app/services/storage.py`). They authorize `POST /api/admin/uploads`,
which stores an admin-chosen project cover image in the bucket named by
`S3_BUCKET` (default `media`) and returns its absolute URL. All four names are
read only by the backend. Leave
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3` blank to disable
uploads cleanly — the image route answers `503` and the editor still accepts the
committed `/images/projects/*.webp` path; the resume route answers `503` and the
site keeps serving the committed PDF. The endpoint is **branch-scoped**
(its host embeds the branch id), so it changes if the branch is recreated.

The same credentials also serve `POST /api/admin/profile/resume`, which stores
the resume in `S3_RESUME_BUCKET` (default `uploads`) — the **private** bucket
`neon init` creates, distinct from the `public_read` `media` bucket. A resume is
a document, not a web asset: it gets no anonymous URL and is read only through
`GET /api/resume` (§6.3.2 of `docs/API.md`). The image bucket must be
`public_read` (its returned URL is baked into the static build as an `<img src>`,
so a private bucket or a presigned URL cannot work), while the resume bucket must
stay private (`neon.ts`). `S3_RESUME_MAX_BYTES` (default 10 MB) caps the upload,
and `RESUME_RATE_LIMIT`/`RESUME_RATE_WINDOW_SECONDS` (default 60/60 s) bound the
public read per IP.

The local templates are [.env.example](../.env.example),
[backend/.env.example](../backend/.env.example), and
[ai_service/.env.example](../ai_service/.env.example).
