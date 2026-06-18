package dev.iskra.client.exception;

public class NotFoundException extends IskraException {

    public NotFoundException(String message, String errorCode, Object details, String requestId) {
        super(message, 404, errorCode, details, requestId);
    }
}
