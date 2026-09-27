---
title: Templates Gallery
description: Ready-to-run starting points for Iskra apps, with one-line descriptions and run commands.
---

Each template lives under [`templates/`](https://github.com/fearful/iskra/tree/main/templates) in the monorepo and ships with its own README. To run any of them from a clone:

```bash
bun install
cd templates/<name>
bun start
```

## Web & API

### simple-server
Minimal HTTP server in ~18 lines — the smallest possible Iskra app.
`cd templates/simple-server && bun start`

### starter-app
Minimal app with a web server and a user CRUD. A good first project.
`cd templates/starter-app && bun start`

### ecommerce-api
E-commerce backend with a product catalog, order management, DB persistence, and cache. Product writes and orders need per-user API keys (`API_KEYS`, admin or customer role); the catalog is public.
`cd templates/ecommerce-api && bun start`

### cms-starter
CMS with a REST API over SQLite: draft/publish flow, content versioning, slug validation (Zod) via Drizzle ORM. Changes, drafts and history need an editor API key (`API_KEYS`); the public only reads published content.
`cd templates/cms-starter && bun start`

### db-starter
User CRUD over SQLite (Drizzle ORM) with optional Oracle Database support. Great for learning DB integration.
`cd templates/db-starter && bun start`

### forms-app
Forms platform with a microservices architecture: pre-rendered static forms, a lightweight public service (CSRF + reCAPTCHA v3), and Redis-batched inserts to PostgreSQL.
`cd templates/forms-app && bun run dev` _(Docker Compose; it needs a `.env` with the secrets first, see the template's README)_

## Real-time

### chat-app
Real-time chat over WebSocket with rooms, user presence, paginated history backed by a KV store, and auth at the handshake with server-signed, expiring tokens.
`cd templates/chat-app && bun start` · client: `CHAT_TOKEN=$(bun run --silent token ana) bun run client`

### realtime-feed
Social feed combining an HTTP API with a real-time WebSocket stream. Posting needs an author API key (`API_KEYS`) and is rate-limited per author.
`cd templates/realtime-feed && bun start`

## Background work

### job-worker
Background task processor with queues: retry with backoff, a dead-letter queue, and an HTTP health/monitoring endpoint.
`cd templates/job-worker && bun start`

### python-data-processor
Node.js ↔ Python bridge: spawns a Python subprocess via Process Kit and talks to it over JSON-on-stdio, exposing results through an HTTP API.
`cd templates/python-data-processor && bun start`

## Full stack & cross-platform

### full-stack-app
Complete app combining every kit: HTTP with OpenAPI docs, WebSocket, DB (SQLite + optional Oracle), KV store, and external process management.
`cd templates/full-stack-app && bun start`

### desktop-app
Desktop app with [Tauri](https://tauri.app): window management, IPC commands wired to `@iskra-bun/desktop-kit`, a native menu, a file dialog, and a UI.
`cd templates/desktop-app && bun run tauri:dev`

### universal-app
Cross-platform app targeting desktop and mobile from one codebase.
`cd templates/universal-app && bun start`

## Extending Iskra

### plugin-starter
Scaffolding for building reusable plugins/drivers you can register in any Iskra app.
`(cd packages/core && bun run build) && cd templates/plugin-starter && bun run build` (the template builds against `@iskra-bun/core`'s published types, so build core first)
