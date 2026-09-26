package dev.iskra.client.exception;

import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Optional;

public class RateLimitException extends IskraException {

    private final Duration retryAfter;

    public RateLimitException(String message, String errorCode, Object details, String requestId) {
        this(message, errorCode, details, requestId, null);
    }

    public RateLimitException(String message, String errorCode, Object details, String requestId,
                              Duration retryAfter) {
        super(message, 429, errorCode, details, requestId);
        this.retryAfter = retryAfter;
    }

    /**
     * How long to wait before retrying, from the response's {@code Retry-After}
     * header; empty when it is absent or invalid.
     */
    public Optional<Duration> getRetryAfter() {
        return Optional.ofNullable(retryAfter);
    }

    /**
     * A {@code Retry-After} value (delay in seconds or an HTTP-date) as the
     * time from now, never negative; null when absent or invalid.
     */
    public static Duration parseRetryAfter(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        if (trimmed.matches("[0-9]+")) {
            try {
                return Duration.ofSeconds(Long.parseLong(trimmed));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        try {
            Instant when = ZonedDateTime.parse(trimmed, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
            Duration delay = Duration.between(Instant.now(), when);
            return delay.isNegative() ? Duration.ZERO : delay;
        } catch (DateTimeException e) {
            return null;
        }
    }
}
