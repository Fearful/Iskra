package dev.iskra.client.exception;

public class ForbiddenException extends IskraException {

    public ForbiddenException(String message, String errorCode, Object details, String requestId) {
        super(message, 403, errorCode, details, requestId);
    }
}
