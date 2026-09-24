package dev.iskra.client.response;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class ErrorResponse {

    @JsonProperty("success")
    private boolean success;

    @JsonProperty("error")
    private String error;

    @JsonProperty("message")
    private String message;

    @JsonProperty("context")
    private Object context;

    @JsonProperty("code")
    private String code;

    @JsonProperty("details")
    private Object details;

    @JsonProperty("timestamp")
    private String timestamp;

    @JsonProperty("requestId")
    private String requestId;

    public ErrorResponse() {}

    public boolean isSuccess() {
        return success;
    }

    public String getError() {
        return error;
    }

    public String getMessage() {
        return message;
    }

    public Object getContext() {
        return context;
    }

    public String getCode() {
        return code;
    }

    public Object getDetails() {
        return details;
    }

    public String getTimestamp() {
        return timestamp;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public void setError(String error) {
        this.error = error;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public void setContext(Object context) {
        this.context = context;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public void setDetails(Object details) {
        this.details = details;
    }

    public void setTimestamp(String timestamp) {
        this.timestamp = timestamp;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }
}
