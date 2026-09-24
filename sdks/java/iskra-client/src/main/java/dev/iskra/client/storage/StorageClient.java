package dev.iskra.client.storage;

import com.fasterxml.jackson.databind.JsonNode;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.http.HttpClientWrapper;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URLConnection;
import java.net.URLEncoder;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Client for the routes {@code UploadFeature} exposes ({@code exposeRoutes: true}).
 *
 * <p>Those routes go through the feature's {@code authorize} callback, which
 * usually requires a signed-in user: call them on {@code iskra.withSession(session)}.
 */
public class StorageClient {

    private final HttpClientWrapper http;
    private final String routePrefix;

    public StorageClient(HttpClientWrapper http) {
        this(http, "/upload");
    }

    public StorageClient(HttpClientWrapper http, String routePrefix) {
        this.http = http;
        this.routePrefix = "/" + routePrefix.replaceAll("^/+|/+$", "");
    }

    public String getRoutePrefix() {
        return routePrefix;
    }

    /** A StorageClient for an UploadFeature mounted at another {@code routePrefix}. */
    public StorageClient withRoutePrefix(String routePrefix) {
        return new StorageClient(http, routePrefix);
    }

    // --- Upload ---

    public UploadedFile upload(Path file) {
        return upload(file, null, null);
    }

    public UploadedFile upload(Path file, String name) {
        return upload(file, name, null);
    }

    /** Uploads {@code file} as {@code name} (defaults to the file's name) under the optional subfolder. */
    public UploadedFile upload(Path file, String name, String subfolder) {
        try {
            return upload(Files.readAllBytes(file), name != null ? name : file.getFileName().toString(), subfolder);
        } catch (IOException e) {
            throw new IskraException("Could not read " + file + ": " + e.getMessage(), e);
        }
    }

    public UploadedFile upload(byte[] data, String name, String subfolder) {
        if (name == null || name.isEmpty()) {
            throw new IllegalArgumentException("name is required");
        }
        String boundary = "IskraBoundary" + UUID.randomUUID().toString().replace("-", "");
        String contentType = URLConnection.guessContentTypeFromName(name);
        ByteArrayOutputStream body = new ByteArrayOutputStream(data.length + 256);
        writeUtf8(body, "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"" + quoteFilename(name) + "\"\r\n"
                + "Content-Type: " + (contentType != null ? contentType : "application/octet-stream") + "\r\n\r\n");
        body.write(data, 0, data.length);
        writeUtf8(body, "\r\n--" + boundary + "--\r\n");

        JsonNode result = http.readJson(http.send(
                "POST",
                routePrefix + query(subfolder),
                HttpRequest.BodyPublishers.ofByteArray(body.toByteArray()),
                "multipart/form-data; boundary=" + boundary
        ));
        return result == null ? new UploadedFile() : http.convert(result, UploadedFile.class);
    }

    // --- List / download / delete ---

    public List<StoredFile> list() {
        return list(null);
    }

    /** Files under the project (or {@code subfolder}), including nested folders. */
    public List<StoredFile> list(String subfolder) {
        JsonNode body = http.readJson(http.send("GET", routePrefix + query(subfolder), null, null));
        List<StoredFile> files = new ArrayList<>();
        if (body != null && body.path("files").isArray()) {
            for (JsonNode file : body.get("files")) {
                files.add(http.convert(file, StoredFile.class));
            }
        }
        return files;
    }

    public byte[] download(String name) {
        return download(name, null);
    }

    public byte[] download(String name, String subfolder) {
        return http.send("GET", filePath(name, subfolder), null, null).body();
    }

    public void delete(String name) {
        delete(name, null);
    }

    public void delete(String name, String subfolder) {
        http.send("DELETE", filePath(name, subfolder), null, null);
    }

    // --- Helpers ---

    private String filePath(String name, String subfolder) {
        StringBuilder path = new StringBuilder(routePrefix);
        if (subfolder != null) {
            for (String segment : subfolder.split("/")) {
                if (!segment.isEmpty()) {
                    path.append('/').append(encode(checkSegment(segment)));
                }
            }
        }
        return path.append('/').append(encode(checkSegment(name))).toString();
    }

    /**
     * "." and ".." are resolved by URI normalization: "../api/admin" left the
     * upload routes and sent the API key and session cookie to another route.
     */
    private static String checkSegment(String segment) {
        if (segment == null || segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
            throw new IllegalArgumentException("Invalid file name or subfolder segment: \"" + segment + "\"");
        }
        return segment;
    }

    private static String query(String subfolder) {
        return subfolder == null || subfolder.isEmpty() ? "" : "?subfolder=" + encode(subfolder);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /**
     * Keeps a filename from breaking out of the quoted Content-Disposition
     * parameter, the way browsers do (WHATWG multipart/form-data encoding):
     * {@code "} and CR/LF are percent-encoded. Backslash escapes are not
     * understood by servers (Bun keeps the backslash).
     */
    private static String quoteFilename(String name) {
        return name.replace("\"", "%22").replace("\r", "%0D").replace("\n", "%0A");
    }

    private static void writeUtf8(ByteArrayOutputStream out, String text) {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        out.write(bytes, 0, bytes.length);
    }
}
