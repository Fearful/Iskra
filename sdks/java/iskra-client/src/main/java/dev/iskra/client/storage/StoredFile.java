package dev.iskra.client.storage;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class StoredFile {

    @JsonProperty("name")
    private String name;

    @JsonProperty("path")
    private String path;

    @JsonProperty("size")
    private long size;

    @JsonProperty("mimeType")
    private String mimeType;

    @JsonProperty("lastModified")
    private String lastModified;

    @JsonProperty("url")
    private String url;

    public String getName() { return name; }
    public String getPath() { return path; }
    public long getSize() { return size; }
    public String getMimeType() { return mimeType; }
    public String getLastModified() { return lastModified; }
    public String getUrl() { return url; }

    public void setName(String name) { this.name = name; }
    public void setPath(String path) { this.path = path; }
    public void setSize(long size) { this.size = size; }
    public void setMimeType(String mimeType) { this.mimeType = mimeType; }
    public void setLastModified(String lastModified) { this.lastModified = lastModified; }
    public void setUrl(String url) { this.url = url; }
}
