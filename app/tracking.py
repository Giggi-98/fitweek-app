"""API v1 per i dati "leggeri" della routine: sonno, note per esercizio, spesa reale settimanale.

Sono tutti inserimenti facoltativi e modificabili; lo storico non viene mai sovrascritto in blocco.
Il sonno è indicizzato sul giorno del RISVEGLIO (la notte tra lunedì e martedì è di martedì).
"""
import sqlite3
from datetime import date, timedelta
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query

from . import domain
from .config import Settings
from .db import connect, transaction
from .schemas import ExerciseNotePut, GrocerySpendPut, IsoDate, SleepPut
from .security import check_origin
from .workouts import STALE, edit_time, is_stale, now_iso, today


def _rows(c: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    c.row_factory = sqlite3.Row
    return [dict(r) for r in c.execute(sql, params)]


def sleep_rows(c: sqlite3.Connection, first: str, last: str) -> list[dict]:
    rows = _rows(c, "SELECT date, bed_time, wake_time, source, note FROM sleep_logs"
                    " WHERE date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date", (first, last))
    for r in rows:
        r["duration_min"] = domain.sleep_minutes(r["bed_time"], r["wake_time"])
    return rows


def sleep_summary(rows: list[dict]) -> dict:
    """Medie calcolate su `rows`; None se non ci sono notti registrate."""
    if not rows:
        return {"nights": 0, "duration_avg_min": None, "bedtime_avg": None}
    return {
        "nights": len(rows),
        "duration_avg_min": round(sum(r["duration_min"] for r in rows) / len(rows)),
        "bedtime_avg": domain.average_clock([r["bed_time"] for r in rows]),
    }


def _saved_at(c: sqlite3.Connection, table: str, key: str, value: str) -> str | None:
    """Orario dell'ultima modifica salvata (tabella e colonna sono costanti del codice, mai input)."""
    row = c.execute(f"SELECT updated_at FROM {table} WHERE {key}=?", (value,)).fetchone()
    return row[0] if row else None


def build_router(settings: Settings, require_session: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_session)])
    writes = [Depends(check_origin)]

    # ---- sonno -----------------------------------------------------------------------------
    @r.get("/sleep")
    def list_sleep(date_from: IsoDate | None = Query(default=None, alias="from"),
                   date_to: IsoDate | None = Query(default=None, alias="to")):
        last = date_to or today().isoformat()
        first = date_from or (date.fromisoformat(last) - timedelta(days=59)).isoformat()
        with connect(settings.db_path) as c:
            rows = sleep_rows(c, first, last)
        return {"items": rows, "summary": sleep_summary(rows)}

    @r.put("/sleep/{day}", dependencies=writes)
    def put_sleep(day: IsoDate, body: SleepPut, edited: str = Depends(edit_time)):
        now = edited
        with connect(settings.db_path) as c, transaction(c):
            if is_stale(_saved_at(c, "sleep_logs", "date", day), edited):
                return STALE
            c.execute(
                "INSERT INTO sleep_logs (date, bed_time, wake_time, source, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(date) DO UPDATE SET bed_time=excluded.bed_time, wake_time=excluded.wake_time,"
                " source=excluded.source, note=excluded.note, updated_at=excluded.updated_at, deleted_at=NULL",
                (day, body.bed_time, body.wake_time, body.source, body.note, now),
            )
        return {"ok": True, "duration_min": domain.sleep_minutes(body.bed_time, body.wake_time)}

    @r.delete("/sleep/{day}", dependencies=writes)
    def delete_sleep(day: IsoDate, edited: str = Depends(edit_time)):
        with connect(settings.db_path) as c, transaction(c):
            if is_stale(_saved_at(c, "sleep_logs", "date", day), edited):
                return STALE
            c.execute("UPDATE sleep_logs SET deleted_at=?, updated_at=? WHERE date=?", (edited, edited, day))
        return {"ok": True}

    # ---- note per esercizio (restano tra una seduta e l'altra: sedile, presa, fastidi) ----------
    @r.get("/exercise-notes")
    def list_exercise_notes():
        with connect(settings.db_path) as c:
            return {"items": _rows(c, "SELECT exercise_id, note, updated_at FROM exercise_notes WHERE note <> ''")}

    @r.put("/exercise-notes/{exercise_id}", dependencies=writes)
    def put_exercise_note(exercise_id: str, body: ExerciseNotePut, edited: str = Depends(edit_time)):
        if not (1 <= len(exercise_id) <= 64) or not exercise_id.replace("-", "").replace("_", "").isalnum():
            raise HTTPException(status_code=422, detail="Esercizio non valido")
        with connect(settings.db_path) as c, transaction(c):
            if is_stale(_saved_at(c, "exercise_notes", "exercise_id", exercise_id), edited):
                return STALE
            c.execute(
                "INSERT INTO exercise_notes (exercise_id, note, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT(exercise_id) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at",
                (exercise_id, body.note.strip(), edited),
            )
        return {"ok": True}

    # ---- spesa reale per settimana (un totale, inserito quando arriva la consegna) ---------------
    @r.get("/grocery-spend")
    def list_grocery_spend(limit: int = Query(default=12, ge=1, le=104)):
        with connect(settings.db_path) as c:
            rows = _rows(c, "SELECT week_start, amount, note FROM grocery_spend ORDER BY week_start DESC LIMIT ?", (limit,))
        return {"items": rows}

    @r.put("/grocery-spend/{week_start}", dependencies=writes)
    def put_grocery_spend(week_start: IsoDate, body: GrocerySpendPut):
        monday = date.fromisoformat(week_start)
        monday -= timedelta(days=monday.weekday())  # qualsiasi giorno → lunedì della sua settimana
        with connect(settings.db_path) as c, transaction(c):
            c.execute(
                "INSERT INTO grocery_spend (week_start, amount, note, updated_at) VALUES (?, ?, ?, ?)"
                " ON CONFLICT(week_start) DO UPDATE SET amount=excluded.amount, note=excluded.note,"
                " updated_at=excluded.updated_at",
                (monday.isoformat(), body.amount, body.note, now_iso()),
            )
        return {"ok": True, "week_start": monday.isoformat()}

    @r.delete("/grocery-spend/{week_start}", dependencies=writes)
    def delete_grocery_spend(week_start: IsoDate):
        with connect(settings.db_path) as c, transaction(c):
            c.execute("DELETE FROM grocery_spend WHERE week_start=?", (week_start,))
        return {"ok": True}

    return r
