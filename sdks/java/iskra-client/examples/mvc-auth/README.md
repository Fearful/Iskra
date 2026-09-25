# Java MVC Auth Example

Ejemplo de una aplicacion Java MVC (Spring MVC) que enruta peticiones de autenticacion a un servicio Iskra usando el SDK Java.

La app usa un solo `IskraClient` (bean) para todos los usuarios. Al iniciar sesion
guarda la cookie de sesion de Iskra (`Session.getCookie()`) en una cookie HttpOnly
propia (`iskra_session`) y la reenvia a Iskra con `withSession()` / `getSession(cookie)`
en cada peticion del usuario.

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

- Java 17+ (Spring 6)
- Maven
- Un servicio Iskra corriendo con `AuthFeature` habilitado

## Configuracion

Variables de entorno:

```bash
export ISKRA_BASE_URL=http://localhost:3000   # URL del servicio Iskra
export ISKRA_API_KEY=sk-xxx                    # Opcional: API key
export SESSION_COOKIE_SECURE=0                 # Solo en desarrollo sobre http://
```

Todas las peticiones de auth llegan a Iskra desde la IP de esta app, asi que el
limite por IP del `AuthFeature` (20 intentos cada 15 min) las frena a todas juntas:
subilo con `rateLimit: { max, windowMs }` en el servicio. Este ejemplo **no limita**
intentos por usuario: antes de exponerlo agregale un limite por IP del cliente o por
email (por ejemplo con Bucket4j), y no desactives el del servicio (`rateLimit: false`) sin eso, porque los
intentos de adivinar passwords quedarian sin freno.

Los errores de Iskra (su mensaje, o el host y puerto de una conexion que falla) y el
detalle de `/auth/health` quedan en el log: los clientes reciben solo un error generico
y `{"status": "ok" | "error"}`.

## Compilar y ejecutar

```bash
# Compilar
mvn clean package

# Desplegar el WAR en un contenedor Jakarta EE 10 (Tomcat 10.1+, Jetty 12),
# o levantarlo directamente con Jetty:
mvn org.eclipse.jetty.ee10:jetty-ee10-maven-plugin:12.0.16:run -Djetty.http.port=8080
```

El SDK debe estar en el repositorio Maven local (`mvn install` en `sdks/java/iskra-client`).

## Uso

```bash
# Registrar usuario (deja la sesion iniciada en cookies.txt)
curl -X POST http://localhost:8080/auth/sign-up -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123", "name": "Juan"}'

# Iniciar sesion
curl -X POST http://localhost:8080/auth/sign-in -c cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret123"}'

# Obtener sesion
curl http://localhost:8080/auth/session -b cookies.txt

# Cerrar sesion
curl -X POST http://localhost:8080/auth/sign-out -b cookies.txt -c cookies.txt

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
