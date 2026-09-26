---
title: Galería de Templates
description: Puntos de partida listos para correr para apps de Iskra, con descripciones y comandos de ejecución.
---

Cada template vive en [`templates/`](https://github.com/fearful/iskra/tree/main/templates) dentro del monorepo y trae su propio README. Para correr cualquiera desde un clon:

```bash
bun install
cd templates/<name>
bun start
```

## Web & API

### simple-server
Servidor HTTP mínimo en ~18 líneas — la app de Iskra más pequeña posible.
`cd templates/simple-server && bun start`

### starter-app
App mínima con un servidor web y un CRUD de usuarios. Un buen primer proyecto.
`cd templates/starter-app && bun start`

### ecommerce-api
Backend de e-commerce con catálogo de productos, gestión de órdenes, persistencia en DB y cache. Crear productos y órdenes exige API keys por usuario (`API_KEYS`, rol admin o customer); el catálogo es público.
`cd templates/ecommerce-api && bun start`

### cms-starter
CMS con API REST sobre SQLite: flujo draft/publish, versionado de contenido, validación de slugs (Zod) vía Drizzle ORM. Editar y leer borradores o el historial exige una API key de editor (`API_KEYS`); el público solo lee lo publicado.
`cd templates/cms-starter && bun start`

### db-starter
CRUD de usuarios sobre SQLite (Drizzle ORM) con soporte opcional de Oracle Database. Ideal para aprender la integración con bases de datos.
`cd templates/db-starter && bun start`

### forms-app
Plataforma de formularios con arquitectura de microservicios: formularios pre-renderizados estáticos, un servicio público liviano (CSRF + reCAPTCHA v3) e inserts en lote a PostgreSQL vía Redis.
`cd templates/forms-app && bun run dev` _(Docker Compose; antes necesita un `.env` con los secretos, ver el README del template)_

## Tiempo real

### chat-app
Chat en tiempo real sobre WebSocket con salas, presencia de usuarios, historial paginado respaldado por KV store y autenticación en el handshake con tokens firmados por el servidor que vencen.
`cd templates/chat-app && bun start` · cliente: `CHAT_TOKEN=$(bun run --silent token ana) bun run client`

### realtime-feed
Feed social que combina una API HTTP con un stream WebSocket en tiempo real. Publicar exige una API key de autor (`API_KEYS`) y tiene un límite por autor.
`cd templates/realtime-feed && bun start`

## Trabajo en background

### job-worker
Procesador de tareas en background con colas: retry con backoff, una dead-letter queue y un endpoint HTTP de health/monitoring.
`cd templates/job-worker && bun start`

### python-data-processor
Puente Node.js ↔ Python: levanta un subproceso Python vía Process Kit y se comunica con él por JSON sobre stdio, exponiendo los resultados a través de una API HTTP.
`cd templates/python-data-processor && bun start`

## Full stack y multiplataforma

### full-stack-app
App completa que combina todos los kits: HTTP con docs OpenAPI, WebSocket, DB (SQLite + Oracle opcional), KV store y gestión de procesos externos.
`cd templates/full-stack-app && bun start`

### desktop-app
App de escritorio con [Tauri](https://tauri.app): gestión de ventana, comandos IPC cableados a `@iskra-bun/desktop-kit`, un menú nativo, un diálogo de archivos y una UI.
`cd templates/desktop-app && bun run tauri:dev`

### universal-app
App multiplataforma que apunta a escritorio y móvil desde un mismo codebase.
`cd templates/universal-app && bun start`

## Extender Iskra

### plugin-starter
Scaffolding para construir plugins/drivers reutilizables que podés registrar en cualquier app de Iskra.
`(cd packages/core && bun run build) && cd templates/plugin-starter && bun run build` (el template compila contra los tipos publicados de `@iskra-bun/core`, así que primero compilá core)
