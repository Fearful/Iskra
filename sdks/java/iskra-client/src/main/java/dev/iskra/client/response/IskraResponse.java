package dev.iskra.client.response;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class IskraResponse<T> {

    @JsonProperty("success")
    private boolean success;

    @JsonProperty("data")
    private T data;

    @JsonProperty("message")
    private String message;

    @JsonIgnore
    private int statusCode;

    public IskraResponse() {}

    public IskraResponse(boolean success, T data, String message) {
        this(success, data, message, 0);
    }

    public IskraResponse(boolean success, T data, String message, int statusCode) {
        this.success = success;
        this.data = data;
        this.message = message;
        this.statusCode = statusCode;
    }

    public boolean isSuccess() {
        return success;
    }

    public T getData() {
        return data;
    }

    public String getMessage() {
        return message;
    }

    /** The HTTP status of the response. */
    public int getStatusCode() {
        return statusCode;
    }

    public void setSuccess(boolean success) {
        this.success = success;
    }

    public void setData(T data) {
        this.data = data;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
