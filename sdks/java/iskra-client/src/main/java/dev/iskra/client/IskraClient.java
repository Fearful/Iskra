package dev.iskra.client;

import com.fasterxml.jackson.core.type.TypeReference;
import dev.iskra.client.auth.AuthClient;
import dev.iskra.client.health.HealthClient;
import dev.iskra.client.http.HttpClientWrapper;
import dev.iskra.client.response.IskraResponse;
import dev.iskra.client.storage.StorageClient;

import java.time.Duration;

public class IskraClient {

    private final IskraConfig config;
    private final HttpClientWrapper http;
    private final AuthClient authClient;
    private final HealthClient healthClient;
    private final StorageClient storageClient;

    private IskraClient(IskraConfig config) {
        this.config = config;
        this.http = new HttpClientWrapper(config);
        this.authClient = new AuthClient(http, config);
        this.healthClient = new HealthClient(http);
        this.storageClient = new StorageClient(http);
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

    public <T> IskraResponse<T> post(String path, Object body, Class<T> responseType) {
        return http.post(path, body, responseType);
    }

    public <T> IskraResponse<T> put(String path, Object body, Class<T> responseType) {
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

        public IskraClient build() {
            return new IskraClient(configBuilder.build());
        }
    }
}
