package dev.iskra.client.http;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.iskra.client.IskraConfig;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.response.ErrorResponse;
import dev.iskra.client.response.IskraResponse;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Sends requests to an Iskra service and maps its responses.
 *
 * <p>The underlying {@link HttpClient} has no cookie handler, so a client
 * never picks up a session from a response: one instance can serve every user
 * of a backend. Sessions are bound explicitly with {@link #withCookie(String)}.
 */
public class HttpClientWrapper {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final IskraConfig config;
    private final Map<String, String> extraHeaders;

    public HttpClientWrapper(IskraConfig config) {
        this(
                config,
                HttpClient.newBuilder().connectTimeout(config.getTimeout()).build(),
                new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false),
                Collections.emptyMap()
        );
    }

    private HttpClientWrapper(IskraConfig config, HttpClient httpClient, ObjectMapper objectMapper,
                              Map<String, String> extraHeaders) {
        this.config = config;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.extraHeaders = extraHeaders;
    }

    /**
     * A wrapper sharing this one's connections that authenticates as the
     * session in {@code cookie} (a Cookie header value). It also sends an
     * {@code Origin}: Better Auth rejects cookie-authenticated POSTs without a
     * trusted one.
     */
    public HttpClientWrapper withCookie(String cookie) {
        Map<String, String> headers = new LinkedHashMap<>(extraHeaders);
        headers.put("Cookie", cookie);
        headers.put("Origin", config.getOrigin() != null ? config.getOrigin() : originOf(config.getBaseUrl()));
        return new HttpClientWrapper(config, httpClient, objectMapper, Collections.unmodifiableMap(headers));
    }

    /** The session cookie this wrapper is bound to, or null. */
    public String getCookie() {
        return extraHeaders.get("Cookie");
    }

    public IskraConfig getConfig() {
        return config;
    }

    // --- Typed requests ---

    public <T> IskraResponse<T> get(String path, Class<T> responseType) {
        return toResponse(send("GET", path, null, null), type(responseType));
    }

    public <T> IskraResponse<T> get(String path, TypeReference<T> responseType) {
        return toResponse(send("GET", path, null, null), type(responseType));
    }

    public <T> IskraResponse<T> post(String path, Object body, Class<T> responseType) {
        return toResponse(sendJson("POST", path, body), type(responseType));
    }

    public <T> IskraResponse<T> post(String path, Object body, TypeReference<T> responseType) {
        return toResponse(sendJson("POST", path, body), type(responseType));
    }

    public <T> IskraResponse<T> put(String path, Object body, Class<T> responseType) {
        return toResponse(sendJson("PUT", path, body), type(responseType));
    }

    public <T> IskraResponse<T> put(String path, Object body, TypeReference<T> responseType) {
        return toResponse(sendJson("PUT", path, body), type(responseType));
    }

    public <T> IskraResponse<T> delete(String path, Class<T> responseType) {
        return toResponse(send("DELETE", path, null, null), type(responseType));
    }

    public byte[] getBytes(String path) {
        return send("GET", path, null, null).body();
    }

    // --- Raw requests ---

    /**
     * Sends a request and returns the raw response, throwing the matching
     * {@link IskraException} for a 4xx/5xx status not in {@code okStatuses}.
     */
    public HttpResponse<byte[]> send(String method, String path, HttpRequest.BodyPublisher body,
                                     String contentType, Set<Integer> okStatuses) {
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(config.getBaseUrl().replaceAll("/+$", "") + path))
                .timeout(config.getTimeout())
                .method(method, body != null ? body : HttpRequest.BodyPublishers.noBody());
        if (config.getApiKey() != null) {
            builder.header("X-API-Key", config.getApiKey());
        }
        config.getHeaders().forEach(builder::header);
        extraHeaders.forEach(builder::header);
        if (contentType != null) {
            builder.header("Content-Type", contentType);
        }

        HttpResponse<byte[]> response;
        try {
            response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IskraException("HTTP request interrupted", e);
        } catch (IOException e) {
            throw new IskraException("HTTP request failed: " + e.getMessage(), e);
        }
        if (response.statusCode() >= 400 && !okStatuses.contains(response.statusCode())) {
            throw toException(response);
        }
        return response;
    }

    public HttpResponse<byte[]> send(String method, String path, HttpRequest.BodyPublisher body, String contentType) {
        return send(method, path, body, contentType, Collections.emptySet());
    }

    private HttpResponse<byte[]> sendJson(String method, String path, Object body) {
        if (body == null) {
            return send(method, path, null, null);
        }
        try {
            byte[] json = objectMapper.writeValueAsBytes(body);
            return send(method, path, HttpRequest.BodyPublishers.ofByteArray(json), "application/json");
        } catch (IOException e) {
            throw new IskraException("Failed to serialize request body", e);
        }
    }

    // --- Response mapping ---

    /**
     * The JSON body as a tree, or null when the body is empty or not JSON
     * (e.g. {@code c.text()} routes and Hono's plain-text 404).
     */
    public JsonNode readJson(HttpResponse<byte[]> response) {
        byte[] body = response.body();
        if (body == null || body.length == 0 || !isJson(response)) {
            return null;
        }
        try {
            return objectMapper.readTree(body);
        } catch (IOException e) {
            return null;
        }
    }

    public <T> T convert(JsonNode node, Class<T> type) {
        return objectMapper.convertValue(node, type);
    }

    /**
     * Unwraps {@code {"success", "data", "message"}} envelopes. Fields next to
     * {@code success} (e.g. the upload routes' result) become the data; any
     * other JSON body (objects, arrays) is the data itself, and a text body is
     * the data when {@code T} is {@code String} or {@code Object}.
     */
    private <T> IskraResponse<T> toResponse(HttpResponse<byte[]> response, JavaType type) {
        int status = response.statusCode();
        byte[] body = response.body();
        if (body == null || body.length == 0) {
            return new IskraResponse<>(true, null, null, status);
        }
        if (!isJson(response)) {
            if (type.getRawClass().isAssignableFrom(String.class)) {
                @SuppressWarnings("unchecked")
                T text = (T) new String(body, StandardCharsets.UTF_8);
                return new IskraResponse<>(true, text, null, status);
            }
            throw new IskraException("Expected a JSON response but got "
                    + response.headers().firstValue("Content-Type").orElse("no content type"), status);
        }

        JsonNode node;
        try {
            node = objectMapper.readTree(body);
        } catch (IOException e) {
            throw new IskraException("Invalid JSON response: " + e.getMessage(), e);
        }
        boolean success = true;
        String message = null;
        JsonNode data = node;
        if (node.isObject() && node.has("success")) {
            success = node.get("success").asBoolean();
            message = node.hasNonNull("message") ? node.get("message").asText() : null;
            if (node.has("data")) {
                data = node.get("data");
            } else {
                ObjectNode rest = ((ObjectNode) node).deepCopy();
                rest.remove("success");
                rest.remove("message");
                data = rest.size() > 0 ? rest : null;
            }
        }
        try {
            T value = data == null || data.isNull() ? null : objectMapper.convertValue(data, type);
            return new IskraResponse<>(success, value, message, status);
        } catch (IllegalArgumentException e) {
            throw new IskraException("Could not map the response to " + type + ": " + e.getMessage(), e);
        }
    }

    private IskraException toException(HttpResponse<byte[]> response) {
        int status = response.statusCode();
        JsonNode node = readJson(response);
        ErrorResponse error;
        if (node != null && node.isObject()) {
            error = objectMapper.convertValue(normalizeError((ObjectNode) node.deepCopy()), ErrorResponse.class);
        } else {
            error = new ErrorResponse();
            String text = response.body() == null ? "" : new String(response.body(), StandardCharsets.UTF_8).trim();
            if (!text.isEmpty()) {
                error.setError(text);
            }
        }
        return IskraException.fromErrorResponse(status, error);
    }

    /** Accepts {@code "error": {"message", "code"}} as well as a string. */
    private static ObjectNode normalizeError(ObjectNode node) {
        JsonNode error = node.get("error");
        if (error != null && error.isObject()) {
            if (error.hasNonNull("code") && !node.hasNonNull("code")) {
                node.set("code", error.get("code"));
            }
            if (error.hasNonNull("message")) {
                node.put("error", error.get("message").asText());
            } else {
                node.remove("error");
            }
        } else if (error != null && !error.isTextual()) {
            node.remove("error");
        }
        return node;
    }

    private static boolean isJson(HttpResponse<?> response) {
        return response.headers().firstValue("Content-Type").map(t -> t.contains("json")).orElse(false);
    }

    private JavaType type(Class<?> type) {
        return objectMapper.getTypeFactory().constructType(type);
    }

    private JavaType type(TypeReference<?> type) {
        return objectMapper.getTypeFactory().constructType(type);
    }

    private static String originOf(String url) {
        URI uri = URI.create(url);
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }

    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}
