package dev.iskra.client.auth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Session {

    @JsonProperty("session")
    private SessionInfo session;

    @JsonProperty("user")
    private UserInfo user;

    public SessionInfo getSession() {
        return session;
    }

    public UserInfo getUser() {
        return user;
    }

    public void setSession(SessionInfo session) {
        this.session = session;
    }

    public void setUser(UserInfo user) {
        this.user = user;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class SessionInfo {

        @JsonProperty("id")
        private String id;

        @JsonProperty("expiresAt")
        private String expiresAt;

        @JsonProperty("token")
        private String token;

        public String getId() { return id; }
        public String getExpiresAt() { return expiresAt; }
        public String getToken() { return token; }

        public void setId(String id) { this.id = id; }
        public void setExpiresAt(String expiresAt) { this.expiresAt = expiresAt; }
        public void setToken(String token) { this.token = token; }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class UserInfo {

        @JsonProperty("id")
        private String id;

        @JsonProperty("email")
        private String email;

        @JsonProperty("name")
        private String name;

        @JsonProperty("image")
        private String image;

        public String getId() { return id; }
        public String getEmail() { return email; }
        public String getName() { return name; }
        public String getImage() { return image; }

        public void setId(String id) { this.id = id; }
        public void setEmail(String email) { this.email = email; }
        public void setName(String name) { this.name = name; }
        public void setImage(String image) { this.image = image; }
    }
}
