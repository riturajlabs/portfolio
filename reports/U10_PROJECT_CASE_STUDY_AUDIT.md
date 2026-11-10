# U10 Project Case Study Audit

- Date: 2026-11-09
- Repository: `/home/riturajlabs/Projects/portfolio`
- Branch: `feature/portfolio-u8-work`
- Baseline HEAD: `0ccc7ef0deea9d8710af4b7225b2eb8799e53723`
- Baseline tree: clean (`git status --porcelain` empty at audit start)
- Mode: read-only audit. No source, schema, dependency, generated-content, or Git changes were made.
- Output: this report only.

Evidence labels used throughout:

- **VERIFIED** — directly observed in repository code, data, tests, or committed output.
- **INFERRED** — a reasonable conclusion from repository evidence, but not directly proven.
- **UNKNOWN** — not supported by repository evidence; must not be published as fact.

---

## 1. Executive Summary

The portfolio already has a strong, validated project publishing pipeline: PostgreSQL is the content authority, `GET /api/content` feeds a build-time snapshot, five project pages are prerendered, SEO/discovery files are generated, and admin changes are audited and rebuild-triggered. That infrastructure is ready for richer project content. **VERIFIED**

The public project experience, however, is a project summary, not a case study. Each project currently exposes one short description, three bullet highlights, a technology list, one cover image, and live/source links. The detail page repeats the short description in both the header and the “About this project” section. There are no fields for role, timeline, problem, constraints, architecture, key decisions, challenges, outcomes, metrics, learnings, or additional screenshots. **VERIFIED**

The richest case-study material already in the repository is not in the public content model. `ai_service/knowledge_base.json` contains `overview`, `features`, `architecture`, `challenges`, `learnings`, and `completionYear` for four projects (Orbit AI, Stayora, Scientific Calculator, WebChat AI), but it is a rollback-only AI source, is not public, is not editable in the CMS, and is missing Zerodha Clone. It also contains unpublished personal data and must not be imported wholesale. **VERIFIED**

WebChat AI is the strongest candidate for a flagship case study, but its implementation source is not in this repository. Repository evidence is limited to project metadata, one screenshot, SEO content, links, tests/reports that merely reference the slug, and the legacy knowledge-base entry. Code-level claims about its RAG pipeline, multi-tenancy, streaming, vector search, or performance cannot be verified here. **VERIFIED for the absence of source; UNKNOWN for implementation claims**

A critical implementation guardrail was found: `long_description` is not a prose field in practice. It is the storage encoding for the bullet highlights, and `_highlights()` converts every non-empty line into a highlight. Adding prose case-study text to `long_description` would pollute the Highlights section and the AI context. **VERIFIED**

A separate correctness defect affects project coverage in the AI assistant: the default knowledge source indexes all five projects, but the system prompt and few-shot example hardcode only three projects and explicitly state that Ritu’s known projects are “strictly limited to Orbit AI, Stayora, and Scientific Calculator.” This can suppress correct answers about WebChat AI and Zerodha Clone even when retrieval supplies them. **VERIFIED contradiction; INFERRED user-visible impact**

**Recommendation:** do not attempt full case studies by editing `long_description`, `src/data/**`, or generated content. Add a dedicated, nullable case-study content model through the backend/API/admin/frontend/AI layers, then author content with evidence rules. The current pipeline is ready; the content model and evidence base are not. **VERIFIED readiness gap**

---

## 2. Scope, Constraints, and Method

### 2.1 Scope

This audit covers:

- Current project content and its depth.
- Public project card, modal, and detail-page rendering.
- Content pipeline from database to static output.
- Backend project schema and validation.
- Admin project authoring.
- AI assistant knowledge coverage for projects.
- WebChat AI evidence available in this repository.
- Evidence available for the other four projects.
- Gaps against a credible project case-study structure.
- SEO, prerendering, discovery, accessibility, responsive behavior, testing, and editorial safety.
- Recommended U10 scope and a proposed content model.

### 2.2 Constraints observed

- No source files were modified.
- No schema or migration was created or applied.
- No package or dependency changes were made.
- No build was run, because `npm run build` writes `src/generated/content.js` and other generated output.
- No tests were run in this audit; prior U9 results are cited separately and labelled.
- No commit, push, merge, or deployment was performed.
- Only this report was created.

### 2.3 Method

The audit used direct file reads and searches across `src/`, `backend/`, `ai_service/`, `scripts/`, `tests/`, `e2e/`, `docs/`, and `reports/`, plus Git state verification. Claims are tied to file references. Where the repository cannot support a claim, it is marked `UNKNOWN`.

