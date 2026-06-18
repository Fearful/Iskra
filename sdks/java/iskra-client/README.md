# Iskra Java Client SDK

Cliente Java para interactuar con servicios Iskra a traves de HTTP. Permite integrar aplicaciones Java (Spring MVC, Spring Boot, Jakarta EE, etc.) con un backend Iskra de forma sencilla y tipada.

## Instalacion

### Maven

```xml
<dependency>
    <groupId>dev.iskra</groupId>
    <artifactId>iskra-client</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'dev.iskra:iskra-client:0.1.0'
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
    .build();
```

## Sub-clientes

### Auth — Autenticacion

Interactua con el `AuthFeature` de Iskra (Better Auth).

```java
// Iniciar sesion
var session = iskra.auth().signIn("user@email.com", "password123");
var user = session.getData().getUser();
System.out.println("Bienvenido, " + user.getName());

// Registrar usuario
var newUser = iskra.auth().signUp("new@email.com", "password123", "Juan Perez");

// Obtener sesion actual
var current = iskra.auth().getSession();

// Cerrar sesion
iskra.auth().signOut();
```

### Health — Verificacion de Salud

Consulta los endpoints de salud de `HealthCheckFeature`.

```java
// Estado general
Map<String, Object> health = iskra.health().check();      // GET /health

// Probes de Kubernetes
Map<String, Object> ready = iskra.health().ready();        // GET /health/ready
Map<String, Object> live = iskra.health().live();          // GET /health/live
```

### Storage — Archivos

Interactua con `UploadFeature` y `StorageFeature`.

```java
import java.nio.file.Path;

// Subir archivo
iskra.storage().upload(Path.of("reporte.pdf"), "reporte.pdf");

// Subir a subcarpeta
iskra.storage().upload(Path.of("foto.jpg"), "foto.jpg", "avatares");

// Listar archivos
var archivos = iskra.storage().list();

// Descargar archivo
byte[] contenido = iskra.storage().download("reporte.pdf");

// Eliminar archivo
iskra.storage().delete("reporte.pdf");

// Cambiar prefijo de ruta (default: /upload)
iskra.storage().withRoutePrefix("/files");
```

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
| 429 | `RateLimitException` | — |
| 5xx | `IskraException` | `INTERNAL_ERROR` |

## Integracion con Spring MVC

```java
import dev.iskra.client.IskraClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class ProductoController {

    private final IskraClient iskra;

    public ProductoController() {
        this.iskra = IskraClient.builder("http://iskra-service:3000")
            .apiKey(System.getenv("ISKRA_API_KEY"))
            .build();
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
