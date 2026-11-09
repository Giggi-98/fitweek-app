"""Applicazione FastAPI. Avvio: uvicorn app.main:create_app --factory"""
import json
import logging
import time

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import APP_VERSION
from .config import BASE_DIR, Settings, load_settings
from .db import connect, transaction
from .logging_setup import setup_logging
from .migrations import run_migrations
from .schemas import LoginBody, StatePut
from .security import (
    BASE_HEADERS,
    COOKIE_NAME,
    CSP,
    LoginRateLimiter,
    SessionManager,
    check_origin,
    password_matches,
)

log = logging.getLogger("fitweek.http")
STATIC_DIR = BASE_DIR / "static"
PDF_PATH = BASE_DIR / "resources" / "scheda-originale.pdf"


def create_app(settings: Settings | None = None) -> FastAPI:
    setup_logging()
    settings = settings or load_settings()
    schema_version = run_migrations(settings.db_path, settings.backup_dir, settings.pre_migration_backups_kept)
    sessions = SessionManager(settings)
    sessions.purge_expired()
    limiter = LoginRateLimiter(settings.login_max_failures, settings.login_window_s)

    app = FastAPI(title="FitWeek", version=APP_VERSION, docs_url=None, redoc_url=None, openapi_url=None)

    # ---- middleware e gestione errori ---------------------------------------------------
    @app.middleware("http")
    async def headers_and_logging(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers.update(BASE_HEADERS)
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Content-Security-Policy"] = CSP
            response.headers["Cache-Control"] = "no-cache"
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        if request.url.path != "/api/health":
            log.info(
                "request",
                extra={"fields": {
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "ms": round((time.perf_counter() - started) * 1000, 1),
                }},
            )
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        problems = [
            {"field": ".".join(str(p) for p in e.get("loc", ())[1:]), "error": e.get("msg", "")}
            for e in exc.errors()[:20]
        ]
        return JSONResponse(status_code=422, content={"detail": "Dati non validi", "errors": problems})

    # ---- dipendenze ---------------------------------------------------------------------
    def require_session(request: Request) -> str:
        sid = sessions.session_id(request.cookies.get(COOKIE_NAME, ""))
        if not sid:
            raise HTTPException(status_code=401, detail="Accesso richiesto")
        return sid

    def client_key(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    # ---- auth ---------------------------------------------------------------------------
    @app.post("/api/login", dependencies=[Depends(check_origin)])
    def login(body: LoginBody, request: Request):
        key = client_key(request)
        wait = limiter.retry_after(key)
        if wait:
            raise HTTPException(
                status_code=429,
                detail="Troppi tentativi. Riprova tra poco.",
                headers={"Retry-After": str(wait)},
            )
        if not password_matches(body.password, settings.app_password):
            limiter.record_failure(key)
            log.warning("login fallito", extra={"fields": {"client": key}})
            raise HTTPException(status_code=401, detail="Password errata")
        limiter.reset(key)
        token = sessions.create(request.headers.get("user-agent", ""))
        response = JSONResponse({"ok": True})
        response.set_cookie(
            COOKIE_NAME, token, httponly=True, samesite="lax", secure=settings.cookie_secure,
            max_age=settings.session_max_age_s, path="/",
        )
        return response

    @app.post("/api/logout", dependencies=[Depends(check_origin)])
    def logout(request: Request):
        sid = sessions.session_id(request.cookies.get(COOKIE_NAME, ""))
        if sid:
            sessions.revoke(sid)
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    @app.post("/api/logout-all", dependencies=[Depends(check_origin), Depends(require_session)])
    def logout_all():
        sessions.revoke_all()
        response = JSONResponse({"ok": True})
        response.delete_cookie(COOKIE_NAME, path="/")
        return response

    # ---- stato ----------------------------------------------------------------------------
    def read_state() -> tuple[int, dict]:
        with connect(settings.db_path) as c:
            version, blob = c.execute("SELECT version, json FROM app_state WHERE id=1").fetchone()
        return version, json.loads(blob)

    @app.get("/api/state", dependencies=[Depends(require_session)])
    def get_state():
        version, data = read_state()
        return {"version": version, "data": data}

    @app.put("/api/state", dependencies=[Depends(check_origin), Depends(require_session)])
    def put_state(body: StatePut):
        blob = json.dumps(body.data.model_dump(mode="json"), ensure_ascii=False)
        if len(blob.encode("utf-8")) > settings.max_state_bytes:
            raise HTTPException(status_code=413, detail="Dati troppo grandi")
        with connect(settings.db_path) as c, transaction(c):
            current = c.execute("SELECT version FROM app_state WHERE id=1").fetchone()[0]
            if body.version != current:
                raise HTTPException(
                    status_code=409,
                    detail="Dati modificati da un altro dispositivo.",
                    headers={"X-Current-Version": str(current)},
                )
            c.execute("UPDATE app_state SET version=?, json=? WHERE id=1", (current + 1, blob))
        return {"ok": True, "version": current + 1}

    @app.get("/api/backup", dependencies=[Depends(require_session)])
    def backup():
        version, data = read_state()
        stamp = time.strftime("%Y%m%d")
        return JSONResponse(
            {"format": "fitweek-backup-v1", "version": version, "data": data},
            headers={"Content-Disposition": f'attachment; filename="fitweek-backup-{stamp}.json"'},
        )

    @app.get("/api/original-pdf", dependencies=[Depends(require_session)])
    def original_pdf():
        return FileResponse(PDF_PATH, media_type="application/pdf", filename="scheda-originale.pdf")

    # ---- servizio -------------------------------------------------------------------------
    @app.get("/api/health")
    def health():
        with connect(settings.db_path) as c:
            c.execute("SELECT 1 FROM app_state WHERE id=1").fetchone()
        return {"ok": True, "version": APP_VERSION, "schema": schema_version}

    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app
