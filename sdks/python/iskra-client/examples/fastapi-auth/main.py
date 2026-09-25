import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import Cookie, FastAPI, HTTPException, Response
from pydantic import BaseModel

from iskra_client import (
    AuthException,
    IskraClient,
    IskraException,
    Session,
    ValidationException,
)

# The Iskra session cookie is kept in this app's own HttpOnly cookie and sent
# back to Iskra on each request with IskraClient.with_session().
SESSION_COOKIE = "iskra_session"
COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "1") != "0"

log = logging.getLogger("iskra-example")


# ── Iskra client ─────────────────────────────────────────────────────────
# One client for the whole app: it pools connections and never stores
# cookies, so requests of different users cannot leak into each other.

iskra = IskraClient(
    base_url=os.environ.get("ISKRA_BASE_URL", "http://localhost:3000"),
    api_key=os.environ.get("ISKRA_API_KEY"),
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    await iskra.aclose()


app = FastAPI(title="Iskra FastAPI Auth Example", lifespan=lifespan)


# ── Request models ───────────────────────────────────────────────────────

class SignInRequest(BaseModel):
    email: str
    password: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────

def _start_session(response: Response, session: Session) -> dict:
    if session.cookie:
        response.set_cookie(
            SESSION_COOKIE,
            session.cookie,
            httponly=True,
            secure=COOKIE_SECURE,
            samesite="lax",
        )
    user = session.user
    return {"id": user.id, "email": user.email, "name": user.name} if user else {}


def _server_error(e: IskraException) -> HTTPException:
    # The detail (Iskra's message, a connection error with host and port) goes
    # to the log: anonymous callers only learn that the service failed.
    log.warning("Iskra request failed (status %s, code %s): %s", e.status_code, e.error_code, e)
    return HTTPException(status_code=502, detail={"error": "Error del servicio Iskra"})


# ── Auth routes ──────────────────────────────────────────────────────────

@app.post("/auth/sign-in")
async def sign_in(body: SignInRequest, response: Response):
    try:
        resp = await iskra.auth.async_sign_in(body.email, body.password)
    except AuthException as e:
        raise HTTPException(status_code=401, detail={"error": "Credenciales invalidas", "code": e.error_code})
    except ValidationException as e:
        raise HTTPException(status_code=400, detail={"error": "Datos invalidos", "details": e.details})
    except IskraException as e:
        raise _server_error(e)
    return _start_session(response, resp.data)


@app.post("/auth/sign-up", status_code=201)
async def sign_up(body: SignUpRequest, response: Response):
    try:
        resp = await iskra.auth.async_sign_up(body.email, body.password, name=body.name)
    except ValidationException as e:
        raise HTTPException(status_code=400, detail={"error": "Datos invalidos", "details": e.details})
    except IskraException as e:
        raise _server_error(e)
    return _start_session(response, resp.data)


@app.post("/auth/sign-out")
async def sign_out(response: Response, iskra_session: Optional[str] = Cookie(None)):
    if iskra_session:
        try:
            await iskra.auth.async_sign_out(iskra_session)
        except IskraException as e:
            raise _server_error(e)
    response.delete_cookie(SESSION_COOKIE)
    return {"message": "Sesion cerrada"}


@app.get("/auth/session")
async def get_session(iskra_session: Optional[str] = Cookie(None)):
    if not iskra_session:
        raise HTTPException(status_code=401, detail={"error": "No hay sesion activa"})
    try:
        resp = await iskra.auth.async_get_session(iskra_session)
    except IskraException as e:
        raise _server_error(e)
    if resp.data is None or resp.data.user is None:
        raise HTTPException(status_code=401, detail={"error": "No hay sesion activa"})
    user = resp.data.user
    return {"user": {"id": user.id, "email": user.email, "name": user.name}}


@app.get("/auth/health")
async def health():
    # Public route: only up or down. The full payload (every check, with its
    # messages and details) stays in the log.
    try:
        status = await iskra.health.async_check()
    except IskraException as e:
        log.warning("Iskra health check failed: %s", e)
        raise HTTPException(status_code=503, detail={"status": "error"})
    if status.get("status") != "ok":
        log.warning("Iskra is unhealthy: %s", status)
        raise HTTPException(status_code=503, detail={"status": "error"})
    return {"status": "ok"}
