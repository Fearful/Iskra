package dev.iskra.client.exception;

import dev.iskra.client.response.ErrorResponse;

public class IskraException extends RuntimeException {

    private final int statusCode;
    private final String errorCode;
    private final Object details;
    private final String requestId;

    public IskraException(String message, int statusCode) {
        this(message, statusCode, null, null, null);
    }

    public IskraException(String message, int statusCode, String errorCode, Object details, String requestId) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.details = details;
        this.requestId = requestId;
    }

    public IskraException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = 0;
        this.errorCode = null;
        this.details = null;
        this.requestId = null;
    }

    /**
     * Maps an error response to a typed exception. The message comes from
     * {@code error} ({@code ErrorHandlerFeature}, {@code errorResponse()}) or
     * {@code message} (Better Auth, the Kernel's default handler).
     */
    public static IskraException fromErrorResponse(int statusCode, ErrorResponse response) {
        String message = response.getError() != null ? response.getError()
                : response.getMessage() != null ? response.getMessage()
                : "HTTP " + statusCode;
        String code = response.getCode();
        Object details = response.getDetails() != null ? response.getDetails() : response.getContext();
        String requestId = response.getRequestId();

        switch (statusCode) {
            case 400:
                return new ValidationException(message, code, details, requestId);
            case 401:
                return new AuthException(message, code, details, requestId);
            case 403:
                return new ForbiddenException(message, code, details, requestId);
            case 404:
                return new NotFoundException(message, code, details, requestId);
            case 409:
                return new ConflictException(message, code, details, requestId);
            case 429:
                return new RateLimitException(message, code, details, requestId);
            default:
                return new IskraException(message, statusCode, code, details, requestId);
        }
    }

    public int getStatusCode() {
        return statusCode;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public Object getDetails() {
        return details;
    }

    public String getRequestId() {
        return requestId;
    }
}
