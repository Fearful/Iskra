# Forms App

Plataforma de formularios completa con arquitectura de microservicios. Los admins crean espacios y formularios con reglas de validacion personalizadas; los formularios se pre-renderizan a HTML estatico + JS vanilla; un servicio publico liviano (sin conexion a Postgres) los sirve con CSRF + reCAPTCHA v3; las respuestas se encolan en Redis y se insertan en lote a PostgreSQL.

El template esta pensado para escenarios donde hay miles de formularios abiertos simultaneamente y se necesita escalar la parte publica sin tocar la infraestructura del admin.

## Arquitectura

```
                         ┌──────────────────────────────────┐
                         │     nginx (puerto 80)            │
                         │  /formularios/ → forms-api:3000  │
                         │  /admin/api/   → admin-api:4000  │
                         │  /admin/       → admin-fe:5173   │
                         └────────┬─────────────┬───────────┘
                                  │             │
          ┌───────────────────────┘             └────────────────────┐
          ▼                                                          ▼
┌──────────────┐                              ┌─────────────┐     ┌──────────────┐
│ forms-api    │                              │ admin-       │────▶│ admin-api    │──▶ PostgreSQL
│ (puerto 3000)│                              │ frontend     │     │ (puerto 4000)│
│ Redis-only   │                              │ React 19     │     │ Auth+CRUD    │
│ CSRF+reCAPT  │                              └─────────────┘     └──────┬───────┘
│ escalable    │                                                         │
└──────┬───────┘                                                  ┌──────▼───────┐
       │                                                          │ form-manager │──▶ PostgreSQL
       │ lee archivos                                             │ (puerto 4001)│
       │ estaticos del                                            │ builds Vite  │──▶ volumen
       │ volumen                                                  └──────▲───────┘    estatico
       │                                                                 │
       │ lee schemas                                              ┌──────┴───────┐
       │ de Redis                                                 │ cron         │
       │                                                          │ (puerto 4002)│
       │ encola respuestas                                        │ popular Redis│
       │ en Redis                                                 └──────────────┘
       ▼
┌──────────────┐         ┌──────────────┐
│ Redis        │────────▶│ answer-writer│──▶ PostgreSQL
│ (schemas +   │         │ (consumers)  │
│  cola BullMQ)│         │ insert batch │
└──────────────┘         └──────────────┘
```

### Zonas de red (produccion)

| Zona | Servicios | Acceso |
|------|-----------|--------|
| **DMZ** | nginx-publico, forms-api, Redis | Unico punto expuesto a internet |
| **Red interna (admin)** | nginx-admin, admin-frontend, admin-api | Detras de VPN/firewall |
| **Intranet** | form-manager, cron, answer-writer, PostgreSQL | Sin acceso externo |

