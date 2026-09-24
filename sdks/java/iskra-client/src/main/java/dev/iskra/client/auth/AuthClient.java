package dev.iskra.client.auth;

import com.fasterxml.jackson.databind.JsonNode;
import dev.iskra.client.IskraConfig;
import dev.iskra.client.http.HttpClientWrapper;
import dev.iskra.client.response.IskraResponse;

import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.Map;

public class AuthClient {

    private final HttpClientWrapper http;
    private final String basePath;

    public AuthClient(HttpClientWrapper http, IskraConfig config) {
        this.http = http;
        this.basePath = config.getAuthBasePath();
    }

    /** The response's data is the new session, with {@link Session#getCookie()} set. */
    public IskraResponse<Session> signIn(String email, String password) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("password", password);
        return sessionResponse(postJson(http, basePath + "/sign-in/email", body), true);
    }

    /**
     * Registers and signs in a user. Better Auth requires a name; a null
     * {@code name} defaults to the email's local part.
     */
    public IskraResponse<Session> signUp(String email, String password, String name) {
        Map<String, String> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("password", password);
        body.put("name", name != null ? name : email.split("@", 2)[0]);
        return sessionResponse(postJson(http, basePath + "/sign-up/email", body), true);
    }

    /** The session this client is bound to; data is null when there is none. */
    public IskraResponse<Session> getSession() {
        return sessionResponse(http.send("GET", basePath + "/get-session", null, null), false);
    }

    /** The session behind {@code session}; data is null once it expired or was signed out. */
    public IskraResponse<Session> getSession(Session session) {
        return getSession(Sessions.cookieOf(session));
    }

    /** Same as {@link #getSession(Session)} for a stored {@link Session#getCookie()} value. */
    public IskraResponse<Session> getSession(String sessionCookie) {
        HttpClientWrapper bound = http.withCookie(sessionCookie);
        return sessionResponse(bound.send("GET", basePath + "/get-session", null, null), false, bound);
    }

    public IskraResponse<Object> signOut() {
        return http.post(basePath + "/sign-out", null, Object.class);
    }

    public IskraResponse<Object> signOut(Session session) {
        return signOut(Sessions.cookieOf(session));
    }

    public IskraResponse<Object> signOut(String sessionCookie) {
        return http.withCookie(sessionCookie).post(basePath + "/sign-out", null, Object.class);
    }

    // --- Helpers ---

    private static HttpResponse<byte[]> postJson(HttpClientWrapper http, String path, Object body) {
        try {
            byte[] json = http.getObjectMapper().writeValueAsBytes(body);
            return http.send("POST", path, HttpRequest.BodyPublishers.ofByteArray(json), "application/json");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }

    private IskraResponse<Session> sessionResponse(HttpResponse<byte[]> response, boolean captureCookie) {
        return sessionResponse(response, captureCookie, http);
    }

    private static IskraResponse<Session> sessionResponse(HttpResponse<byte[]> response, boolean captureCookie,
                                                          HttpClientWrapper http) {
        JsonNode body = http.readJson(response);
        if (body == null || !body.isObject()) {
            return new IskraResponse<>(true, null, null, response.statusCode());
        }
        Session session = http.convert(body, Session.class);
        session.setCookie(captureCookie ? Sessions.cookieFrom(response) : http.getCookie());
        return new IskraResponse<>(true, session, null, response.statusCode());
    }
}
