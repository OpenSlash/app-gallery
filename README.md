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
To test real login locally, omit `LOCAL_DEV` and set a unique `ADMIN_PASSWORD`
of 16-256 characters in `.dev.vars` instead.

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
It applies migrations, rebuilds Vite output with the resolved binding, and only
then publishes. It refuses to publish if the built ID does not match.
Cloudflare may also provision the database during template setup; an ID already
present in the configuration is preserved.

**No Cloudflare Zero Trust / Access setup is required.**

1. Set `ADMIN_PASSWORD` in the deployment form to a unique password of 16-256
   characters. Prefer a password-manager-generated value. The template declares
   it in `.dev.vars.example` so Cloudflare treats it as a Worker secret, not a
   public configuration variable.
   If Cloudflare exposes it as a build secret, `pnpm deploy` explicitly uploads
   it as a runtime Worker secret in the same deployment. It is not put in source
   configuration or client assets.
2. Complete deployment, open the Worker URL, and sign in with that password.
3. Verify anonymous requests to `/api/v1/applications` return 401 before adding
   real data.

If the secret was omitted or is too short, the site shows setup instructions and
data APIs return 503. In the Worker dashboard, open Settings > Variables and
Secrets, add `ADMIN_PASSWORD` with type **Secret**, and deploy the change.
Never put the real password in `wrangler.jsonc`, source code, or a `VITE_*` variable.
If you manage the password directly in Worker settings, leave the build-time
`ADMIN_PASSWORD` unset. When both are set, the build-time value is uploaded on
each deployment and replaces the runtime value.

Sessions expire after 12 hours and use host-only HttpOnly, Secure, SameSite=Strict
cookies over HTTPS. D1 stores only token hashes and credential-bound tags.
Logout revokes the current session on the server; changing `ADMIN_PASSWORD`
invalidates sessions issued under the old password. There is no public signup
or web-based password reset: reset the Worker secret if you forget it.
Login attempts are limited to five per minute per IP and Cloudflare location
through the included rate-limit binding; this is not a global account-wide quota.
The static page shell contains no private application data. Dynamic preview
URLs are disabled by default.

### Manual Deployment

```sh
pnpm exec wrangler login
pnpm deploy
pnpm exec wrangler secret put ADMIN_PASSWORD
```

An actual production deployment has not yet been verified for this repository.
Set `database_name` in `wrangler.jsonc` before the first deploy if you want a
different name. To use a specific existing database, set its real `database_id`.
Local deployments update this configuration with the resolved ID; retain that
ID in your own deployment repository for subsequent releases.
The last command securely prompts for the administrator password. Until it is
set, data APIs stay locked. Deploying the application does not publish local
sample data.

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
`pnpm deploy` (which applies the new session-table migration), and set the
`ADMIN_PASSWORD` secret. Once password login works, remove the old Access
application or its Worker protection if you no longer want the extra login.
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are no longer used. Existing application
and lifecycle records are preserved.

### Password Is Set but the Site Still Shows Setup

Open `/api/v1/auth/session` on the same production hostname. Its
`configurationIssue` distinguishes `missing` (the running Worker did not receive
the variable), `too_short`, and `too_long`. A valid password, including exactly
16 characters, produces `configured: true` and `configurationIssue: null`.
This endpoint never returns the password or its exact length.

For `missing`, check the Worker and production environment behind that hostname,
not only the build configuration. Add the runtime Secret and select Deploy.
Alternatively, update to the latest deployment script, set the build secret,
and run a fresh build with deploy command `pnpm deploy`. Build variables alone
do not become runtime bindings without this explicit upload.
The setup page rechecks when you return to the tab and every 15 seconds while
visible; it also has a manual recheck button.

To regenerate the deployment badge from the Git remote:

```sh
pnpm deploy:button
```

## API

`POST /api/v1/applications` is available for adding applications through
authenticated, same-origin requests. Authentication uses the administrator's
session cookie. `GET /api/v1/auth/session`, `POST /api/v1/auth/login`, and
`POST /api/v1/auth/logout` provide session status, login, and logout respectively.
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
