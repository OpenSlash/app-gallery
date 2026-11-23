# App Gallery

A private launchpad and lifecycle log for your websites, infrastructure services, and apps.

**English** | [简体中文](README.zh-CN.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FOpenSlash%2Fapp-gallery)

## Features

- Launchpad-inspired interface with a white background and a favorites Dock.
- Launchpad and card views, global zoom, and small / medium / large app cards.
- Add, edit, search, categorize, tag, filter, sort, and favorite applications.
- Retrieve public website names, descriptions, and icons from the app editor.
- Upload application icons to D1 without bundling private service logos in source.
- Record first launch dates, releases, notes, pauses, resumptions, and retirement.
- View elapsed days and cumulative active periods from lifecycle records.
- Archive retired or not-yet-launched apps without deleting their history.
- Accessible Radix UI primitives and 16 application icons from Radix Icons.
- D1 persistence, validated APIs, and built-in administrator password login.
- Revocable, expiring API tokens scoped to application metadata and icon uploads.

Each application currently has one production deployment and one URL. Dates use
UTC. Durations describe recorded lifecycle periods, **not monitored uptime**.
Multiple environments, migration, import/export, monitoring, and general file uploads
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
command and **`pnpm run deploy`** as the deploy command, not bare `wrangler deploy`.
Use the explicit `run`: `pnpm deploy` invokes pnpm's built-in workspace deployment
command instead of this project's script.
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
pnpm run deploy
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

In Workers Builds settings, ensure the deploy command is `pnpm run deploy`, then
start a **new build from the updated commit**. Do not merely retry the old
artifact or add a dashboard binding while leaving the fake ID in source.
The deploy script repairs legacy zero IDs by resolving the configured database
name. It never replaces a non-placeholder ID automatically or deletes a database.

### Updating an Existing Access-Based Installation

Pull the update into your deployment repository, run `pnpm build` and
`pnpm run deploy` (which applies the session and credential migrations), and create
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
DELETE FROM api_tokens;
```

Remove any legacy runtime/build `ADMIN_PASSWORD`, then immediately create a new
password in the browser before reopening access. This preserves application and
lifecycle records. Anyone with access during this reset window could claim the instance.

### Database Setup Errors

If the page reports a missing database binding, verify that the production Worker
has a D1 binding named `DB`. Missing tables or columns require migrations on that
same database, not another database with a similar name. In Workers Builds, set
the **deploy command** to `pnpm run deploy` (the build command remains `pnpm build`),
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

### Adding Applications With an API Token

After signing in, open **API Token** in the header. Create a named token with an
expiry of 7, 30 (default), 90, or 365 days. The full token is shown **once**, is not
saved in browser storage, and cannot be retrieved later. D1 stores only its
SHA-256 hash, a short display prefix, metadata, and a credential-bound tag.
Keep it in a password manager or your script/CI secret store, not in source code,
URLs, screenshots, or chat messages.

Set `APP_GALLERY_TOKEN` in your shell environment and replace the hostname:

```sh
curl --fail-with-body 'https://your-worker.workers.dev/api/v1/applications' \
  -H "Authorization: Bearer $APP_GALLERY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"My App","url":"https://example.com","type":"website","launchedOn":"2026-01-01"}'
