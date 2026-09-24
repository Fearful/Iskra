package dev.iskra.client.auth;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * A Better Auth session. Maps both {@code {"session", "user"}} (get-session)
 * and {@code {"token", "user"}} (sign-in / sign-up) bodies.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Session {

    @JsonProperty("session")
    private SessionInfo session;

    @JsonProperty("user")
    private UserInfo user;

    @JsonIgnore
    private String cookie;

    public SessionInfo getSession() {
        return session;
    }

    public UserInfo getUser() {
        return user;
    }

    /**
     * The Cookie header value that authenticates as this session, captured
     * from the sign-in / sign-up response. Pass the Session (or this string) to
     * {@code IskraClient.withSession()} to make requests as the user. Keep it
     * server-side: it is as sensitive as the user's password.
     */
    public String getCookie() {
        return cookie;
    }

    public void setSession(SessionInfo session) {
        this.session = session;
    }

    public void setUser(UserInfo user) {
        this.user = user;
    }

    public void setCookie(String cookie) {
        this.cookie = cookie;
    }

    /** Sign-in / sign-up put the session token at the top level. */
    @JsonProperty("token")
    private void setTopLevelToken(String token) {
        if (token == null) {
            return;
        }
        if (session == null) {
            session = new SessionInfo();
        }
        if (session.getToken() == null) {
            session.setToken(token);
        }
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

        @JsonProperty("emailVerified")
        private boolean emailVerified;

        public String getId() { return id; }
        public String getEmail() { return email; }
        public String getName() { return name; }
        public String getImage() { return image; }
        public boolean isEmailVerified() { return emailVerified; }

        public void setId(String id) { this.id = id; }
        public void setEmail(String email) { this.email = email; }
        public void setName(String name) { this.name = name; }
        public void setImage(String image) { this.image = image; }
        public void setEmailVerified(boolean emailVerified) { this.emailVerified = emailVerified; }
    }
}
