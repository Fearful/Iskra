package dev.iskra.client;

import com.fasterxml.jackson.core.type.TypeReference;
import dev.iskra.client.exception.AuthException;
import dev.iskra.client.exception.ConflictException;
import dev.iskra.client.exception.ForbiddenException;
import dev.iskra.client.exception.IskraException;
import dev.iskra.client.exception.NotFoundException;
import dev.iskra.client.exception.RateLimitException;
import dev.iskra.client.exception.ValidationException;
import dev.iskra.client.response.IskraResponse;
import org.junit.jupiter.api.Test;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RequestsTest {

    private final IskraClient iskra = ContractServer.client();

    public static class Items {
        public List<Integer> items;
    }

    @Test
    void successEnvelopeIsUnwrapped() {
        IskraResponse<Items> resp = iskra.get("/contract/envelope", Items.class);
        assertTrue(resp.isSuccess());
        assertEquals(List.of(1, 2, 3), resp.getData().items);
        assertEquals("listed", resp.getMessage());
        assertEquals(200, resp.getStatusCode());
    }

    @Test
    void plainJsonArraysBecomeData() {
        IskraResponse<List<Map<String, Integer>>> resp =
                iskra.get("/contract/raw", new TypeReference<List<Map<String, Integer>>>() {});
        assertEquals(List.of(Map.of("id", 1), Map.of("id", 2)), resp.getData());
    }

    @Test
    void textBodyIsDataForStringAndObject() {
        assertEquals("pong", iskra.get("/contract/text", String.class).getData());
        assertEquals("pong", iskra.get("/contract/text", Object.class).getData());
        assertThrows(IskraException.class, () -> iskra.get("/contract/text", Items.class));
    }

    @Test
    void postPutDelete() {
        assertEquals(Map.of("a", 1), iskra.post("/contract/echo", Map.of("a", 1), Map.class).getData());
        assertEquals(Map.of("b", 2), iskra.put("/contract/echo", Map.of("b", 2), Map.class).getData());
        IskraResponse<Object> deleted = iskra.delete("/contract/echo", Object.class);
        assertTrue(deleted.isSuccess());
        assertNull(deleted.getData());
        assertEquals(204, deleted.getStatusCode());
    }

    @Test
    void apiKeyAndCustomHeadersAreSent() {
        IskraClient client = IskraClient.builder(ContractServer.baseUrl())
                .apiKey("sk-test")
                .header("X-Custom", "yes")
                .build();
        assertEquals(Map.of("apiKey", "sk-test", "custom", "yes"), client.get("/contract/headers", Map.class).getData());
    }

    @Test
    void errorHandlerErrorsAreTyped() {
        NotFoundException e = assertThrows(NotFoundException.class, () -> iskra.get("/contract/not-found", Object.class));
        assertEquals("Widget not found", e.getMessage());
        assertEquals(404, e.getStatusCode());
        assertEquals("NOT_FOUND", e.getErrorCode());
    }

    @Test
    void validationDetailsAreExposed() {
        ValidationException e = assertThrows(ValidationException.class,
                () -> iskra.post("/contract/validate", null, Object.class));
        assertEquals("VALIDATION_ERROR", e.getErrorCode());
        assertEquals(Map.of("field", "name", "issue", "required"), e.getDetails());
    }

    @Test
    void unauthenticatedRoute() {
        assertThrows(AuthException.class, () -> iskra.get("/contract/me", Object.class));
    }

    @Test
    void forbiddenConflictAndRateLimitAreTyped() {
        ForbiddenException forbidden = assertThrows(ForbiddenException.class,
                () -> iskra.get("/contract/forbidden", Object.class));
        assertEquals("Not your widget", forbidden.getMessage());
        assertEquals(403, forbidden.getStatusCode());
        assertEquals("FORBIDDEN", forbidden.getErrorCode());

        ConflictException conflict = assertThrows(ConflictException.class,
                () -> iskra.post("/contract/conflict", null, Object.class));
        assertEquals("Widget already exists", conflict.getMessage());
        assertEquals(409, conflict.getStatusCode());
        assertEquals("CONFLICT", conflict.getErrorCode());

        RateLimitException limited = assertThrows(RateLimitException.class,
                () -> iskra.get("/contract/rate-limited", Object.class));
        assertEquals("Too many requests", limited.getMessage());
        assertEquals(429, limited.getStatusCode());
    }

    @Test
    void rateLimitExposesRetryAfter() {
        assertEquals(Optional.of(Duration.ofSeconds(7)), rateLimited("").getRetryAfter());

        String inTwoMinutes = DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now(ZoneOffset.UTC).plusSeconds(120));
        Duration delay = rateLimited("?retryAfter=" + URLEncoder.encode(inTwoMinutes, StandardCharsets.UTF_8))
                .getRetryAfter().orElseThrow();
        assertTrue(delay.getSeconds() > 100 && delay.getSeconds() <= 120, delay.toString());

        String aMinuteAgo = DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now(ZoneOffset.UTC).minusSeconds(60));
        assertEquals(Optional.of(Duration.ZERO),
                rateLimited("?retryAfter=" + URLEncoder.encode(aMinuteAgo, StandardCharsets.UTF_8)).getRetryAfter());
        for (String absentOrInvalid : List.of("", "soon", "-5")) {
            assertFalse(rateLimited("?retryAfter=" + absentOrInvalid).getRetryAfter().isPresent(), absentOrInvalid);
        }
    }

    private RateLimitException rateLimited(String query) {
        return assertThrows(RateLimitException.class, () -> iskra.get("/contract/rate-limited" + query, Object.class));
    }

    @Test
    void plainTextErrorBody() {
        NotFoundException e = assertThrows(NotFoundException.class,
                () -> iskra.get("/contract/does-not-exist", Object.class));
        assertTrue(e.getMessage().contains("Not Found"), e.getMessage());
    }

    @Test
    void interruptedCallsKeepTheInterruptFlag() {
        Thread.currentThread().interrupt();
        try {
            assertThrows(IskraException.class, () -> iskra.get("/contract/envelope", Object.class));
            assertTrue(Thread.currentThread().isInterrupted());
        } finally {
            Thread.interrupted();
        }
    }
}
