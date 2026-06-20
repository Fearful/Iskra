<!-- markdownlint-disable-next-line MD041 -->
> **Languages:** **English** · [Español](./README.es.md)

# Iskra Framework

[![CI](https://github.com/fearful/iskra/actions/workflows/ci.yml/badge.svg)](https://github.com/fearful/iskra/actions)
[![npm](https://img.shields.io/npm/v/@iskra-bun/core.svg)](https://www.npmjs.com/package/@iskra-bun/core)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df.svg?logo=bun)](https://bun.sh)

**Every large system starts small. Iskra is that initial spark — focused on keeping your code tidy while everything else evolves.**

Iskra is a modular framework for building modern, high-performance applications with [Bun](https://bun.sh). It follows a [hexagonal architecture](./docs/arquitectura.md) (Ports and Adapters) that decouples your business logic from infrastructure, letting you swap drivers without touching your domain code.

## Key concepts

- **Core** — The heart of the framework. Handles [dependency injection, the event bus, and the application lifecycle](./docs/core.md).
- **Kits** — Modular packages that add specific capabilities. Each one registers itself as a Driver or Plugin on the Core.
- **Drivers** — Adapters that connect the Core to external systems (Hono for HTTP, Drizzle for DB, BullMQ for jobs, etc.).

For a deeper look at the layers, interfaces, and design patterns, see the [architecture documentation](./docs/arquitectura.md).

## Packages

| Package | Description | Docs |
| :--- | :--- | :--- |
| `@iskra-bun/core` | Framework core: App, DI, events, logger, errors | [Core](./docs/core.md) |
| `@iskra-bun/config-kit` | Typed, Zod-validated environment/config loading | [Config Kit](./docs/config-kit.md) |
| `@iskra-bun/web-kit` | HTTP server with Hono, Kernel, and 15+ built-in features | [Web Kit](./docs/web-kit.md) |
| `@iskra-bun/auth-kit` | Transport-agnostic better-auth (config + Drizzle schema), usable outside HTTP | [Auth Kit](./docs/auth-kit.md) |
| `@iskra-bun/db-kit` | SQL database with Drizzle ORM (PostgreSQL, MySQL, SQLite) | [DB Kit](./docs/db-kit.md) |
| `@iskra-bun/db-oracle` | Oracle Database support (via Bridge/Sidecar) | [DB Kit](./docs/db-kit.md) |
| `@iskra-bun/socket-kit` | Native Bun WebSocket with router and broadcast | [Socket Kit](./docs/socket-kit.md) |
| `@iskra-bun/kv-kit` | Key-Value store with Redis and in-memory adapters | [KV Kit](./docs/kv-kit.md) |
| `@iskra-bun/cache-kit` | Higher-level cache (cache-aside, TTL, namespaces, tags) on top of kv-kit | [Cache Kit](./docs/cache-kit.md) |
| `@iskra-bun/worker-kit` | Background job queue with BullMQ | [Worker Kit](./docs/worker-kit.md) |
| `@iskra-bun/mailer-kit` | Transport-agnostic email (SMTP/SendGrid/Mailgun/SES) | [Mailer Kit](./docs/mailer-kit.md) |
| `@iskra-bun/storage-kit` | File storage (local, S3/MinIO) with streaming | [Storage Kit](./docs/storage-kit.md) |
| `@iskra-bun/process-kit` | External process management (Python, binaries) | [Process Kit](./docs/process-kit.md) |
| `@iskra-bun/testing-kit` | Test utilities (createTestApp, mock logger/driver, withTempDir) | [Testing Kit](./docs/testing-kit.md) |
| `@iskra-bun/desktop-kit` | Desktop app support with Tauri | [Desktop Kit](./docs/desktop-kit.md) |
| `@iskra-bun/mobile-kit` | Mobile platform support | [Mobile Kit](./docs/mobile-kit.md) |
| `create-iskra` | Project scaffolding CLI (`bun create iskra`) | [create-iskra](./docs/create-iskra.md) |

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
| [desktop-app](./templates/desktop-app/) | Desktop app with Tauri |
| [universal-app](./templates/universal-app/) | Cross-platform app (desktop + mobile) |
| [plugin-starter](./templates/plugin-starter/) | Scaffolding for building reusable plugins/drivers |

To run a template from a clone of the monorepo:

```bash
bun install
cd templates/starter-app
bun start
```

## Documentation

Full documentation lives at **[iskra-docs.fly.dev](https://iskra-docs.fly.dev)**. You can also browse the [`docs/`](./docs/) directory:

| Document | What it covers |
| :--- | :--- |
| [Architecture](./docs/arquitectura.md) | Hexagonal architecture, layers, design patterns |
| [Core](./docs/core.md) | App class, lifecycle, DI, logger, events, errors |
| [Web Kit](./docs/web-kit.md) | HTTP server, Kernel, features (auth, CORS, CSRF, rate limit, etc.) |
| [DB Kit](./docs/db-kit.md) | Drizzle ORM, supported drivers, schemas |
| [Socket Kit](./docs/socket-kit.md) | WebSocket, router, broadcast, message protocol |
| [KV Kit](./docs/kv-kit.md) | Key-Value store, Redis and in-memory adapters |
| [Worker Kit](./docs/worker-kit.md) | Job queue, BullMQ, handlers, retries |
| [Process Kit](./docs/process-kit.md) | External processes, daemon/oneshot/stdio modes |
| [Configuration](./docs/configuracion.md) | Config system with c12, Zod, environment variables |
| [Migrations](./docs/migraciones.md) | Migration system with Drizzle Kit |
| [Deployment](./docs/despliegue.md) | Docker, CI/CD, environments |
| [SDKs](./docs/sdks.md) | Clients for Java and Python (Go/.NET planned) |

## SDKs for other languages

Iskra exposes its services over HTTP and provides client SDKs to integrate from other languages:

- **Java** — `dev.iskra:iskra-client`
- **Python** — `iskra-client` (sync and async)
- **Go** and **.NET** — planned (see the [roadmap](./ROADMAP.md))

More details in the [SDK documentation](./docs/sdks.md).

## Testing

```bash
bun test
```

## Mirror

A read-only mirror is available on Codeberg: [codeberg.org/fearful/iskra](https://codeberg.org/fearful/iskra).

## License

Licensed under the [GNU Affero General Public License v3.0 or later](./LICENSE) (AGPL-3.0-or-later).
