# Local manual test checklist

## Start and verify

- [ ] `npm run local:up`
- [ ] `npm run local:check`
- [ ] Frontend opens at http://127.0.0.1:5173
- [ ] Backend `/health`, `/ready`, and `/api/content` return expected responses
- [ ] AI `/health` and `/ready` return expected responses
- [ ] `npm run local:status` shows all services healthy

## Public site

- [ ] Homepage loads without unexpected console errors.
- [ ] Seven navigation anchors resolve.
- [ ] Theme toggle persists across refresh.
- [ ] All five project cards open their project pages.
- [ ] Project metadata, images, canonical URLs, sitemap, robots, and resume load.
- [ ] GitHub data either loads from the configured proxy or shows its documented
  unavailable state.
- [ ] Contact validation rejects invalid input and accepts valid input.

## Chat

- [ ] `/ready` is healthy before opening chat.
- [ ] The chat dialog opens.
- [ ] A question streams an SSE response to completion.
- [ ] Provider errors are visible and do not expose keys or stack traces.
- [ ] Confirm the browser Network tab calls the configured AI URL only.

## Admin

- [ ] Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in ignored `backend/.env`.
- [ ] Run `npm run admin:setup`; confirm it reports safe account metadata only.
- [ ] `/admin` redirects unauthenticated users to login.
- [ ] Configured local admin credentials log in and redirect to `/admin`.
- [ ] Refresh the dashboard and confirm the server-side session persists.
- [ ] `GET /api/admin/me` returns the user projection and CSRF token.
- [ ] Failed login has a generic error.
- [ ] Missing or invalid configuration fails the setup command without outputting
  the value.
- [ ] Dashboard, projects, skills, certifications, profile, and messages load.
- [ ] Create/edit/hide a disposable project and verify the resulting API state.
- [ ] Run `npm run admin:reset` only after deliberately changing credentials.
- [ ] Logout invalidates the session and returns to `/admin/login`.
- [ ] A subsequent protected API request is rejected with `401`.
- [ ] Session cookies are HttpOnly and SameSite-protected.

## Persistence and integrations

- [ ] `npm run seed:verify` reports zero differences.
- [ ] Restart the application services with `npm run local:stop` then
  `npm run local:up`; database content and ChromaDB remain present.
- [ ] Treat contact delivery as real only when a real Resend key and verified
  sender are configured. A stored message does not prove email delivery.
- [ ] Treat chat as real-provider testing only when Groq/Gemini keys are
  configured; otherwise use the documented offline/test behavior.

## Evidence and cleanup

- [ ] Inspect `.cache/local/*.log` for service errors.
- [ ] Inspect browser Console and Network tabs.
- [ ] Run `npm run local:prod:build` for the isolated production-like build.
- [ ] Stop with `npm run local:stop` and, if used,
  `npm run local:prod:stop`.
