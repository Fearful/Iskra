# Announcing Iskra 0.1.0

> Draft announcement for the public launch. Trim per channel (HN/Lobsters want a
> short neutral title; the Bun Discord wants the friendly version).

## TL;DR

**Iskra** is a modular framework for building backend (and desktop/mobile)
applications on [Bun](https://bun.sh), using a hexagonal (ports & adapters)
architecture so your business logic stays decoupled from infrastructure. It's
open source under AGPL-3.0-or-later and just hit its first public release,
`0.1.0`.

- **Repo:** https://github.com/fearful/iskra
- **Docs:** https://fearful.github.io/iskra
- **Install:** `bun add @iskra-bun/core @iskra-bun/web-kit`

## What it is

Iskra is a small `core` (dependency injection, an event bus, a typed config
system, and an app lifecycle) plus a set of **kits** that plug in as Drivers or
Plugins:

| Kit | What it adds |
| :-- | :-- |
| `web-kit` | HTTP server on Hono, with 15+ features (auth, CORS, CSRF, rate-limit, sessions, uploads…) |
| `db-kit` | SQL via Drizzle ORM (PostgreSQL, MySQL, SQLite) |
| `kv-kit` | Key-value store (Redis + in-memory) |
| `socket-kit` | Native Bun WebSockets with routing/broadcast |
| `worker-kit` | Background jobs on BullMQ |
| `process-kit` | Managing external processes (Python, binaries) |

`desktop-kit` (Tauri), `mobile-kit`, and `db-oracle` ship as **experimental**.

## Why

Most Bun backends start as a single file and slowly tangle business logic with
HTTP, DB, and queue code. Iskra keeps that boundary explicit from line one, so
you can swap a driver (say, SQLite → Postgres, or in-memory KV → Redis) without
touching your domain. You only pull in the kits you need.

## A taste

```typescript
import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';

const app = new App({ name: 'MyApp' });

app.register(new WebDriver({
    port: 3000,
    routes: [{ method: 'GET', path: '/', handler: () => ({ message: 'Hello from Iskra!' }) }],
}));

app.start();
```

There are ready-to-run templates for a chat app, a job worker, a CMS, an
e-commerce API, a desktop app, and more.

## Status & honesty

- `0.1.0` — early. The core and the stable kits are usable today; APIs may still
  move before `1.0`. The experimental kits are explicitly `0.x`.
- TypeScript, Python, and Java client SDKs exist; Go and .NET are on the
  [roadmap](./ROADMAP.md).
- It's AGPL-3.0-or-later — fine for most apps and services; note the network
  copyleft if you're embedding it in a proprietary hosted product.

Feedback, issues, and PRs welcome — there are `good first issue`s to get started.
A read-only mirror lives on [Codeberg](https://codeberg.org/fearful/iskra).
