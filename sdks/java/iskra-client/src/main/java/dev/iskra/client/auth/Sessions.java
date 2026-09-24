package dev.iskra.client.auth;

import java.net.http.HttpResponse;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/** Session cookie helpers shared by the auth and storage clients. */
public final class Sessions {

    private Sessions() {}

    /** The Cookie header value of a session from signIn/signUp. */
    public static String cookieOf(Session session) {
        if (session == null || session.getCookie() == null) {
            throw new IllegalArgumentException("Session has no cookie (it did not come from signIn/signUp)");
        }
        return session.getCookie();
    }

    /**
     * Better Auth's session-token cookie from the Set-Cookie headers, as a
     * Cookie header value, or null. Only the token is kept: the
     * {@code session_data} cookie is a signed cache that keeps a signed-out
     * session valid until it expires (5 min by default), whereas the token is
     * checked against the database on every request.
     */
    static String cookieFrom(HttpResponse<?> response) {
        Map<String, String> cookies = new LinkedHashMap<>();
        for (String header : response.headers().allValues("Set-Cookie")) {
            String pair = header.split(";", 2)[0].trim();
            int eq = pair.indexOf('=');
            if (eq > 0 && eq < pair.length() - 1) {
                cookies.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        String tokens = cookies.entrySet().stream()
                .filter(e -> e.getKey().endsWith("session_token"))
                .map(e -> e.getKey() + "=" + e.getValue())
                .collect(Collectors.joining("; "));
        return tokens.isEmpty() ? null : tokens;
    }
}
