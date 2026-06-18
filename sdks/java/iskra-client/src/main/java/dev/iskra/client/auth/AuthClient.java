package dev.iskra.client.auth;

import dev.iskra.client.IskraConfig;
import dev.iskra.client.http.HttpClientWrapper;
import dev.iskra.client.response.IskraResponse;

import java.util.HashMap;
import java.util.Map;

public class AuthClient {

    private final HttpClientWrapper http;
    private final String basePath;

    public AuthClient(HttpClientWrapper http, IskraConfig config) {
        this.http = http;
        this.basePath = config.getAuthBasePath();
    }

    public IskraResponse<Session> signIn(String email, String password) {
        Map<String, String> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        return http.post(basePath + "/sign-in/email", body, Session.class);
    }

    public IskraResponse<Session> signUp(String email, String password, String name) {
        Map<String, String> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        if (name != null) {
            body.put("name", name);
        }
        return http.post(basePath + "/sign-up/email", body, Session.class);
    }

    public IskraResponse<Object> signOut() {
        return http.post(basePath + "/sign-out", null, Object.class);
    }

    public IskraResponse<Session> getSession() {
        return http.get(basePath + "/get-session", Session.class);
    }
}