---

## 3. Repository Baseline and Verification

| Check | Result | Label |
|---|---|---|
| Branch | `feature/portfolio-u8-work` | VERIFIED |
| HEAD | `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` | VERIFIED |
| Working tree at start | clean | VERIFIED |
| Recent commit | `0ccc7ef feat: polish portfolio typography and responsive design` | VERIFIED |
| Prior commit | `9034d23 fix: stabilize chat lifecycle and lazy markdown loading` | VERIFIED |
| U9 report present | `reports/U9_FINAL_REVIEW.md` | VERIFIED |
| U10 report before this audit | absent | VERIFIED |

The audit starts from a clean, known checkpoint. The only intended repository change is this report. **VERIFIED**

---

## 4. Current Project Content Inventory

Five projects are published and indexable:

| Project | Slug | Category | Featured | Description length | Highlights | Tech items | Live | Source |
|---|---|---|---:|---:|---:|---:|---:|---:|
| WebChat AI | `webchat-ai` | AI SaaS | yes | 169 chars | 3 | 10 | yes | yes |
| Orbit AI | `orbit-ai` | AI | yes | 164 chars | 3 | 6 | yes | yes |
| Stayora | `stayora` | Full Stack | no | 131 chars | 3 | 4 | yes | yes |
| Zerodha Clone | `zerodha-clone` | Frontend | no | 110 chars | 3 | 3 | yes | yes |
| Scientific Calculator | `scientific-calculator` | Web App | no | 123 chars | 3 | 3 | yes | yes |

All five are `status: published` and `indexable: true`. Two are featured. **VERIFIED**

### 4.1 What each project actually has

For every project, the public payload contains:

- `description` — one short paragraph.
- `longDescription` — currently a newline-separated list of `- bullet` lines.
- `highlights` — derived from `longDescription`.
- `techStack` — a flat list.
- One `image` with intrinsic dimensions and alt text.
- `category`, `featured`, `indexable`, `display_order`.
- `live` and `github` URLs.
- `seoTitle` and `seoDescription`.

There is no role, timeline, team size, duration, problem statement, constraints, architecture diagram, key decision, tradeoff, challenge narrative, outcome metric, testimonial, screenshot gallery, demo video, or learning section. **VERIFIED**

### 4.2 Content quality observations

- Highlights are feature statements, not outcomes. For example, “Multi-tenant SaaS architecture with FastAPI backend…” describes implementation, not impact. **VERIFIED**
- The homepage profile stat says `Projects: "4+"` while five projects are published. This is a minor public inconsistency. **VERIFIED**
- Every project has exactly one cover image. No project has a gallery or architecture screenshot. **VERIFIED**
- Descriptions are short enough that the detail page’s “About this project” section adds little beyond the header. **VERIFIED**

---

## 5. Public Project Experience

### 5.1 Homepage project grid

`src/components/sections/Projects.jsx` renders all `indexableProjects()` in a two-column grid. `src/components/common/ProjectCard.jsx` renders:

- Cover image with overlay “View Details” control.
- Featured badge when applicable.
- Title and short description.
- Technology tags.
- “View project” link to `/projects/<slug>/`.
- “Details” modal trigger.
- GitHub and Live Demo links when present.

**VERIFIED**

### 5.2 Details modal

The modal renders the cover image, category, title, short description, highlights, technology tags, and actions. It has a focus trap, Escape close, focus restoration, scroll lock, and `aria-modal="true"`. **VERIFIED**

### 5.3 Project detail page

`src/components/pages/ProjectPage.jsx` renders:

- Back link.
- Category and title.
- Short description in the header.
- Sticky section nav.
- Cover image.
- “About this project” — the same short description again.
- “Built with” technology list.
- “Highlights” bullet list.
- Live/source actions.
- Related projects.
- Footer link home.

The page ships no JavaScript and is safe to render in Node for prerendering. **VERIFIED**

The duplicate description is a real content weakness: `ProjectPage.jsx:75-76` renders `project.description` in the header and `ProjectPage.jsx:145` renders the same value under “About this project.” **VERIFIED**

### 5.4 Case-study readiness of the UI

The current UI can display a summary well. It cannot display a case study:

- No section for problem/context.
- No section for role and constraints.
- No architecture or decision narrative.
- No challenge/resolution structure.
- No outcome/metrics structure.
- No gallery.
- No code or diagram support.
- No reading-time or next/previous case-study navigation.

