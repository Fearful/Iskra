package dev.iskra.client;

import dev.iskra.client.auth.Session;
import dev.iskra.client.exception.AuthException;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthClientTest {

    private static final String PASSWORD = "correct-horse-battery";
    private final IskraClient iskra = ContractServer.client();

    private static String email() {
        return "user-" + UUID.randomUUID().toString().substring(0, 12) + "@example.com";
    }

    @Test
    void signUpReturnsUserTokenAndCookie() {
        String email = email();
        Session session = iskra.auth().signUp(email, PASSWORD, "Ada").getData();
        assertEquals(email, session.getUser().getEmail());
        assertEquals("Ada", session.getUser().getName());
        assertNotNull(session.getSession().getToken());
        assertTrue(session.getCookie().contains("session_token="));
        // Only the token: the session_data cache cookie would outlive a sign-out.
        assertFalse(session.getCookie().contains("session_data"));
    }

    @Test
    void signInWithWrongPassword() {
        String email = email();
        iskra.auth().signUp(email, PASSWORD, null);
        AuthException e = assertThrows(AuthException.class, () -> iskra.auth().signIn(email, "wrong-password"));
        assertEquals("INVALID_EMAIL_OR_PASSWORD", e.getErrorCode());
        assertEquals("Invalid email or password", e.getMessage());
    }

    @Test
    void sessionRoundTrip() {
        String email = email();
        iskra.auth().signUp(email, PASSWORD, null);
        Session session = iskra.auth().signIn(email, PASSWORD).getData();

        Session current = iskra.auth().getSession(session).getData();
        assertEquals(email, current.getUser().getEmail());
        assertNotNull(current.getSession().getId());

        IskraClient asUser = iskra.withSession(session);
        assertEquals(email, asUser.auth().getSession().getData().getUser().getEmail());
        assertEquals(email, asUser.get("/contract/me", Map.class).getData().get("email"));

        assertTrue(asUser.auth().signOut().isSuccess());
        assertNull(iskra.auth().getSession(session).getData());
        assertThrows(AuthException.class, () -> asUser.get("/contract/me", Map.class));
    }

    @Test
    void clientDoesNotKeepSessionsBetweenCalls() {
        String email = email();
        iskra.auth().signUp(email, PASSWORD, null);
        iskra.auth().signIn(email, PASSWORD);
        // A shared client must not start acting as whoever signed in last.
        assertNull(iskra.auth().getSession().getData());
        assertThrows(AuthException.class, () -> iskra.get("/contract/me", Map.class));
    }

    @Test
    void sessionsOfDifferentUsersStayApart() {
        String alice = email();
        String bob = "other-" + alice;
        Session aliceSession = iskra.auth().signUp(alice, PASSWORD, null).getData();
        Session bobSession = iskra.auth().signUp(bob, PASSWORD, null).getData();
        assertEquals(alice, iskra.withSession(aliceSession).get("/contract/me", Map.class).getData().get("email"));
        assertEquals(bob, iskra.withSession(bobSession.getCookie()).get("/contract/me", Map.class).getData().get("email"));
    }

    @Test
    void sessionWithoutCookieIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> iskra.withSession(new Session()));
    }
}
