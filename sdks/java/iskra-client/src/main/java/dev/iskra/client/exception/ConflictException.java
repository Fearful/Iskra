package dev.iskra.client.exception;

public class ConflictException extends IskraException {

    public ConflictException(String message, String errorCode, Object details, String requestId) {
        super(message, 409, errorCode, details, requestId);
    }
}
