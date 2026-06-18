package dev.iskra.example.controller;

import dev.iskra.client.IskraClient;
import dev.iskra.client.exception.AuthException;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.exception.ValidationException;
import dev.iskra.client.response.IskraResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final IskraClient iskra;

    @Autowired
    public AuthController(IskraClient iskra) {
        this.iskra = iskra;
    }

    @PostMapping("/sign-in")
    public ResponseEntity<?> signIn(@RequestBody SignInRequest request) {
        try {
            IskraResponse<?> response = iskra.auth().signIn(request.email, request.password);
            return ResponseEntity.ok(response.getData());
        } catch (AuthException e) {
            return error(HttpStatus.UNAUTHORIZED, "Credenciales invalidas", e);
        } catch (ValidationException e) {
            return error(HttpStatus.BAD_REQUEST, "Datos invalidos", e);
        } catch (IskraException e) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error del servidor", e);
        }
    }

    @PostMapping("/sign-up")
    public ResponseEntity<?> signUp(@RequestBody SignUpRequest request) {
        try {
            IskraResponse<?> response = iskra.auth().signUp(
                    request.email, request.password, request.name
            );
            return ResponseEntity.status(HttpStatus.CREATED).body(response.getData());
        } catch (ValidationException e) {
            return error(HttpStatus.BAD_REQUEST, "Datos invalidos", e);
        } catch (IskraException e) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error del servidor", e);
        }
    }

    @PostMapping("/sign-out")
    public ResponseEntity<?> signOut() {
        try {
            iskra.auth().signOut();
            return ResponseEntity.ok(message("Sesion cerrada"));
        } catch (IskraException e) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error al cerrar sesion", e);
        }
    }

    @GetMapping("/session")
    public ResponseEntity<?> getSession() {
        try {
            IskraResponse<?> response = iskra.auth().getSession();
            return ResponseEntity.ok(response.getData());
        } catch (AuthException e) {
            return error(HttpStatus.UNAUTHORIZED, "No hay sesion activa", e);
        } catch (IskraException e) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error del servidor", e);
        }
    }

    @GetMapping("/health")
    public ResponseEntity<?> health() {
        try {
            Map<String, Object> health = iskra.health().check();
            return ResponseEntity.ok(health);
        } catch (IskraException e) {
            return error(HttpStatus.SERVICE_UNAVAILABLE, "Iskra no disponible", e);
        }
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

    private Map<String, Object> message(String msg) {
        Map<String, Object> body = new HashMap<>();
        body.put("message", msg);
        return body;
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String msg, IskraException e) {
        Map<String, Object> body = new HashMap<>();
        body.put("error", msg);
        body.put("detail", e.getMessage());
        if (e.getErrorCode() != null) {
            body.put("code", e.getErrorCode());
        }
        if (e.getDetails() != null) {
            body.put("details", e.getDetails());
        }
        return ResponseEntity.status(status).body(body);
    }
}
