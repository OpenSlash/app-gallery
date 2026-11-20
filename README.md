# App Gallery

A private launchpad and lifecycle log for your websites, infrastructure services, and apps.

**English** | [简体中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FOpenSlash%2Fapp-gallery)

## Features

- Launchpad-inspired interface with a white background and a favorites Dock.
- Launchpad and card views, global zoom, and small / medium / large app cards.
- Add, edit, search, categorize, tag, filter, sort, and favorite applications.
- Record first launch dates, releases, notes, pauses, resumptions, and retirement.
- View elapsed days and cumulative active periods from lifecycle records.
- Archive retired or not-yet-launched apps without deleting their history.
- Accessible Radix UI primitives and 16 application icons from Radix Icons.
- D1 persistence, validated APIs, and built-in administrator password login.

Each application currently has one production deployment and one URL. Dates use
UTC. Durations describe recorded lifecycle periods, **not monitored uptime**.
Multiple environments, migration, import/export, monitoring, and file uploads
are not implemented.

The application interface is currently **Simplified Chinese**. The README is
bilingual; full application internationalization is not implemented.

## Stack

React, Vite, TypeScript, Radix UI, Cloudflare Workers, Hono, D1, Drizzle, and Zod.
No self-managed server is required.

## Local Development

Recommended: Node.js 24 LTS and pnpm 10. Cloudflare login is not required locally.

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

For local-only authentication bypass, add `LOCAL_DEV=true` to `.dev.vars`, then run:

```sh
pnpm db:local
pnpm dev
```

Open the address printed by Vite. Development authentication only works on
localhost / 127.0.0.1. Never commit `.dev.vars` or enable `LOCAL_DEV` in production.
New installations do not contain sample applications.
To test real login locally, omit `LOCAL_DEV` and create the administrator password
in the browser on first use. Credentials persist in local D1.

### Sample Data

```sh
pnpm seed:local
```

Seeds 12 editable sample applications into local D1, covering card sizes,
lifecycle states, favorites, and history. Samples are labeled and link to
`example.com` placeholders, not real services. Re-running preserves existing
edits and archived records. This command is not part of production migrations
or the deployment flow.

### Checks

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

If Google Chrome is already installed, use
`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e` instead of downloading Chromium.
End-to-end tests write to local D1 and archive their test applications on success.

## Deploy to Cloudflare

Use the button above to create your own instance. Use `pnpm build` as the build
command and **`pnpm deploy`** as the deploy command, not bare `wrangler deploy`.
The deploy script resolves the `DB` binding, reuses a database with the configured
name or creates one if needed, and writes its real ID into `wrangler.jsonc`.
It applies migrations, verifies the required database schema without reading any
rows, rebuilds Vite output with the resolved binding, and only
then publishes. It refuses to publish if the built ID does not match.
Cloudflare may also provision the database during template setup; an ID already
present in the configuration is preserved.

**No Cloudflare Zero Trust / Access setup is required.**

1. Complete deployment. No administrator password or runtime Secret is required
   in the deployment form.
2. Immediately open the Worker URL, create and confirm a unique password of
   16-256 characters, then sign in. Prefer a password-manager-generated value.
3. Verify anonymous requests to `/api/v1/applications` return 401 before adding
   real data.

**First-run ownership:** until initialization is complete, anyone who can reach
the site can create its administrator password. Do not share the URL before
setup; for sensitive deployments, restrict access temporarily during setup.
There is no account-ownership verification on this first-run page.

D1 stores a PBKDF2-SHA-256 password hash (100,000 iterations), a random per-password
salt, and an independent session signing key, never the plaintext password.
The singleton credential row prevents concurrent or repeated setup from replacing
the password. Data APIs return 503 until initialization is complete.
Back up and protect the D1 database, including its credential material.

Sessions expire after 12 hours and use host-only HttpOnly, Secure, SameSite=Strict
cookies over HTTPS. D1 stores only token hashes and credential-bound tags.
Logout revokes the current session on the server. There is no public signup
after initialization and no web-based password reset.
Login and setup attempts share a limit of five per minute per IP and Cloudflare location
through the included rate-limit binding; this is not a global account-wide quota.
The static page shell contains no private application data. Dynamic preview
URLs are disabled by default.

