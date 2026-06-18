package dev.iskra.client.exception;

public class ValidationException extends IskraException {

    public ValidationException(String message, String errorCode, Object details, String requestId) {
        super(message, 400, errorCode, details, requestId);
    }
}
