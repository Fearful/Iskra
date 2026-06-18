package dev.iskra.client.http;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.iskra.client.IskraConfig;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.response.ErrorResponse;
import dev.iskra.client.response.IskraResponse;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;

public class HttpClientWrapper {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final IskraConfig config;

    public HttpClientWrapper(IskraConfig config) {
        this.config = config;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(config.getTimeout())
                .build();
        this.objectMapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public <T> IskraResponse<T> get(String path, Class<T> responseType) {
        HttpRequest request = buildRequest(path)
                .GET()
                .build();
        return execute(request, responseType);
    }

    public <T> IskraResponse<T> get(String path, TypeReference<T> responseType) {
        HttpRequest request = buildRequest(path)
                .GET()
                .build();
        return execute(request, responseType);
    }

    public <T> IskraResponse<T> post(String path, Object body, Class<T> responseType) {
        HttpRequest request = buildRequest(path)
                .POST(jsonBody(body))
                .header("Content-Type", "application/json")
                .build();
        return execute(request, responseType);
    }

    public <T> IskraResponse<T> put(String path, Object body, Class<T> responseType) {
        HttpRequest request = buildRequest(path)
                .PUT(jsonBody(body))
                .header("Content-Type", "application/json")
                .build();
        return execute(request, responseType);
    }

    public <T> IskraResponse<T> delete(String path, Class<T> responseType) {
        HttpRequest request = buildRequest(path)
                .DELETE()
                .build();
        return execute(request, responseType);
    }

    public byte[] getBytes(String path) {
        HttpRequest request = buildRequest(path)
                .GET()
                .build();
        try {
            HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
            if (response.statusCode() >= 400) {
                handleError(response.statusCode(), new String(response.body()));
            }
            return response.body();
        } catch (IOException | InterruptedException e) {
            throw new IskraException("HTTP request failed: " + e.getMessage(), e);
        }
    }

    public <T> IskraResponse<T> uploadFile(String path, Path filePath, String fileName) {
        String boundary = "----IskraBoundary" + System.currentTimeMillis();
        try {
            byte[] fileBytes = java.nio.file.Files.readAllBytes(filePath);

            String prefix = "--" + boundary + "\r\n" +
                    "Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n" +
                    "Content-Type: application/octet-stream\r\n\r\n";
            String suffix = "\r\n--" + boundary + "--\r\n";

            byte[] prefixBytes = prefix.getBytes();
            byte[] suffixBytes = suffix.getBytes();
            byte[] body = new byte[prefixBytes.length + fileBytes.length + suffixBytes.length];
            System.arraycopy(prefixBytes, 0, body, 0, prefixBytes.length);
            System.arraycopy(fileBytes, 0, body, prefixBytes.length, fileBytes.length);
            System.arraycopy(suffixBytes, 0, body, prefixBytes.length + fileBytes.length, suffixBytes.length);

            HttpRequest request = buildRequest(path)
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                    .build();

            @SuppressWarnings("unchecked")
            IskraResponse<T> result = (IskraResponse<T>) execute(request, Object.class);
            return result;
        } catch (IOException e) {
            throw new IskraException("File upload failed: " + e.getMessage(), e);
        }
    }

    private HttpRequest.Builder buildRequest(String path) {
        String url = config.getBaseUrl().replaceAll("/$", "") + path;
        HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(config.getTimeout());

        if (config.getApiKey() != null) {
            builder.header("X-API-Key", config.getApiKey());
        }

        Map<String, String> headers = config.getHeaders();
        if (headers != null) {
            headers.forEach(builder::header);
        }

        return builder;
    }

    private HttpRequest.BodyPublisher jsonBody(Object body) {
        if (body == null) {
            return HttpRequest.BodyPublishers.noBody();
        }
        try {
            return HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body));
        } catch (IOException e) {
            throw new IskraException("Failed to serialize request body", e);
        }
    }

    private <T> IskraResponse<T> execute(HttpRequest request, Class<T> responseType) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() >= 400) {
                handleError(response.statusCode(), response.body());
            }

            if (response.body() == null || response.body().isEmpty()) {
                return new IskraResponse<>(true, null, null);
            }

            JavaType type = objectMapper.getTypeFactory()
                    .constructParametricType(IskraResponse.class, responseType);
            return objectMapper.readValue(response.body(), type);
        } catch (IskraException e) {
            throw e;
        } catch (IOException | InterruptedException e) {
            throw new IskraException("HTTP request failed: " + e.getMessage(), e);
        }
    }

    private <T> IskraResponse<T> execute(HttpRequest request, TypeReference<T> responseType) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() >= 400) {
                handleError(response.statusCode(), response.body());
            }

            if (response.body() == null || response.body().isEmpty()) {
                return new IskraResponse<>(true, null, null);
            }

            JavaType innerType = objectMapper.getTypeFactory().constructType(responseType.getType());
            JavaType type = objectMapper.getTypeFactory()
                    .constructParametricType(IskraResponse.class, innerType);
            return objectMapper.readValue(response.body(), type);
        } catch (IskraException e) {
            throw e;
        } catch (IOException | InterruptedException e) {
            throw new IskraException("HTTP request failed: " + e.getMessage(), e);
        }
    }

    private void handleError(int statusCode, String responseBody) {
        try {
            ErrorResponse errorResponse = objectMapper.readValue(responseBody, ErrorResponse.class);
            throw IskraException.fromErrorResponse(statusCode, errorResponse);
        } catch (IskraException e) {
            throw e;
        } catch (Exception e) {
            throw new IskraException(
                    "HTTP " + statusCode + ": " + (responseBody != null ? responseBody : "Unknown error"),
                    statusCode
            );
        }
    }

    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}
