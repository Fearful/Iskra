package dev.iskra.client;

import com.fasterxml.jackson.core.type.TypeReference;
import dev.iskra.client.auth.AuthClient;
import dev.iskra.client.auth.Session;
import dev.iskra.client.auth.Sessions;
import dev.iskra.client.health.HealthClient;
import dev.iskra.client.http.HttpClientWrapper;
import dev.iskra.client.response.IskraResponse;
import dev.iskra.client.storage.StorageClient;

import java.time.Duration;
import java.util.Map;

/**
 * Entry point of the SDK. An instance is thread-safe and never stores cookies,
 * so one client can serve every user of a backend; act as a user with
 * {@link #withSession(Session)}.
 */
public class IskraClient {

    private final IskraConfig config;
    private final HttpClientWrapper http;
    private final AuthClient authClient;
    private final HealthClient healthClient;
    private final StorageClient storageClient;

    private IskraClient(IskraConfig config) {
        this(new HttpClientWrapper(config));
    }

    private IskraClient(HttpClientWrapper http) {
        this.config = http.getConfig();
        this.http = http;
        this.authClient = new AuthClient(http, config);
        this.healthClient = new HealthClient(http);
        this.storageClient = new StorageClient(http, config.getStorageRoutePrefix());
    }

    /**
     * A client that makes every request as the user of {@code session} (from
     * {@code auth().signIn()} / {@code signUp()}). It shares this client's
     * connections.
     */
    public IskraClient withSession(Session session) {
        return withSession(Sessions.cookieOf(session));
    }

    /** Same as {@link #withSession(Session)} for a stored {@link Session#getCookie()} value. */
    public IskraClient withSession(String sessionCookie) {
        if (sessionCookie == null || sessionCookie.isEmpty()) {
            throw new IllegalArgumentException("sessionCookie is required");
        }
        return new IskraClient(http.withCookie(sessionCookie));
    }

    public static Builder builder(String baseUrl) {
        return new Builder(baseUrl);
    }

    // --- Sub-clients ---

    public AuthClient auth() {
        return authClient;
    }

    public HealthClient health() {
        return healthClient;
    }

    public StorageClient storage() {
        return storageClient;
    }

    // --- Generic HTTP methods for custom routes ---

    public <T> IskraResponse<T> get(String path, Class<T> responseType) {
        return http.get(path, responseType);
    }

    public <T> IskraResponse<T> get(String path, TypeReference<T> responseType) {
        return http.get(path, responseType);
    }

    /**
     * GET with {@code query} appended to the path, UTF-8 percent-encoded: null
     * values are left out and a collection or array repeats its key.
     */
    public <T> IskraResponse<T> get(String path, Map<String, ?> query, Class<T> responseType) {
        return http.get(path, query, responseType);
    }

    public <T> IskraResponse<T> get(String path, Map<String, ?> query, TypeReference<T> responseType) {
        return http.get(path, query, responseType);
    }

    public <T> IskraResponse<T> post(String path, Object body, Class<T> responseType) {
        return http.post(path, body, responseType);
    }

    public <T> IskraResponse<T> post(String path, Object body, TypeReference<T> responseType) {
        return http.post(path, body, responseType);
    }

    public <T> IskraResponse<T> put(String path, Object body, Class<T> responseType) {
        return http.put(path, body, responseType);
    }

    public <T> IskraResponse<T> put(String path, Object body, TypeReference<T> responseType) {
        return http.put(path, body, responseType);
    }

    public <T> IskraResponse<T> delete(String path, Class<T> responseType) {
        return http.delete(path, responseType);
    }

    public IskraConfig getConfig() {
        return config;
    }

    // --- Builder ---

    public static class Builder {
        private final IskraConfig.Builder configBuilder;

        private Builder(String baseUrl) {
            this.configBuilder = IskraConfig.builder(baseUrl);
        }

        public Builder apiKey(String apiKey) {
            configBuilder.apiKey(apiKey);
            return this;
        }

        public Builder timeout(Duration timeout) {
            configBuilder.timeout(timeout);
            return this;
        }

        public Builder header(String name, String value) {
            configBuilder.header(name, value);
            return this;
        }

        public Builder authBasePath(String authBasePath) {
            configBuilder.authBasePath(authBasePath);
            return this;
        }

        /** See {@link IskraConfig.Builder#origin(String)}. */
        public Builder origin(String origin) {
            configBuilder.origin(origin);
            return this;
        }

        public Builder storageRoutePrefix(String storageRoutePrefix) {
            configBuilder.storageRoutePrefix(storageRoutePrefix);
            return this;
        }

        /** See {@link IskraConfig.Builder#maxResponseBytes(long)}. */
        public Builder maxResponseBytes(long maxResponseBytes) {
            configBuilder.maxResponseBytes(maxResponseBytes);
            return this;
        }

        public IskraClient build() {
            return new IskraClient(configBuilder.build());
        }
    }
}