En desarrollo se usa un solo nginx que rutea todo. Para produccion se desplegarian dos nginx separados (uno en DMZ, otro en la red interna).

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, DI, logger, event bus
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con Hono, features (Auth, CSRF, CORS, RateLimit)
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos con Drizzle ORM (PostgreSQL)
- [`@iskra-bun/worker-kit`](https://iskra-docs.fly.dev/es/packages/worker-kit/) — Cola de jobs con BullMQ
- [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/) — Key-Value store con Redis

## Servicios y paquetes

| # | Paquete | Tipo | Puerto | Zona | Escalable | Descripcion |
|---|---------|------|--------|------|-----------|-------------|
| 1 | `@forms-app/shared` | libreria | — | — | — | Tipos TS, schema Drizzle PG, constantes, constraints de campos, errorMessages por defecto |
| 2 | `@forms-app/vite-plugin-jsonschema` | libreria | — | — | — | Plugin de Vite: JSON Schema → Zod TS con errorMessages preservados |
| 3 | `@forms-app/admin-api` | servicio | 4000 | admin | no | Auth (Better Auth), CRUD de espacios y formularios, lectura de respuestas |
| 4 | `@forms-app/admin-frontend` | frontend | 5173 | admin | no | SPA React 19 + Vite, constructor de formularios, visor de respuestas |
| 5 | `@forms-app/form-manager` | servicio | 4001 | intranet | no | Pre-renderiza formularios a HTML+JS estatico via Vite |
| 6 | `@forms-app/cron` | servicio | 4002 | intranet | no | Ciclo de vida de formularios (abrir/cerrar) + poblar Redis con schemas |
| 7 | `@forms-app/forms-api` | servicio | 3000 | **publico** | **si** | Sirve formularios estaticos, CSRF, reCAPTCHA v3, encola respuestas. **Solo Redis, sin Postgres.** |
| 8 | `@forms-app/answer-writer` | servicio | — | intranet | **si** | Consumers BullMQ exclusivamente. Inserts batch a Postgres. Sin HTTP. |
| 9 | nginx | infra | 80 | entrypoint | — | Reverse proxy de desarrollo |

## Requisitos

- **Bun** v1.0+
- **Docker** y **Docker Compose** (para levantar el stack completo)
- Cuenta de **reCAPTCHA v3** de Google (para el entorno de produccion)

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

# Levantar todo el stack
cd templates/forms-app
docker compose up --build
```

En el primer arranque (volumen de datos vacio) Postgres crea las tablas con los scripts
de `db/init/`: `01-schema.sql`, generado desde `packages/shared/src/db/schema.ts`, y
`02-auth.sql`, las tablas de Better Auth. Si cambias el schema, regenera el SQL con
`bun run db:init-sql` en `packages/shared` (un test falla si quedo desactualizado) y
recrea el volumen (`docker compose down -v`).

La app queda accesible en:

- **Admin**: http://localhost/admin/
- **Formularios publicos**: http://localhost/formularios/{spaceSlug}/{formSlug}

### Crear el primer admin

El admin-api no permite registrarse publicamente: todas sus rutas requieren sesion y las cuentas se crean por linea de comandos. El script crea tambien las tablas de Better Auth (`user`, `session`, `account`, `verification`) si no existen:

```bash
cd services/admin-api
DATABASE_URL=postgresql://forms:secret@localhost:5432/forms_app \
  bun run create-admin admin@example.com 'una-contrasena-larga'
```

Despues inicia sesion en http://localhost/admin/login.

### Envios de formularios y reCAPTCHA

forms-api valida cada envio con reCAPTCHA v3 contra Google, asi que con las claves de
ejemplo (`your-site-key` / `your-secret-key`) todo envio se rechaza con 403. Para probar
localmente, registra un par de claves v3 con el dominio `localhost` en
https://www.google.com/recaptcha/admin y pasalas en `RECAPTCHA_SITE_KEY` y
`RECAPTCHA_SECRET` (form-manager inserta la clave publica al pre-renderizar cada
formulario, asi que re-publicalo despues de cambiarla).

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `DB_PASSWORD` | Password de PostgreSQL | `secret` |
| `DATABASE_URL` | URL de conexion a Postgres | `postgresql://forms:secret@postgres:5432/forms_app` |
| `REDIS_URL` | URL de conexion a Redis | `redis://redis:6379` |
| `AUTH_SECRET` | Secreto para Better Auth (sesiones/tokens), 32+ caracteres | `dev-only-auth-secret-change-me-32chars` |
| `AUTH_BASE_URL` | Origen publico del admin, sin path (con path, Better Auth deja de responder en `/api/auth`) | `http://localhost` |
| `RECAPTCHA_SITE_KEY` | Clave publica de reCAPTCHA v3 | `your-site-key` |
| `RECAPTCHA_SECRET` | Clave privada de reCAPTCHA v3 | `your-secret-key` |
| `CSRF_SECRET` | Secreto para generacion de tokens CSRF | `dev-csrf-secret` |
| `FORM_MANAGER_URL` | URL interna del form-manager | `http://form-manager:4001` |

## Estructura del proyecto

```
templates/forms-app/
├── package.json                          # Workspaces: packages/* + services/*
├── tsconfig.base.json
├── docker-compose.yml
├── .env.example
├── nginx/
│   └── nginx.dev.conf                    # Proxy reverso de desarrollo
│
├── packages/
│   ├── shared/                           # @forms-app/shared
│   │   └── src/
│   │       ├── index.ts                  # Re-exports de tipos y constantes
│   │       ├── constants.ts              # FormStatus, FieldType, claves Redis, nombres de colas
│   │       ├── types/
│   │       │   ├── form.ts               # Form, FormField, Answer, AnswerJob, etc.
│   │       │   ├── space.ts              # Space, CreateSpaceInput, etc.
│   │       │   └── api.ts               # ApiResponse, PaginatedResponse
│   │       ├── db/
│   │       │   └── schema.ts             # Schema Drizzle PG: spaces, forms, form_fields, answers
│   │       └── validation/
│   │           ├── field-constraints.ts   # Limites maximos por tipo de campo (evita errores de DB)
│   │           └── default-messages.ts    # Mensajes de error por defecto por tipo de campo
│   │
│   └── vite-plugin-jsonschema/           # @forms-app/vite-plugin-jsonschema
│       └── src/
│           ├── index.ts                  # Plugin Vite (modulos virtuales)
│           ├── transform.ts              # JSON Schema → codigo Zod con .message()
│           └── codegen.ts               # Escritor de archivos TS
│
└── services/
    ├── admin-api/                        # @forms-app/admin-api
    │   └── src/
    │       ├── main.ts                   # App + WebPlugin + DbDriver + AuthFeature
    │       ├── app.config.ts
    │       ├── domain/
    │       │   ├── spaces/
    │       │   │   └── space.service.ts  # CRUD de espacios
    │       │   └── forms/
    │       │       ├── form.service.ts   # CRUD de formularios + lectura de respuestas
    │       │       └── schema-generator.ts # Campos → JSON Schema con errorMessages
    │       └── interfaces/http/
    │           ├── router.ts
    │           ├── spaces.routes.ts
    │           ├── forms.routes.ts
    │           └── answers.routes.ts
    │
    ├── admin-frontend/                   # @forms-app/admin-frontend
    │   └── src/
    │       ├── main.tsx
    │       ├── App.tsx                   # Router con react-router v7
    │       ├── api/client.ts             # Wrapper fetch para admin-api
    │       ├── pages/
    │       │   ├── SpacesPage.tsx         # Listado y creacion de espacios
    │       │   ├── SpaceDetailPage.tsx    # Detalle de espacio + listado de formularios
    │       │   ├── FormBuilderPage.tsx    # Constructor de formularios
    │       │   └── FormAnswersPage.tsx    # Visor de respuestas con paginacion
    │       └── components/
    │           ├── FormBuilder/
    │           │   ├── FieldEditor.tsx    # Editor de campo individual
    │           │   ├── FieldList.tsx      # Lista de campos con expand/collapse
    │           │   └── ValidationConfig.tsx # Config de validacion + errorMessage custom
    │           └── Layout.tsx
    │
    ├── form-manager/                     # @forms-app/form-manager
    │   └── src/
    │       ├── main.ts                   # App + WebPlugin + DbDriver + KVManager
    │       ├── domain/
    │       │   ├── prerender/
    │       │   │   ├── prerender.service.ts  # Lee form de DB, genera archivos, corre vite.build()
    │       │   │   ├── html-template.ts      # Genera HTML del formulario desde los campos
    │       │   │   └── form-runtime.ts       # Template JS vanilla: validacion Zod, CSRF, reCAPTCHA
    │       │   └── lifecycle/
    │       │       └── lifecycle.service.ts  # Abrir/cerrar formularios, actualizar Redis
    │       └── interfaces/http/router.ts
    │
    ├── cron/                             # @forms-app/cron
    │   └── src/
    │       ├── main.ts
    │       └── domain/
    │           ├── scheduler.service.ts      # Chequea fechas, llama a form-manager
    │           └── redis-populator.service.ts # Escribe schemas activos en Redis
    │
    ├── forms-api/                        # @forms-app/forms-api
    │   └── src/
    │       ├── main.ts                   # App + WebPlugin + KVManager + WorkerManager (solo enqueue)
    │       ├── domain/
    │       │   ├── recaptcha/
    │       │   │   └── recaptcha.service.ts  # Verificacion con Google reCAPTCHA v3
    │       │   └── submission/
    │       │       └── submission.service.ts  # Cache local + AJV con errorMessages + enqueue
    │       └── interfaces/http/
    │           ├── router.ts
    │           ├── static.routes.ts      # Sirve HTML y assets desde el volumen compartido
    │           └── submit.routes.ts      # CSRF → Redis → reCAPTCHA → AJV → BullMQ → 202
    │
    └── answer-writer/                    # @forms-app/answer-writer
        └── src/
            ├── main.ts                   # App + DbDriver + WorkerManager (consumer)
            └── domain/writer/
                └── writer.service.ts     # Buffer de respuestas + flush por cantidad (50) o tiempo (2s)
```

## Base de datos

PostgreSQL 16 con Drizzle ORM. Cuatro tablas principales:

| Tabla | Descripcion |
|-------|-------------|
| `spaces` | Espacios que agrupan formularios. Tienen slug unico para URLs publicas. |
| `forms` | Formularios con titulo, slug, fechas de apertura/cierre, status (draft/scheduled/open/closed), schema de campos (JSONB) y validation_schema (JSON Schema con errorMessages). Indice unico en (space_id, slug). |
| `form_fields` | Campos individuales: tipo (text/number/email/select/checkbox/radio/textarea/date), label, posicion, validaciones, opciones, mensaje de error custom. |
| `answers` | Respuestas enviadas: datos (JSONB), hash del IP (SHA256 con salt diario), score de reCAPTCHA. |

Las tablas de Better Auth (user, session, account, verification) las crea `bun run create-admin` (ver [Crear el primer admin](#crear-el-primer-admin)).

## Endpoints

### admin-api (puerto 4000) — via nginx `/admin/api/`

Todos los endpoints excepto auth requieren sesion autenticada (401 sin sesion). El registro publico (`/api/auth/sign-up/email`) esta deshabilitado; las cuentas se crean con `bun run create-admin`.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/api/auth/*` | Rutas de Better Auth (login, logout, sesion) |
| `GET` | `/api/spaces` | Listar espacios |
| `POST` | `/api/spaces` | Crear espacio |
| `GET` | `/api/spaces/:id` | Obtener espacio |
| `PUT` | `/api/spaces/:id` | Actualizar espacio |
| `DELETE` | `/api/spaces/:id` | Eliminar espacio (cascadea a formularios) |
| `GET` | `/api/spaces/:spaceId/forms` | Listar formularios de un espacio |
| `POST` | `/api/spaces/:spaceId/forms` | Crear formulario con campos y validaciones |
| `GET` | `/api/forms/:id` | Obtener formulario con campos |
| `PUT` | `/api/forms/:id` | Actualizar formulario (regenera JSON Schema) |
| `DELETE` | `/api/forms/:id` | Eliminar formulario |
| `POST` | `/api/forms/:id/publish` | Publicar formulario (scheduled + trigger prerender) |
| `POST` | `/api/forms/:id/prerender` | Forzar pre-renderizado |
| `GET` | `/api/forms/:id/answers` | Respuestas paginadas (query directo a Postgres) |

### form-manager (puerto 4001) — intranet

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/internal/prerender/:formId` | Construir archivos estaticos para un formulario |
| `POST` | `/internal/lifecycle/open` | Abrir formulario (actualiza status + Redis) |
| `POST` | `/internal/lifecycle/close` | Cerrar formulario (actualiza status + TTL en Redis) |

### forms-api (puerto 3000) — via nginx `/formularios/`

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/:spaceSlug/:formSlug` | Servir HTML pre-renderizado |
| `GET` | `/:spaceSlug/:formSlug/assets/*` | Servir JS/CSS (cache inmutable) |
| `GET` | `/api/csrf-token` | Obtener token CSRF |
| `POST` | `/api/submit/:spaceSlug/:formSlug` | Enviar respuesta |

## Sistema de validacion y mensajes de error

La validacion fluye de punta a punta con los mismos mensajes de error:

### 1. Definicion (admin-api)

Cada tipo de campo tiene **mensajes por defecto** en `packages/shared/src/validation/default-messages.ts`. Cuando el admin crea un formulario, puede dejar los defaults o escribir un mensaje custom por campo. El `schema-generator.ts` produce un JSON Schema con la propiedad `errorMessage` por campo (formato `ajv-errors`):

```json
{
  "properties": {
    "email": {
      "type": "string",
      "format": "email",
      "maxLength": 320,
      "errorMessage": {
        "format": "Ingresa un email valido",
        "maxLength": "El email es demasiado largo"
      }
    }
  }
}
```

### 2. Pre-renderizado (form-manager)

El `vite-plugin-jsonschema` transforma ese JSON Schema a codigo Zod con `.message()`:

```typescript
z.object({
  email: z.string().email('Ingresa un email valido').max(320, 'El email es demasiado largo'),
})
```

Este codigo se bundlea con el formulario estatico. El usuario ve los mismos mensajes tanto en la validacion del navegador como en la del servidor.

### 3. Validacion del servidor (forms-api)

Al recibir una respuesta, `forms-api` valida con AJV + `ajv-errors` usando el mismo JSON Schema de Redis. Los mensajes de error del JSON Schema se devuelven al cliente si la validacion falla:

```json
{ "error": "Validation failed", "errors": { "email": "Ingresa un email valido" } }
```

### 4. Constraints de seguridad

Cada tipo de campo tiene limites maximos definidos en `field-constraints.ts` para evitar que un admin cree campos que rompan la base de datos (ej: texto con maxLength de 10 millones). Estos se aplican automaticamente al crear o actualizar formularios.

## Flujo completo de una respuesta

1. El usuario llena el formulario en el navegador
2. JS vanilla valida con Zod (errores inline con los mensajes del admin)
3. Obtiene token CSRF de `/formularios/api/csrf-token`
4. Ejecuta `grecaptcha.execute()` para obtener token reCAPTCHA v3
5. POST a `/formularios/api/submit/:spaceSlug/:formSlug` con datos + tokens
6. **forms-api**: valida CSRF → lee schema de Redis (cache local 30s) → verifica reCAPTCHA con Google → valida datos con AJV + errorMessages → hashea IP con salt diario → encola en BullMQ
7. Retorna `202 Accepted`
8. **answer-writer**: consume de la cola, acumula en buffer, hace batch INSERT cuando hay 50 respuestas o pasaron 2 segundos

## Flujo de pre-renderizado

1. Admin crea formulario con campos y validaciones via la interfaz
2. `schema-generator.ts` convierte campos → JSON Schema con errorMessages
3. Admin publica → admin-api llama a form-manager
4. form-manager lee formulario de Postgres, genera archivos temporales:
   - `index.html` con la estructura del formulario
   - `main.ts` con JS vanilla (validacion Zod, CSRF, reCAPTCHA, submit)
   - CSS con estilos base
5. Corre `vite.build()` con el `vite-plugin-jsonschema`
6. Output va al volumen compartido: `/app/static/{spaceSlug}/{formSlug}/`
7. Escribe schema en Redis para que forms-api lo tenga inmediatamente

## Seguridad

### Superficie de ataque minimizada

El servicio publico (`forms-api`) **no tiene conexion a PostgreSQL**. Solo habla con Redis. Esto significa que si un atacante compromete el servicio expuesto a internet:

- No tiene acceso a la base de datos
- No puede leer datos de otros formularios (solo lo que esta en Redis)
- No puede modificar formularios ni usuarios
- Solo puede encolar datos a una cola de Redis (que el answer-writer valida antes de insertar)

### CSRF

Proteccion via `CsrfFeature` de Iskra. El formulario pre-renderizado obtiene un token via cookie + header `X-CSRF-Token`. Previene que sitios externos envien respuestas en nombre del usuario.

### reCAPTCHA v3

Verificacion invisible sin interaccion del usuario. Cada envio incluye un token que se verifica contra la API de Google. Se rechaza si el score es menor a 0.5 (configurable). El score se guarda con la respuesta para analisis posterior.

### Rate limiting

`RateLimitFeature` en forms-api: 60 requests por minuto por IP. Evita abuso y scraping.

### Hash de IP

No se guarda la IP cruda. Se hashea con SHA256 usando un salt que rota diariamente. Permite detectar envios duplicados sin almacenar datos personales.

### Validacion en capas

1. **Cliente**: Zod (UX inmediata, no es barrera de seguridad)
2. **Servidor**: AJV con JSON Schema (barrera real, con los mismos mensajes)
3. **Constraints de campos**: Limites duros por tipo de campo para proteger la base de datos

### Secretos

Todos los secretos (AUTH_SECRET, CSRF_SECRET, RECAPTCHA_SECRET) se configuran via variables de entorno. Los valores por defecto son solo para desarrollo.

## Escalabilidad

### Que se escala

| Servicio | Como escalar | Por que |
|----------|-------------|---------|
| **forms-api** | Mas replicas, son stateless | Recibe todo el trafico publico. Sin Postgres = sin cuello de botella de conexiones |
| **answer-writer** | Mas replicas de consumers | Si la cola crece, se agregan mas workers. Batch inserts minimizan carga en Postgres |

### Que NO necesitas escalar

| Servicio | Por que |
|----------|---------|
| **admin-api** | Solo admins lo usan. Si tenes 10 admins concurrentes es mucho |
| **form-manager** | Pre-renderiza bajo demanda. No recibe trafico constante |
| **cron** | Un solo proceso chequea cada 30 segundos. No tiene carga |

### Estrategia de cache

- **Redis**: forms-api lee schemas de formularios de Redis (escritos por cron y form-manager)
- **Cache local**: forms-api tiene cache en memoria con TTL de 30 segundos para evitar llamadas repetidas a Redis
- **Archivos estaticos**: El HTML/JS se sirve desde un volumen compartido. En produccion se puede poner un CDN adelante

### docker-compose con replicas

```bash
# Escalar forms-api a 3 replicas y answer-writer a 4
docker compose up --scale forms-api=3 --scale answer-writer=4
```

## Estructura de Redis

El cron puebla Redis para que forms-api nunca necesite Postgres:

| Clave | Contenido |
|-------|-----------|
| `forms:schema:{spaceSlug}:{formSlug}` | JSON Schema de validacion (con errorMessages) |
| `forms:meta:{spaceSlug}:{formSlug}` | Metadata: `{ formId, status, startsAt, endsAt }` |
| `forms:index` | Set con todas las claves activas `{spaceSlug}:{formSlug}` |

Los formularios cerrados tienen TTL de 1 hora en Redis. Los activos no expiran (se borran al cerrar).

## Docker

Cada servicio tiene su propio Dockerfile:

| Servicio | Imagen base runtime | Nota |
|----------|-------------------|------|
| admin-api | UBI9 minimal | Binary compilado con `bun build --compile` |
| admin-frontend | nginx:alpine | Build de Vite → archivos estaticos servidos por nginx |
| form-manager | oven/bun:1.3.14 | Necesita Vite en runtime, no se puede compilar a binario |
| cron | UBI9 minimal | Binary compilado |
| forms-api | UBI9 minimal | Binary compilado + volumen para archivos estaticos |
| answer-writer | UBI9 minimal | Binary compilado, sin puerto expuesto |

Los binarios se compilan con `NODE_ENV=production` (Bun lo fija al compilar), y todas
las imagenes corren con un UID no root (1001, grupo 0). Detalles en la
[guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
# Build y levantar todo
docker compose up --build

# Solo rebuild un servicio
docker compose build forms-api
docker compose up -d forms-api
```

## Flujo de desarrollo

```bash
# 1. Levantar infra
docker compose up postgres redis -d

# 2. Levantar servicios individualmente para desarrollo
cd services/admin-api && bun dev
cd services/admin-frontend && bun dev  # (en otra terminal)
cd services/form-manager && bun dev
cd services/forms-api && bun dev
cd services/cron && bun dev
cd services/answer-writer && bun dev
```

## Proximos pasos

A partir de aca podes:

- Agregar migraciones con [Drizzle Kit](https://iskra-docs.fly.dev/es/guides/migrations/) para manejar cambios de schema
- Configurar un CDN (CloudFront, Cloudflare) delante de nginx para cachear los formularios estaticos
- Agregar notificaciones por email cuando se reciben respuestas usando el [EmailFeature](https://iskra-docs.fly.dev/es/packages/web-kit/)
- Implementar exportacion de respuestas a CSV/Excel desde el admin
- Agregar soporte de formularios multi-paso (wizard)
- Configurar los dos nginx de produccion (DMZ + interno) segun tu infraestructura
- Revisar las [features del Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) para agregar mas funcionalidad (API keys, permisos, OpenAPI)

## Despliegue

Para produccion necesitas:

1. Dos instancias de nginx: una en la DMZ (solo `/formularios/`) y otra en la red interna (`/admin/`)
2. Secretos reales para AUTH_SECRET, CSRF_SECRET, RECAPTCHA_SECRET
3. PostgreSQL y Redis en alta disponibilidad
4. Al menos 2 replicas de forms-api y answer-writer

Mas info general en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