### Manual Deployment

```sh
pnpm exec wrangler login
pnpm deploy
```

An actual production deployment has not yet been verified for this repository.
Set `database_name` in `wrangler.jsonc` before the first deploy if you want a
different name. To use a specific existing database, set its real `database_id`.
Local deployments update this configuration with the resolved ID; retain that
ID in your own deployment repository for subsequent releases.
Open the deployed URL and create the administrator password before adding data.
Deploying the application does not publish local sample data.

### Recovering From D1 Error 10181

If deployment reports database `00000000-0000-0000-0000-000000000000` was not
found, it is using an older template or stale build. Update the repository
connected to Cloudflare, not just the upstream repository. If Cloudflare cloned
the template into your account, sync that copy first.

In Workers Builds settings, ensure the deploy command is `pnpm deploy`, then
start a **new build from the updated commit**. Do not merely retry the old
artifact or add a dashboard binding while leaving the fake ID in source.
The deploy script repairs legacy zero IDs by resolving the configured database
name. It never replaces a non-placeholder ID automatically or deletes a database.

### Updating an Existing Access-Based Installation

Pull the update into your deployment repository, run `pnpm build` and
`pnpm deploy` (which applies the session and credential migrations), and create
the password on the first-run page. Once password login works, remove the old Access
application or its Worker protection if you no longer want the extra login.
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are no longer used. Existing application
and lifecycle records are preserved.

### Existing Secret-Based Installations

A valid existing `ADMIN_PASSWORD` runtime Secret still works when no D1 password
has been created; initialization is then closed. To switch to browser setup,
remove the legacy runtime Secret and any build-time `ADMIN_PASSWORD`, deploy,
then immediately initialize in the browser. No application records are removed.
An invalid legacy Secret must be removed or corrected before setup is available.
D1 credentials take precedence once created, so a leftover Secret cannot override them.
The deployment script still forwards an explicitly supplied build-time
`ADMIN_PASSWORD` for legacy users; leave it unset for browser-based setup.

`GET /api/v1/auth/session` returns `setupRequired: true` only when first-run
setup is available. It never returns credentials. The page automatically
rechecks while visible and when returning to the tab.

### Forgotten Password

There is no unauthenticated reset endpoint. As the Cloudflare account owner,
first restrict access to the site, then run this SQL in the bound D1 console:

```sql
DELETE FROM admin_credentials;
DELETE FROM auth_sessions;
```

Remove any legacy runtime/build `ADMIN_PASSWORD`, then immediately create a new
password in the browser before reopening access. This preserves application and
lifecycle records. Anyone with access during this reset window could claim the instance.

### Database Setup Errors

If the page reports a missing database binding, verify that the production Worker
has a D1 binding named `DB`. Missing tables or columns require migrations on that
same database, not another database with a similar name. In Workers Builds, set
the **deploy command** to `pnpm deploy` (the build command remains `pnpm build`),
then start a new build from the latest commit. Bare `wrangler deploy` does not
apply the application's migrations. Do not delete the database or manually
recreate credential tables. Unexpected failures include a request ID that can
be matched against Worker logs; do not share passwords or session cookies.

To regenerate the deployment badge from the Git remote:

```sh
pnpm deploy:button
```

## API

`POST /api/v1/applications` is available for adding applications through
authenticated, same-origin requests. Authentication uses the administrator's
session cookie. `GET /api/v1/auth/session`, `POST /api/v1/auth/login`, and
`POST /api/v1/auth/logout` provide session status, login, and logout respectively.
`POST /api/v1/auth/setup` accepts `{ "password": "...", "confirmPassword": "..." }`
only before an administrator credential exists. It does not log in automatically.
Dedicated API tokens and CI integration authentication are not implemented.

## Project Layout

```text
src/web/          React interface
src/worker/       Worker API and database schema
src/shared/       Shared models and validation
drizzle/          D1 migrations
seeds/            Local-only sample data
tests/            Unit and end-to-end tests
docs/             Architecture notes
```

See the [architecture notes (Simplified Chinese)](docs/technical-design.md).
Those notes include deferred features as well as the implemented baseline.
