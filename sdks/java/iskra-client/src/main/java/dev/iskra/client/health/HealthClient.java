package dev.iskra.client.health;

import com.fasterxml.jackson.core.type.TypeReference;
import dev.iskra.client.http.HttpClientWrapper;
import dev.iskra.client.response.IskraResponse;

import java.util.Map;

public class HealthClient {

    private final HttpClientWrapper http;

    public HealthClient(HttpClientWrapper http) {
        this.http = http;
    }

    public Map<String, Object> check() {
        IskraResponse<Map<String, Object>> response = http.get(
                "/health",
                new TypeReference<Map<String, Object>>() {}
        );
        return response.getData();
    }

    public Map<String, Object> ready() {
        IskraResponse<Map<String, Object>> response = http.get(
                "/health/ready",
                new TypeReference<Map<String, Object>>() {}
        );
        return response.getData();
    }

    public Map<String, Object> live() {
        IskraResponse<Map<String, Object>> response = http.get(
                "/health/live",
                new TypeReference<Map<String, Object>>() {}
        );
        return response.getData();
    }
}
