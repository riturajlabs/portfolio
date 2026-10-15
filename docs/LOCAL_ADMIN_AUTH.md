# Local admin authentication

## Login URL

With the local stack running, open:

```text
http://127.0.0.1:5173/admin/login
```

The development database currently has no admin account until the provisioning
command is run. The login email is not hardcoded in the frontend.

## Configure the first account

Set these values only in the ignored `backend/.env` file or in the shell
environment. Do not use `VITE_` variables:

```env
ADMIN_EMAIL=your-email@example.com
ADMIN_PASSWORD=choose-a-long-local-password
```

Use a password of at least 12 characters. The command reads the values on the
server, validates them, and stores only an Argon2id hash:

```bash
npm run admin:setup
```

If no admin exists, the command creates exactly one `ADMIN` account. If an
account already exists, the command makes no changes and tells you to use the
explicit reset command.

## Reset or change credentials

Changing `backend/.env` alone does not change an existing database account.
After deliberately changing both `ADMIN_EMAIL` and `ADMIN_PASSWORD`, run:

```bash
npm run admin:reset
```

The reset command updates the single existing account, clears its failed-login
counter and invalidates no unrelated content. It refuses to run if more than
one admin account exists. It never resets the database.

Do not put either value in the root `.env`, `VITE_*` variables, committed
documentation, browser code, or chat messages.

## Verify login and session

1. Run `npm run local:up`.
2. Run `npm run admin:setup` after configuring `backend/.env`.
3. Open `/admin/login`.
4. Submit the configured email and password.
5. Confirm the browser redirects to `/admin`.
6. Refresh the page and confirm the dashboard remains authenticated.
7. Confirm `GET /api/admin/me` returns the current user and CSRF token in the
   Network tab; the session cookie remains HttpOnly and is not readable by JS.
8. Use the dashboard logout action and confirm the browser returns to login.
9. Confirm a subsequent protected API request is rejected with `401`.

Wrong email and wrong password intentionally produce the same generic error.
If login fails, first run `npm run local:check`, then verify only the variable
names and account metadata:

```bash
cd backend
.venv/bin/python -m db.admin --help
```

Never print `.env`, password hashes, cookies, or session tokens.
