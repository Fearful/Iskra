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
)
```

## Sub-clientes

### Auth — Autenticacion

Interactua con el `AuthFeature` de Iskra (Better Auth).

```python
# Iniciar sesion
resp = iskra.auth.sign_in("user@email.com", "password123")
user = resp.data.user
print(f"Bienvenido, {user.name}")

# Registrar usuario
resp = iskra.auth.sign_up("new@email.com", "password123", name="Juan Perez")

# Obtener sesion actual
resp = iskra.auth.get_session()

# Cerrar sesion
iskra.auth.sign_out()
```

**Async:**
```python
resp = await iskra.auth.async_sign_in("user@email.com", "password123")
```

### Health — Verificacion de Salud

```python
# Estado general
health = iskra.health.check()        # GET /health

# Probes de Kubernetes
ready = iskra.health.ready()          # GET /health/ready
live = iskra.health.live()            # GET /health/live
```

**Async:**
```python
health = await iskra.health.async_check()
```

### Storage — Archivos

```python
from pathlib import Path

# Subir archivo
iskra.storage.upload(Path("reporte.pdf"), "reporte.pdf")

# Subir a subcarpeta
iskra.storage.upload(Path("foto.jpg"), "foto.jpg", subfolder="avatares")

# Listar archivos
archivos = iskra.storage.list()

# Descargar archivo
contenido = iskra.storage.download("reporte.pdf")

# Eliminar archivo
iskra.storage.delete("reporte.pdf")

# Cambiar prefijo de ruta
iskra.storage.with_route_prefix("/files")
```

**Async:**
```python
await iskra.storage.async_upload(Path("reporte.pdf"), "reporte.pdf")
contenido = await iskra.storage.async_download("reporte.pdf")
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
resp = iskra.get("/api/productos")
resp.success   # bool
resp.data      # dict | list | None
resp.message   # str | None
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
| 429 | `RateLimitException` | — |
| 5xx | `IskraException` | `INTERNAL_ERROR` |

## Integracion con FastAPI

```python
from fastapi import FastAPI, Depends
from iskra_client import IskraClient
import os

app = FastAPI()

def get_iskra() -> IskraClient:
    return IskraClient(
        base_url=os.environ["ISKRA_BASE_URL"],
        api_key=os.environ.get("ISKRA_API_KEY"),
    )

@app.get("/productos")
async def listar_productos(iskra: IskraClient = Depends(get_iskra)):
    resp = await iskra.async_get("/api/productos")
    return resp.data

@app.post("/ordenes")
async def crear_orden(orden: dict, iskra: IskraClient = Depends(get_iskra)):
    resp = await iskra.async_post("/api/ordenes", json=orden)
    return resp.data

@app.get("/health")
async def health(iskra: IskraClient = Depends(get_iskra)):
    return await iskra.health.async_check()
```

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
