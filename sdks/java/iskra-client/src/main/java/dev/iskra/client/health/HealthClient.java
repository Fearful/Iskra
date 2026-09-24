package dev.iskra.client.health;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import dev.iskra.client.http.HttpClientWrapper;

import java.util.Collections;
import java.util.Map;
import java.util.Set;

public class HealthClient {

    // /health and /health/ready answer 503 with the same body shape when a
    // check fails ({"status": "error", ...}): a result to return, not an error.
    private static final Set<Integer> UNHEALTHY = Collections.singleton(503);
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<Map<String, Object>>() {};

    private final HttpClientWrapper http;

    public HealthClient(HttpClientWrapper http) {
        this.http = http;
    }

    /** GET /health: {@code {"status": "ok" | "error", "timestamp": ...}}. */
    public Map<String, Object> check() {
        return get("/health");
    }

    public Map<String, Object> ready() {
        return get("/health/ready");
    }

    public Map<String, Object> live() {
        return get("/health/live");
    }

    public boolean isHealthy() {
        return "ok".equals(check().get("status"));
    }

    private Map<String, Object> get(String path) {
        JsonNode body = http.readJson(http.send("GET", path, null, null, UNHEALTHY));
        if (body == null || !body.isObject()) {
            return Collections.emptyMap();
        }
        return http.getObjectMapper().convertValue(body, MAP);
    }
}
