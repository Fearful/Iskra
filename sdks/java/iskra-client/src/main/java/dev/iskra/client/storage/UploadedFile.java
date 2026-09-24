package dev.iskra.client.storage;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * What the service stored for an upload. {@link #getFilename()} is the name it
 * actually used: the service reduces names to {@code [A-Za-z0-9._-]}.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class UploadedFile {

    @JsonProperty("path")
    private String path;

    @JsonProperty("filename")
    private String filename;

    @JsonProperty("size")
    private long size;

    @JsonProperty("uploadedAt")
    private String uploadedAt;

    public String getPath() { return path; }
    public String getFilename() { return filename; }
    public long getSize() { return size; }
    public String getUploadedAt() { return uploadedAt; }

    public void setPath(String path) { this.path = path; }
    public void setFilename(String filename) { this.filename = filename; }
    public void setSize(long size) { this.size = size; }
    public void setUploadedAt(String uploadedAt) { this.uploadedAt = uploadedAt; }
}
