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
from .db import backup_to, connect, transaction
from .logging_setup import setup_logging
from .migrations import run_migrations
from .schemas import BackupRestore, LoginBody, StatePut
from .security import (
    BASE_HEADERS,
    COOKIE_NAME,
    CSP,
    LoginRateLimiter,
    SessionManager,
    check_origin,
    password_matches,
)
from .workouts import build_router, load_sessions, now_iso

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
        with connect(settings.db_path) as c:
            version, blob = c.execute("SELECT version, json FROM app_state WHERE id=1").fetchone()
            sessions_ = load_sessions(c, limit=100_000)
        stamp = time.strftime("%Y%m%d")
        return JSONResponse(
            {"format": "fitweek-backup-v2", "version": version, "data": json.loads(blob),
             "workout_sessions": sessions_},
            headers={"Content-Disposition": f'attachment; filename="fitweek-backup-{stamp}.json"'},
        )

    @app.post("/api/v1/restore", dependencies=[Depends(check_origin), Depends(require_session)])
    def restore(body: BackupRestore):
        """Sostituisce stato e sedute con il contenuto del backup, dopo un backup SQLite automatico.
        Un backup v1 (sedute dentro data.workouts) viene convertito nelle tabelle dedicate."""
        sessions_in = [s.model_dump() for s in body.workout_sessions]
        if body.format == "fitweek-backup-v1":
            now = now_iso()
            for w in body.data.workouts:
                sessions_in.append({
                    "id": w.id, "routine": w.routine, "week": w.week, "date": w.date, "status": "done",
                    "started_at": None, "ended_at": None, "duration_min": w.duration, "cardio_min": None,
                    "notes": w.notes, "source": "v1-backup", "created_at": now, "updated_at": now,
                    "sets": [{"exercise_id": x.exerciseId, "set_index": x.set, "kg": x.kg, "reps": x.reps,
                              "rir": None, "completed": True, "logged_at": w.date} for x in w.sets],
                })
        blob = json.dumps(body.data.model_dump(mode="json"), ensure_ascii=False)
        with connect(settings.db_path) as c:
            backup_to(c, settings.backup_dir / f"pre-restore-{time.strftime('%Y%m%d-%H%M%S')}.sqlite")
            with transaction(c):
                version = c.execute("SELECT version FROM app_state WHERE id=1").fetchone()[0]
                c.execute("UPDATE app_state SET version=?, json=? WHERE id=1", (version + 1, blob))
                c.execute("DELETE FROM set_logs")
                c.execute("DELETE FROM workout_sessions")
                for s in sessions_in:
                    sets = s.pop("sets")
                    cols = ", ".join(s)
                    c.execute(f"INSERT OR REPLACE INTO workout_sessions ({cols}) VALUES ({','.join('?' * len(s))})",
                              tuple(s.values()))
                    for x in sets:
                        c.execute(
                            "INSERT OR REPLACE INTO set_logs (session_id, exercise_id, set_index, kg, reps, rir,"
                            " completed, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            (s["id"], x["exercise_id"], x["set_index"], x["kg"], x["reps"], x["rir"],
                             int(x["completed"]), x["logged_at"]),
                        )
        return {"ok": True, "version": version + 1, "sessions": len(sessions_in)}

    app.include_router(build_router(settings, require_session))

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
