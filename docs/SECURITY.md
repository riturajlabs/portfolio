# Security Documentation

**Document Status:** Active — **Phase 4 implemented 2026-10-04: Admin authentication, server-side sessions, Argon2id, secure cookies, CSRF, login rate limiting.**
**Document Type:** Security Model and Controls
**Version:** 2.1 — Phase 4 implemented and verified
**Last Verified Against Code:** uncommitted working tree (`backend/app/routes/admin_auth.py`, `backend/app/services/auth.py`, `backend/app/security/`)

---

## Reading Convention

| Label | Meaning |
|---|---|
| **CURRENT** | Implemented and verified in the code. |
| **TARGET** | Required before the migration phase that needs it. |
| **MIGRATION** | When the control is added. |

Architecture rationale: `ARCHITECTURE.md`. Phase plan: `MIGRATION.md`.

**Reporting a vulnerability** — this is a personal portfolio with no bug bounty.
Report it privately by email to `riturajlabs@outlook.com`. There is no public
issue tracker for security reports.

---

# 1. Threat Model

## 1.1 What is being protected

| Asset | Why it matters | Where it lives |
|---|---|---|
| **LLM API keys** (`GROQ_API_KEY`, `GEMINI_API_KEY`) | Direct financial cost per request | Render env |
| **`RESEND_API_KEY`** | Email sending quota, sender reputation | Render env |
| **`GITHUB_TOKEN`** | API quota, potential repo access scope | Render env |
| **`BACKEND_API_KEY` / `AI_SERVICE_KEY`** | Gate to the LLM endpoints | Vercel edge + Render env |
| **Admin session secret** (**TARGET**) | Gate to content management | Render env |
| **Contact messages** | Personal data of third parties (**TARGET** DB) | PostgreSQL |
| **Portfolio content** | The product itself | Git repo + `dist/` |
| **Search rankings** | 6 indexable URLs | `sitemap.xml`, JSON-LD |
| **Server reputation / IP** | Hosting account | Render, Vercel, Resend |

## 1.2 Trust boundaries

```text
┌── UNTRUSTED ─────────────────────────────────────────────────┐
│  Visitor browser (any anonymous visitor)                     │
│  Third-party GitHub API, Resend API, LLM providers           │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌── SEMI-TRUSTED ───────────▼─────────────────────────────────┐
│  Vercel edge  (middleware.js)                               │
│  - owns BACKEND_API_KEY                                     │
│  - rewrites /api/* to Render                                │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS + X-API-Key
┌── TRUSTED ────────────────▼─────────────────────────────────┐
│  Render ai_service                                          │
│    - verifies X-API-Key                                     │
│    - holds LLM + Resend + GitHub secrets                    │
│    - indexes GET /api/content (read-only, Phase 9)          │
└─────────────────────────────────────────────────────────────┘

┌── TARGET TRUSTED ───────────────────────────────────────────┐
│  Render backend/                                            │
│    - holds DATABASE_URL, Resend key, optional GITHUB_TOKEN  │
│    - the ONLY component that touches PostgreSQL              │
│  Managed PostgreSQL                                          │
│    - network-restricted to backend/ only                     │
│  Vercel static output + admin SPA                            │
│    - zero secrets                                            │
└─────────────────────────────────────────────────────────────┘
```

**Key property:** no secret is ever present in the public bundle. The browser
never holds `BACKEND_API_KEY`; the edge injects it.

## 1.3 Attack surface

| Surface | Endpoint / path | Auth | Rate limit | Risk |
|---|---|---|---|---|
| Chat (SSE) | `POST /api/chat`, `/api/chat/stream` | `X-API-Key` | 10/min | **High** — costs money per call |
| Contact | `POST /api/contact` | **none** | 5/min | **High** — outbound email, spam relay |
| GitHub proxy | `GET /api/github` | **none** | 300 s cache | Medium — upstream quota |
| Static site | `GET /*` | none | CDN | Low |
| Health | `/health`, `/ready` | none | none | Low — must stay open for probes |
| Admin API (**TARGET**) | `/api/admin/*` | session cookie | 600/min | **Critical** — content + messages |
| Login (**TARGET**) | `POST /api/admin/auth/login` | none | 10/15min | **Critical** — credential stuffing |
| Content API (**TARGET**) | `GET /api/content` | none | 300/min | Low — read-only, cacheable |
| Database (**TARGET**) | port 5432 | credentials + network | n/a | **Critical** — restricted to `backend/` |

---

# 2. CURRENT Controls — Implemented and Verified

## 2.1 Secret handling

