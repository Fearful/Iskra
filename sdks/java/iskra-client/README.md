# Iskra Java Client SDK

Cliente Java para interactuar con servicios Iskra a traves de HTTP. Permite integrar aplicaciones Java (Spring MVC, Spring Boot, Jakarta EE, etc.) con un backend Iskra de forma sencilla y tipada.

## Instalacion

### Maven

```xml
<dependency>
    <groupId>dev.iskra</groupId>
    <artifactId>iskra-client</artifactId>
    <version>0.2.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'dev.iskra:iskra-client:0.2.0'
```

## Requisitos

- Java 11 o superior
- Un servicio Iskra corriendo con `@iskra-bun/web-kit`

## Inicio Rapido

```java
import dev.iskra.client.IskraClient;
import dev.iskra.client.response.IskraResponse;

// Crear el cliente
var iskra = IskraClient.builder("http://localhost:3000")
    .apiKey("sk-tu-api-key")  // opcional, si usas ApiKeyFeature
    .build();

// Verificar salud del servicio
var health = iskra.health().check();
System.out.println("Status: " + health.get("status"));

// Hacer peticiones a rutas personalizadas
IskraResponse<Map> users = iskra.get("/api/users", Map.class);
```

## Configuracion

```java
var iskra = IskraClient.builder("http://iskra-service:3000")
    .apiKey("sk-xxx")                          // API key para autenticacion
    .timeout(Duration.ofSeconds(60))           // timeout de peticiones (default: 30s)
    .header("X-Custom-Header", "valor")        // headers adicionales
    .authBasePath("/api/sso")                  // ruta base de autenticacion (default: /api/sso)
    .storageRoutePrefix("/upload")             // routePrefix del UploadFeature (default: /upload)
    .origin("https://app.ejemplo.com")         // Origin de las peticiones con sesion (default: el de la base URL)
    .maxResponseBytes(10 * 1024 * 1024)        // tamano maximo del body de una respuesta (default: 10 MiB)
    .build();
```

Una respuesta cuyo body supera `maxResponseBytes` (por su `Content-Length` o por los
bytes recibidos) lanza `IskraException` en lugar de llenar la memoria del proceso.

Un `IskraClient` es thread-safe y **nunca guarda cookies**: una sola instancia (por
ejemplo, un bean singleton) puede atender a todos los usuarios sin que la sesion de
uno se filtre a las peticiones de otro. Las sesiones se asocian de forma explicita
con `withSession()` (ver Auth).

## Sub-clientes

### Auth — Autenticacion

Interactua con el `AuthFeature` de Iskra (Better Auth). Las sesiones son cookies:
`signIn`/`signUp` devuelven un `Session` cuyo `getCookie()` autentica al usuario.
Guardalo del lado del servidor (por ejemplo, en una cookie HttpOnly de tu app) y
pasalo a `withSession()` para actuar como ese usuario.

```java
// Iniciar sesion
Session session = iskra.auth().signIn("user@email.com", "password123").getData();
System.out.println("Bienvenido, " + session.getUser().getName());
session.getCookie();                 // "better-auth.session_token=..." (secreto: no lo expongas)
session.getSession().getToken();

// Registrar usuario (inicia sesion igual que signIn; name null = parte local del email)
Session nuevo = iskra.auth().signUp("new@email.com", "password123", "Juan Perez").getData();

// Actuar como el usuario: un cliente que comparte las conexiones del original
IskraClient comoUsuario = iskra.withSession(session);      // o withSession(session.getCookie())
comoUsuario.get("/api/mis-pedidos", Map.class);
comoUsuario.storage().list();

// Sesion actual (getData() es null si no hay, expiro o se cerro)
Session actual = iskra.auth().getSession(session).getData();

// Cerrar sesion
iskra.auth().signOut(session);
```

Notas:

- Solo se conserva la cookie `session_token`, que el servicio valida contra la base
  en cada peticion. La cookie de cache `session_data` se descarta porque mantendria
  valida una sesion cerrada hasta que expire.
- Better Auth rechaza los POST con cookie que no traen un `Origin` de confianza, asi
  que las peticiones con sesion envian `Origin` = origen de la base URL. Si el
  `baseURL` del `AuthFeature` es otra URL (por ejemplo, la publica y no la interna),
  configura `.origin(...)` o agrega la base URL a `trustedOrigins`.
