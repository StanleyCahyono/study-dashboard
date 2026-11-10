"""FastAPI application: private JSON API under /api plus the built frontend."""

import hmac
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import auth
from .config import Settings, load_settings
from .db import Database
from .demo import seed_demo
from .models import AuthSession
from .paths import REPO_ROOT, Profile, ProfilePaths
from .timeutil import Clock, iso, utcnow
from .today import today_summary

FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
LOOPBACK_HOSTS = ["127.0.0.1", "localhost"]

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; "
    "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)


@dataclass
class AppState:
    profile: Profile
    paths: ProfilePaths
    settings: Settings
    db: Database
    clock: Clock
    allowed_origins: set[str] = field(default_factory=set)

    @property
    def cookie_name(self) -> str:
        # __Host- prefix: Secure, Path=/, no Domain. Distinct per profile because
        # browsers do not isolate cookies by port.
        return f"__Host-sd_{self.profile.value}"


def _allowed_hosts(settings: Settings, extra: list[str]) -> list[str]:
    return LOOPBACK_HOSTS + list(settings.tailnet_hostnames) + extra


def _allowed_origins(settings: Settings, port: int, extra: list[str]) -> set[str]:
    origins = {f"http://{h}:{port}" for h in LOOPBACK_HOSTS}
    origins |= {f"https://{h}" for h in settings.tailnet_hostnames}
    origins |= {f"https://{h}" for h in extra}
    return origins


