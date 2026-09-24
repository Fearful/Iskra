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
    void theConfigKeepsItsOwnCopyOfTheHeaders() {
        IskraConfig.Builder builder = IskraConfig.builder("http://localhost").header("X-A", "1");
        IskraConfig config = builder.build();
        builder.header("X-B", "2");
        assertEquals(Map.of("X-A", "1"), config.getHeaders());
        assertFalse(config.getHeaders().containsKey("X-B"));
    }
}