| Control | Status | Evidence |
|---|---|---|
| LLM/Resend/GitHub keys server-side only | **Yes** | `ai_service/config/settings.py` + `backend/app/config.py` (Phase 8: contact/GitHub now read from the backend) read from env; never exposed to the frontend |
| Shared secret injected at the edge | **Yes** | `middleware.js` sets `X-API-Key` from `process.env.BACKEND_API_KEY` |
| Browser never holds the API key | **Yes** | The key is added by middleware after the request leaves the browser |
| Secret never in the response body | **Yes** | No route echoes a key |
| Missing key fails closed | **Yes** | `middleware.js` returns `503` when `BACKEND_API_KEY` is unset; `security.py:91-104` raises `503` in production |
| Constant-time key comparison | **Yes** | `hmac.compare_digest` (`security.py:113`) |
| Dev auth bypass cannot be triggered accidentally | **Yes** | `ENV` defaults to `production` when unset (`security.py:55-58`) |
| No `VITE_*` variable in production | **Yes (verified)** | Only `VITE_BACKEND_URL` exists, documented as local-dev only |

## 2.2 Transport and headers

Configured in `vercel.json` and verified on the live domain:

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HTTPS enforcement, 2-year |
| `X-Content-Type-Options` | `nosniff` | Blocks MIME sniffing |
| `X-Frame-Options` | `SAMEORIGIN` | Clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | Disables unused APIs |
| `Cross-Origin-Opener-Policy` | `same-origin` | Isolates the browsing context |
| `Cross-Origin-Resource-Policy` | `same-site` | Blocks cross-site asset embedding |

**Gap (TARGET):** no `Content-Security-Policy`. See §3.4.

## 2.3 CORS

`ai_service/app.py:64-92`, and now `backend/app/config.py` +
`backend/app/main.py` for the content API:

* Default allow-list: `https://riturajlabs.vercel.app`,
  `http://localhost:5173`, `http://127.0.0.1:5173`.
* `ALLOWED_ORIGINS` overrides it, comma-separated. Entries must be **bare
  origins** (`scheme://host[:port]`) — a path, query, fragment, missing scheme or
  missing host is rejected at startup rather than silently excluded. Trailing
  slashes and stray commas are tolerated.
* `ai_service` treats `"*"` as a loud warning plus `allow_credentials = False`
  (browsers reject wildcard + credentials together).

**Tightened for `backend/`, Phase 3.** `ai_service`'s warning is not enough for the
service that serves the site's content, so `backend` refuses to start instead:

* `ALLOWED_ORIGINS` must not contain `*` when `ENVIRONMENT` is **`production` or
  `staging`**. Staging is included because it is publicly reachable and normally
  backed by a copy of real data; a wildcard there is an accident, and treating it
  as valid would mean the production posture was never exercised before a
  production deploy.
* `*` remains available in `development`, where it is convenient locally.
* `allow_credentials` is `False` unconditionally and is not configurable. The
  public content API takes no cookie, and the Phase 4 admin session has no reason
  to inherit a credentialed-CORS posture.
* Allowed methods are `GET` only; `ETag` is the sole exposed response header.

Enforced by `backend/tests/test_cors.py` (28 cases), including the negative cases:
a look-alike origin (`https://a.example.evil`), a preflight from an unlisted
origin, and `POST` preflighting.

**Gap:** `/api/contact` is intentionally **not** key-verified and is no longer
covered by the edge matcher. See §2.5.

**Assessment:** the chat path is correctly locked down; the wildcard path is guarded.

**Gap (TARGET):** `allow_methods=["*"]` and `allow_headers=["*"]` are broader than
necessary. `API.md` §8 narrows both.

## 2.4 Rate limiting

`ai_service/core/rate_limit.py` (slowapi) limits chat; the backend's
`FixedWindowLimiter` limits contact (Phase 8):

| Route | Limit | Key | Source |
|---|---|---|---|
| `POST /chat`, `/chat/stream` | 10/min | IP | `ai_service/core/rate_limit.py` |
| `POST /api/contact` | 5/min | IP | `backend/app/routes/contact.py` (`FixedWindowLimiter`, `CONTACT_RATE_LIMIT`) |
| `GET /api/github` | none | 300 s in-process cache absorbs it | `backend/app/services/github.py` |

Both handlers return `429` with `Retry-After`; the backend also sets
`X-RateLimit-Limit` and `X-RateLimit-Remaining`.

**Gap:** in-memory store — per-instance. Acceptable on a single-instance Render
service. **TARGET** keeps this and does not add Redis (ADR-014).

## 2.5 Auth verification is chat-only

| Endpoint | `verify_api_key` applied? | Evidence |
|---|---|---|
| `POST /chat` | **Yes** | `ai_service/chat.py:24` — router-level `Depends(verify_api_key)` |
| `POST /chat/stream` | **Yes** | Same router |
| `POST /api/contact` | **No** | `backend/app/routes/contact.py` — no `dependencies` |
| `GET /api/github` | **No** | `backend/app/routes/github.py` — no `dependencies` (intentional; public data) |
| `GET /health`, `/ready` | **No** | `ai_service/app.py:113-127` (intentional) |

