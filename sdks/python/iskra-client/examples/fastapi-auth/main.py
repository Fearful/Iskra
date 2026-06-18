import os

from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from iskra_client import (
    IskraClient,
    IskraException,
    AuthException,
    ValidationException,
)

# ── App ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Iskra FastAPI Auth Example")


# ── Iskra client dependency ──────────────────────────────────────────────

def get_iskra() -> IskraClient:
    return IskraClient(
        base_url=os.environ.get("ISKRA_BASE_URL", "http://localhost:3000"),
        api_key=os.environ.get("ISKRA_API_KEY"),
    )


# ── Request models ───────────────────────────────────────────────────────

class SignInRequest(BaseModel):
    email: str
    password: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


# ── Auth routes ──────────────────────────────────────────────────────────

@app.post("/auth/sign-in")
async def sign_in(body: SignInRequest, iskra: IskraClient = Depends(get_iskra)):
    try:
        resp = await iskra.auth.async_sign_in(body.email, body.password)
        return resp.data
    except AuthException as e:
        raise HTTPException(status_code=401, detail={
            "error": "Credenciales invalidas",
            "detail": str(e),
            "code": e.error_code,
        })
    except ValidationException as e:
        raise HTTPException(status_code=400, detail={
            "error": "Datos invalidos",
            "detail": str(e),
            "details": e.details,
        })
    except IskraException as e:
        raise HTTPException(status_code=500, detail={
            "error": "Error del servidor",
            "detail": str(e),
        })


@app.post("/auth/sign-up", status_code=201)
async def sign_up(body: SignUpRequest, iskra: IskraClient = Depends(get_iskra)):
    try:
        resp = await iskra.auth.async_sign_up(body.email, body.password, name=body.name)
        return resp.data
    except ValidationException as e:
        raise HTTPException(status_code=400, detail={
            "error": "Datos invalidos",
            "detail": str(e),
            "details": e.details,
        })
    except IskraException as e:
        raise HTTPException(status_code=500, detail={
            "error": "Error del servidor",
            "detail": str(e),
        })


@app.post("/auth/sign-out")
async def sign_out(iskra: IskraClient = Depends(get_iskra)):
    try:
        await iskra.auth.async_sign_out()
        return {"message": "Sesion cerrada"}
    except IskraException as e:
        raise HTTPException(status_code=500, detail={
            "error": "Error al cerrar sesion",
            "detail": str(e),
        })


@app.get("/auth/session")
async def get_session(iskra: IskraClient = Depends(get_iskra)):
    try:
        resp = await iskra.auth.async_get_session()
        return resp.data
    except AuthException as e:
        raise HTTPException(status_code=401, detail={
            "error": "No hay sesion activa",
            "detail": str(e),
        })
    except IskraException as e:
        raise HTTPException(status_code=500, detail={
            "error": "Error del servidor",
            "detail": str(e),
        })


@app.get("/auth/health")
async def health(iskra: IskraClient = Depends(get_iskra)):
    try:
        return await iskra.health.async_check()
    except IskraException:
        raise HTTPException(status_code=503, detail={
            "error": "Iskra no disponible",
        })
