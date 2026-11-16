"""Copia dei dati per l'app autonoma: tutte le righe che servono a lavorare senza rete, in una sola lettura.

L'app tiene questa copia sul telefono, ci applica sopra le modifiche ancora in coda e da lì ricostruisce
agenda, diario e riepilogo quando il server non risponde (`static/js/local.js`). Il server resta la copia
che fa fede: a coda vuota il telefono riparte da ciò che arriva da qui.
"""
import sqlite3
from datetime import timedelta
from typing import Callable

from fastapi import APIRouter, Depends, Query

from .config import Settings
from .daily import parse_items
from .db import connect, snapshot
from .workouts import now_iso, today


def _rows(c: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    c.row_factory = sqlite3.Row
    return [dict(r) for r in c.execute(sql, params)]


def build_router(settings: Settings, require_session: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_session)])

    @r.get("/sync/snapshot")
    def get_snapshot(days: int = Query(default=60, ge=7, le=400)):
        """Righe non eliminate dei domini giornalieri. Diario, sonno e conferme dei promemoria sono limitati
        agli ultimi `days` giorni; cataloghi e promemoria sono completi. Lo stato a blob e le sedute hanno
        già le loro API (`/api/state`, `/api/v1/workout-sessions`)."""
        since = (today() - timedelta(days=days - 1)).isoformat()
        with connect(settings.db_path) as c, snapshot(c):
            reminders = _rows(c, "SELECT * FROM reminders ORDER BY weekday, time, id")
            for x in reminders:
                x["enabled"] = bool(x["enabled"])
            return {
                "as_of": now_iso(),
                "since": since,
                "meal_logs": [parse_items(m) for m in _rows(
                    c, "SELECT * FROM meal_logs WHERE date >= ? AND deleted_at IS NULL ORDER BY date, logged_at", (since,))],
                "meal_templates": _rows(c, "SELECT * FROM meal_templates WHERE deleted_at IS NULL ORDER BY position, name"),
                "foods": _rows(c, "SELECT * FROM foods WHERE deleted_at IS NULL ORDER BY category, use_count DESC, name"),
                "reminders": reminders,
                "reminder_acks": _rows(c, "SELECT * FROM reminder_acks WHERE date >= ?", (since,)),
                "sleep_logs": _rows(c, "SELECT date, bed_time, wake_time, source, note FROM sleep_logs"
                                       " WHERE date >= ? AND deleted_at IS NULL ORDER BY date", (since,)),
                "exercise_notes": _rows(c, "SELECT exercise_id, note, updated_at FROM exercise_notes WHERE note <> ''"),
                "grocery_spend": _rows(c, "SELECT week_start, amount, note FROM grocery_spend ORDER BY week_start DESC"),
            }

    return r
