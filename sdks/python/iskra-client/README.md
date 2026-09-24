# Iskra Python Client SDK

Cliente Python para interactuar con servicios Iskra a traves de HTTP. Compatible con FastAPI, Django, Flask, y cualquier aplicacion Python. Soporta operaciones sincronas y asincronas.

## Instalacion

```bash
pip install iskra-client
```

O con Poetry:
```bash
poetry add iskra-client
```

## Requisitos

- Python 3.9 o superior
- Un servicio Iskra corriendo con `@iskra-bun/web-kit`

## Inicio Rapido

```python
from iskra_client import IskraClient

# Crear el cliente
iskra = IskraClient(
    base_url="http://localhost:3000",
    api_key="sk-tu-api-key",  # opcional
)

# Verificar salud del servicio
health = iskra.health.check()
print(f"Status: {health['status']}")

# Peticiones a rutas personalizadas
users = iskra.get("/api/users")
print(users.data)
```

### Context manager

```python
with IskraClient(base_url="http://localhost:3000") as iskra:
    result = iskra.get("/api/productos")
```

### Async

```python
async with IskraClient(base_url="http://localhost:3000") as iskra:
    result = await iskra.async_get("/api/productos")
```

## Configuracion

```python
iskra = IskraClient(
    base_url="http://iskra-service:3000",
    api_key="sk-xxx",                        # API key para autenticacion
    timeout=60.0,                            # timeout en segundos (default: 30)
    headers={"X-Custom-Header": "valor"},    # headers adicionales
    auth_base_path="/api/sso",               # ruta base de auth (default: /api/sso)
    storage_route_prefix="/upload",          # routePrefix del UploadFeature (default: /upload)
    origin=None,                             # Origin de las peticiones con sesion (default: el de base_url)
)
```

Un solo `IskraClient` puede atender a todos los usuarios de tu backend: reutiliza
conexiones y **nunca guarda cookies**, asi que la sesion de un usuario no se filtra
a las peticiones de otro. Las sesiones se asocian de forma explicita con
`with_session()` (ver Auth).

## Sub-clientes

### Auth — Autenticacion

Interactua con el `AuthFeature` de Iskra (Better Auth). Las sesiones son cookies:
`sign_in`/`sign_up` devuelven un `Session` cuyo `cookie` autentica al usuario.
Guardalo del lado del servidor (por ejemplo, en una cookie HttpOnly de tu app) y
pasalo a `with_session()` para actuar como ese usuario.

```python
# Iniciar sesion
session = iskra.auth.sign_in("user@email.com", "password123").data
print(f"Bienvenido, {session.user.name}")
session.cookie        # "better-auth.session_token=..." (secreto: no lo expongas)
session.session.token

# Registrar usuario (inicia sesion igual que sign_in)
session = iskra.auth.sign_up("new@email.com", "password123", name="Juan Perez").data

# Actuar como el usuario: un cliente que comparte las conexiones del original
como_usuario = iskra.with_session(session)          # o with_session(session.cookie)
como_usuario.get("/api/mis-pedidos")
como_usuario.storage.list()

# Sesion actual (data es None si no hay, expiro o se cerro)
actual = iskra.auth.get_session(session).data       # o como_usuario.auth.get_session()

# Cerrar sesion
iskra.auth.sign_out(session)
```

**Async:**
```python
session = (await iskra.auth.async_sign_in("user@email.com", "password123")).data
await iskra.auth.async_get_session(session)
await iskra.auth.async_sign_out(session)
```

Notas:

- Solo se conserva la cookie `session_token`, que el servicio valida contra la base
  en cada peticion. La cookie de cache `session_data` se descarta porque mantendria
  valida una sesion cerrada hasta que expire.
- Better Auth rechaza los POST con cookie que no traen un `Origin` de confianza, asi
  que las peticiones con sesion envian `Origin` = origen de `base_url`. Si el
  `baseURL` del `AuthFeature` es otra URL (por ejemplo, la publica y no la interna),
  pasa `origin="https://app.ejemplo.com"` o agrega `base_url` a `trustedOrigins`.