**Finding.** `/api/contact` is public: `middleware.js` no longer lists it in its
matcher, so no `X-API-Key` is injected and none would be read. The endpoint is
reachable directly at `https://portfolio-api-j7xc.onrender.com/api/contact`, bypassing
Vercel and the edge entirely. Its only controls are the 5/min IP rate limit and
the honeypot. (Before the 2026-10-10 cleanup the matcher did cover it and inject a
header nothing verified; that coupling only made an unset `BACKEND_API_KEY`
return `503` for contact, so it was removed.)

**Severity: medium.** Impact is outbound email via Resend (a spam relay from
the portfolio's domain, and quota consumption on the owner's Resend account) —
not data exposure.

**Fix (one line, not in this migration's scope)**

```python
# backend/app/routes/contact.py (Phase 8)
router = APIRouter(
    prefix="/api",
    tags=["contact"],
    dependencies=[Depends(verify_api_key)],
)
```

**Why it is not applied here:** it changes a public endpoint's behaviour, and
`MIGRATION.md` Phase 8's mandate is to preserve request/response behaviour
exactly. It is recorded as a separate, one-line, independently revertible fix.

## 2.6 Development auth bypass

`core/security.py:61-84`: when `ENV=development`, `verify_api_key` returns
`True` unconditionally.

```python
if is_dev:
    logger.warning("AI_SERVICE_KEY missing. Auth bypass enabled in development.")
    return True
```

| Property | Assessment |
|---|---|
| Fails safe | **Yes.** `ENV` defaults to `production` when unset (`security.py:55-58`) |
| Logged | **Yes.** A warning on every call in dev |
| Risk | A deployed environment with `ENV=development` exposes chat with no auth |

**Rule:** `ENV=development` must never be set on Render. `DEPLOYMENT.md` §3.3
lists `ENVIRONMENT` for `backend/`; the equivalent for `ai_service` is `ENV`,
and it must stay unset or `production`.
| GitHub path | server-constructed from `GITHUB_USERNAME`; no user input | `github.py:116-117` |

**Good practices present**

* `extra="forbid"` on request models — an unexpected field is a `422`, not
  silently ignored input.
* No string interpolation into SQL (there is no SQL).
* GitHub upstream errors are truncated (`resp.text[:200]`) before being
  returned.

## 2.7 Input validation

| Input | Rules | Location |
|---|---|---|
| Chat `message` | 1–2000 chars, trimmed | `chat.py` Pydantic model |
| Chat `history`, `sessionId` | typed; unknown fields rejected | `extra="forbid"` |
| Contact `name` / `email` / `subject`(optional) / `message` | 2–80 / valid email ≤254 / 3–150 (server stores `Portfolio contact: {name}` when omitted) / 10–2000 | `backend/app/routes/contact.py` |
| Contact `website` | honeypot; non-empty ⇒ silent `200`, nothing stored | `backend/app/routes/contact.py` |


## 2.8 Anti-automation

* **Honeypot** on the contact form.
* **Chat rate limit** — the primary brake on LLM cost abuse.
* **No CAPTCHA** — deliberately. A portfolio should not show one to a recruiter.
  The honeypot plus rate limiting covers the spam case at this scale.

## 2.9 Error handling

| Rule | Status |
|---|---|
| No stack traces in responses | **Yes** — FastAPI handles `HTTPException`; no handler leaks `exc` |
| Upstream bodies truncated | **Yes** (`github.py:83`) |
| Secrets never logged | **Yes** — no route logs a key |
| Request IDs | **No (TARGET)** — `API.md` §6.2 |

## 2.10 Health endpoints

`/health` and `/ready` are deliberately unauthenticated and disclose only
`{"status": ..., "vector_store": ...}`. That is the minimum needed for a health
check. **No version pinning, no hostname, no environment name is exposed** —
`/health` does return `version: "1.0.0"`, which is acceptable and useful for
debugging.

---

# 3. IDENTIFIED GAPS — CURRENT

Honest accounting. Nothing here is a live exploit; each is a real limitation.

## 3.1 `VITE_*` build-time secret exposure

Any `VITE_*` variable is **inlined into the public bundle at build time**. It is
public to anyone who views source, regardless of what it is named.

**Status: no secret-named `VITE_*` variable exists.** The root `.env.example`
declares `VITE_BACKEND_URL=http://localhost:8000` for local development — a URL,
not a secret, and the file explicitly warns against setting it in production.
The risk is latent: the next developer who adds `VITE_ADMIN_TOKEN` publishes it.

**Note on the dev flow (Phase 8):** `vite.config.js` proxies `/api/admin`,
`/api/contact` and `/api/github` to the backend on `:8001`. Chat is the only
service with no proxy: the browser calls `${VITE_BACKEND_URL}/api/...`
directly against `localhost:8000`, which requires CORS to allow
`http://localhost:5173` — which `ai_service`'s default origins do.
**TARGET:** keep `VITE_BACKEND_URL` for dev; never set it in production.

**Rule (TARGET)**

1. No secret is ever named `VITE_*`.
2. A CI check fails the build if any `VITE_` variable name matches
   `/SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL/i`.
3. `DEPLOYMENT.md` §3.3 lists `VITE_*` under "must remain unset".
4. Authenticated admin operations go through the `HttpOnly` cookie — nothing a
   `VITE_` variable could hold.

**Mitigating design:** the admin API is server-authorized, so no secret is needed
in the browser at all. That is why this gap stays theoretical.

## 3.2 `knowledge_base.json` contains unpublished personal data

The legacy AI knowledge base holds details **not** published on the site —
including CGPA, semester and graduation year for an institution not listed on
the portfolio, plus personal summary text.

**Assessment:** since Phase 9 the default index (`KNOWLEDGE_SOURCE=api`) is
built from `GET /api/content`, i.e. **only published content**, so those fields
are no longer retrievable through chat. The legacy file remains in the repo
solely as the `KNOWLEDGE_SOURCE=file` rollback, where the old exposure returns
— which is one reason the rollback is a conscious switch, never an automatic
fallback. Retrievable only through the chat widget, which is `X-API-Key`-gated
and rate-limited. It is **not** public content, but it is content that should
not be retrievable by an anonymous visitor if the widget is ever opened up.

**Rules (TARGET)**

1. The knowledge base is built from `GET /api/content` — **only published
   content** (`MIGRATION.md` Phase 9). Implemented as the default.
2. The seed imports nothing from `knowledge_base.json` into public content
   (`DATABASE.md` §9.1).
3. `DATABASE.md` §5.8 explicitly refuses to model those fields.
4. `knowledge_base.json` is **retained** as the documented rollback source
   (not deleted "after parity" — `parity.py` reports `PARITY: FAIL` by design
   because the legacy file carries non-public history). Any deletion is a
   separate, explicitly approved task; before it happens, confirm the data is
   not in git history.

**Residual risk:** git history retains the file. If any of it must be forgotten,
history rewriting is required and is a separate, explicitly approved task.

## 3.3 Shared API key is not authentication

`BACKEND_API_KEY` is one secret shared by every visitor. It authenticates a
*route*, not a *user*: no identity, no revocation, no audit trail, no per-user
quota. Anyone who obtains it can call the LLM endpoints at 10 req/min
indefinitely.

**Mitigation (TARGET, ADR-009):** admin operations move to user-based sessions.
Chat keeps the shared key because the LLM has no per-user identity to check —
the chat is anonymous by design, and the rate limit is the correct control.

## 3.4 No Content-Security-Policy

**Risk:** no defence-in-depth against XSS. React escaping is the only protection.

**Why not added now:** a strict CSP on this site breaks inline styles and the
Vercel Speed Insights script unless nonces are plumbed through the edge. It needs
to be designed, not guessed.

**TARGET:** report-only CSP first (`Content-Security-Policy-Report-Only`),
observe violations, then enforce. Deferred with a named trigger.

## 3.5 `/api/contact` is public

**Detailed in §2.5.** The edge matcher no longer covers `/api/contact` and the
backend verifies no key on it. Rate limiting and the honeypot are the only
controls.

**Severity: medium** — an outbound-email abuse vector from the portfolio's
sender domain. **Fix:** one line in `backend/app/routes/contact.py` (add
`dependencies=[Depends(verify_api_key)]`, with the backend reading the same
secret) and re-add `/api/contact` to the matcher. Not applied because it changes
public endpoint behaviour and the secret scope.

## 3.6 Public endpoints have no rate limit on `/api/github`

The 300 s in-process cache absorbs refresh-spam, and the service returns `429`
when GitHub's own limit is hit. Acceptable at current traffic.

**TARGET:** 60/min per IP (`API.md` §7).

## 3.6a `/api/content` rate limiting (**implemented, Phase 3**)

`GET /api/content` is the endpoint most exposed to refresh-spam and scraping, so it
is the one public route that ships with a limit:

| Property | Value | Source |
|---|---|---|
| Limit | 300 requests / 60 s per client IP | `API.md` §8 |
| Store | In-process fixed window, `threading.Lock` | `ADR-014` |
| 429 body | `{"detail": "Too many requests. Please try again shortly."}` | `API.md` §8 |
| 429 headers | `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` | `API.md` §8 |
| Excluded | `/health`, `/ready` | `SECURITY.md` §3.6a |

Design decisions worth stating, because each is a place a weaker implementation
would be wrong:

* **The limiter is a dependency of the content route only.** A throttled
  `/health` or `/ready` would make a restart loop look like a rate-limit fault and
  send an operator to debug the wrong system. Verified by
  `test_health_endpoints_are_never_throttled` (25 probes each).
* **`limit_response` is declared before `session` on the route.** FastAPI resolves
  dependencies in declaration order, so a throttled request is refused before a DB
  session is even constructed, and a database outage cannot stop the limiter from
  counting.
* **The client IP is the socket peer, unless the deployment declares a trusted
  proxy header.** In the documented Render deployment the socket peer is a load
  balancer, so every caller would otherwise share one bucket; setting
  `TRUSTED_PROXY_HEADER=cf-connecting-ip` makes the resolver read
  `CF-Connecting-IP`, which Cloudflare overwrites on every request that reaches a
  Render web service. `X-Forwarded-For` is never read: Cloudflare *appends* to it
  rather than replacing it, so its leftmost entry is caller-controlled, and
  trusting it would let anyone mint a fresh bucket per request. A configured
  header the edge is not known to overwrite is refused at startup
  (`app/config.py`). Verified by `tests/test_client_ip.py`; leaving the setting
  unset is correct for local development and tests.
* **`Retry-After` is the true seconds remaining, rounded up and capped at the
  window.** The original `int(remaining) + 1` told a client to wait 61 s for a
  60 s window.
* **A 429 is not cacheable**, so a client is not still being refused long after its
  window resets.
* **A fixed window is accepted**, not a sliding one. It can admit up to 2× the
  limit across a window boundary; for a CDN-cached public read endpoint behind a
  300 s cache that is not the interesting attack.

**Limitation (unchanged, now load-bearing).** The counter lives in one process's
memory, so `N` instances enforce `300 × N` per minute. This is exact for the
documented single-instance deployment (`SECURITY.md` §10 item 3) and needs a
shared store before any horizontal scaling. Not pre-empted with Redis, per
`ADR-014`.

Enforced by `backend/tests/test_rate_limit.py` (30 cases, injected clock, no
sleeping), including the concurrency test that fails without the lock.

## 3.6b `/chat` rate limiting (**implemented**)

`POST /chat` and `POST /chat/stream` are the only `ai_service` routes, and they
are gated behind the shared key (`SECURITY.md` §3.3) and a per-client limit:

| Property | Value | Source |
|---|---|---|
| Limit | 10 requests / 60 s per client | `ai_service/core/rate_limit.py` |
| Store | In-process fixed window (slowapi `memory://`) | `ai_service/core/rate_limit.py` |
| Bucket key | Verified signed client IP, else socket peer | `ai_service/core/client_ip.py` |
| Trusted header | `x-vercel-client-ip` only | `SECURITY.md` §3.6b |

The AI service is reached only through Vercel's rewrite, so its socket peer is
Vercel's edge egress, shared by every browser. Keying the limiter on that address
gave the whole internet one 10/min bucket. The fix mirrors §3.6a but cannot reuse
`CF-Connecting-IP`: at the Render origin the Cloudflare client is Vercel, not the
browser, so that header does not carry the end-user address here.

Instead `middleware.js` reads Vercel's authoritative `x-real-ip` via
`ipAddress()`, **overwrites** `x-vercel-client-ip` and
`x-vercel-client-ip-signature` with that value and its HMAC-SHA-256 hex digest
keyed by `BACKEND_API_KEY`, and forwards them. `client_ip()` trusts the IP only
when the signature verifies against the same secret; any other case — missing,
forged, wrong-address, malformed, or an operator pointing
`TRUSTED_CLIENT_IP_HEADER` at an unvetted name such as `x-forwarded-for` — falls
back to the socket peer. `headers.set` at the edge means a browser cannot smuggle
in either header, and a direct caller to the Render host cannot forge the
signature. Verified by `ai_service/tests/test_client_ip.py`.

**Honest limitation.** This makes the bucket per-client rather than per-service,
but it does not create per-user identity: a party holding the shared secret (the
existing access boundary) could mint buckets, and a client behind CGNAT still
shares its address. The limit is a volumetric control, not an authn boundary.
Like §3.6a it is single-instance; a shared store is required before scaling the
AI service horizontally.

## 3.7 No security headers on the admin route (**TARGET**)

Admin will be same-origin on Vercel and covered by the existing `/(.*)` header
rule. It must additionally send `Cache-Control: no-store` and
`X-Robots-Tag: noindex`.

## 3.8 `ADMIN_TOKEN` is declared but has no matching route

`ai_service/config/settings.py:96-100` declares:

```python
# --- Admin (cache management) ---
# Token required by the `/admin/cache/*` endpoints. If empty, admin
# routes are disabled (404). Distinct from AI_SERVICE_KEY so a
# leaked chat key never grants cache-purge rights.
ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "")
```

**There are no `/admin/cache/*` routes.** The comment describes endpoints that
were never written; the setting is read by nothing. It is not in either
`.env.example`.

Harmless today — an unused variable grants nothing — but the comment is an
invitation to build a token-authenticated admin surface on a shared-secret
pattern, which is exactly what ADR-009 replaces.

**Rule:** delete the setting and the comment. Admin auth is Argon2id + server-side
sessions only (`API.md` §5.1).

## 3.9 No dependency scanning in CI

`package.json` has no audit step and there is no CI workflow.

**TARGET:** `npm audit --audit-level=high` plus `pip-audit` in
`MIGRATION.md` Phase 10.

---

# 4. TARGET — Authentication and Authorization

## 4.1 Admin session design

```text
Login  ──▶  Argon2id verify (constant-time)
      ──▶  INSERT admin_session (SHA-256 of a 256-bit opaque token)
      ──▶  Set-Cookie: portfolio_admin_session=<token>;
                        HttpOnly; Secure; SameSite=Strict; Path=/;
                        Max-Age=43200
```

| Property | Value | Why |
|---|---|---|
| Hashing | Argon2id | Memory-hard; the current OWASP recommendation |
| Token | 256-bit opaque, `secrets.token_urlsafe(32)` | No structure to forge |
| Storage | SHA-256 hash only | A DB dump cannot be replayed |
| Cookie flags | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` | Not readable by JS; not sent cross-site; not sent over HTTP |
| Idle timeout | 12 h | |
| Absolute timeout | 7 d | |
| Revocation | `revoked_at` on logout | Immediate, not eventual |
| Transport | HTTPS only | HSTS already enforces it |

**Never** in `localStorage`, in `sessionStorage`, in a response body, or in an
`Authorization` header.

## 4.2 CSRF

**Why it is mostly solved by design:** the cookie is `SameSite=Strict`, so the
browser will not attach it to a cross-site request. That removes classic CSRF for
`POST`/`PUT`/`PATCH`/`DELETE`.

**Additional layer — implemented (Phase 4):** a double-submit CSRF token on every
mutating admin request.

```text
GET  /api/admin/me
 ──▶ { "user": {...}, "csrf_token": "<64 hex>" }

POST /api/admin/auth/logout
X-CSRF-Token: <64 hex>          must equal the session-bound value
Cookie: portfolio_admin_session=<token>
```

**Rationale:** `SameSite=Strict` is a browser behaviour, not a server guarantee.
Defence in depth for the one component that can rewrite the entire site is worth
one header.

**How the value is produced.** It is not a second secret in a column. The server
computes `HMAC-SHA-256("portfolio.admin.csrf.v1\0" || session token)` and
hex-encodes the full 256-bit digest, so `/me` can regenerate it on every call with
nothing to store, nothing to rotate and no way to lose it. Deriving it from the
raw token means possession of the token is possession of the value — which is
exactly the double-submit property, and why comparison is constant-time.

**Ordering.** Authentication is checked before CSRF. A caller with no session
cannot hold a valid token, so checking CSRF first would answer every anonymous
mutation with `403` and hide the fact that the session is simply absent.

**Scope.** Enforced by a dependency on every unsafe method under `/api/admin/*`.
The only such route in Phase 4 is `POST /api/admin/auth/logout`; Phase 5 adds the
content mutations behind the same dependency. `GET /api/admin/me` is exempt
because it is the endpoint that hands the value out.

## 4.3 Authorization matrix

| Resource | Public read | Public write | Admin read | Admin write |
|---|---|---|---|---|
| Projects | Yes | **No** | Yes | Yes |
| Skills / categories | Yes | **No** | Yes | Yes |
| Certifications | Yes | **No** | Yes | Yes |
| Profile (incl. socials + about) | Yes | **No** | Yes | Yes |
| ~~Blog metadata~~ | n/a | n/a | n/a | n/a — **no entity in v1** (`DATABASE.md` §9) |
| Contact message | **No** | Submit only | Yes | Archive only |
| GitHub proxy | Yes | n/a | n/a | n/a |
| Chat | Yes (via `X-API-Key` proxy) | n/a | n/a | n/a |
| Admin users | **No** | **No** | Yes | **No** — CLI only |
| Audit log | **No** | **No** | Yes | **No** — append-only |

**There is no public write path to any content.** No `POST /api/projects`, no
`PUT /api/skills` without a session.

## 4.4 Login abuse protection

| Control | Value |
|---|---|
| Per-IP | 10 attempts / 15 min → `429`. Counts **every** attempt, success or not: each one is a run of Argon2id. |
| Per-email | 5 failures / 15 min → `429`. Counts **failures only**; a correct password clears the run. |
| Uniform failure | Identical `401` body for unknown user, wrong password, disabled account — differing only in `request_id`, which must differ per request |
| Timing | Argon2id is run against a dummy hash when the user does not exist, so response time does not reveal account existence |
| Password storage | Argon2id, PHC string format (`$argon2id$v=19$m=...,t=...,p=...`) |
| First user | **Not implemented in Phase 4.** Provisioning is deliberately out of scope: there is no public registration and no CLI yet. Tests insert the row directly. |
| Password reset | **Not implemented.** No email delivery in scope. |
| Email verification | **Not implemented.** One admin, a known address |

**Two counters, deliberately asymmetric.** They are separate limiters rather than
one shared window because they defend against different attacks: a per-IP limit
alone falls to credential stuffing spread across addresses, and a per-email limit
alone falls to a single address being probed from many. A shared window would let
one dimension starve the other — ten guesses at ten addresses would lock the IP
before any address was protected.

**What is enforced versus what is recorded.** The enforcement lives in a
per-process limiter; `admin_user.failed_attempts` and `admin_user.locked_until`
are the durable operator record written alongside it. That split is why the
process limiter and the row can be seen to disagree — the row is a signal for a
human, not the thing that refuses the request.

**Process-local by design.** The limiter holds its counters in memory and resets on
restart, matching the accepted limitation in `SECURITY.md` §10 #3 (single
instance). It never writes an IP address anywhere: the client address resolved by
`app.security.client_ip` (the socket peer, or `CF-Connecting-IP` when
`TRUSTED_PROXY_HEADER` is set — §3.6a) is keyed into a daily HMAC before it touches
`admin_session.ip_hash`, and the limiter's own keys are never persisted at all.

---

# 5. TARGET — Rate Limits

| Scope | Limit | Rationale |
|---|---|---|
| `POST /api/contact` | 5/min per IP | Resend quota + spam relay prevention |
| `POST /api/chat`, `/chat/stream` | 10/min per IP | **Direct LLM cost per call.** The most important limit in the system |
| `POST /api/admin/auth/login` | 10/15min per IP + 5/15min per email | Credential stuffing |
| `GET /api/content` | 300/min per IP | Abuse prevention; the CDN cache absorbs normal traffic |
| `GET /api/github` | 60/min per IP | Upstream quota protection |
| `GET /api/admin/*` | 600/min per user | Legitimate admin use |

**No global ban list.** It creates a self-inflicted denial-of-service vector
(single IP behind CGNAT) with no benefit at this scale.

**`Retry-After` on every `429`.** A human-readable message:
`"Too many requests. Please try again shortly."`

---

# 6. TARGET — Input Validation

| Input | Validation | Defence |
|---|---|---|
| All admin writes | Pydantic v2, `extra="forbid"`, per-field constraints | Rejects unknown fields; no silent coercion |
| `slug` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 80 | Blocks `../`, uppercase, spaces, unicode |
| `project.image` | `^/images/projects/[a-z0-9-]+\.webp$` (DB CHECK + API validator) | Path traversal; build-contract enforcement |
| `image_width`/`image_height` | Integer > 0 | Breakage of the image-dimension assertion |
| `icon_key` | Membership in the frontend icon registry | Unknown key fails loudly |
| URLs | `http`/`https` only | `javascript:` URLs in rendered links |
| `email` | Pydantic `EmailStr` + `citext` | Normalisation |
| Contact fields | Length checks identical to the API contract | Storage abuse |
| SQL | **SQLAlchemy bound parameters exclusively.** No string-built SQL | Injection |
| `status` enum | `CHECK IN (...)` | Invalid states reaching the API |

**Validation happens at every layer:** Pydantic at the edge, a CHECK in the
schema, and the admin UI. The database constraint is the last line because it
cannot be bypassed by a code path someone forgets.

---

# 7. TARGET — Data Protection

## 7.1 At rest

| Data | Protection |
|---|---|
| Passwords | Argon2id hashes — never reversible |
| Session tokens | SHA-256 hashes only |
| Contact messages | Plaintext, access restricted to `backend/`; raw IP **not** stored (keyed daily hash instead) |
| Audit log | Append-only; no `UPDATE`/`DELETE` grant |
| Database at rest | Provider-managed encryption (managed PostgreSQL, encrypted volumes) |
| Backups | Provider-managed, daily, 7-day retention, encrypted |

## 7.2 In transit

* TLS 1.2+ everywhere. Vercel terminates and re-encrypts to Render.
* HSTS `max-age=63072000; includeSubDomains; preload` — already set.
* No plaintext database connection in production (`sslmode=require` in
  `DATABASE_URL`).

## 7.3 Exposure control

* **The public bundle contains zero secrets.** Verified by inspecting the build
  output for `API_KEY`, `SECRET`, `PASSWORD` patterns — a CI check (Phase 10).
* The database is **network-restricted** to `backend/`. No public connection
  string. Never exposed via a `VITE_` variable.
* `ai_service` receives read-only content over HTTPS. It has no database
  credentials at all.
* Logs never contain a key, a password, a session token or a full message body.

## 7.4 Logging rules

```text
MUST log:   admin login success/failure, all admin mutations (with actor + entity),
            auth failures with reason, upstream 502s, rate-limit events
MUST NOT:   log any API key, password, session token, full contact message body,
            raw IP addresses, database credentials, full LLM prompts containing PII
```

---

# 8. Secrets Management — TARGET

## 8.1 Storage

* Platform secret stores only: Render env vars, Vercel env vars, the managed
  PostgreSQL provider.
* **Never** in the repository, even in a `.env`.
* `.env.example` contains **names and empty values only**.
* Local secrets in `.env`, git-ignored.

## 8.2 Rotation

| Secret | Rotation impact | Procedure |
|---|---|---|
| `BACKEND_API_KEY` / `AI_SERVICE_KEY` | Chat unavailable during the window (contact no longer depends on it) | Update both, redeploy Render then Vercel (`DEPLOYMENT.md` §3.4) |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | Chat falls back to the other provider | Update Render; redeploy |
| `RESEND_API_KEY` | Contact delivery fails, **messages still stored** | Update Render; redeploy |
| `GITHUB_TOKEN` | Rate limit drops to 60/h | Revoke on GitHub; issue a new one; update Render |
| `DATABASE_URL` | Content unavailable | Update Render; redeploy |
| Admin session cookie stolen | Attacker acts as the owner | Revoke all rows in `admin_session`; owner logs in again (`DEPLOYMENT.md` §3.4) |

**`IP_HASH_SALT` is withdrawn** (`DEPLOYMENT.md` §3.1). It was never read: the
contact row's IP hash reuses `client_ip_hash` from `app/services/auth.py`, an
HMAC-SHA-256 over the raw IP with a process-local key that is regenerated daily.
There is nothing to rotate — the key turns over every day on its own, and setting
the variable on the platform changes no behaviour.

## 8.3 Git hygiene

* `.gitignore` covers `.env`, `.env.*` (except `.env.example`), `.cache/`,
  `dist/`, `.prerender/`, `backend/.venv/`.
* **Before every commit:** `git diff --cached | grep -iE 'key|secret|token|password'` — review every hit.
* A secret in git history requires history rewriting. Assume any committed
  secret is compromised and rotate first.

---

# 9. Security Checklist

**Before any production deploy**

- [ ] `git diff --cached` contains no secret
- [ ] No `.env` file staged
- [ ] No `VITE_*` secret-named variable in the Vercel production environment
- [ ] `npm audit --audit-level=high` clean
- [ ] `pip-audit` clean in every Python service
- [ ] Security headers present in the deployed response
- [ ] `/api/chat` rejects requests without `X-API-Key` (contact is public and un-gated — §2.5)
- [ ] `ALLOWED_ORIGINS` does not contain `*`

**Before the admin dashboard ships (TARGET)**

Phase 4 — authentication itself, verified by tests:

- [x] Every `/api/admin/*` route rejects an unauthenticated request — verified by an automated test walking the application's own route table (`test_csrf.py`)
- [x] Session cookie has `HttpOnly`, `Secure`, `SameSite=Strict` (`Secure` is omitted only when `ENVIRONMENT=development`, so a local HTTP origin still works)
- [x] Argon2id hashing in use; no plaintext password anywhere
- [x] Session tokens stored hashed (SHA-256, 64 hex chars; the raw token exists only in the cookie)
- [x] Logout revokes server-side and takes effect immediately
- [x] Login rate limits by IP **and** email
- [x] Login failures are indistinguishable
- [x] CSRF token required on every mutation
- [x] Every mutation writes an audit row (`login`, `logout` → `admin_audit_log`)
- [x] No admin route accepts `X-API-Key`

Phase 5 — the dashboard UI and content mutations:

- [x] Admin responses send `Cache-Control: no-store` and `X-Robots-Tag: noindex` (2026-10-10: successful `/api/admin/*` responses via middleware in `backend/app/main.py`, errors via `admin_error_response` in `backend/app/errors.py`)
- [ ] Admin bundle contains no secret
- [ ] Public bundle size unchanged within budget

---

# 10. Documented Limitations

| # | Limitation | Severity | Status |
|---|---|---|---|
| 1 | No CSP | Medium | Deferred — §3.4 |
| 1a | `/api/contact` is public (no key or cookie gate) | Medium | By design; edge matcher removed 2026-10-10 — rate limit + honeypot — §2.5 |
| 2 | Shared API key for chat (contact no longer shares it) | Medium | Accepted; ADR-009 adds real auth for admin |
| 3 | In-memory rate limits are per-instance | Low | Accepted; single instance |
| 4 | ChromaDB ephemeral → cold-start `/ready` 503 | Low | Mitigated by `CHROMA_DB_PATH` on a persistent disk |
| 5 | `knowledge_base.json` holds unpublished personal data | Medium | Resolved in Phase 9; git history retains it |
| 6 | No password reset flow | Low | Accepted; single admin, CLI-based change |
| 7 | No 2FA on admin | Medium | Accepted for a single-user dashboard; noted as future work |
| 8 | No security scanning in CI | Medium | Phase 10 |
| 9 | `VITE_*` build-time leak risk is latent | Low | No such variable exists; CI check planned |
| 10 | `security.txt` is a static file | Low | Resolves 200; acceptable |

**None of these is an active exploit against the live site.** Each has a stated
remediation or an accepted rationale.

---

# END OF SECURITY