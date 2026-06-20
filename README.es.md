<!-- markdownlint-disable-next-line MD041 -->
> **Idiomas:** [English](./README.md) · **Español**

# Iskra Framework

Todo sistema grande empieza con algo chico. Iskra es esa chispa inicial, enfocada en mantener tu código ordenado mientras todo lo demás evoluciona.

Iskra es un framework modular para construir aplicaciones modernas y de alto rendimiento con [Bun](https://bun.sh). Sigue una [arquitectura hexagonal](./docs/arquitectura.md) (Puertos y Adaptadores) que desacopla tu logica de negocio de la infraestructura, permitiendote cambiar drivers sin tocar el codigo de dominio.

## Conceptos clave

- **Core** — El nucleo del framework. Maneja [inyeccion de dependencias, bus de eventos y ciclo de vida](./docs/core.md) de la aplicacion.
- **Kits** — Paquetes modulares que agregan capacidades especificas. Cada uno se registra como Driver o Plugin en el Core.
- **Drivers** — Adaptadores que conectan el Core con sistemas externos (Hono para HTTP, Drizzle para DB, BullMQ para jobs, etc.).

Para un analisis mas detallado de las capas, interfaces y patrones de diseno, revisa la [documentacion de arquitectura](./docs/arquitectura.md).

## Paquetes

| Paquete | Descripcion | Docs |
| :--- | :--- | :--- |
| `@iskra-bun/core` | Nucleo del framework: App, DI, eventos, logger, errores | [Core](./docs/core.md) |
| `@iskra-bun/config-kit` | Carga y validacion de configuracion de entorno con Zod. | [Config Kit](./docs/config-kit.md) |
| `@iskra-bun/web-kit` | Servidor HTTP con Hono, Kernel y +15 features integradas | [Web Kit](./docs/web-kit.md) |
| `@iskra-bun/auth-kit` | Autenticacion con better-auth (config + esquema Drizzle), independiente del HTTP. | [Auth Kit](./docs/auth-kit.md) |
| `@iskra-bun/db-kit` | Base de datos SQL con Drizzle ORM (PostgreSQL, MySQL, SQLite) | [DB Kit](./docs/db-kit.md) |
| `@iskra-bun/db-oracle` | Soporte para Oracle Database (via Bridge/Sidecar) | [DB Kit](./docs/db-kit.md) |
| `@iskra-bun/socket-kit` | WebSocket nativo de Bun con router y broadcast | [Socket Kit](./docs/socket-kit.md) |
| `@iskra-bun/kv-kit` | Key-Value store con adaptadores de Redis y memoria | [KV Kit](./docs/kv-kit.md) |
| `@iskra-bun/cache-kit` | Cache de alto nivel (cache-aside, TTL, namespaces, tags) sobre kv-kit. | [Cache Kit](./docs/cache-kit.md) |
| `@iskra-bun/worker-kit` | Cola de jobs en segundo plano con BullMQ | [Worker Kit](./docs/worker-kit.md) |
| `@iskra-bun/mailer-kit` | Email independiente del transporte (SMTP/SendGrid/Mailgun/SES). | [Mailer Kit](./docs/mailer-kit.md) |
| `@iskra-bun/storage-kit` | Almacenamiento de archivos (local, S3/MinIO) con streaming. | [Storage Kit](./docs/storage-kit.md) |
| `@iskra-bun/process-kit` | Gestion de procesos externos (Python, binarios) | [Process Kit](./docs/process-kit.md) |
| `@iskra-bun/testing-kit` | Utilidades de testing (createTestApp, mocks de logger/driver, withTempDir). | [Testing Kit](./docs/testing-kit.md) |
| `@iskra-bun/desktop-kit` | Soporte para apps de escritorio con Tauri | [Desktop Kit](./docs/desktop-kit.md) |
| `@iskra-bun/mobile-kit` | Soporte para plataformas moviles | [Mobile Kit](./docs/mobile-kit.md) |
| `create-iskra` | CLI de andamiaje de proyectos (`bun create iskra`). | [create-iskra](./docs/create-iskra.md) |

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
| [desktop-app](./templates/desktop-app/) | App de escritorio con Tauri |
| [universal-app](./templates/universal-app/) | App multiplataforma (escritorio + movil) |
| [plugin-starter](./templates/plugin-starter/) | Scaffolding para crear plugins/drivers reutilizables |

## Primeros pasos

### Requisitos

- [Bun](https://bun.sh) v1.0 o superior
- [Node.js](https://nodejs.org) v18+ (para algunas dependencias nativas)
- [Redis](https://redis.io) (solo si usas `worker-kit` o `kv-kit` con adaptador Redis)

### Instalacion

```bash
git clone <tu-repo> iskra-app
cd iskra-app
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

Mas detalles en la [documentacion de SDKs](./docs/sdks.md).

## Documentacion

| Documento | Que cubre |
| :--- | :--- |
| [Arquitectura](./docs/arquitectura.md) | Arquitectura hexagonal, capas, patrones de diseno |
| [Core](./docs/core.md) | Clase App, ciclo de vida, DI, logger, eventos, errores |
| [Web Kit](./docs/web-kit.md) | Servidor HTTP, Kernel, features (auth, CORS, CSRF, rate limit, etc.) |
| [DB Kit](./docs/db-kit.md) | Drizzle ORM, drivers soportados, schemas |
| [Socket Kit](./docs/socket-kit.md) | WebSocket, router, broadcast, protocolo de mensajes |
| [KV Kit](./docs/kv-kit.md) | Key-Value store, adaptadores Redis y memoria |
| [Worker Kit](./docs/worker-kit.md) | Cola de jobs, BullMQ, handlers, reintentos |
| [Process Kit](./docs/process-kit.md) | Procesos externos, modos daemon/oneshot/stdio |
| [Configuracion](./docs/configuracion.md) | Sistema de config con c12, Zod, variables de entorno |
| [Migraciones](./docs/migraciones.md) | Sistema de migraciones con Drizzle Kit |
| [Despliegue](./docs/despliegue.md) | Docker, CI/CD con GitHub Actions, ambientes |
| [SDKs](./docs/sdks.md) | Clientes para Java y Python (Go/.NET planeados) |

## Testing

```bash
bun test
```