- El `AuthFeature` limita las rutas de auth a 20 peticiones cada 15 minutos por IP.
  Si tu backend inicia sesion por todos sus usuarios desde una IP, ajusta
  `rateLimit: { max, windowMs }` en el servicio (o `rateLimit: false` si limitas por
  tu cuenta).

### Health — Verificacion de Salud

```python
# Estado general: {"status": "ok" | "error", "timestamp": ...}
health = iskra.health.check()        # GET /health
iskra.health.is_healthy()            # True si status == "ok"

# Probes de Kubernetes
ready = iskra.health.ready()          # GET /health/ready
live = iskra.health.live()            # GET /health/live
```

Cuando un check falla, el servicio responde 503 con el mismo cuerpo
(`status: "error"`); el SDK lo devuelve en lugar de lanzar una excepcion.

**Async:**
```python
health = await iskra.health.async_check()
```

### Storage — Archivos

Usa las rutas que expone el `UploadFeature` (`exposeRoutes: true`). Pasan por su
callback `authorize`, que normalmente exige un usuario con sesion: llamalas desde
`iskra.with_session(session)`.

```python
from pathlib import Path

storage = iskra.with_session(session).storage

# Subir archivo (ruta, bytes o archivo binario abierto)
subido = storage.upload(Path("reporte.pdf"))                 # nombre: reporte.pdf
storage.upload(Path("foto.jpg"), "avatar.jpg", subfolder="avatares")
storage.upload(b"...", "datos.bin")                            # bytes: nombre obligatorio
subido.filename, subido.path, subido.size, subido.uploaded_at

# Listar archivos (incluye subcarpetas): lista de StoredFile
for f in storage.list(subfolder="avatares"):
    print(f.name, f.size, f.mime_type)

# Descargar archivo
contenido = storage.download("avatar.jpg", subfolder="avatares")   # bytes

# Eliminar archivo
storage.delete("avatar.jpg", subfolder="avatares")

# UploadFeature montado en otro routePrefix: devuelve otro StorageClient
archivos = storage.with_route_prefix("/files")
```

El servicio reduce los nombres a `[A-Za-z0-9._-]` (`"mi reporte.pdf"` se guarda como
`"mi_reporte.pdf"`); usa `subido.filename` para descargarlo despues.

**Async:**
```python
await storage.async_upload(Path("reporte.pdf"))
contenido = await storage.async_download("reporte.pdf")
await storage.async_list()
await storage.async_delete("reporte.pdf")
```

## Peticiones Genericas

Para interactuar con rutas personalizadas de tu aplicacion Iskra:

```python
# Sync
productos = iskra.get("/api/productos")
resultado = iskra.post("/api/ordenes", json={"producto_id": 1, "cantidad": 3})
actualizado = iskra.put("/api/ordenes/1", json={"cantidad": 5})
eliminado = iskra.delete("/api/ordenes/1")

# Async
productos = await iskra.async_get("/api/productos")
resultado = await iskra.async_post("/api/ordenes", json={"producto_id": 1})
```

Todas las respuestas son objetos `IskraResponse`:
```python
resp = iskra.get("/api/productos", params={"pagina": 2})
resp.success      # bool
resp.data         # el `data` de successResponse(), o el cuerpo JSON / texto
resp.message      # str | None
resp.status_code  # int
```

## Manejo de Errores

El SDK mapea automaticamente las respuestas de error de Iskra a excepciones Python tipadas:

```python
from iskra_client import (
    IskraException,
    ValidationException,
    AuthException,
    ForbiddenException,
    NotFoundException,
    RateLimitException,
)

try:
    iskra.get("/api/recurso-inexistente")
except NotFoundException as e:
    # HTTP 404
    print(f"No encontrado: {e}")
except ValidationException as e:
    # HTTP 400
    print(f"Error de validacion: {e.details}")
except AuthException as e:
    # HTTP 401
    print(f"No autorizado: {e}")
except ForbiddenException as e:
    # HTTP 403
    print(f"Prohibido: {e}")
except RateLimitException as e:
    # HTTP 429
    print("Limite de peticiones excedido")
except IskraException as e:
    # Cualquier otro error
    print(f"Error {e.status_code}: {e}")
    print(f"Codigo: {e.error_code}")
    print(f"Request ID: {e.request_id}")
```

| HTTP Status | Excepcion | Codigo Iskra |
|-------------|-----------|--------------|
| 400 | `ValidationException` | `VALIDATION_ERROR` |
| 401 | `AuthException` | `UNAUTHORIZED` |
| 403 | `ForbiddenException` | `FORBIDDEN` |
| 404 | `NotFoundException` | `NOT_FOUND` |
| 409 | `ConflictException` | `CONFLICT` |
| 429 | `RateLimitException` | — |
| 5xx | `IskraException` | `INTERNAL_ERROR` |

El mensaje sale de `error` o `message` del cuerpo (los formatos de
`ErrorHandlerFeature`, `errorResponse()` y Better Auth), `error_code` de `code` y
`details` de `details`; un cuerpo de texto (por ejemplo, el `404 Not Found` de una
ruta inexistente) queda como mensaje.

## Integracion con FastAPI

Crea un solo cliente para toda la app y cerralo al apagarla:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from iskra_client import IskraClient
import os

iskra = IskraClient(
    base_url=os.environ["ISKRA_BASE_URL"],
    api_key=os.environ.get("ISKRA_API_KEY"),
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await iskra.aclose()

app = FastAPI(lifespan=lifespan)

@app.get("/productos")
async def listar_productos():
    resp = await iskra.async_get("/api/productos")
    return resp.data

@app.post("/ordenes")
async def crear_orden(orden: dict):
    resp = await iskra.async_post("/api/ordenes", json=orden)
    return resp.data

@app.get("/health")
async def health():
    return await iskra.health.async_check()
```

`examples/fastapi-auth` muestra el flujo completo de sesion: guarda la cookie de
Iskra en una cookie HttpOnly propia y la reenvia con `with_session()`.

## Integracion con Django

```python
# views.py
from django.http import JsonResponse
from iskra_client import IskraClient
import os

iskra = IskraClient(
    base_url=os.environ["ISKRA_BASE_URL"],
    api_key=os.environ.get("ISKRA_API_KEY"),
)

def listar_productos(request):
    resp = iskra.get("/api/productos")
    return JsonResponse(resp.data, safe=False)

def crear_orden(request):
    import json
    body = json.loads(request.body)
    resp = iskra.post("/api/ordenes", json=body)
    return JsonResponse(resp.data)

def health(request):
    return JsonResponse(iskra.health.check())
```

## Arquitectura

```
┌─────────────────────────────────────────┐
│       Tu App Python (FastAPI, etc.)     │
│         (Routes, Services)              │
├─────────────────────────────────────────┤
│        iskra-client (SDK)               │
│   IskraClient → HttpClientWrapper       │
│   AuthClient / HealthClient / Storage   │
├───────────────── HTTP ──────────────────┤
│          Servicio Iskra (Bun)           │
│   WebPlugin → Kernel → Features         │
│   DbDriver / SocketDriver / Workers     │
└─────────────────────────────────────────┘
```

## Dependencias

- `httpx` — Cliente HTTP con soporte sync y async

## Tests

Los tests corren contra un servicio Iskra real: el servidor de contrato
`sdks/contract/server.ts` (auth sobre SQLite en memoria, health, uploads). Necesitan
[Bun](https://bun.sh) y las dependencias del monorepo (`bun install` en la raiz).

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
pytest                      # levanta el servidor de contrato con `bun`
BUN=/ruta/a/bun pytest      # otro binario de Bun
ISKRA_CONTRACT_URL=http://127.0.0.1:4000 pytest   # contra un servidor ya levantado
```
