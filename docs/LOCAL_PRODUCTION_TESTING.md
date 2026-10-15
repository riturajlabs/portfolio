# Local production-like testing

This workflow exercises the real Vite production build and preview server
without deploying or touching hosted services. It uses a separate database
name (`portfolio_local_prod` by default), ports, origins, and process state.
The database is created only if absent; no reset or destructive migration is
performed.

```bash
npm run local:prod:setup
npm run local:prod:build
npm run local:prod:up
npm run local:prod:status
npm run local:prod:check
npm run local:prod:logs
npm run local:prod:stop
```

The production-like URLs are:

| Service | URL |
|---|---|
| Preview frontend | http://127.0.0.1:4173 |
| Backend | http://127.0.0.1:8101 |
| AI service | http://127.0.0.1:8100 |

Override the isolated database name with `LOCAL_PROD_DATABASE`. The workflow
sets backend `ENVIRONMENT=staging`, uses exact localhost origins, points the AI
service at the isolated backend, builds the frontend with the isolated AI URL,
and serves `dist/` through `vite preview`.

This is not a production deployment: hosted TLS, Vercel rewrites, Render
networking, managed PostgreSQL, and real provider quotas are not simulated.
Provider calls still use local environment credentials unless a test provider
is configured.
