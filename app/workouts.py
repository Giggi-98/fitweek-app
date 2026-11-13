"""API v1 per sedute e serie. Scritture idempotenti: ripetere la stessa richiesta non duplica."""
import json
import sqlite3
from datetime import date, datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from . import domain
from .config import Settings
from .db import connect, transaction
from .schemas import ProgramWeekPut, SessionCreate, SessionPatch, SetLogPut
from .security import check_origin

TZ = ZoneInfo("Europe/Rome")
SESSION_COLS = (
    "id, routine, week, date, status, started_at, ended_at, duration_min, cardio_min, notes, source,"
    " created_at, updated_at"
)


def now_iso() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


EDIT_HEADER = "x-edited-at"  # orario in cui la modifica è stata fatta sul dispositivo (coda offline)
STALE = {"ok": True, "stale": True}  # risposta a una modifica più vecchia del dato già salvato: non applicata


def _moment(value: str | None) -> datetime | None:
    try:
        moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)


def edit_time(request: Request) -> str:
    """Quando è stata fatta la modifica: l'orario dichiarato dal dispositivo (una scrittura rimasta in coda
    offline arriva più tardi di quando è stata fatta), mai nel futuro; senza intestazione vale adesso.
    Al millisecondo, come lo manda il dispositivo: troncato al secondo, due modifiche fatte nello stesso
    secondo e arrivate in ordine inverso risulterebbero contemporanee e vincerebbe la più vecchia (FW-REV-009)."""
    now = datetime.now(TZ)
    moment = _moment(request.headers.get(EDIT_HEADER))
    return (min(moment.astimezone(TZ), now) if moment else now).isoformat(timespec="milliseconds")


def is_stale(stored: str | None, edited: str) -> bool:
    """Vero se il dato salvato è stato modificato DOPO la modifica in arrivo: vince l'ultima fatta, non l'ultima
    arrivata (es. telefono offline da lunedì che sincronizza mercoledì sopra una correzione fatta martedì dal PC).
    A parità esatta di orario (stesso millisecondo) non c'è un ordine da rispettare: vale l'ultima arrivata."""
    saved, incoming = _moment(stored), _moment(edited)
    return bool(saved and incoming and saved > incoming)


def today() -> date:
    return datetime.now(TZ).date()


def _session_dict(row: sqlite3.Row, sets: list[dict]) -> dict[str, Any]:
    d = dict(row)
    d["sets"] = sets
    return d


def load_sessions(c: sqlite3.Connection, where: str = "", params: tuple = (), limit: int = 50) -> list[dict]:
    c.row_factory = sqlite3.Row
    rows = c.execute(
        f"SELECT {SESSION_COLS} FROM workout_sessions WHERE deleted_at IS NULL {where}"
        " ORDER BY date DESC, created_at DESC LIMIT ?",
        (*params, limit),
    ).fetchall()
    if not rows:
        return []
    ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    sets: dict[str, list[dict]] = {i: [] for i in ids}
    for s in c.execute(
        f"SELECT session_id, exercise_id, set_index, kg, reps, rir, completed, logged_at FROM set_logs"
        f" WHERE session_id IN ({marks}) ORDER BY exercise_id, set_index",
        ids,
    ):
        item = dict(s)
        item["completed"] = bool(item["completed"])
        sets[item.pop("session_id")].append(item)
    return [_session_dict(r, sets[r["id"]]) for r in rows]


