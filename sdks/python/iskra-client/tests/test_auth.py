import pytest

from iskra_client import AuthException, IskraClient, Session


def test_sign_up_returns_user_token_and_cookie(iskra: IskraClient, credentials):
    email, password = credentials
    resp = iskra.auth.sign_up(email, password, name="Ada")
    session = resp.data
    assert isinstance(session, Session)
    assert session.user.email == email
    assert session.user.name == "Ada"
    assert session.session.token
    assert session.cookie and "session_token=" in session.cookie
    # Only the token: the session_data cache cookie would outlive a sign-out.
    assert "session_data" not in session.cookie


def test_sign_in_with_wrong_password(iskra: IskraClient, credentials):
    email, password = credentials
    iskra.auth.sign_up(email, password)
    with pytest.raises(AuthException) as err:
        iskra.auth.sign_in(email, "wrong-password")
    assert err.value.error_code == "INVALID_EMAIL_OR_PASSWORD"
    assert str(err.value) == "Invalid email or password"


def test_session_round_trip(iskra: IskraClient, credentials):
    email, password = credentials
    iskra.auth.sign_up(email, password)
    session = iskra.auth.sign_in(email, password).data

    current = iskra.auth.get_session(session).data
    assert current.user.email == email
    assert current.session.id

    as_user = iskra.with_session(session)
    assert as_user.auth.get_session().data.user.email == email
    assert as_user.get("/contract/me").data["email"] == email

    assert as_user.auth.sign_out().success
    assert iskra.auth.get_session(session).data is None
    with pytest.raises(AuthException):
        as_user.get("/contract/me")


def test_client_does_not_keep_sessions_between_calls(iskra: IskraClient, credentials):
    email, password = credentials
    iskra.auth.sign_up(email, password)
    iskra.auth.sign_in(email, password)
    # A shared client must not start acting as whoever signed in last.
    assert iskra.auth.get_session().data is None
    with pytest.raises(AuthException):
        iskra.get("/contract/me")


def test_sessions_of_different_users_stay_apart(iskra: IskraClient, credentials):
    email, password = credentials
    other = "other-" + email
    alice = iskra.auth.sign_up(email, password).data
    bob = iskra.auth.sign_up(other, password).data
    assert iskra.with_session(alice).get("/contract/me").data["email"] == email
    assert iskra.with_session(bob.cookie).get("/contract/me").data["email"] == other


def test_session_without_cookie_is_rejected(iskra: IskraClient):
    with pytest.raises(ValueError):
        iskra.with_session(Session())


async def test_async_auth(iskra: IskraClient, credentials):
    email, password = credentials
    await iskra.auth.async_sign_up(email, password)
    session = (await iskra.auth.async_sign_in(email, password)).data
    assert (await iskra.auth.async_get_session(session)).data.user.email == email
    assert (await iskra.auth.async_sign_out(session)).success
    assert (await iskra.auth.async_get_session(session)).data is None


def test_get_session_keeps_the_sessions_cookie(iskra: IskraClient, credentials):
    email, password = credentials
    iskra.auth.sign_up(email, password)
    session = iskra.auth.sign_in(email, password).data
    current = iskra.auth.get_session(session).data
    # It read the unbound client's cookie (None), so the returned Session
    # could not be used with with_session().
    assert current.cookie == session.cookie
    assert iskra.with_session(current).get("/contract/me").data["email"] == email
