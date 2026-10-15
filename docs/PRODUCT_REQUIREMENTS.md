# Product Requirements

**Document Status:** Active
**Document Type:** Product Definition
**Version:** 2.0 — rewritten from the verified codebase
**Last Verified Against Code:** commit `a6895e5` (`main`)

---

## Reading Convention

| Label | Meaning |
|---|---|
| **CURRENT** | Shipped and verified. |
| **TARGET** | Required by the migration. |
| **DEFERRED** | Explicitly out of scope. Needs a new requirement. |

---

# 1. What This Product Is

A single-page personal portfolio for a full-stack developer, published as a
static site, with five individually indexable project pages, a resume download,
a working contact form, live GitHub statistics and an AI assistant that answers
questions about the work.

**It is a portfolio, not a platform.** One visitor is a recruiter or a peer
engineer. They need to see the work, skim the skills, download the resume and
send a message — in under a minute, on any device, without logging in.

---

# 2. CURRENT — Shipped Functionality

## 2.1 Page structure

One route, seven in-page sections.

| # | Section | `id` | Source | Purpose |
|---|---|---|---|---|
| 1 | Hero | `home` | `Hero.jsx` | Name, title, availability, resume CTA, socials, hero stats |
| 2 | About | `about` | `About.jsx` | Section description, "My Journey" heading + 2 paragraphs, 4 info cards. **Education is prose in card 1, not an entity.** |
| 3 | Skills | `skills` | `Skills.jsx` | 4 categories / 16 skills with icons |
| 4 | Projects | `projects` | `Projects.jsx` | Grid of project cards → `/projects/<slug>/` |
| 5 | GitHub | `github` | `GithubStats.jsx` | Live profile stats + top repos |
| 6 | Certifications | `certifications` | `Certifications.jsx` | 3 certifications |
| 7 | Blog | `blog` | `Blog.jsx` | 4 "Coming Soon" placeholders |
| — | Contact | `contact` | `Contact.jsx` | Form → Resend email. `X-API-Key` is injected by the edge but **never verified** by the service (`SECURITY.md` §2.5) |
| — | Footer | — | `Footer.jsx` | Social links, resume link |
| — | Chat | — | `ChatAssistant.jsx` | Floating AI assistant |

**Section ids are verified present.** Navbar anchors resolve to `home`, `about`,
`skills`, `projects`, `github`, `certifications`, `blog`, `contact`.

## 2.2 Indexable URLs

| URL | Source | Indexable |
|---|---|---|
| `/` | `dist/index.html` | yes |
| `/projects/webchat-ai/` | `generate-project-pages.mjs` | yes |
| `/projects/orbit-ai/` | " | yes |
| `/projects/stayora/` | " | yes |
| `/projects/zerodha-clone/` | " | yes |
| `/projects/scientific-calculator/` | " | yes |

Plus non-HTML: `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, `llms.txt`.

**`llms.txt` is a deliberate choice.** It publishes a plain-text summary for LLM
consumers, generated and asserted by `generate-seo-discovery.mjs` so it can never
disagree with the site.

## 2.3 Projects

5 projects, verified against `src/data/projects.js`:

| Slug | Category | Featured | Indexable | Live | Tech |
|---|---|---|---|---|---|
| `webchat-ai` | AI SaaS | yes | yes | yes | 10 |
| `orbit-ai` | AI | yes | yes | yes | 6 |
| `stayora` | Full Stack | no | yes | yes | 4 |
| `zerodha-clone` | Frontend | no | yes | yes | 3 |
| `scientific-calculator` | Web App | no | yes | yes | 3 |

Each has a description, image, `imageAlt`, `seoTitle`, `seoDescription`,
highlights and a `github` link.

**`featured` and `indexable` are independent.** Two projects are featured; all
five are indexable. That distinction must be preserved.

## 2.4 Contact

5 fields (`name`, `email`, `subject`, `message`, honeypot), client validation,
honey pot, `/api/contact` → Resend. **Submissions are emailed and then
discarded** — nothing is stored.

## 2.5 AI assistant

Floating widget → `/api/chat/stream` (SSE) → Groq with a Gemini fallback, RAG over
ChromaDB. Server-side conversation memory keyed by `sessionStorage`.

**Known limitation:** `knowledge_base.json` has 4 projects while the site has 5,
so the assistant **cannot answer questions about Zerodha Clone**. This is a
correctness defect, not a cosmetic one — it is a stated goal of the migration to
fix it.

## 2.6 Current defects

Documented, not fixed. No UI work is authorised in this phase.

| # | Defect | Impact | Priority |
|---|---|---|---|
| 1 | `Blog.jsx` reads `blog.date`, but `blogs.js` has no `date` | Undefined rendered | Low |
| 2 | `Hero.jsx` passes `showLabels`; `SocialLinks` expects `showLabel` | Prop ignored | Low |
| 3 | `ScrollToTop` is a no-op | Deep-linking to `#projects` does not scroll to top first | Low |
| 4 | `ai_service/config/settings.py:84` declares `ADMIN_TOKEN` for a non-existent `/admin/cache/*` route | Misleading; invites a shared-secret admin pattern | Medium (documentation) |
| 5 | `src/utils/githubUtils.js` is unused | Dead code | Low |
| 6 | `knowledge_base.json` has 4 of 5 projects | **Assistant gives wrong answers** | **High** |
| 7 | Content changes need a developer and a deploy | The core problem | **High** |

