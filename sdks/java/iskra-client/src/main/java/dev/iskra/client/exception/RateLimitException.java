package dev.iskra.client.exception;

public class RateLimitException extends IskraException {

    public RateLimitException(String message, String errorCode, Object details, String requestId) {
        super(message, 429, errorCode, details, requestId);
    }
}
