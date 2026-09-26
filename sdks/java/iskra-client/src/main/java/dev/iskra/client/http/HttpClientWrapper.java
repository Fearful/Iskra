package dev.iskra.client.http;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.iskra.client.IskraConfig;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.exception.RateLimitException;
import dev.iskra.client.response.ErrorResponse;
import dev.iskra.client.response.IskraResponse;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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
        // Concatenated to the base URL, a path such as "@other-host/x" made
        // "http://iskra@other-host/x": the request, API key included, went to
        // another host.
        if (path == null || !path.startsWith("/")) {
            throw new IllegalArgumentException("Request path must start with '/': " + path);
        }
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

        // The timeout covers the whole exchange: HttpRequest.timeout() stops
        // at the response headers, so a server that stalled mid-body blocked
        // the caller forever. The body is read up to maxResponseBytes: an
        // unbounded one filled the memory of the calling process.
        HttpResponse<byte[]> response;
        CompletableFuture<HttpResponse<byte[]>> future =
                httpClient.sendAsync(builder.build(), limitedBody(config.getMaxResponseBytes()));
        try {
            response = future.get(config.getTimeout().toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            future.cancel(true);
            Thread.currentThread().interrupt();
            throw new IskraException("HTTP request interrupted", e);
        } catch (TimeoutException e) {
            future.cancel(true);
            throw new IskraException("HTTP request timed out after " + config.getTimeout().toMillis() + " ms", e);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause() != null ? e.getCause() : e;
            for (Throwable t = cause; t != null; t = t.getCause()) {
                if (t instanceof IskraException) {
                    throw (IskraException) t;
                }
            }
            // A refused connection has no message, only its type.
            String reason = cause.getMessage() != null ? cause.getMessage() : cause.getClass().getSimpleName();
            throw new IskraException("HTTP request failed: " + reason, cause);
        }
        if (response.statusCode() >= 400 && !okStatuses.contains(response.statusCode())) {
            throw toException(response);
        }
        return response;
    }

    /**
     * Reads the body into a byte array, failing with an {@link IskraException}
     * as soon as it is known to exceed {@code limit}: from a larger declared
     * Content-Length, or once the bytes received pass it.
     */
    static HttpResponse.BodyHandler<byte[]> limitedBody(long limit) {
        return info -> new LimitedBodySubscriber(limit, info.headers().firstValueAsLong("Content-Length"));
    }

    private static IskraException tooLarge(long limit) {
        return new IskraException("HTTP response larger than maxResponseBytes (" + limit + " bytes)", 0);
    }

    private static final class LimitedBodySubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final long limit;
        private final OptionalLong declaredLength;
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private final ByteArrayOutputStream body = new ByteArrayOutputStream();
        private Flow.Subscription subscription;
        private long received;

        LimitedBodySubscriber(long limit, OptionalLong declaredLength) {
            this.limit = limit;
            this.declaredLength = declaredLength;
        }

        @Override
        public CompletionStage<byte[]> getBody() {
            return result;
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            if (declaredLength.isPresent() && declaredLength.getAsLong() > limit) {
                fail();
                return;
            }
            subscription.request(Long.MAX_VALUE);
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            if (result.isDone()) {
                return;
            }
            for (ByteBuffer buffer : buffers) {
                received += buffer.remaining();
                if (received > limit) {
                    fail();
                    return;
                }
                byte[] chunk = new byte[buffer.remaining()];
                buffer.get(chunk);
                body.write(chunk, 0, chunk.length);
            }
        }

        @Override
        public void onError(Throwable error) {
            result.completeExceptionally(error);
        }

        @Override
        public void onComplete() {
            result.complete(body.toByteArray());
        }

        private void fail() {
            subscription.cancel();
            result.completeExceptionally(tooLarge(limit));
        }
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
        Duration retryAfter = status == 429
                ? RateLimitException.parseRetryAfter(response.headers().firstValue("Retry-After").orElse(null))
                : null;
        return IskraException.fromErrorResponse(status, error, retryAfter);
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
