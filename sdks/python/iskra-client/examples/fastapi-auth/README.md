# FastAPI Auth Example

Ejemplo de una aplicacion FastAPI que enruta peticiones de autenticacion a un servicio Iskra usando el SDK Python.

## Arquitectura

```
Cliente HTTP
    │
    ▼
┌─────────────────────────┐
│  FastAPI (este app)     │
│  /auth/sign-in          │
│  /auth/sign-up          │
│  /auth/sign-out         │
│  /auth/session          │
│  /auth/health           │
├─────────── HTTP ────────┤
│  Servicio Iskra (Bun)   │
│  AuthFeature            │
│  HealthCheckFeature     │
└─────────────────────────┘
```

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/auth/sign-in` | Iniciar sesion (email + password) |
| POST | `/auth/sign-up` | Registrar usuario (email + password + name) |
| POST | `/auth/sign-out` | Cerrar sesion |
| GET | `/auth/session` | Obtener sesion actual |
| GET | `/auth/health` | Verificar salud del servicio Iskra |

## Requisitos

- Python 3.9+
- Un servicio Iskra corriendo con `AuthFeature` habilitado

## Instalacion

```bash
pip install -r requirements.txt
```

## Configuracion

Variables de entorno:

```bash
export ISKRA_BASE_URL=http://localhost:3000   # URL del servicio Iskra
export ISKRA_API_KEY=sk-xxx                    # Opcional: API key
```

## Ejecutar

```bash
uvicorn main:app --reload --port 8080
```

La documentacion interactiva de FastAPI estara disponible en `http://localhost:8080/docs`.

## Uso

```bash
# Registrar usuario
curl -X POST http://localhost:8080/auth/sign-up \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123", "name": "Juan"}'

# Iniciar sesion
curl -X POST http://localhost:8080/auth/sign-in \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'

# Obtener sesion
curl http://localhost:8080/auth/session

# Cerrar sesion
curl -X POST http://localhost:8080/auth/sign-out

# Verificar salud
curl http://localhost:8080/auth/health
```

## Estructura del proyecto

```
examples/fastapi-auth/
├── main.py               # Aplicacion FastAPI con rutas de auth
├── requirements.txt      # Dependencias
└── README.md
```