def build_router(settings: Settings, require_session: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_session)])
    writes = [Depends(check_origin)]

    def get_one(c: sqlite3.Connection, sid: str) -> dict:
        found = load_sessions(c, "AND id=?", (sid,), 1)
        if not found:
            raise HTTPException(status_code=404, detail="Seduta non trovata")
        return found[0]

    def read_profile(c: sqlite3.Connection) -> dict:
        return json.loads(c.execute("SELECT json FROM app_state WHERE id=1").fetchone()[0])["profile"]

    @r.get("/today")
    def get_today():
        d = today()
        with connect(settings.db_path) as c:
            profile = read_profile(c)
            week = domain.program_week(date.fromisoformat(profile["startDate"]), d)
            routine = domain.routine_for(d)
            active = load_sessions(c, "AND status='in_progress'", (), 1)
            done_today = load_sessions(c, "AND date=? AND status='done'", (d.isoformat(),), 5)
        return {
            "date": d.isoformat(),
            "weekday": d.weekday(),
            "routine": routine,
            "program_week": week,
            "program_weeks": domain.PROGRAM_WEEKS,
            "active_session": active[0] if active else None,
            "done_today": done_today,
        }

    @r.put("/program-week", dependencies=writes)
    def set_program_week(body: ProgramWeekPut):
        """Imposta la settimana corrente spostando la data di inizio (unica fonte di verità)."""
        start = domain.start_date_for_week(body.week, today())
        with connect(settings.db_path) as c, transaction(c):
            version, blob = c.execute("SELECT version, json FROM app_state WHERE id=1").fetchone()
            state = json.loads(blob)
            state["profile"]["startDate"] = start.isoformat()
            state["profile"]["week"] = body.week
            c.execute("UPDATE app_state SET version=?, json=? WHERE id=1",
                      (version + 1, json.dumps(state, ensure_ascii=False)))
        return {"ok": True, "startDate": start.isoformat(), "version": version + 1}

    @r.get("/workout-sessions")
    def list_sessions(
        routine: str | None = Query(default=None, max_length=20),
        status: str | None = Query(default=None, pattern="^(in_progress|done|skipped)$"),
        limit: int = Query(default=50, ge=1, le=500),
    ):
        where, params = "", []
        if routine:
            where += " AND routine=?"
            params.append(routine)
        if status:
            where += " AND status=?"
            params.append(status)
        with connect(settings.db_path) as c:
            return {"items": load_sessions(c, where, tuple(params), limit)}

    @r.get("/workout-sessions/{sid}")
    def get_session(sid: str):
        with connect(settings.db_path) as c:
            return get_one(c, sid)

    @r.post("/workout-sessions", dependencies=writes)
    def create_session(body: SessionCreate):
        now = now_iso()
        with connect(settings.db_path) as c, transaction(c):
            c.execute(
                "INSERT OR IGNORE INTO workout_sessions (id, routine, week, date, status, started_at,"
                " created_at, updated_at) VALUES (?, ?, ?, ?, 'in_progress', ?, ?, ?)",
                (body.id, body.routine, body.week, body.date, now, now, now),
            )
            return get_one(c, body.id)

    @r.patch("/workout-sessions/{sid}", dependencies=writes)
    def patch_session(sid: str, body: SessionPatch):
        changes = body.model_dump(exclude_unset=True)
        with connect(settings.db_path) as c, transaction(c):
            current = get_one(c, sid)
            if changes.get("status") == "done" and not current["ended_at"] and "ended_at" not in changes:
                changes["ended_at"] = now_iso()
            if (changes.get("status") == "done" and "duration_min" not in changes
                    and current["duration_min"] is None and current["started_at"]):
                end = datetime.fromisoformat(changes.get("ended_at") or current["ended_at"])
                start = datetime.fromisoformat(current["started_at"])
                changes["duration_min"] = max(0, round((end - start).total_seconds() / 60))
            if changes:
                changes["updated_at"] = now_iso()
                cols = ", ".join(f"{k}=?" for k in changes)
                c.execute(f"UPDATE workout_sessions SET {cols} WHERE id=?", (*changes.values(), sid))
            return get_one(c, sid)

    @r.delete("/workout-sessions/{sid}", dependencies=writes)
    def delete_session(sid: str):
        """Eliminazione logica: i dati restano nel DB (recuperabili) ma escono da liste e grafici."""
        with connect(settings.db_path) as c, transaction(c):
            get_one(c, sid)
            c.execute("UPDATE workout_sessions SET deleted_at=?, updated_at=? WHERE id=?",
                      (now_iso(), now_iso(), sid))
        return {"ok": True}

    def _set_time(c: sqlite3.Connection, sid: str, exercise_id: str, set_index: int) -> str | None:
        row = c.execute("SELECT logged_at FROM set_logs WHERE session_id=? AND exercise_id=? AND set_index=?",
                        (sid, exercise_id, set_index)).fetchone()
        return row[0] if row else None

    def _deleted_time(c: sqlite3.Connection, sid: str, exercise_id: str, set_index: int) -> str | None:
        """Quando la serie è stata eliminata l'ultima volta (segno in `set_tombstones`), o None."""
        row = c.execute("SELECT deleted_at FROM set_tombstones WHERE session_id=? AND exercise_id=? AND set_index=?",
                        (sid, exercise_id, set_index)).fetchone()
        return row[0] if row else None

    def _mark_deleted(c: sqlite3.Connection, sid: str, exercise_id: str, set_index: int, edited: str) -> None:
        """Ricorda l'eliminazione: senza questo segno un PUT rimasto in coda su un dispositivo offline, fatto
        PRIMA dell'eliminazione, ricreerebbe la serie. Il segno non torna mai indietro nel tempo e resta
        anche se la serie viene poi registrata di nuovo (a quel punto la protegge il suo `logged_at`)."""
        if not c.execute("SELECT 1 FROM workout_sessions WHERE id=?", (sid,)).fetchone():
            return
        if is_stale(_deleted_time(c, sid, exercise_id, set_index), edited):
            return
        c.execute(
            "INSERT INTO set_tombstones (session_id, exercise_id, set_index, deleted_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(session_id, exercise_id, set_index) DO UPDATE SET deleted_at=excluded.deleted_at",
            (sid, exercise_id, set_index, edited),
        )

    def check_slot(sid: str, exercise_id: str, set_index: int) -> None:
        if not (1 <= set_index <= 50) or not exercise_id.replace("-", "").replace("_", "").isalnum():
            raise HTTPException(status_code=422, detail="Serie non valida")

    @r.put("/workout-sessions/{sid}/sets/{exercise_id}/{set_index}", dependencies=writes)
    def put_set(sid: str, exercise_id: str, set_index: int, body: SetLogPut, edited: str = Depends(edit_time)):
        check_slot(sid, exercise_id, set_index)
        with connect(settings.db_path) as c, transaction(c):
            get_one(c, sid)
            if (is_stale(_set_time(c, sid, exercise_id, set_index), edited)
                    or is_stale(_deleted_time(c, sid, exercise_id, set_index), edited)):
                return STALE  # più vecchia della serie salvata, oppure della sua eliminazione
            c.execute(
                "INSERT INTO set_logs (session_id, exercise_id, set_index, kg, reps, rir, completed, logged_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, exercise_id, set_index) DO UPDATE SET"
                " kg=excluded.kg, reps=excluded.reps, rir=excluded.rir, completed=excluded.completed,"
                " logged_at=excluded.logged_at",
                (sid, exercise_id, set_index, body.kg, body.reps, body.rir, int(body.completed), edited),
            )
            c.execute("UPDATE workout_sessions SET updated_at=? WHERE id=?", (now_iso(), sid))
        return {"ok": True}

    @r.delete("/workout-sessions/{sid}/sets/{exercise_id}/{set_index}", dependencies=writes)
    def delete_set(sid: str, exercise_id: str, set_index: int, edited: str = Depends(edit_time)):
        check_slot(sid, exercise_id, set_index)
        with connect(settings.db_path) as c, transaction(c):
            if is_stale(_set_time(c, sid, exercise_id, set_index), edited):
                return STALE
            _mark_deleted(c, sid, exercise_id, set_index, edited)
            c.execute("DELETE FROM set_logs WHERE session_id=? AND exercise_id=? AND set_index=?",
                      (sid, exercise_id, set_index))
        return {"ok": True}

    return r
