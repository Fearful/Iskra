package dev.iskra.client.exception;

public class AuthException extends IskraException {

    public AuthException(String message, String errorCode, Object details, String requestId) {
        super(message, 401, errorCode, details, requestId);
    }
}
