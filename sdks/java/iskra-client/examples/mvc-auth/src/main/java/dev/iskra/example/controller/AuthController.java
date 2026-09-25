package dev.iskra.example.controller;

import dev.iskra.client.IskraClient;
import dev.iskra.client.auth.Session;
import dev.iskra.client.exception.AuthException;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.exception.ValidationException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Routes auth requests to Iskra. The user's Iskra session cookie is kept in
 * this app's own HttpOnly cookie and sent back to Iskra with
 * {@code iskra.withSession()} on each request.
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final String SESSION_COOKIE = "iskra_session";
    private static final boolean COOKIE_SECURE = !"0".equals(System.getenv("SESSION_COOKIE_SECURE"));
    private static final Logger LOG = Logger.getLogger(AuthController.class.getName());

    // One client for the whole app (a singleton bean): it never stores
    // cookies, so requests of different users cannot leak into each other.
    private final IskraClient iskra;

    @Autowired
    public AuthController(IskraClient iskra) {
        this.iskra = iskra;
    }

    @PostMapping("/sign-in")
    public ResponseEntity<?> signIn(@RequestBody SignInRequest request) {
        try {
            Session session = iskra.auth().signIn(request.email, request.password).getData();
            return startSession(HttpStatus.OK, session);
        } catch (AuthException e) {
            return error(HttpStatus.UNAUTHORIZED, "Credenciales invalidas", e);
        } catch (ValidationException e) {
            return error(HttpStatus.BAD_REQUEST, "Datos invalidos", e);
        } catch (IskraException e) {
            return error(HttpStatus.BAD_GATEWAY, "Error del servicio Iskra", e);
        }
    }

    @PostMapping("/sign-up")
    public ResponseEntity<?> signUp(@RequestBody SignUpRequest request) {
        try {
            Session session = iskra.auth().signUp(request.email, request.password, request.name).getData();
            return startSession(HttpStatus.CREATED, session);
        } catch (ValidationException e) {
            return error(HttpStatus.BAD_REQUEST, "Datos invalidos", e);
        } catch (IskraException e) {
            return error(HttpStatus.BAD_GATEWAY, "Error del servicio Iskra", e);
        }
    }

    @PostMapping("/sign-out")
    public ResponseEntity<?> signOut(@CookieValue(value = SESSION_COOKIE, required = false) String stored) {
        String cookie = decode(stored);
        try {
            if (cookie != null) {
                iskra.auth().signOut(cookie);
            }
        } catch (IskraException e) {
            return error(HttpStatus.BAD_GATEWAY, "Error al cerrar sesion", e);
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, sessionCookie("", 0))
                .body(message("Sesion cerrada"));
    }

    @GetMapping("/session")
    public ResponseEntity<?> getSession(@CookieValue(value = SESSION_COOKIE, required = false) String stored) {
        String cookie = decode(stored);
        if (cookie == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(message("No hay sesion activa"));
        }
        try {
            Session session = iskra.auth().getSession(cookie).getData();
            if (session == null || session.getUser() == null) {
                return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(message("No hay sesion activa"));
            }
            Map<String, Object> body = new HashMap<>();
            body.put("user", user(session));
            return ResponseEntity.ok(body);
        } catch (IskraException e) {
            return error(HttpStatus.BAD_GATEWAY, "Error del servicio Iskra", e);
        }
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        // Public route: only up or down. The full payload (every check, with
        // its messages and details) stays in the log.
        try {
            Map<String, Object> health = iskra.health().check();
            if ("ok".equals(health.get("status"))) {
                return ResponseEntity.ok(status("ok"));
            }
            LOG.warning(() -> "Iskra is unhealthy: " + health);
        } catch (IskraException e) {
            LOG.log(Level.WARNING, "Iskra health check failed", e);
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(status("error"));
    }

    // ── Request DTOs ────────────────────────────────────────────────────

    public static class SignInRequest {
        public String email;
        public String password;
    }

    public static class SignUpRequest {
        public String email;
        public String password;
        public String name;
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private ResponseEntity<?> startSession(HttpStatus status, Session session) {
        ResponseEntity.BodyBuilder response = ResponseEntity.status(status);
        if (session.getCookie() != null) {
            response.header(HttpHeaders.SET_COOKIE, sessionCookie(encode(session.getCookie()), -1));
        }
        return response.body(user(session));
    }

    /** The Iskra cookie is stored base64url-encoded: it contains '=' and '%'. */
    private static String sessionCookie(String value, int maxAge) {
        StringBuilder cookie = new StringBuilder(SESSION_COOKIE).append('=').append(value)
                .append("; Path=/; HttpOnly; SameSite=Lax");
        if (maxAge >= 0) {
            cookie.append("; Max-Age=").append(maxAge);
        }
        if (COOKIE_SECURE) {
            cookie.append("; Secure");
        }
        return cookie.toString();
    }

    private static String encode(String cookie) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(cookie.getBytes(StandardCharsets.UTF_8));
    }

    private static String decode(String stored) {
        if (stored == null || stored.isEmpty()) {
            return null;
        }
        try {
            return new String(Base64.getUrlDecoder().decode(stored), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Map<String, Object> user(Session session) {
        Map<String, Object> user = new HashMap<>();
        if (session.getUser() != null) {
            user.put("id", session.getUser().getId());
            user.put("email", session.getUser().getEmail());
            user.put("name", session.getUser().getName());
        }
        return user;
    }

    private Map<String, Object> message(String msg) {
        Map<String, Object> body = new HashMap<>();
        body.put("message", msg);
        return body;
    }

    private static Map<String, Object> status(String value) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", value);
        return body;
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String msg, IskraException e) {
        Map<String, Object> body = new HashMap<>();
        body.put("error", msg);
        if (status.is4xxClientError()) {
            // About the caller's own request (wrong credentials, invalid fields).
            if (e.getErrorCode() != null) {
                body.put("code", e.getErrorCode());
            }
            if (e.getDetails() != null) {
                body.put("details", e.getDetails());
            }
        } else {
            // Iskra's own message or a connection error (host, port): log only,
            // anonymous callers only learn that the service failed.
            LOG.log(Level.WARNING, "Iskra request failed: " + msg, e);
        }
        return ResponseEntity.status(status).body(body);
    }
}