---

# 3. TARGET — Migration Requirements

Each requirement is testable. Phases are in `MIGRATION.md`.

## 3.1 Content management — the primary goal

| ID | Requirement | Verified by |
|---|---|---|
| **C1** | All portfolio content is stored in PostgreSQL and editable without a code change | Admin UI + API test |
| **C2** | The owner can create, edit, reorder, hide/unhide, index/unindex and delete projects | Playwright |
| **C3** | Projects, skills, skill categories, certifications and the profile (including socials and about content) are editable. **Education, social links and blog metadata are NOT editable in v1** — they have no entity (`DATABASE.md` §1.3, §9) | API tests |
| **C4** | Deleting a project is a soft delete (`status='hidden'` + `indexable=false`); the row survives for audit | API test |
| **C5** | Every mutation is attributed to a user in an audit log | API test |
| **C6** | Content changes reach the live site only after an explicit rebuild, triggered by the admin's "Rebuild site" button (ADR-017) | E2E |
| **C7** | **Editing content must not change the public UI, the URLs or the SEO output** | Migration validation checks 7–11 |

**C7 is the requirement that constrains every other phase.** The migration moves
data, not design.

## 3.2 Non-regression — the hard constraints

| ID | Requirement | Verified by |
|---|---|---|
| **N1** | All 6 HTML documents still exist | Build assertion |
| **N2** | Title, description, canonical, OG, Twitter and JSON-LD are identical per URL | Baseline diff |
| **N3** | `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, `llms.txt` are identical | Baseline diff |
| **N4** | Zero changes to `src/styles/**` | `git diff --stat src/styles` empty |
| **N5** | Zero changes to `src/data/**` through Phase 7 | `git diff -- src/data` empty |
| **N6** | Public bundle grows < 15 KB gzipped | Bundle budget |
| **N7** | Lighthouse SEO score stays 100 | Lighthouse |
| **N8** | `/api/chat`, `/api/github`, `/api/contact` keep their paths, schemas and status codes | Contract tests |
| **N9** | Project image dimensions remain verified against the real WebP headers | Build assertion |
| **N10** | No secret exists in the public bundle | Bundle inspection + CI |

## 3.3 Reliability

| ID | Requirement | Verified by |
|---|---|---|
| **R1** | The build **fails** if the content API is unreachable | Build test |
| **R2** | The build **fails** if the API returns zero projects | Build test |
| **R3** | The build **fails** on an image-dimension mismatch | Build test |
| **R4** | In dev with the API down, the committed snapshot renders with one warning | Component test |
| **R5** | The deployed site works with every backend down — it is static | E2E |
| **R6** | An `ai_service` outage never degrades the portfolio | E2E |
| **R7** | A Resend outage never loses a contact message | API test |
| **R8** | A GitHub outage shows the existing fallback | Component test |

**R1–R3 versus R5 are complementary.** A silent build that emits 3 project pages
deletes indexed URLs; a user-facing error banner makes the site look broken. Both
behaviours are required.

## 3.4 Security

| ID | Requirement | Verified by |
|---|---|---|
| **S1** | Every `/api/admin/*` route requires a valid server-side session | Route-iteration test |
| **S2** | Passwords are Argon2id hashed; no plaintext or reversible encoding | API test |
| **S3** | Session tokens are stored hashed | API test |
| **S4** | The session cookie is `HttpOnly`, `Secure`, `SameSite=Strict` | API test |
| **S5** | Login failures are indistinguishable and timing-comparable | API test |
| **S6** | Login is rate limited per IP **and** per email | API test |
| **S7** | Every mutation requires a CSRF token | API test |
| **S8** | Logout revokes the session immediately | API test |
| **S9** | `X-API-Key` never grants admin access | API test |
| **S10** | No secret is in the browser bundle | Bundle inspection |
| **S11** | Audit rows never contain a password or a token | API test |
| **S12** | The database is network-restricted to `backend/` | Infra config |

## 3.5 AI assistant

| ID | Requirement | Verified by |
|---|---|---|
| **A1** | The knowledge base is built from `GET /api/content` | Service test |
| **A2** | The assistant can answer about **all 5** projects | Retrieval benchmark |
| **A3** | A project added in the admin UI is answerable after a reindex — no file edit, no redeploy | E2E |
| **A4** | If the content API is unreachable, the committed snapshot is used and chat keeps working | Service test |
| **A5** | LLM keys stay server-side | Config review |
| **A6** | The chat frontend contract is unchanged | SSE comparison |

**A2 is the defect fix.** A visitor asking about Zerodha Clone today gets an
answer that omits it.

## 3.6 Contact

| ID | Requirement | Verified by |
|---|---|---|
| **M1** | Submissions are stored **and** emailed | API test |
| **M2** | The owner can read messages in the admin inbox | Playwright |
| **M3** | A Resend failure stores the message and returns `502` | API test |
| **M4** | Honeypot submissions send nothing and store nothing | API test |
| **M5** | The raw IP is never stored | API test |
| **M6** | The frontend is unmodified | `git diff` |
| **M7** | The public auth model of `/api/contact` is unchanged | Contract test |

## 3.7 Performance

| ID | Requirement | Budget |
|---|---|---|
| **P1** | `/api/content` p95 | < 100 ms |
| **P2** | `GET /api/content` payload | ≤ 60 KB gzipped |
| **P3** | Lighthouse Performance (mobile) | ≥ 90, no regression |
| **P4** | Lighthouse Accessibility | ≥ 95 |
| **P5** | Lighthouse SEO | 100 |
| **P6** | Public bundle growth | < 15 KB gzipped |
| **P7** | Build time | < +20% |

---

# 4. Personas and Journeys

## 4.1 Primary — Recruiter (90% of traffic)

```text
Land on / from a search or a shared link
  → Read the hero: who, what, available
  → Skim Skills: does the stack match the role?
  → Projects: is the work relevant?
      → Open /projects/<slug>/ — read it properly
  → Certifications: any signal?
  → Contact: ask a question
  → Download the resume
```

**Requirements it creates**

| Need | Current state |
|---|---|
| Understand fit in 10 seconds | Hero + skills |
| Judge quality of work | Project pages with highlights |
| Get a CV | Resume PDF in hero and footer |
| Ask a question | Contact form → email |
| Search-discover the work | 6 indexable URLs, sitemap, JSON-LD, `llms.txt` |

**Success = the recruiter can act (email, save, share) within one minute.**
That is the constraint that keeps the design single-page and the site static.

## 4.2 Secondary — Peer engineer

```text
Land → read the code-adjacent detail: skills, project descriptions
     → open a project page
     → ask the AI assistant a specific technical question
     → check GitHub
```

**Requirements it creates:** the assistant must be **accurate** (A2 — today it is
not), and project pages must carry technical substance.

## 4.3 Owner — content editing (TARGET)

```text
Go to /admin → log in
  → edit a project's description, highlight a project, drag to reorder
  → toggle indexable / hidden
  → click "Rebuild site"
  → add a certification
  → read a new message
  → rebuild the site
```

**Requirements it creates:** no code change, no database access, no server
restart, no deploy from Render — just a rebuild.

---

# 5. Non-Goals — Explicit

Naming these prevents scope creep. Each requires a new requirement document
section before it starts.

| Non-goal | Why |
|---|---|
| **Redesigning the public UI** | No requirement asks for it. The design works and is documented in `DESIGN_SYSTEM.md`. |
| **Adding a client-side router to the public SPA** | One route. `react-router-dom` is scoped to the admin entry only (ADR-010). |
| **Draft / archived content states** | Not required. Two independent flags (`status`, `indexable`) cover it (ADR-016). |
| **Contact retry queue / resend button** | The message is already stored and visible in the inbox (`API.md` §5.2). |
| **An SSR framework (Next/Remix/Nuxt)** | The existing build-time prerender already produces correct HTML (ADR-001). |
| **A blog reading route, table or admin UI** | No post has content. All 4 have `link: "#"` and `status: "Coming Soon"`. All three arrive together, or none (`DATABASE.md` §9) |
| **Experience and achievements sections** | Not on the site. **No schemas drafted and none created** |
| **Image upload / object storage** | Committed WebP files are still the default and the build still verifies every project image's dimensions. One narrow exception was approved 2026-10-14: the owner may upload a **project cover image** to a `public_read` bucket (`POST /api/admin/uploads`, ADR-012 update). A general media library / resume upload stays out |
| **A public CMS, a public write API, or visitor accounts** | A portfolio has no need for them |
| **Analytics beyond Speed Insights** | No decision has been made on data collection |
| **Multiple admin roles** | One user |
| **A media library, tagging system or reusable page builder** | CMS features a portfolio does not need |
| **i18n / multi-language** | One audience |
| **Notifications (email on new contact, webhooks)** | The inbox is sufficient |
| **Redis, queues, event sourcing, Kubernetes, GraphQL, microservices** | No workload needs them |

**A recurring request to add a feature must start here.** A line in this table
costs one sentence; implementing it changes `ARCHITECTURE.md`, `API.md`,
`DATABASE.md`, `MIGRATION.md` and `TESTING.md`.

---

# 6. Success Metrics

## 6.1 Measurable

| Metric | Instrument | Target |
|---|---|---|
| Lighthouse SEO (mobile) | Lighthouse CI | 100 — a regression alarm |
| Lighthouse Performance | Lighthouse CI | ≥ 90, no regression |
| Indexed URLs | Search Console | 6 indexed, 0 errors |
| `dist/` HTML documents | Build assertion | Exactly 6 |
| Public bundle growth | Bundle budget | < 15 KB |
| `GET /api/content` p95 | Render metrics | < 100 ms |
| Contact delivery failures | `delivery_status` | < 1% |
| Assistant project coverage | Retrieval benchmark | 5/5 projects |
| Admin route coverage | Route-iteration test | 100% of routes require a session |
| Test coverage — critical modules | Coverage report | See `TESTING.md` §14 |

## 6.2 Not Measurable Here

| Metric | Why not |
|---|---|
| Recruiter conversions | No tracking consent, no funnel |
| Time on page | Would require analytics the owner has not chosen |
| Application outcomes | Entirely outside the product |

**Adding a metric requires an explicit decision about visitor data.** No
analytics beyond Vercel Speed Insights is currently collected.

---

# 7. Assumptions

| # | Assumption | If wrong |
|---|---|---|
| 1 | The portfolio owner is the only editor | Add a second user; `role` CHECK becomes a migration |
| 2 | Content changes are infrequent (weekly at most) | Build-per-change becomes a bottleneck — reconsider on-demand revalidation |
| 3 | ~50–500 unique visitors/month | Capacity is irrelevant until ~10k/day |
| 4 | Static hosting is acceptable | Reconsider only if a second page is added |
| 5 | A managed PostgreSQL provider is acceptable | Self-hosting changes `DEPLOYMENT.md` only |
| 6 | Render free/starter tiers suffice | Scale up is a config change, not an architecture change |
| 7 | `src/data/*.js` stays as the build fallback | If removed, R1–R3 become the only content-integrity net |
| 8 | The assistant remains anonymous | Adding identity would change A6 and the auth model |

---

# 8. Out of Scope for This Migration

The following are real issues. They are **documented, not authorised**:

| Item | Documented in |
|---|---|
| `Blog.jsx` `date` defect | §2.6 |
| `Hero.jsx` / `SocialLinks` prop mismatch | §2.6 |
| `ScrollToTop` no-op | §2.6 |
| Unused `githubUtils.js` | §2.6 |
| `ADMIN_TOKEN` dead setting | §2.6 (documentation only) |
| `/api/contact` unverified `X-API-Key` | `SECURITY.md` §2.5 (one-line fix) |
| Missing CSP | `SECURITY.md` §3.4 |
| No CI, no tests | `TESTING.md` §1 |
| ChromaDB ephemeral | `DEPLOYMENT.md` §11 |

**Fixing any of these requires a separate, explicit change request.** Bundling
unrelated fixes into a content migration makes the migration unrevertible.

---

# END OF PRODUCT REQUIREMENTS