class EnrollBody(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    passphrase: str = Field(min_length=1, max_length=1024)
    device_label: str | None = Field(default=None, max_length=80)


class LoginBody(BaseModel):
    passphrase: str = Field(min_length=1, max_length=1024)
    device_label: str | None = Field(default=None, max_length=80)


def create_app(
    profile: Profile,
    paths: ProfilePaths,
    *,
    clock: Clock = utcnow,
    extra_hosts: list[str] | None = None,
    port: int | None = None,
    frontend_dist: Path | None = FRONTEND_DIST,
) -> FastAPI:
    extra_hosts = extra_hosts or []
    settings = load_settings(paths)
    db = Database(paths)
    if profile is Profile.DEMO:
        with db.session() as s:
            seed_demo(s, profile, clock)
    state = AppState(
        profile=profile,
        paths=paths,
        settings=settings,
        db=db,
        clock=clock,
        allowed_origins=_allowed_origins(settings, port or settings.port, extra_hosts),
    )

    app = FastAPI(
        title="Study Dashboard",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.sd = state

    # --- middleware ---------------------------------------------------------

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        path = request.url.path
        if request.method in UNSAFE_METHODS and path.startswith("/api/"):
            origin = request.headers.get("origin")
            fetch_site = request.headers.get("sec-fetch-site")
            if origin is None or origin not in state.allowed_origins:
                return _no_store(JSONResponse({"error": "bad_origin"}, status_code=403))
            if fetch_site not in (None, "same-origin"):
                return _no_store(JSONResponse({"error": "bad_origin"}, status_code=403))
            # A custom header forces a CORS preflight for any cross-site attempt.
            if request.headers.get("x-studydash") != "1":
                return _no_store(JSONResponse({"error": "missing_header"}, status_code=403))
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        if path.startswith("/api/"):
            _no_store(response)
        return response

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_allowed_hosts(settings, extra_hosts))

    # --- dependencies -------------------------------------------------------

    def get_db():
        with state.db.session() as s:
            yield s

    DB = Annotated[Session, Depends(get_db)]

    def require_session(request: Request, db: DB):
        row = auth.resolve_session(db, state.clock, request.cookies.get(state.cookie_name))
        if row is None:
            raise HTTPException(status_code=401, detail="not_authenticated")
        if request.method in UNSAFE_METHODS:
            sent = request.headers.get("x-csrf-token", "")
            if not sent or not hmac.compare_digest(sent, row.csrf_token):
                raise HTTPException(status_code=403, detail="bad_csrf")
        return row

    SessionDep = Annotated[AuthSession, Depends(require_session)]

    def set_cookie(response: Response, token: str) -> None:
        response.set_cookie(
            state.cookie_name,
            token,
            max_age=int(auth.SESSION_ABSOLUTE_TTL.total_seconds()),
            path="/",
            secure=True,
            httponly=True,
            samesite="strict",
        )

    def auth_error(exc: auth.AuthError) -> JSONResponse:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status, headers=headers)

    # --- public endpoints (no private data) --------------------------------

    @app.get("/api/public/status")
    def public_status(db: DB):
        return {"profile": profile.value, "enrolled": auth.is_enrolled(db)}

    @app.post("/api/auth/enroll")
    def enroll(body: EnrollBody, request: Request, response: Response, db: DB):
        try:
            auth.enroll_owner(db, state.clock, body.code.strip(), body.passphrase)
        except auth.AuthError as exc:
            return auth_error(exc)
        label = body.device_label or auth.device_label_from_user_agent(request.headers.get("user-agent"))
        new = auth.create_session(db, state.clock, label)
        set_cookie(response, new.token)
        return {"ok": True, "csrf_token": new.row.csrf_token}

    @app.post("/api/auth/login")
    def login(body: LoginBody, request: Request, response: Response, db: DB):
        try:
            auth.check_passphrase(db, state.clock, body.passphrase)
        except auth.AuthError as exc:
            return auth_error(exc)
        label = body.device_label or auth.device_label_from_user_agent(request.headers.get("user-agent"))
        new = auth.create_session(db, state.clock, label)
        set_cookie(response, new.token)
        return {"ok": True, "csrf_token": new.row.csrf_token}

    # --- authenticated endpoints -------------------------------------------

    @app.get("/api/auth/session")
    def session_info(sess: SessionDep):
        return {
            "profile": profile.value,
            "csrf_token": sess.csrf_token,
            "device_label": sess.device_label,
            "session_id": sess.public_id,
            "expires_at": iso(sess.expires_at),
        }

    @app.post("/api/auth/logout")
    def logout(response: Response, sess: SessionDep, db: DB):
        auth.revoke_session(db, state.clock, sess.public_id, reason="logout")
        response.delete_cookie(state.cookie_name, path="/", secure=True, httponly=True, samesite="strict")
        return {"ok": True}

    @app.get("/api/auth/devices")
    def devices(sess: SessionDep, db: DB):
        return {
            "devices": [
                {
                    "session_id": r.public_id,
                    "device_label": r.device_label,
                    "created_at": iso(r.created_at),
                    "last_seen_at": iso(r.last_seen_at),
                    "expires_at": iso(r.expires_at),
                    "current": r.public_id == sess.public_id,
                }
                for r in auth.active_sessions(db, state.clock)
            ]
        }

    @app.post("/api/auth/devices/{session_id}/revoke")
    def revoke_device(session_id: str, sess: SessionDep, db: DB):
        if not auth.revoke_session(db, state.clock, session_id, reason="revoked_by_owner"):
            raise HTTPException(status_code=404, detail="not_found")
        return {"ok": True}

    @app.get("/api/today")
    def today(sess: SessionDep, db: DB):
        return today_summary(db, profile, state.clock(), settings.zone())

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_not_found(rest: str):
        raise HTTPException(status_code=404, detail="not_found")

    # --- static frontend (public app shell only) ---------------------------

    if frontend_dist is not None:
        _mount_frontend(app, frontend_dist)

    return app


def _no_store(response: Response) -> Response:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return response


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if not (dist / "index.html").exists():
            return JSONResponse(
                {"error": "frontend_not_built", "message": "Run `npm run build` in frontend/ first."},
                status_code=503,
            )
        candidate = (dist / path).resolve()
        if path and dist in candidate.parents and candidate.is_file():
            response = FileResponse(candidate)
            if path.startswith("assets/"):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
            if path == "sw.js":
                response.headers["Service-Worker-Allowed"] = "/"
            return response
        response = FileResponse(dist / "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response