**VERIFIED**

---

## 6. Content Pipeline and Data Flow

The public content path is:

1. PostgreSQL stores the authoritative project rows.
2. `GET /api/content` returns the public payload.
3. `scripts/build-content.mjs` fetches and validates the payload, then writes `src/generated/content.js`.
4. Public components import the snapshot through `src/lib/publicContent.js`.
5. `scripts/prerender/entry.jsx` renders `ProjectPage` for each indexable project.
6. `scripts/generate-project-pages.mjs` writes `dist/projects/<slug>/index.html`.
7. `scripts/generate-seo-discovery.mjs` writes `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, and `llms.txt`.
8. The AI service can index `GET /api/content` directly (`KNOWLEDGE_SOURCE=api`, the default).

**VERIFIED**

Key properties:

- The build is fail-closed: content fetch/validation failure stops the build.
- `src/data/**` is legacy migration input and is frozen by a CI tripwire.
- `src/generated/content.js` is generated; hand edits are overwritten.
- The build validates image path shape, real WebP dimensions, indexable page existence, and discovery consistency.

**VERIFIED**

Implication: any case-study field must enter through the backend/API and survive the same validation path. Adding copy directly to `src/data` or generated content is not a viable U10 implementation. **VERIFIED**

---

## 7. Backend Project Data Model and Validation

`backend/app/models/project.py` defines the `project` table with:

| Field | Type / rule |
|---|---|
| `id` | UUID primary key |
| `slug` | text, unique, lowercase/hyphen format, max 80 |
| `title` | text, required |
| `short_description` | text, required |
| `long_description` | text, nullable |
| `image` | text, required; in-repo `/images/projects/<slug>.webp` or absolute http(s) URL |
| `image_width`, `image_height` | positive integers |
| `image_alt` | text, required |
| `category` | text, nullable, max 60 |
| `tech_stack` | text array, default empty |
| `status` | `published` or `hidden` |
| `featured` | boolean |
| `indexable` | boolean |
| `display_order` | integer |
| `live_url`, `github_url` | text, nullable |
| `seo_title` | text, required, max 70 |
| `seo_description` | text, required, max 185 |
| `created_at`, `updated_at` | timestamps |

**VERIFIED**

There is no case-study entity, JSONB narrative field, project-media table, project-metric table, or project-link table. **VERIFIED**

### 7.1 The `long_description` trap

`backend/app/services/content.py:80` defines `_highlights(long_description)`. It splits on lines, strips whitespace, removes one leading bullet marker (`-`, `*`, `•`, `–`, `—`), and returns every non-empty line as a highlight. `content.py:167` uses it to populate `highlights`.

This means:

- `long_description` is effectively the bullet storage encoding, not a prose field.
- A multi-paragraph case study placed in `long_description` would render every paragraph as a “highlight.”
- The public detail page does not render `longDescription` directly; it renders `description` and `highlights`.

**VERIFIED**

`docs/CONTENT_MAPPING.md` confirms this design: `highlights[]` maps to `long_description` as a derived encoding, and “Nothing else goes into `long_description` (no long prose exists in the source).” **VERIFIED**

### 7.2 Status vs indexable

`status` controls whether a visitor sees the project. `indexable` controls whether it gets a generated page and appears in sitemap/discovery output. They are independent. **VERIFIED**

---

## 8. Admin Authoring Workflow

`src/admin/pages/ProjectEditor.jsx` exposes:

- Title.
- Read-only permalink preview.
- Short description.
- Long description.
- Category.
- Comma-separated tech stack.
- Image path/upload, alt text, width, height.
- Live URL and GitHub URL.
- Status, indexable, featured.
- Display order.
- SEO title and SEO description.

**VERIFIED**

The slug is not authored. The backend derives it from the title on create; an existing published project’s slug cannot change. **VERIFIED**

The long-description field has no helper text explaining that its lines become highlights. This makes accidental misuse likely if an editor tries to write a case study there. **VERIFIED**

The editor has no case-study sections, no structured lists for decisions/challenges/outcomes, no evidence field, and no preview of the rendered page beyond the permalink. **VERIFIED**

Admin project operations:

- List, create, update, soft delete.
- Reorder via `display_order`.
- Project image upload.
- Publish action triggers site rebuild and AI reingest.
- Every mutation writes an `admin_audit_log` row in the same transaction.

**VERIFIED**

Implication: editors cannot author case studies with the current CMS without either using the overloaded `long_description` field or changing the model. **VERIFIED**

---

## 9. AI Knowledge and Assistant Coverage

The AI service defaults to `KNOWLEDGE_SOURCE=api`, so it indexes `GET /api/content`. In that mode all five projects are available. **VERIFIED**

The project chunk sent to the knowledge store includes the full public project object, including `description`, `longDescription`, `highlights`, `techStack`, category, links, and SEO fields. It does **not** include architecture, challenges, learnings, role, timeline, or outcomes, because those fields do not exist in the public model. **VERIFIED**

The legacy file mode (`KNOWLEDGE_SOURCE=file`) reads `ai_service/knowledge_base.json`. That file has richer fields for four projects but is missing Zerodha Clone. It is a rollback source, not the default. **VERIFIED**

### 9.1 Verified prompt/content contradiction

`ai_service/core/prompts.py` contains:

- Few-shot example 2: “Ritu has developed three main projects” and lists Orbit AI, Stayora, Scientific Calculator (`prompts.py:17-20`).
- Core rule 2: “Ritu’s known projects are strictly limited to Orbit AI, Stayora, and Scientific Calculator” (`prompts.py:48`).

The current content API has five projects, including WebChat AI and Zerodha Clone. The prompt therefore contradicts the knowledge source. **VERIFIED**

Impact: even when retrieval returns WebChat AI or Zerodha Clone chunks, the model may refuse, omit them, or answer that they do not exist. This is an AI correctness defect independent of U10. **INFERRED from model behavior; contradiction itself VERIFIED**

### 9.2 Case-study implication

If U10 adds case-study fields, the AI service must include them in `sections_from_content` and the prompt must stop hardcoding a project list. Otherwise the assistant will remain inconsistent with the site and will not benefit from the new content. **VERIFIED design requirement**

---

## 10. WebChat AI Evidence Inventory

### 10.1 What the repository verifies

- Project entry exists with slug `webchat-ai`, title “WebChat AI,” category “AI SaaS,” featured and indexable. **VERIFIED**
- Live URL: `https://webchat-ai-dashboard.vercel.app/`. **VERIFIED**
- Source URL: `https://github.com/riturajlabs/webchat-AI`. **VERIFIED as a stored link, not as in-repo code**
- Ten technology tags: Next.js, React, TypeScript, FastAPI, Python, MongoDB Atlas, Vector Search, RAG, Gemini AI, Playwright. **VERIFIED as metadata**
- Three highlights covering RAG/vector/grounded responses, zero-code embeddable streaming widget, and multi-tenant architecture. **VERIFIED as metadata**
- Cover image `public/images/projects/webchat-ai.webp`, 1870x896. **VERIFIED**
- Image alt text mentions an embedded widget answering from a “156-page indexed knowledge base.” **VERIFIED as an authored claim, not independently verified**
- SEO title and description exist and a prerendered page is generated. **VERIFIED**
- Tests and e2e reference the slug for page rendering, SEO, accessibility, and sweep checks. **VERIFIED**

### 10.2 What the legacy knowledge base adds

`ai_service/knowledge_base.json` contains a WebChat AI entry with:

- Detailed overview describing a multi-tenant RAG SaaS that crawls websites, chunks content, generates embeddings, stores vectors in MongoDB Atlas, retrieves context, streams responses, and ships an embeddable widget.
- Technology groups: Next.js/React/TypeScript; Python/FastAPI; MongoDB Atlas; Gemini AI/RAG/embeddings/vector search; Playwright/SSE/Docker; Vercel/Railway.
- Features: multi-tenant SaaS, zero-code widget, crawling/extraction, RAG grounding, vector search, streaming, secure auth/API management.
- Architecture: Next.js dashboard, FastAPI backend, MongoDB Atlas Vector Search, Playwright scraper, embedding pipeline, LLM generation layer, embeddable widget SDK.
- Challenges: building the RAG pipeline, ingestion, hallucination reduction, multi-tenant design, provider reliability/latency.
- Learnings: generative AI application development, RAG architecture, vector search, backend system design, AI API integration, production deployment.
- Completion year: 2026.

**VERIFIED as legacy knowledge-base content**

### 10.3 What cannot be verified here

- Whether the actual implementation matches the claimed architecture. **UNKNOWN**
- Whether the crawl/ingestion pipeline, chunking, embeddings, vector index, streaming, tenancy isolation, auth, rate limits, and deployment topology work as described. **UNKNOWN**
- Whether the “156-page” knowledge base claim is current or accurate. **UNKNOWN**
- Performance, latency, scale, reliability, cost, or security outcomes. **UNKNOWN**
- Any metric suitable for a case-study outcome section. **UNKNOWN**

### 10.4 Editorial conclusion

WebChat AI can support a strong case study only if the external repository or live product is used as an evidence source. From this repository alone, the defensible content is the problem framing, technology list, and reported architecture/challenges/learnings from the legacy knowledge base. Those must be labelled as reported, not independently verified. **VERIFIED limitation; INFERRED editorial approach**

---

## 11. Other Project Evidence Inventory

### 11.1 Orbit AI

Available in this repository:

- Metadata: React, Node.js, Express, FastAPI, MongoDB, AI/LLM; live and source links; 3 highlights.
- Legacy knowledge base: detailed overview, grouped technologies, features, architecture, challenges, learnings, completion year 2026.
- Public detail page and SEO output.

**VERIFIED as repository/legacy content.** Actual implementation is external and not verifiable here. **UNKNOWN**

### 11.2 Stayora

Available:

- Metadata: JavaScript, Node.js, Express, MongoDB; live and source links; 3 highlights.
- Legacy knowledge base: detailed overview, grouped technologies, features, MVC/REST architecture, challenges, learnings, completion year 2026.
- Public detail page and SEO output.

**VERIFIED as repository/legacy content.** Actual implementation is external and not verifiable here. **UNKNOWN**

### 11.3 Zerodha Clone

Available:

- Metadata: React, Bootstrap, JavaScript; live and source links; 3 highlights.
- No legacy knowledge-base entry.
- No architecture, challenges, or learnings content.

**VERIFIED.** This is the thinnest project and needs new authoring before it can support a case study. **VERIFIED**

### 11.4 Scientific Calculator

Available:

- Metadata: HTML, CSS, JavaScript; live and source links; 3 highlights.
- Legacy knowledge base: detailed overview, technologies, features, learnings, completion year 2025.
- No architecture or challenges section in the legacy entry.

**VERIFIED.** Suitable for a shorter case study focused on scope, math logic, accessibility/keyboard support, and constraints. **INFERRED**

---

## 12. Case Study Gap Analysis

A credible project case study in this portfolio should answer:

1. What problem did the project solve, and for whom?
2. What was the author’s role and scope?
3. What constraints shaped the work?
4. How was it architected?
5. What were the key decisions and tradeoffs?
6. What was the hardest challenge, and how was it resolved?
7. What was the outcome, with evidence?
8. What was learned, and what would be done differently?
9. Where can a reader verify the work (demo, source, screenshots)?

Current coverage:

| Element | Current public model | Legacy KB (4 projects) |
|---|---|---|
| Problem/context | Short description only | Partial, in overview |
| Role/scope | absent | absent |
| Timeline/year | absent | `completionYear` |
| Constraints | absent | absent |
| Architecture | absent | `architecture` list |
| Key decisions/tradeoffs | absent | absent |
| Challenges/resolution | absent | `challenges` list (challenge names only, no resolution) |
| Outcomes/metrics | absent | absent |
| Learnings | absent | `learnings` list |
| Evidence/gallery | one cover image | image path only |
| Demo/source | present | present |

**VERIFIED**

The gap is not just “more words.” The missing pieces are role, constraints, decisions, tradeoffs, resolution narratives, and evidence-backed outcomes. **VERIFIED**

---

## 13. SEO, Prerendering, and Discovery

Current strengths:

- Five static project pages at `/projects/<slug>/`.
- Canonical URL derived from site URL and slug.
- Open Graph and Twitter metadata.
- JSON-LD `SoftwareApplication` structured data.
- Explicit image dimensions and preload.
- `sitemap.xml`, `sitemap-images.xml`, `robots.txt`, and `llms.txt`.
- Build asserts every indexable project has a page and every discovery URL resolves.
- Related projects are derived only from shared technologies/category.

**VERIFIED**

Case-study implications:

- Adding sections to the existing project page preserves the current URL and SEO surface.
- Adding new routes would require discovery, canonical, sitemap, and test changes.
- Richer content could improve `llms.txt` summaries and AI retrieval only if the content enters the public payload and the AI ingestion path.
- Duplicate description content should be removed or differentiated as part of any content upgrade.

**VERIFIED / INFERRED**

---

## 14. UX, Design, Accessibility, and Responsive Behavior

Current design:

- Homepage project grid: two columns, one column below 991px.
- Project detail article: max-width 860px.
- Sticky section nav with in-page anchors.
- Theme tokens for cards, text, links, and elevation.
- Project pages are static and dark-only; they do not have the homepage theme toggle mechanism.
- Buttons and nav links meet touch-target expectations (for example, 44px minimum nav links).
- Project modal traps focus, closes on Escape, restores focus, and locks scroll.

**VERIFIED**

Accessibility coverage:

- Axe scans the homepage in dark and light themes.
- Axe scans all five project pages at four viewports.
- Horizontal overflow is checked on project pages and the homepage.
- Critical/serious violations fail the gate; the deferred list is empty.

**VERIFIED**

Case-study UX gaps:

- No long-form reading layout for narrative sections.
- No table of contents beyond the current four anchors.
- No code blocks, diagrams, callouts, or image galleries.
- No next/previous project navigation.
- No reading time or last-updated signal.
- Project pages have no theme control.

**VERIFIED**

---

## 15. Testing and CI Coverage

Repository test/spec inventory by filename:

- 32 frontend test modules.
- 29 backend test modules.
- 9 AI-service test modules.
- 6 Playwright spec files.
- 76 total test/spec modules.

**VERIFIED by file count**

CI covers:

- Frontend lint and unit tests.
- Deterministic seed extraction.
- Backend API tests.
- AI-service lint and tests.
- Full build against a provisioned backend.
- Migration validation against `dist/`.
- Playwright public, admin, chat, contact, accessibility, and sweep tests.
- Tripwire preventing `src/data/**` changes.

**VERIFIED**

Prior U9 validation, cited from `reports/U9_FINAL_REVIEW.md`:

- Lint pass.
- Serial frontend suite: 292 tests pass.
- Migration validation: 14/14 pass.
- SEO parity: 11/11 pass.
- Full build pass with a disposable backend.
- Playwright suite: 37 passed, 2 transient `ERR_NETWORK_CHANGED` failures.

**VERIFIED as prior report content, not re-run in this audit**

Coverage gaps for U10:

- No test asserts case-study fields, sections, or evidence.
- No test covers prose in `long_description` because prose is not a supported input.
- No test asserts that the AI prompt names all five projects.
- No content-quality or claim-verification test exists.
- No test covers WebChat AI implementation claims.

**VERIFIED**

---

## 16. Security, Privacy, and Editorial Safety

Current safeguards:

- Public content excludes admin fields and timestamps.
- Content assembly names columns explicitly and uses read-only transactions.
- Admin mutations are audited in the same transaction.
- Project deletion is soft.
- Published project slugs are immutable.
- Uploads accept only constrained image shapes/URLs.
- Admin authentication uses an HttpOnly cookie; no admin secret is shipped to the browser.
- CI tripwire protects legacy `src/data` content.

**VERIFIED**

Editorial risks:

- `knowledge_base.json` contains unpublished personal data, including academic details not on the public site. It must not be imported wholesale into public case studies.
- Legacy project narratives are unverified and may be stale.
- WebChat AI claims are not code-verifiable in this repository.
- There is no evidence requirement for metrics, so a case study could accidentally publish invented numbers.
- The AI prompt currently contradicts the public project list.

**VERIFIED risks; editorial consequences INFERRED**

---

## 17. Risks and Limitations

| Risk | Severity | Evidence | Mitigation |
|---|---|---|---|
| Using `long_description` for prose breaks Highlights | High | `_highlights()` treats every line as a bullet | Add a dedicated case-study field; do not put prose there |
| Current schema cannot store case studies | High | No narrative/decision/outcome fields | Add nullable structured model |
| WebChat AI claims cannot be verified here | High | No source in repo | Verify against external repo/live product or label as reported |
| AI prompt suppresses WebChat/Zerodha | High | Prompt hardcodes three projects | Update prompt to derive from retrieved context |
| Legacy KB contains private data | High | `docs/SECURITY.md` §3.2 | Import only reviewed project fields; redact personal data |
| Schema/API change expands scope | Medium | Public/admin/AI contracts all consume project fields | Phase the change; keep fields nullable and backward-compatible |
| Duplicate description weakens detail page | Medium | `ProjectPage.jsx:75-76` and `:145` | Differentiate summary and narrative |
| No outcome evidence | Medium | No metrics fields or sources | Require evidence URLs/labels for every metric |
| New routes could break SEO | Medium | Discovery/build contracts are strict | Prefer sections on existing pages, or update discovery/tests |
| Content drift between legacy KB and API | Medium | 4 vs 5 projects, different fields | Use API as authority; retire or regenerate legacy file later |
| Test coverage does not assert case-study quality | Low/Medium | No case-study tests | Add rendering, API, and AI ingestion tests with the feature |

**VERIFIED / INFERRED as marked in the evidence column**

---

## 18. Recommendations and Proposed U10 Scope

### 18.1 Immediate fixes independent of U10

1. Fix the AI prompt so it does not hardcode three projects. It should rely on retrieved context and mention all published projects when asked. **VERIFIED need**
2. Correct the profile “Projects” stat from “4+” to the actual count, or make it derived. **VERIFIED inconsistency**
3. Add admin helper text explaining that `long_description` lines become highlights and are not a prose case-study field. **VERIFIED need**
4. Remove or differentiate the duplicated description on the project detail page. **VERIFIED need**

These are small but should not be bundled into a schema change without approval.

### 18.2 Recommended U10 implementation scope

Do not attempt full case studies by overloading existing fields. Add a dedicated, nullable case-study model:

- `role` — string.
- `timeline` — string or year range.
- `team` — string or null.
- `problem` — text.
- `constraints` — list of strings.
- `approach` — text.
- `architecture` — list of strings or structured items.
- `key_decisions` — list of `{ decision, rationale, tradeoff }`.
- `challenges` — list of `{ challenge, resolution }`.
- `outcomes` — list of `{ label, value, evidence_url }`.
- `learnings` — list of strings.
- `gallery` — list of `{ src, alt, caption }`.
- `links` — optional demo/source/design links.

Store as a nullable JSONB column on `project` or as a `project_case_study` table. JSONB is simpler for a single case study per project; a table is better if media/metrics need independent constraints. **INFERRED recommendation**

### 18.3 Required changes by layer

| Layer | Change |
|---|---|
| Database | Add nullable case-study storage and migration |
| Backend model | Add field/relationship |
| Public schema | Add `caseStudy` to project payload |
| Admin schema | Add create/update validation |
| Admin UI | Structured editor sections and preview |
| Public UI | Render case-study sections, gallery, TOC |
| AI service | Include case-study fields in `sections_from_content` |
| AI prompt | Remove hardcoded project list |
| Build/SEO | Keep existing pages; update `llms.txt` only if desired |
| Tests | API, admin, rendering, AI ingestion, accessibility |

**VERIFIED dependency chain**

### 18.4 Content authoring plan

| Project | Priority | Available material | Main gap |
|---|---|---|---|
| WebChat AI | 1 | Strong metadata + legacy narrative | External verification and evidence |
| Orbit AI | 2 | Legacy narrative | Role/decisions/outcomes |
| Stayora | 3 | Legacy narrative | Role/decisions/outcomes |
| Scientific Calculator | 4 | Legacy narrative | Architecture/challenges |
| Zerodha Clone | 5 | Only metadata | Nearly everything |

**INFERRED priority based on available evidence and project complexity**

### 18.5 Evidence rules

- Every outcome metric must have a source URL or be labelled “reported.”
- Do not publish a metric that cannot be reproduced or linked.
- Do not claim code-level WebChat AI behavior from this repository.
- Do not import unpublished personal data from `knowledge_base.json`.
- Prefer “what I built and why” over feature lists.

**VERIFIED policy recommendation**

---

## 19. Proposed Case Study Content Model and Migration Path

### 19.1 Proposed shape

```json
{
  "role": "Solo developer",
  "timeline": "2026",
  "team": null,
  "problem": "Businesses need grounded AI support without building a RAG stack.",
  "constraints": [
    "Zero-code embed for non-technical site owners",
    "Grounded answers with low hallucination"
  ],
  "approach": "Crawl, chunk, embed, retrieve, and stream grounded answers.",
  "architecture": [
    "Next.js dashboard",
    "FastAPI backend",
    "MongoDB Atlas Vector Search",
    "Playwright ingestion",
    "Embeddable widget SDK"
  ],
  "keyDecisions": [
    {
      "decision": "Use retrieval grounding instead of fine-tuning",
      "rationale": "Content changes frequently; retrieval keeps answers current.",
      "tradeoff": "Retrieval quality and latency become critical."
    }
  ],
  "challenges": [
    {
      "challenge": "Multi-tenant isolation",
      "resolution": "Scope every retrieval and widget request by tenant."
    }
  ],
  "outcomes": [
    {
      "label": "Indexed knowledge base",
      "value": "156 pages",
      "evidenceUrl": "external evidence required"
    }
  ],
  "learnings": [
    "RAG quality depends on ingestion and chunking more than prompt wording."
  ],
  "gallery": [
    {
      "src": "/images/projects/webchat-ai.webp",
      "alt": "WebChat AI landing page with embedded chat widget",
      "caption": "Dashboard and embeddable widget"
    }
  ]
}
```

This is a recommendation, not an implemented contract. **INFERRED**

### 19.2 Why not reuse `long_description`

- It is already the bullet encoding for highlights.
- `_highlights()` would treat prose paragraphs as highlights.
- It has no structure for decisions, challenges, outcomes, or gallery.
- It is a single text column; parsing conventions would be brittle.
- The AI service would ingest the raw text without structure.

**VERIFIED**

### 19.3 Migration path

1. Review and redact legacy `knowledge_base.json` project content.
2. Design and approve the nullable case-study schema.
3. Add backend model/schema/API and admin editor.
4. Add public renderer and keep existing pages backward-compatible.
5. Add AI ingestion fields and fix the prompt project list.
6. Author and verify all five case studies.
7. Add tests for API, admin, rendering, AI ingestion, and accessibility.
8. Run full build, migration validation, SEO parity, and e2e.

**INFERRED sequence; each step requires separate approval**

### 19.4 Alternative if schema changes are not allowed

A static case-study module plus prerendered pages would be possible, but it would:

- Bypass the database content authority.
- Require a second content path.
- Break the admin workflow.
- Risk drift from the public API.
- Conflict with the CI tripwire on `src/data/**`.

It is not recommended. **INFERRED**

---

## 20. Verification, Evidence Index, and Sign-off

### 20.1 Verification performed

| Check | Result |
|---|---|
| Branch unchanged | `feature/portfolio-u8-work` |
| HEAD unchanged | `0ccc7ef0deea9d8710af4b7225b2eb8799e53723` |
| Initial working tree | clean |
| Source edits | none |
| Schema/migration changes | none |
| Dependency changes | none |
| Build/tests run | none (read-only audit; build would mutate generated content) |
| Output created | this report only |

**VERIFIED**

### 20.2 Evidence index

| Topic | Evidence |
|---|---|
| Project content | `src/generated/content.js`, `src/data/projects.js` |
| Public card/modal | `src/components/common/ProjectCard.jsx` |
| Detail page | `src/components/pages/ProjectPage.jsx:75-76`, `:143-145`, `:169-179` |
| Highlights derivation | `backend/app/services/content.py:80`, `:167` |
| Project schema | `backend/app/models/project.py` |
| Admin editor | `src/admin/pages/ProjectEditor.jsx:283-305`, `:453-525` |
| Admin CRUD/audit | `backend/app/services/admin_content.py` |
| Content pipeline | `scripts/build-content.mjs`, `package.json` build script |
| Project SEO | `src/lib/projectPages.js`, `scripts/generate-project-pages.mjs`, `scripts/generate-seo-discovery.mjs` |
| AI default source | `ai_service/config/settings.py:61` |
| AI project context | `ai_service/services/content_api.py:310-333` |
| AI prompt defect | `ai_service/core/prompts.py:17-20`, `:48` |
| Legacy project narratives | `ai_service/knowledge_base.json` |
| Private-data warning | `docs/SECURITY.md` §3.2 |
| Content mapping | `docs/CONTENT_MAPPING.md` §3 |
| CI coverage | `.github/workflows/ci.yml` |
| Prior validation | `reports/U9_FINAL_REVIEW.md` §5-§6 |

### 20.3 Open questions for the owner

1. Is U10 allowed to add a database column/table and change the public/admin API contract?
2. Should case studies live as sections on existing `/projects/<slug>/` pages, or as new routes?
3. Can WebChat AI be verified against the external repository/live product, or should claims be labelled “reported”?
4. Who owns final copy approval and evidence verification for metrics?
5. Should Zerodha Clone remain in the portfolio if no substantive case study can be supported?

**UNKNOWN until answered**

### 20.4 Sign-off

The portfolio is **ready for a case-study content-model design**, not for immediate case-study authoring. The publishing pipeline, SEO, accessibility, and admin audit foundations are solid. The missing pieces are a dedicated narrative model, an evidence policy, WebChat AI verification, and an AI prompt correction. **VERIFIED readiness assessment**

No implementation should begin until the schema/API scope and WebChat evidence source are explicitly approved.