- El `AuthFeature` limita los intentos de auth (sign-in, sign-up...) a 20 cada 15
  minutos por IP. Tu backend los hace todos desde su IP, asi que ese limite frena a
  todos tus usuarios juntos: subilo con `rateLimit: { max, windowMs }` en el servicio y
  limita por usuario en tu app (por IP del cliente o por email), que el SDK no lo hace.
  `rateLimit: false` deja los intentos de adivinar passwords sin ningun freno: usalo
  solo si tu app ya tiene ese limite.

### Health — Verificacion de Salud

Consulta los endpoints de salud de `HealthCheckFeature`.

```java
// Estado general: {"status": "ok" | "error", "timestamp": ...}
Map<String, Object> health = iskra.health().check();      // GET /health
boolean ok = iskra.health().isHealthy();

// Probes de Kubernetes
Map<String, Object> ready = iskra.health().ready();        // GET /health/ready
Map<String, Object> live = iskra.health().live();          // GET /health/live
```

Cuando un check falla, el servicio responde 503 con el mismo cuerpo
(`status: "error"`); el SDK lo devuelve en lugar de lanzar una excepcion.

### Storage — Archivos

Usa las rutas que expone el `UploadFeature` (`exposeRoutes: true`). Pasan por su
callback `authorize`, que normalmente exige un usuario con sesion: llamalas desde
`iskra.withSession(session)`.

Todos los usuarios comparten los archivos del proyecto: un `authorize` que solo pide
sesion (`(c) => Boolean(c.get('user'))`) deja que cualquiera liste, descargue o borre
los archivos de los demas. Para que cada usuario vea solo los suyos, el servicio puede
exigir una carpeta propia en `authorize`:

```typescript
// Servicio Iskra: cada usuario solo usa la subcarpeta users/<su id>
new UploadFeature({
    projectName: 'app',
    exposeRoutes: true,
    authorize: (c, action) => {
        const user = c.get('user');
        if (!user) return false;
        // upload y list la reciben en ?subfolder=; download y delete, en la ruta.
        const folder =
            action === 'upload' || action === 'list'
                ? c.req.query('subfolder')
                : c.req.path.slice('/upload/'.length).split('/').slice(0, -1).join('/');
        return folder === `users/${user.id}`;
    },
});
```

```java
String carpeta = "users/" + session.getUser().getId();   // la que exige ese authorize
iskra.withSession(session).storage().upload(Path.of("reporte.pdf"), "reporte.pdf", carpeta);
```

```java
import java.nio.file.Path;

StorageClient storage = iskra.withSession(session).storage();

// Subir archivo (nombre por defecto: el del archivo)
UploadedFile subido = storage.upload(Path.of("reporte.pdf"));
storage.upload(Path.of("foto.jpg"), "avatar.jpg", "avatares");   // nombre + subcarpeta
storage.upload(bytes, "datos.bin", null);                          // bytes
subido.getFilename(); subido.getPath(); subido.getSize();

// Listar archivos (incluye subcarpetas)
List<StoredFile> archivos = storage.list("avatares");

// Descargar archivo
byte[] contenido = storage.download("avatar.jpg", "avatares");

// Eliminar archivo
storage.delete("avatar.jpg", "avatares");

// UploadFeature montado en otro routePrefix: devuelve otro StorageClient
StorageClient files = storage.withRoutePrefix("/files");
```

El servicio reduce los nombres a `[A-Za-z0-9._-]` (`"mi reporte.pdf"` se guarda como
`"mi_reporte.pdf"`); usa `subido.getFilename()` para descargarlo despues.

## Peticiones Genericas

Para interactuar con rutas personalizadas de tu aplicacion Iskra:

```java
// GET
IskraResponse<List> productos = iskra.get("/api/productos", List.class);

// POST
Map<String, Object> orden = Map.of("producto_id", 1, "cantidad", 3);
IskraResponse<Map> resultado = iskra.post("/api/ordenes", orden, Map.class);

// PUT
IskraResponse<Map> actualizado = iskra.put("/api/ordenes/1", cambios, Map.class);

// DELETE
IskraResponse<Object> eliminado = iskra.delete("/api/ordenes/1", Object.class);
```

`getData()` es el `data` de `successResponse()` o, si la ruta responde otro JSON
(objeto o array), el cuerpo completo; los campos junto a `success` sin `data` (como
los de las rutas de upload) tambien quedan en `getData()`. Una respuesta de texto se
obtiene pidiendo `String.class` u `Object.class`. `getStatusCode()` devuelve el
status HTTP.

