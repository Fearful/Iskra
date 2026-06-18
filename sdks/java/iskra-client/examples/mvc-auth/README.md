# Java MVC Auth Example

Ejemplo de una aplicacion Java MVC (Spring MVC) que enruta peticiones de autenticacion a un servicio Iskra usando el SDK Java.

## Arquitectura

```
Cliente HTTP
    │
    ▼
┌─────────────────────────┐
│   Java MVC (este app)   │
│   /auth/sign-in         │
│   /auth/sign-up         │
│   /auth/sign-out        │
│   /auth/session         │
│   /auth/health          │
├─────────── HTTP ────────┤
│   Servicio Iskra (Bun)  │
│   AuthFeature           │
│   HealthCheckFeature    │
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

- Java 11+
- Maven
- Un servicio Iskra corriendo con `AuthFeature` habilitado

## Configuracion

Variables de entorno:

```bash
export ISKRA_BASE_URL=http://localhost:3000   # URL del servicio Iskra
export ISKRA_API_KEY=sk-xxx                    # Opcional: API key
```

## Compilar y ejecutar

```bash
# Compilar
mvn clean package

# Desplegar el WAR en Tomcat, Jetty, o cualquier contenedor de servlets
```

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
src/main/java/dev/iskra/example/
├── config/
│   ├── AppConfig.java            # Bean de IskraClient + Spring MVC config
│   └── WebAppInitializer.java    # Inicializador del DispatcherServlet
└── controller/
    └── AuthController.java       # Endpoints de autenticacion
```
