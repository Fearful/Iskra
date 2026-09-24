package dev.iskra.client;

import java.time.Duration;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class IskraConfig {

    private final String baseUrl;
    private final String apiKey;
    private final Duration timeout;
    private final Map<String, String> headers;
    private final String authBasePath;
    private final String origin;
    private final String storageRoutePrefix;

    private IskraConfig(Builder builder) {
        this.baseUrl = builder.baseUrl;
        this.apiKey = builder.apiKey;
        this.timeout = builder.timeout;
        this.headers = Collections.unmodifiableMap(builder.headers);
        this.authBasePath = builder.authBasePath;
        this.origin = builder.origin;
        this.storageRoutePrefix = builder.storageRoutePrefix;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public String getApiKey() {
        return apiKey;
    }

    public Duration getTimeout() {
        return timeout;
    }

    public Map<String, String> getHeaders() {
        return headers;
    }

    public String getAuthBasePath() {
        return authBasePath;
    }

    /** Origin sent with session requests; null means the origin of the base URL. */
    public String getOrigin() {
        return origin;
    }

    public String getStorageRoutePrefix() {
        return storageRoutePrefix;
    }

    public static Builder builder(String baseUrl) {
        return new Builder(baseUrl);
    }

    public static class Builder {
        private final String baseUrl;
        private String apiKey;
        private Duration timeout = Duration.ofSeconds(30);
        private final Map<String, String> headers = new HashMap<>();
        private String authBasePath = "/api/sso";
        private String origin;
        private String storageRoutePrefix = "/upload";

        private Builder(String baseUrl) {
            if (baseUrl == null || baseUrl.isEmpty()) {
                throw new IllegalArgumentException("baseUrl is required");
            }
            this.baseUrl = baseUrl;
        }

        public Builder apiKey(String apiKey) {
            this.apiKey = apiKey;
            return this;
        }

        public Builder timeout(Duration timeout) {
            this.timeout = timeout;
            return this;
        }

        public Builder header(String name, String value) {
            this.headers.put(name, value);
            return this;
        }

        public Builder authBasePath(String authBasePath) {
            this.authBasePath = authBasePath;
            return this;
        }

        /**
         * Origin sent with requests that carry a user's session. Better Auth
         * rejects cookie-authenticated POSTs without a trusted Origin; set this
         * when the service's AuthFeature {@code baseURL} differs from the base
         * URL used here (or add that URL to {@code trustedOrigins}).
         */
        public Builder origin(String origin) {
            this.origin = origin;
            return this;
        }

        /** The {@code routePrefix} of the service's UploadFeature (default /upload). */
        public Builder storageRoutePrefix(String storageRoutePrefix) {
            this.storageRoutePrefix = storageRoutePrefix;
            return this;
        }

        public IskraConfig build() {
            return new IskraConfig(this);
        }
    }
}