```

A successful response is HTTP 201 with `{ "id": "..." }`. Required fields are
`name`, `url` (HTTP or HTTPS, without embedded credentials), and `type`
(`website`, `service`, or `app`). Optional fields include `description`, `category`,
`tags`, `icon`, `iconUrl`, `color`, `size`, `favorite`, and `launchedOn` (UTC `YYYY-MM-DD`,
not in the future; omitted or null means not yet launched).
Each request creates a new application; there is no automatic deduplication.

### Uploaded Icons

Upload an icon in the application editor and save the application. PNG, JPEG,
WebP, ICO, and static SVG are accepted, up to 256 KiB. Image bytes are persisted
in D1, deduplicated by content hash, and served from an authenticated
`/api/v1/icons/:id` URL. No application-specific images are bundled in the
repository and no R2 setup is required. Uploads are independent assets;
cancelling an edit does not delete an already uploaded image.

Icons appear in the launchpad, cards, details, editor preview, and Dock. Failed
images fall back to the chosen Radix icon. Choosing a Radix icon clears `iconUrl`.
External HTTPS image URLs without embedded credentials remain optional; their
requests omit the referrer, but remote hosts still receive the visitor's IP.
Download icons from HTTP services and upload them, or use website information
retrieval, instead of embedding mixed content. SVG responses are sandboxed
with a restrictive CSP; scripted SVG and external references are rejected.

Use `pnpm run deploy` to migrate icon metadata and uploaded image storage before
publishing. Existing applications are not automatically changed.

### Retrieve Website Information

In the app editor, enter the full HTTP(S) address and click **获取网站信息**
("Get website information"). The server reads public HTML metadata and icon
links, then tries conventional favicon paths. Valid icons are copied into D1
using the same 256 KiB limit and validation as manual uploads. Results fill
only empty name, description, and icon fields; existing edits are never
overwritten. Review or change the result, then save the application.
Fetched icons are independent assets, just like manual uploads.

Login-page metadata can be read if publicly available, including HTML returned
with 401/403. Product credentials, browser cookies, API tokens, and upstream
Set-Cookie headers are never forwarded or reused. Pages requiring JavaScript,
a logged-in session, bot-challenge completion, or private-network access may
require manual entry. Cross-host page redirects, such as separate SSO sites,
are not adopted as product identity. The entered application URL is preserved.
Remote sites and DNS providers see the Worker requests, not the browser session.

`POST /api/v1/website-metadata` accepts `{ "url": "https://example.com/console" }`
and returns `{ name, description, iconUrl, warnings }`. It requires the
administrator's same-origin browser session; API tokens cannot call it.
Partial results include warnings; failures leave the form editable.
The included `METADATA_RATE_LIMITER` allows 10 attempts per minute per IP and
Cloudflare location. Use `pnpm run deploy` to publish the new binding.

Retrieval accepts only public HTTP(S) destinations, checks literal and DNS IP
addresses, validates every redirect and icon destination, rejects HTTPS
downgrades, and never executes remote scripts or follows meta refresh.
HTML is limited to 512 KiB, icons to 256 KiB, each fetch chain to 4.5 seconds,
the overall remote operation to 15 seconds, and outbound fetches to 32.
The app is not a private-network connector or authenticated browser.

### API Token Permissions

Tokens have the `applications:write` scope. **Existing tokens also gain these
permissions after upgrading**; revoke any that should remain create-only before
deploying. Supported endpoints:

- `POST /api/v1/applications`: create an application.
- `GET /api/v1/applications/:id`: read one known application, including its revision.
- `PUT /api/v1/applications/:id`: replace editable metadata, with `revision`.
- `PATCH /api/v1/applications/:id`: update only supplied fields, with `revision`.
- `POST /api/v1/icons`: upload raw image bytes with the image's Content-Type.
- `GET /api/v1/icons/:id`: read an uploaded image.

Tokens cannot list the application directory, archive applications, change
lifecycle records, retrieve website metadata, or access authentication/token management.
HTTPS is required except on loopback for development. Script requests
do not need a Cookie or Origin header. Cross-origin browser calls remain blocked;
there is no permissive CORS. A supplied invalid Authorization header never falls
back to an existing browser session.

To upload an icon, then edit an existing application (replace `APP_ID` and use
the actual `iconUrl` returned by the upload):

```sh
curl --fail-with-body 'https://your-worker.workers.dev/api/v1/icons' \
  -H "Authorization: Bearer $APP_GALLERY_TOKEN" \
  -H 'Content-Type: image/png' --data-binary @icon.png

curl --fail-with-body 'https://your-worker.workers.dev/api/v1/applications/APP_ID' \
  -H "Authorization: Bearer $APP_GALLERY_TOKEN"

curl --fail-with-body -X PATCH 'https://your-worker.workers.dev/api/v1/applications/APP_ID' \
  -H "Authorization: Bearer $APP_GALLERY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"revision":0,"name":"My App","iconUrl":"/api/v1/icons/RETURNED_ICON_ID"}'
```

Use the revision from the single-application GET, not an assumed value. A stale
revision returns HTTP 409 without changing the application. PATCH cannot modify
launch dates or lifecycle fields, and omitted metadata is preserved.

The management UI shows up to 100 tokens, with unexpired non-revoked tokens first
and recent history next, expiry, and last authenticated
call time (which may include requests subsequently rejected by input validation).
Revoke a token to disable subsequent calls; browser logout does not revoke tokens.
Changing the administrator credential invalidates tokens bound to the previous one.
At most 20 unexpired, non-revoked tokens are allowed; revoke obsolete tokens before
creating more. Local development bypass alone cannot issue tokens: configure a
real administrator password first.

Token management requires the administrator's same-origin browser session:
`GET /api/v1/auth/tokens`, `POST /api/v1/auth/tokens` with
`{ "name": "integration", "expiresInDays": 30 }`, and
`POST /api/v1/auth/tokens/:id/revoke` with `{}`. Bearer tokens cannot call these.
Deploy updates with `pnpm run deploy` to apply the token-table migration.

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
