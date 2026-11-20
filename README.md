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
- D1 persistence, validated APIs, and Cloudflare Access JWT verification.

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

Set `LOCAL_DEV=true` in your local `.dev.vars`, then run:

```sh
pnpm db:local
pnpm dev
```

Open the address printed by Vite. Development authentication only works on
localhost / 127.0.0.1. Never commit `.dev.vars` or enable `LOCAL_DEV` in production.
New installations do not contain sample applications.

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

Use the button above to create your own instance. The deployment flow provisions
D1 and replaces the template database ID. Use `pnpm build` as the build command
and `pnpm deploy` as the deploy command. The deploy script applies database
migrations through the `DB` binding before publishing the Worker.

**The button deploys the application, but does not configure your identity
provider.** Before storing real data:

1. Create a Cloudflare Access application with a minimal email allowlist.
2. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc` under `vars`
   (or the generated configuration committed by the deployment flow), then
   rebuild and deploy. Dashboard-only changes may be overwritten by empty
   values in the repository on subsequent deployments.
3. Protect the site with Access on your custom domain, or configure Access
   protection for its `workers.dev` address.
4. Verify that anonymous requests are denied and authorized users can read
   and write data.

The API returns 503 when Access is unconfigured and 401 for missing or invalid
JWTs. It verifies JWTs independently of domain-level protection. The static
page shell contains no private application data. Dynamic preview URLs are
disabled by default.

### Manual Deployment

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create app-gallery
```

Replace the placeholder database ID in `wrangler.jsonc` with the real ID and
configure the Access variables described above, then run:

```sh
pnpm build
pnpm deploy
```

An actual production deployment has not yet been verified for this repository.

To regenerate the deployment badge from the Git remote:

```sh
pnpm deploy:button
```

## API

`POST /api/v1/applications` is available for adding applications through
authenticated, same-origin requests. Authentication uses Cloudflare Access.
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
