<!-- markdownlint-disable-next-line MD041 -->
> **Languages:** **English** · [Español](./README.es.md)

# Iskra Framework

[![CI](https://github.com/fearful/iskra/actions/workflows/ci.yml/badge.svg)](https://github.com/fearful/iskra/actions)
[![npm](https://img.shields.io/npm/v/@iskra-bun/core.svg)](https://www.npmjs.com/package/@iskra-bun/core)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df.svg?logo=bun)](https://bun.sh)

**Every large system starts small. Iskra is that initial spark — focused on keeping your code tidy while everything else evolves.**

Iskra is a modular framework for building modern, high-performance applications with [Bun](https://bun.sh). It follows a [hexagonal architecture](https://iskra-docs.fly.dev/concepts/architecture/) (Ports and Adapters) that decouples your business logic from infrastructure, letting you swap drivers without touching your domain code.

## Key concepts

- **Core** — The heart of the framework. Handles [dependency injection, the event bus, and the application lifecycle](https://iskra-docs.fly.dev/packages/core/).
- **Kits** — Modular packages that add specific capabilities. Each one registers itself as a Driver or Plugin on the Core.
- **Drivers** — Adapters that connect the Core to external systems (Hono for HTTP, Drizzle for DB, BullMQ for jobs, etc.).

For a deeper look at the layers, interfaces, and design patterns, see the [architecture documentation](https://iskra-docs.fly.dev/concepts/architecture/).

## Packages

| Package | Description | Docs |
| :--- | :--- | :--- |
| `@iskra-bun/core` | Framework core: App, DI, events, logger, errors | [Core](https://iskra-docs.fly.dev/packages/core/) |
| `@iskra-bun/config-kit` | Typed, Zod-validated environment/config loading | [Config Kit](https://iskra-docs.fly.dev/packages/config-kit/) |
| `@iskra-bun/web-kit` | HTTP server with Hono, Kernel, and 15+ built-in features | [Web Kit](https://iskra-docs.fly.dev/packages/web-kit/) |
| `@iskra-bun/auth-kit` | Transport-agnostic better-auth (config + Drizzle schema), usable outside HTTP | [Auth Kit](https://iskra-docs.fly.dev/packages/auth-kit/) |
| `@iskra-bun/db-kit` | SQL database with Drizzle ORM (PostgreSQL, MySQL, SQLite) | [DB Kit](https://iskra-docs.fly.dev/packages/db-kit/) |
| `@iskra-bun/db-oracle` | Oracle Database support (via Bridge/Sidecar) | [DB Kit](https://iskra-docs.fly.dev/packages/db-kit/) |
| `@iskra-bun/socket-kit` | Native Bun WebSocket with router and broadcast | [Socket Kit](https://iskra-docs.fly.dev/packages/socket-kit/) |
| `@iskra-bun/kv-kit` | Key-Value store with Redis and in-memory adapters | [KV Kit](https://iskra-docs.fly.dev/packages/kv-kit/) |
| `@iskra-bun/cache-kit` | Higher-level cache (cache-aside, TTL, namespaces, tags) on top of kv-kit | [Cache Kit](https://iskra-docs.fly.dev/packages/cache-kit/) |
| `@iskra-bun/worker-kit` | Background job queue with BullMQ | [Worker Kit](https://iskra-docs.fly.dev/packages/worker-kit/) |
| `@iskra-bun/mailer-kit` | Transport-agnostic email (SMTP/SendGrid/Mailgun/SES) | [Mailer Kit](https://iskra-docs.fly.dev/packages/mailer-kit/) |
| `@iskra-bun/storage-kit` | File storage (local, S3/MinIO) with streaming | [Storage Kit](https://iskra-docs.fly.dev/packages/storage-kit/) |
| `@iskra-bun/process-kit` | External process management (Python, binaries) | [Process Kit](https://iskra-docs.fly.dev/packages/process-kit/) |
| `@iskra-bun/testing-kit` | Test utilities (createTestApp, mock logger/driver, withTempDir) | [Testing Kit](https://iskra-docs.fly.dev/packages/testing-kit/) |
| `@iskra-bun/desktop-kit` | Experimental placeholder for Tauri desktop apps (no Tauri integration yet) | [Desktop Kit](https://iskra-docs.fly.dev/packages/desktop-kit/) |
| `@iskra-bun/mobile-kit` | Experimental placeholder for mobile apps (no platform integration yet) | [Mobile Kit](https://iskra-docs.fly.dev/packages/mobile-kit/) |
| `create-iskra` | Project scaffolding CLI (`bun create iskra`) | [create-iskra](https://iskra-docs.fly.dev/packages/create-iskra/) |

## Requirements

- [Bun](https://bun.sh) v1.3 or later (the version CI uses is pinned in [`.bun-version`](./.bun-version))
- [Node.js](https://nodejs.org) v18+ (for some native dependencies)
- [Redis](https://redis.io) (only if you use `worker-kit`, or `kv-kit` with its Redis adapter)

## Quick start

Add the core and the web kit to your project:

```bash
bun add @iskra-bun/core @iskra-bun/web-kit
```

A minimal application:

```typescript
import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';

const app = new App({ name: 'MyApp' });

app.register(new WebDriver({
    port: 3000,
    routes: [
        {
            method: 'GET',
            path: '/',
            handler: () => ({ message: 'Hello from Iskra!' }),
        },
    ],
}));

app.start().catch(console.error);
```

Run it with `bun run index.ts` and visit `http://localhost:3000`.

## Templates

Ready-to-use templates as a starting point. Each one ships with its own README and detailed instructions.

| Template | Description |
| :--- | :--- |
| [simple-server](./templates/simple-server/) | Minimal HTTP server (~18 lines) |
| [starter-app](./templates/starter-app/) | Minimal app with a web server and user CRUD |
| [chat-app](./templates/chat-app/) | Real-time chat with WebSocket and KV store |
| [db-starter](./templates/db-starter/) | CRUD with SQLite and optional Oracle (Drizzle ORM) |
| [cms-starter](./templates/cms-starter/) | CMS with a REST API for posts and pages |
| [ecommerce-api](./templates/ecommerce-api/) | E-commerce backend with products, orders, and cache |
| [realtime-feed](./templates/realtime-feed/) | Social feed with HTTP + real-time WebSocket |
| [full-stack-app](./templates/full-stack-app/) | Full app combining all the kits |
| [job-worker](./templates/job-worker/) | Background task processor with queues |
| [python-data-processor](./templates/python-data-processor/) | Node.js ↔ Python bridge for data processing |
| [desktop-app](./templates/desktop-app/) | Desktop app with Tauri (experimental: the Bun side does not talk to Tauri yet) |
| [universal-app](./templates/universal-app/) | Cross-platform app (experimental: no real mobile project) |
| [plugin-starter](./templates/plugin-starter/) | Scaffolding for building reusable plugins/drivers |

To run a template from a clone of the monorepo:

```bash
bun install
cd templates/starter-app
bun start
```

## Documentation

Full documentation lives at **[iskra-docs.fly.dev](https://iskra-docs.fly.dev)**. Its sources are in [`website/src/content/docs/`](./website/src/content/docs/):

| Document | What it covers |
| :--- | :--- |
| [Architecture](https://iskra-docs.fly.dev/concepts/architecture/) | Hexagonal architecture, layers, design patterns |
| [Core](https://iskra-docs.fly.dev/packages/core/) | App class, lifecycle, DI, logger, events, errors |
| [Web Kit](https://iskra-docs.fly.dev/packages/web-kit/) | HTTP server, Kernel, features (auth, CORS, CSRF, rate limit, etc.) |
| [DB Kit](https://iskra-docs.fly.dev/packages/db-kit/) | Drizzle ORM, supported drivers, schemas |
| [Socket Kit](https://iskra-docs.fly.dev/packages/socket-kit/) | WebSocket, router, broadcast, message protocol |
| [KV Kit](https://iskra-docs.fly.dev/packages/kv-kit/) | Key-Value store, Redis and in-memory adapters |
| [Worker Kit](https://iskra-docs.fly.dev/packages/worker-kit/) | Job queue, BullMQ, handlers, retries |
| [Process Kit](https://iskra-docs.fly.dev/packages/process-kit/) | External processes, daemon/oneshot/stdio modes |
| [Configuration](https://iskra-docs.fly.dev/configuration/) | Config system with c12, Zod, environment variables |
| [Migrations](https://iskra-docs.fly.dev/guides/migrations/) | Migration system with Drizzle Kit |
| [Deployment](https://iskra-docs.fly.dev/guides/deployment/) | Docker, CI/CD, environments |
| [SDKs](https://iskra-docs.fly.dev/guides/sdks/) | Clients for Java and Python (Go/.NET planned) |

## SDKs for other languages

Iskra exposes its services over HTTP and provides client SDKs to integrate from other languages:

- **Java** — `dev.iskra:iskra-client`
- **Python** — `iskra-client` (sync and async)
- **Go** and **.NET** — planned (see the [roadmap](./ROADMAP.md))

More details in the [SDK documentation](https://iskra-docs.fly.dev/guides/sdks/).

## Testing

```bash
bun test
```

## Mirror

A read-only mirror is available on Codeberg: [codeberg.org/fearful/iskra](https://codeberg.org/fearful/iskra).

## License

Licensed under the [GNU Affero General Public License v3.0 or later](./LICENSE) (AGPL-3.0-or-later).
