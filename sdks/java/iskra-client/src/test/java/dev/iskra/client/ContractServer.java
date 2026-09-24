package dev.iskra.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Starts the real Iskra contract server (sdks/contract/server.ts) once per
 * test JVM, with Bun ($BUN or {@code bun} on PATH). Set ISKRA_CONTRACT_URL to
 * test against a server that is already running.
 */
final class ContractServer {

    private static final String READY = "ISKRA_CONTRACT_READY ";
    private static String baseUrl;

    private ContractServer() {}

    static synchronized String baseUrl() {
        if (baseUrl == null) {
            baseUrl = start();
        }
        return baseUrl;
    }

    static IskraClient client() {
        return IskraClient.builder(baseUrl()).build();
    }

    private static String start() {
        String external = System.getenv("ISKRA_CONTRACT_URL");
        if (external != null && !external.isEmpty()) {
            return external.replaceAll("/+$", "");
        }
        String bun = findBun();
        Assumptions.assumeTrue(bun != null, "bun not found: set BUN or ISKRA_CONTRACT_URL to run the contract tests");

        Path repoRoot = Paths.get(System.getProperty("iskra.repoRoot", "../../..")).toAbsolutePath().normalize();
        ProcessBuilder builder = new ProcessBuilder(bun, "run", repoRoot.resolve("sdks/contract/server.ts").toString())
                .directory(repoRoot.toFile())
                .redirectErrorStream(true);
        builder.environment().put("CONTRACT_EXIT_ON_STDIN_EOF", "1"); // exits if this JVM dies
        Process process;
        try {
            process = builder.start();
        } catch (IOException e) {
            throw new IllegalStateException("could not start the contract server", e);
        }
        Runtime.getRuntime().addShutdownHook(new Thread(process::destroy));

        StringBuilder output = new StringBuilder();
        CompletableFuture<String> ready = new CompletableFuture<>();
        Thread pump = new Thread(() -> {
            // Keep draining: a full pipe would block the server's logging.
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    synchronized (output) {
                        output.append(line).append('\n');
                    }
                    if (line.startsWith(READY)) {
                        ready.complete(line.substring(READY.length()));
                    }
                }
            } catch (IOException ignored) {
                // process ended
            }
            ready.completeExceptionally(new IllegalStateException("contract server exited"));
        }, "contract-server-output");
        pump.setDaemon(true);
        pump.start();

        try {
            String json = ready.get(30, TimeUnit.SECONDS);
            return new ObjectMapper().readTree(json).get("baseUrl").asText();
        } catch (TimeoutException | java.util.concurrent.ExecutionException | IOException e) {
            process.destroy();
            synchronized (output) {
                throw new IllegalStateException("contract server did not start:\n" + output, e);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroy();
            throw new IllegalStateException("interrupted while starting the contract server", e);
        }
    }

    private static String findBun() {
        String bun = System.getenv("BUN");
        if (bun != null && !bun.isEmpty()) {
            return bun;
        }
        String path = System.getenv("PATH");
        if (path == null) {
            return null;
        }
        for (String dir : path.split(File.pathSeparator)) {
            File candidate = new File(dir, "bun");
            if (candidate.canExecute()) {
                return candidate.getAbsolutePath();
            }
        }
        return null;
    }
}
