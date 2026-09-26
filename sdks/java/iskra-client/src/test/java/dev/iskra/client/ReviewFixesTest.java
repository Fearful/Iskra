package dev.iskra.client;

import com.sun.net.httpserver.HttpServer;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.storage.StorageClient;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewFixesTest {

    @Test
    void dotSegmentsAreRejectedInStoragePaths() {
        // Resolved by URI normalization, "../contract" left the upload routes
        // with the API key and the session cookie.
        StorageClient storage = ContractServer.client().storage();
        assertThrows(IllegalArgumentException.class, () -> storage.download(".."));
        assertThrows(IllegalArgumentException.class, () -> storage.download("x", "../contract"));
        assertThrows(IllegalArgumentException.class, () -> storage.delete("x", "a/./b"));
    }

    @Test
    void aPathMustStartWithASlash() {
        // Concatenated to the base URL, "@other-host/x" became the host.
        IskraClient iskra = ContractServer.client();
        assertThrows(IllegalArgumentException.class, () -> iskra.get("@example.com/x", Object.class));
        assertThrows(IllegalArgumentException.class, () -> iskra.get("contract/raw", Object.class));
    }

    @Test
    void theTimeoutCoversTheResponseBody() throws Exception {
        // Headers at once, then a body that never finishes: HttpRequest.timeout()
        // stops at the headers, so this blocked forever.
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/slow", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 100);
            OutputStream body = exchange.getResponseBody();
            body.write("{\"a\":".getBytes());
            body.flush();
            try {
                Thread.sleep(3_000);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            exchange.close();
        });
        server.start();
        try {
            IskraClient iskra = IskraClient.builder("http://127.0.0.1:" + server.getAddress().getPort())
                    .timeout(Duration.ofMillis(500))
                    .build();
            long started = System.nanoTime();
            IskraException error = assertThrows(IskraException.class, () -> iskra.get("/slow", Object.class));
            assertTrue(error.getMessage().contains("timed out"), error.getMessage());
            assertTrue(System.nanoTime() - started < 5_000_000_000L);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void aResponseLargerThanMaxResponseBytesIsRefused() throws Exception {
        // The whole body was read into memory, whatever its size.
        byte[] big = new byte[4096];
        java.util.Arrays.fill(big, (byte) 'a');
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/declared", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, big.length); // Content-Length: 4096
            try (OutputStream body = exchange.getResponseBody()) {
                body.write(big);
            }
        });
        server.createContext("/chunked", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, 0); // chunked: no Content-Length
            try (OutputStream body = exchange.getResponseBody()) {
                for (int i = 0; i < 4; i++) {
                    body.write(big, 0, 1024);
                    body.flush();
                }
            }
        });
        server.createContext("/small", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "text/plain");
            exchange.sendResponseHeaders(200, 0);
            try (OutputStream body = exchange.getResponseBody()) {
                body.write(big, 0, 1000);
            }
        });
        server.start();
        try {
            IskraClient iskra = IskraClient.builder("http://127.0.0.1:" + server.getAddress().getPort())
                    .maxResponseBytes(1024)
                    .build();
            for (String path : new String[] {"/declared", "/chunked"}) {
                IskraException error = assertThrows(IskraException.class, () -> iskra.get(path, String.class));
                assertEquals("HTTP response larger than maxResponseBytes (1024 bytes)", error.getMessage(), path);
            }
            assertEquals(1000, iskra.get("/small", String.class).getData().length());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void maxResponseBytesMustBePositive() {
        assertEquals(10L * 1024 * 1024, IskraConfig.builder("http://localhost").build().getMaxResponseBytes());
        assertThrows(IllegalArgumentException.class, () -> IskraConfig.builder("http://localhost").maxResponseBytes(0));
        assertThrows(IllegalArgumentException.class, () -> IskraClient.builder("http://localhost").maxResponseBytes(-1));
    }

    @Test
    void theConfigKeepsItsOwnCopyOfTheHeaders() {
        IskraConfig.Builder builder = IskraConfig.builder("http://localhost").header("X-A", "1");
        IskraConfig config = builder.build();
        builder.header("X-B", "2");
        assertEquals(Map.of("X-A", "1"), config.getHeaders());
        assertFalse(config.getHeaders().containsKey("X-B"));
    }
}
