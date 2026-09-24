package dev.iskra.client;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HealthClientTest {

    private final IskraClient iskra = ContractServer.client();

    @Test
    void checkReturnsTheBody() {
        Map<String, Object> health = iskra.health().check();
        assertEquals("ok", health.get("status"));
        assertNotNull(health.get("timestamp"));
        assertTrue(iskra.health().isHealthy());
    }

    @Test
    void checkReturnsTheErrorBodyOn503() {
        iskra.post("/contract/health", Map.of("healthy", false), Object.class);
        try {
            assertEquals("error", iskra.health().check().get("status"));
            assertFalse(iskra.health().isHealthy());
        } finally {
            iskra.post("/contract/health", Map.of("healthy", true), Object.class);
        }
    }

    @Test
    void readyAndLive() {
        assertEquals("ready", iskra.health().ready().get("status"));
        assertEquals("alive", iskra.health().live().get("status"));
    }
}
