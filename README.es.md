<!-- markdownlint-disable-next-line MD041 -->
> **Idiomas:** [English](./README.md) · **Español**

# Iskra Framework

Todo sistema grande empieza con algo chico. Iskra es esa chispa inicial, enfocada en mantener tu código ordenado mientras todo lo demás evoluciona.

Iskra es un framework modular para construir aplicaciones modernas y de alto rendimiento con [Bun](https://bun.sh). Sigue una [arquitectura hexagonal](https://iskra-docs.fly.dev/es/concepts/architecture/) (Puertos y Adaptadores) que desacopla tu logica de negocio de la infraestructura, permitiendote cambiar drivers sin tocar el codigo de dominio.

## Conceptos clave

- **Core** — El nucleo del framework. Maneja [inyeccion de dependencias, bus de eventos y ciclo de vida](https://iskra-docs.fly.dev/es/packages/core/) de la aplicacion.
- **Kits** — Paquetes modulares que agregan capacidades especificas. Cada uno se registra como Driver o Plugin en el Core.
- **Drivers** — Adaptadores que conectan el Core con sistemas externos (Hono para HTTP, Drizzle para DB, BullMQ para jobs, etc.).

Para un analisis mas detallado de las capas, interfaces y patrones de diseno, revisa la [documentacion de arquitectura](https://iskra-docs.fly.dev/es/concepts/architecture/).

## Paquetes

| Paquete | Descripcion | Docs |
| :--- | :--- | :--- |
| `@iskra-bun/core` | Nucleo del framework: App, DI, eventos, logger, errores | [Core](https://iskra-docs.fly.dev/es/packages/core/) |
| `@iskra-bun/config-kit` | Carga y validacion de configuracion de entorno con Zod. | [Config Kit](https://iskra-docs.fly.dev/es/packages/config-kit/) |
| `@iskra-bun/web-kit` | Servidor HTTP con Hono, Kernel y +15 features integradas | [Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) |
| `@iskra-bun/auth-kit` | Autenticacion con better-auth (config + esquema Drizzle), independiente del HTTP. | [Auth Kit](https://iskra-docs.fly.dev/es/packages/auth-kit/) |
| `@iskra-bun/db-kit` | Base de datos SQL con Drizzle ORM (PostgreSQL, MySQL, SQLite) | [DB Kit](https://iskra-docs.fly.dev/es/packages/db-kit/) |
| `@iskra-bun/db-oracle` | Soporte para Oracle Database (via Bridge/Sidecar) | [DB Kit](https://iskra-docs.fly.dev/es/packages/db-kit/) |
| `@iskra-bun/socket-kit` | WebSocket nativo de Bun con router y broadcast | [Socket Kit](https://iskra-docs.fly.dev/es/packages/socket-kit/) |
| `@iskra-bun/kv-kit` | Key-Value store con adaptadores de Redis y memoria | [KV Kit](https://iskra-docs.fly.dev/es/packages/kv-kit/) |
| `@iskra-bun/cache-kit` | Cache de alto nivel (cache-aside, TTL, namespaces, tags) sobre kv-kit. | [Cache Kit](https://iskra-docs.fly.dev/es/packages/cache-kit/) |
| `@iskra-bun/worker-kit` | Cola de jobs en segundo plano con BullMQ | [Worker Kit](https://iskra-docs.fly.dev/es/packages/worker-kit/) |
| `@iskra-bun/mailer-kit` | Email independiente del transporte (SMTP/SendGrid/Mailgun/SES). | [Mailer Kit](https://iskra-docs.fly.dev/es/packages/mailer-kit/) |
| `@iskra-bun/storage-kit` | Almacenamiento de archivos (local, S3/MinIO) con streaming. | [Storage Kit](https://iskra-docs.fly.dev/es/packages/storage-kit/) |
| `@iskra-bun/process-kit` | Gestion de procesos externos (Python, binarios) | [Process Kit](https://iskra-docs.fly.dev/es/packages/process-kit/) |
| `@iskra-bun/testing-kit` | Utilidades de testing (createTestApp, mocks de logger/driver, withTempDir). | [Testing Kit](https://iskra-docs.fly.dev/es/packages/testing-kit/) |
| `@iskra-bun/desktop-kit` | Placeholder experimental para apps de escritorio con Tauri (todavia sin integracion con Tauri) | [Desktop Kit](https://iskra-docs.fly.dev/es/packages/desktop-kit/) |
| `@iskra-bun/mobile-kit` | Placeholder experimental para apps moviles (todavia sin integracion con plataformas) | [Mobile Kit](https://iskra-docs.fly.dev/es/packages/mobile-kit/) |
| `create-iskra` | CLI de andamiaje de proyectos (`bun create iskra`). | [create-iskra](https://iskra-docs.fly.dev/es/packages/create-iskra/) |

## Inicio rapido

Agrega el core y el web kit a tu proyecto:

```bash
bun add @iskra-bun/core @iskra-bun/web-kit
```

Una aplicacion minima:

```typescript
import { App } from '@iskra-bun/core';
import { WebDriver } from '@iskra-bun/web-kit';

const app = new App({ name: 'MiApp' });

app.register(new WebDriver({
    port: 3000,
    routes: [
        {
            method: 'GET',
            path: '/',
            handler: () => ({ message: 'Hola desde Iskra!' }),
        },
    ],
}));

app.start().catch(console.error);
```

Correla con `bun run index.ts` y visita `http://localhost:3000`.

## Templates

Templates listos para usar como punto de partida. Cada uno incluye su propio README con instrucciones detalladas.

| Template | Descripcion |
| :--- | :--- |
| [simple-server](./templates/simple-server/) | Servidor HTTP minimo (~18 lineas) |
| [starter-app](./templates/starter-app/) | App minima con servidor web y CRUD de usuarios |
| [chat-app](./templates/chat-app/) | Chat en tiempo real con WebSocket y KV store |
| [db-starter](./templates/db-starter/) | CRUD con SQLite y Oracle opcional (Drizzle ORM) |
| [cms-starter](./templates/cms-starter/) | CMS con API REST para posts y paginas |
| [ecommerce-api](./templates/ecommerce-api/) | Backend de e-commerce con productos, ordenes y cache |
| [realtime-feed](./templates/realtime-feed/) | Feed social con HTTP + WebSocket en tiempo real |
| [full-stack-app](./templates/full-stack-app/) | App completa combinando todos los kits |
| [job-worker](./templates/job-worker/) | Procesador de tareas en segundo plano con colas |
| [python-data-processor](./templates/python-data-processor/) | Puente Node.js ↔ Python para procesamiento de datos |
| [desktop-app](./templates/desktop-app/) | App de escritorio con Tauri (experimental: la capa Bun no se comunica todavia con Tauri) |
| [universal-app](./templates/universal-app/) | App multiplataforma (experimental: sin proyecto movil real) |
| [plugin-starter](./templates/plugin-starter/) | Scaffolding para crear plugins/drivers reutilizables |

## Primeros pasos

### Requisitos

- [Bun](https://bun.sh) v1.3 o superior (la version que usa CI esta fijada en [`.bun-version`](./.bun-version))
- [Node.js](https://nodejs.org) v18+ (para algunas dependencias nativas)
- [Redis](https://redis.io) (solo si usas `worker-kit`, o `kv-kit` con su adaptador Redis)

### Instalacion

```bash
git clone https://github.com/fearful/iskra.git
cd iskra
bun install
```

### Arrancar un template

```bash
cd templates/starter-app
bun start
```

Para los templates que tienen modo desarrollo con hot-reload:

```bash
bun dev
```

## SDKs para otros lenguajes

Iskra expone sus servicios via HTTP, y provee SDKs cliente para integrar desde otros lenguajes:

- **Java** — `dev.iskra:iskra-client`
- **Python** — `iskra-client` (sync y async)
- **Go** y **.NET** — planeados (ver el [roadmap](./ROADMAP.md))

Mas detalles en la [documentacion de SDKs](https://iskra-docs.fly.dev/es/guides/sdks/).

## Documentacion

| Documento | Que cubre |
| :--- | :--- |
| [Arquitectura](https://iskra-docs.fly.dev/es/concepts/architecture/) | Arquitectura hexagonal, capas, patrones de diseno |
| [Core](https://iskra-docs.fly.dev/es/packages/core/) | Clase App, ciclo de vida, DI, logger, eventos, errores |
| [Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) | Servidor HTTP, Kernel, features (auth, CORS, CSRF, rate limit, etc.) |
| [DB Kit](https://iskra-docs.fly.dev/es/packages/db-kit/) | Drizzle ORM, drivers soportados, schemas |
| [Socket Kit](https://iskra-docs.fly.dev/es/packages/socket-kit/) | WebSocket, router, broadcast, protocolo de mensajes |
| [KV Kit](https://iskra-docs.fly.dev/es/packages/kv-kit/) | Key-Value store, adaptadores Redis y memoria |
| [Worker Kit](https://iskra-docs.fly.dev/es/packages/worker-kit/) | Cola de jobs, BullMQ, handlers, reintentos |
| [Process Kit](https://iskra-docs.fly.dev/es/packages/process-kit/) | Procesos externos, modos daemon/oneshot/stdio |
| [Configuracion](https://iskra-docs.fly.dev/es/configuration/) | Sistema de config con c12, Zod, variables de entorno |
| [Migraciones](https://iskra-docs.fly.dev/es/guides/migrations/) | Sistema de migraciones con Drizzle Kit |
| [Despliegue](https://iskra-docs.fly.dev/es/guides/deployment/) | Docker, CI/CD con GitHub Actions, ambientes |
| [SDKs](https://iskra-docs.fly.dev/es/guides/sdks/) | Clientes para Java y Python (Go/.NET planeados) |

## Testing

```bash
bun test
```

## Mirror

Hay un mirror de solo lectura en Codeberg: [codeberg.org/fearful/iskra](https://codeberg.org/fearful/iskra).

## Licencia

Distribuido bajo la [GNU Affero General Public License v3.0 o posterior](./LICENSE) (AGPL-3.0-or-later).