### Con tipos personalizados

```java
public class Producto {
    private int id;
    private String nombre;
    private double precio;
    // getters y setters...
}

IskraResponse<Producto> producto = iskra.get("/api/productos/1", Producto.class);
System.out.println(producto.getData().getNombre());
```

## Manejo de Errores

El SDK mapea automaticamente las respuestas de error de Iskra a excepciones Java tipadas:

```java
import dev.iskra.client.exception.*;

try {
    iskra.get("/api/recurso-inexistente", Object.class);
} catch (NotFoundException e) {
    // HTTP 404
    System.out.println("No encontrado: " + e.getMessage());
} catch (ValidationException e) {
    // HTTP 400
    System.out.println("Error de validacion: " + e.getDetails());
} catch (AuthException e) {
    // HTTP 401
    System.out.println("No autorizado: " + e.getMessage());
} catch (ForbiddenException e) {
    // HTTP 403
    System.out.println("Prohibido: " + e.getMessage());
} catch (RateLimitException e) {
    // HTTP 429
    System.out.println("Limite de peticiones excedido");
} catch (IskraException e) {
    // Cualquier otro error
    System.out.println("Error " + e.getStatusCode() + ": " + e.getMessage());
    System.out.println("Codigo: " + e.getErrorCode());
    System.out.println("Request ID: " + e.getRequestId());
}
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
`ErrorHandlerFeature`, `errorResponse()` y Better Auth), `getErrorCode()` de `code` y
`getDetails()` de `details`; un cuerpo de texto (por ejemplo, el `404 Not Found` de
una ruta inexistente) queda como mensaje. Si el hilo se interrumpe durante una
peticion, se lanza `IskraException` y el hilo conserva la marca de interrupcion.

## Integracion con Spring MVC

```java
import dev.iskra.client.IskraClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ProductoController {

    private final IskraClient iskra;   // un solo cliente (bean) para toda la app

    public ProductoController(IskraClient iskra) {
        this.iskra = iskra;
    }

    @GetMapping("/productos")
    public List<Producto> listar() {
        return iskra.get("/api/productos", List.class).getData();
    }

    @PostMapping("/ordenes")
    public Orden crear(@RequestBody OrdenRequest req) {
        return iskra.post("/api/ordenes", req, Orden.class).getData();
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return iskra.health().check();
    }
}
```

### Spring Boot — Bean de configuracion

```java
import dev.iskra.client.IskraClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class IskraConfiguration {

    @Bean
    public IskraClient iskraClient(
            @Value("${iskra.base-url}") String baseUrl,
            @Value("${iskra.api-key:}") String apiKey) {

        var builder = IskraClient.builder(baseUrl);
        if (!apiKey.isEmpty()) {
            builder.apiKey(apiKey);
        }
        return builder.build();
    }
}
```

`application.yml`:
```yaml
iskra:
  base-url: http://localhost:3000
  api-key: ${ISKRA_API_KEY:}
```

## Arquitectura

```
┌─────────────────────────────────────────┐
│           Tu App Java/Spring            │
│         (Controllers, Services)         │
├─────────────────────────────────────────┤
│          iskra-client (SDK)             │
│   IskraClient → HttpClientWrapper       │
│   AuthClient / HealthClient / Storage   │
├───────────────── HTTP ──────────────────┤
│          Servicio Iskra (Bun)           │
│   WebPlugin → Kernel → Features         │
│   DbDriver / SocketDriver / Workers     │
└─────────────────────────────────────────┘
```

## Dependencias

- `com.fasterxml.jackson:jackson-databind` — Serializacion JSON
- `java.net.http.HttpClient` — Cliente HTTP nativo (Java 11+)

## Tests

Los tests corren contra un servicio Iskra real: el servidor de contrato
`sdks/contract/server.ts` (auth sobre SQLite en memoria, health, uploads). Necesitan
[Bun](https://bun.sh) y las dependencias del monorepo (`bun install` en la raiz).

```bash
mvn test                                   # levanta el servidor de contrato con `bun`
BUN=/ruta/a/bun mvn test                   # otro binario de Bun
ISKRA_CONTRACT_URL=http://127.0.0.1:4000 mvn test   # contra un servidor ya levantado
```

`examples/mvc-auth` muestra el flujo completo de sesion en Spring MVC: guarda la
cookie de Iskra en una cookie HttpOnly propia y la reenvia con `withSession()`.
