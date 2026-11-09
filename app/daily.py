"""API v1 per la giornata: pasti abituali, diario pasti, promemoria/agenda, riepilogo settimanale.

Le calorie sono sempre "teoriche": somma dei valori stimati o dichiarati dei pasti registrati.
Ogni risposta riporta quanti pasti non hanno valori, così l'interfaccia non spaccia una
somma parziale per completa.
"""
import json
import sqlite3
from datetime import date, datetime, timedelta
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query

from . import domain
from .config import Settings
from .db import connect, transaction
from .schemas import IsoDate, MealLogPut, MealTemplatePut, ReminderAck, ReminderPut
from .security import check_origin
from .workouts import TZ, now_iso, today

MEAL_ACTION = "log_meal"


def _rows(c: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    c.row_factory = sqlite3.Row
    return [dict(r) for r in c.execute(sql, params)]


def _blob(c: sqlite3.Connection) -> dict:
    return json.loads(c.execute("SELECT json FROM app_state WHERE id=1").fetchone()[0])


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def agenda_for(c: sqlite3.Connection, d: date, now: datetime | None = None) -> list[dict]:
    """Promemoria del giorno con stato: done | skipped | snoozed | pending, e se sono già scaduti."""
    iso = d.isoformat()
    reminders = _rows(c, "SELECT * FROM reminders WHERE weekday=? AND enabled=1 ORDER BY time, id", (d.weekday(),))
    acks = {a["reminder_id"]: a for a in _rows(c, "SELECT * FROM reminder_acks WHERE date=?", (iso,))}
    meals = {}
    for m in _rows(c, "SELECT slot, status, description FROM meal_logs WHERE date=? AND deleted_at IS NULL"
                      " ORDER BY logged_at", (iso,)):
        meals.setdefault(m["slot"], m)
    weighed = any(w.get("date") == iso for w in _blob(c).get("weights", []))
    trained = c.execute("SELECT 1 FROM workout_sessions WHERE date=? AND deleted_at IS NULL"
                        " AND status IN ('done','in_progress') LIMIT 1", (iso,)).fetchone() is not None
    now = now or datetime.now(TZ)
    out = []
    for r in reminders:
        state, detail = "pending", ""
        if r["action"] == MEAL_ACTION and r["slot"] in meals:
            m = meals[r["slot"]]
            state, detail = ("done" if m["status"] == "eaten" else "skipped"), m["description"]
        elif r["action"] == "log_weight" and weighed:
            state = "done"
        elif r["action"] == "start_workout" and trained:
            state = "done"
        ack = acks.get(r["id"])
        if state == "pending" and ack:
            if ack["status"] == "done":
                state = "done"
            elif ack["status"] == "dismissed":
                state = "skipped"
            elif ack["snooze_until"] and datetime.fromisoformat(ack["snooze_until"]) > now:
                state = "snoozed"
        due_at = datetime.combine(d, datetime.strptime(r["time"], "%H:%M").time(), TZ)
        if state == "snoozed":
            due_at = datetime.fromisoformat(ack["snooze_until"])
        out.append({**r, "enabled": bool(r["enabled"]), "state": state, "detail": detail,
                    "due_at": due_at.isoformat(timespec="minutes"), "due": state == "pending" and due_at <= now})
    return out


def weekly_summary(c: sqlite3.Connection, week_start: date) -> dict:
    days = [week_start + timedelta(days=i) for i in range(7)]
    first, last = days[0].isoformat(), days[-1].isoformat()
    blob = _blob(c)
    logs = _rows(c, "SELECT * FROM meal_logs WHERE date BETWEEN ? AND ? AND deleted_at IS NULL", (first, last))
    expected = {wd: n for wd, n in c.execute(
        "SELECT weekday, count(*) FROM reminders WHERE enabled=1 AND action=? GROUP BY weekday", (MEAL_ACTION,))}
    sessions = _rows(c, "SELECT id, routine, week, date, status FROM workout_sessions WHERE date BETWEEN ? AND ?"
                        " AND deleted_at IS NULL AND status='done'", (first, last))
    sets_done = dict(c.execute(
        "SELECT session_id, count(*) FROM set_logs WHERE completed=1 AND session_id IN"
        " (SELECT id FROM workout_sessions WHERE date BETWEEN ? AND ? AND deleted_at IS NULL AND status='done')"
        " GROUP BY session_id", (first, last)).fetchall())
    start = date.fromisoformat(blob["profile"]["startDate"])
    pweek = domain.program_week(start, week_start)
    routines = blob.get("routines", {})
    planned_by_routine = {r: sum(domain.planned_sets(ex["sets"], pweek) for ex in exs) for r, exs in routines.items()}

    out_days = []
    for d in days:
        iso = d.isoformat()
        dl = [m for m in logs if m["date"] == iso]
        eaten = [m for m in dl if m["status"] == "eaten"]
        with_kcal = [m for m in eaten if m["kcal"] is not None]
        out_days.append({
            "date": iso,
            "meals_eaten": len(eaten),
            "meals_skipped": len(dl) - len(eaten),
            "meals_expected": expected.get(d.weekday(), 0),
            "meals_without_values": len(eaten) - len(with_kcal),
            "kcal_estimate": round(sum(m["kcal"] for m in with_kcal)) if with_kcal else None,
            "protein_estimate_g": round(sum(m["protein_g"] or 0 for m in with_kcal)) if with_kcal else None,
            "workouts": [{"routine": s["routine"], "sets_done": sets_done.get(s["id"], 0),
                          "sets_planned": planned_by_routine.get(s["routine"], 0)}
                         for s in sessions if s["date"] == iso],
        })
    weights = [w["weight"] for w in blob.get("weights", []) if first <= w.get("date", "") <= last]
    logged_days = [x for x in out_days if x["kcal_estimate"] is not None]
    scheduled = [r for r in domain.SCHEDULE.values() if r in planned_by_routine]
    return {
        "week_start": first,
        "program_week": pweek,
        "days": out_days,
        "totals": {
            "kcal_estimate_avg": round(sum(x["kcal_estimate"] for x in logged_days) / len(logged_days)) if logged_days else None,
            "protein_estimate_avg_g": round(sum(x["protein_estimate_g"] for x in logged_days) / len(logged_days)) if logged_days else None,
            "days_with_values": len(logged_days),
            "meals_eaten": sum(x["meals_eaten"] for x in out_days),
            "meals_expected": sum(x["meals_expected"] for x in out_days),
            "meals_without_values": sum(x["meals_without_values"] for x in out_days),
            "workouts_done": len(sessions),
            "workouts_planned": len(scheduled),
            "sets_done": sum(sets_done.get(s["id"], 0) for s in sessions),
            "sets_planned": sum(planned_by_routine[r] for r in scheduled),
            "weight_avg": round(sum(weights) / len(weights), 1) if weights else None,
            "weigh_ins": len(weights),
        },
        "estimate_note": "Calorie e proteine sono stime teoriche dai pasti registrati, non misure.",
    }


def build_router(settings: Settings, require_session: Callable) -> APIRouter:
    r = APIRouter(prefix="/api/v1", dependencies=[Depends(require_session)])
    writes = [Depends(check_origin)]

    # ---- pasti abituali --------------------------------------------------------------------
    @r.get("/meal-templates")
    def list_templates():
        with connect(settings.db_path) as c:
            return {"items": _rows(c, "SELECT * FROM meal_templates WHERE deleted_at IS NULL ORDER BY position, name")}

    @r.put("/meal-templates/{tid}", dependencies=writes)
    def put_template(tid: str, body: MealTemplatePut):
        _check_id(tid)
        now = now_iso()
        with connect(settings.db_path) as c, transaction(c):
            c.execute(
                "INSERT INTO meal_templates (id, slot, name, kcal, protein_g, nutrition_source, nutrition_note,"
                " position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET slot=excluded.slot, name=excluded.name, kcal=excluded.kcal,"
                " protein_g=excluded.protein_g, nutrition_source=excluded.nutrition_source,"
                " nutrition_note=excluded.nutrition_note, position=excluded.position, updated_at=excluded.updated_at,"
                " deleted_at=NULL",
                (tid, body.slot, body.name, body.kcal, body.protein_g, _source(body.kcal, body.nutrition_source),
                 body.nutrition_note, body.position, now, now),
            )
        return {"ok": True}

    @r.delete("/meal-templates/{tid}", dependencies=writes)
    def delete_template(tid: str):
        with connect(settings.db_path) as c, transaction(c):
            c.execute("UPDATE meal_templates SET deleted_at=? WHERE id=?", (now_iso(), tid))
        return {"ok": True}

    # ---- diario pasti ----------------------------------------------------------------------
    @r.get("/meal-logs")
    def list_meal_logs(date_from: IsoDate = Query(alias="from"), date_to: IsoDate = Query(alias="to")):
        with connect(settings.db_path) as c:
            return {"items": _rows(c, "SELECT * FROM meal_logs WHERE date BETWEEN ? AND ? AND deleted_at IS NULL"
                                      " ORDER BY date, logged_at", (date_from, date_to))}

    @r.put("/meal-logs/{mid}", dependencies=writes)
    def put_meal_log(mid: str, body: MealLogPut):
        _check_id(mid)
        now = now_iso()
        kcal, protein, source = body.kcal, body.protein_g, body.nutrition_source
        with connect(settings.db_path) as c, transaction(c):
            if body.template_id and kcal is None:
                t = c.execute("SELECT kcal, protein_g, nutrition_source FROM meal_templates WHERE id=?",
                              (body.template_id,)).fetchone()
                if t:
                    kcal, protein, source = t
            if body.status == "skipped":
                kcal = protein = source = None
            c.execute(
                "INSERT INTO meal_logs (id, date, slot, status, description, template_id, kcal, protein_g,"
                " nutrition_source, note, logged_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                " ON CONFLICT(id) DO UPDATE SET date=excluded.date, slot=excluded.slot, status=excluded.status,"
                " description=excluded.description, template_id=excluded.template_id, kcal=excluded.kcal,"
                " protein_g=excluded.protein_g, nutrition_source=excluded.nutrition_source, note=excluded.note,"
                " updated_at=excluded.updated_at, deleted_at=NULL",
                (mid, body.date, body.slot, body.status, body.description, body.template_id, kcal, protein,
                 _source(kcal, source), body.note, now, now),
            )
        return {"ok": True}

    @r.delete("/meal-logs/{mid}", dependencies=writes)
    def delete_meal_log(mid: str):
        with connect(settings.db_path) as c, transaction(c):
            c.execute("UPDATE meal_logs SET deleted_at=? WHERE id=?", (now_iso(), mid))
        return {"ok": True}

    # ---- promemoria e agenda ---------------------------------------------------------------
    @r.get("/reminders")
    def list_reminders():
        with connect(settings.db_path) as c:
            items = _rows(c, "SELECT * FROM reminders ORDER BY weekday, time, id")
        for i in items:
            i["enabled"] = bool(i["enabled"])
        return {"items": items}

    @r.put("/reminders/{rid}", dependencies=writes)
    def put_reminder(rid: str, body: ReminderPut):
        _check_id(rid)
        if body.action == MEAL_ACTION and not body.slot:
            raise HTTPException(status_code=422, detail="Un promemoria pasto richiede il tipo di pasto")
        now = now_iso()
        with connect(settings.db_path) as c, transaction(c):
            c.execute(
                "INSERT INTO reminders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET"
                " weekday=excluded.weekday, time=excluded.time, kind=excluded.kind, slot=excluded.slot,"
                " title=excluded.title, action=excluded.action, enabled=excluded.enabled, updated_at=excluded.updated_at",
                (rid, body.weekday, body.time, body.kind, body.slot, body.title, body.action, int(body.enabled), now, now),
            )
        return {"ok": True}

    @r.delete("/reminders/{rid}", dependencies=writes)
    def delete_reminder(rid: str):
        with connect(settings.db_path) as c, transaction(c):
            c.execute("DELETE FROM reminder_acks WHERE reminder_id=?", (rid,))
            c.execute("DELETE FROM reminders WHERE id=?", (rid,))
        return {"ok": True}

    @r.put("/reminders/{rid}/ack", dependencies=writes)
    def ack_reminder(rid: str, body: ReminderAck):
        until = None
        if body.status == "snoozed":
            until = (datetime.now(TZ) + timedelta(minutes=body.snooze_minutes or 15)).isoformat(timespec="seconds")
        with connect(settings.db_path) as c, transaction(c):
            if not c.execute("SELECT 1 FROM reminders WHERE id=?", (rid,)).fetchone():
                raise HTTPException(status_code=404, detail="Promemoria non trovato")
            c.execute(
                "INSERT INTO reminder_acks VALUES (?, ?, ?, ?, ?) ON CONFLICT(reminder_id, date) DO UPDATE SET"
                " status=excluded.status, snooze_until=excluded.snooze_until, at=excluded.at",
                (rid, body.date, body.status, until, now_iso()),
            )
        return {"ok": True, "snooze_until": until}

    @r.get("/agenda")
    def get_agenda(day: IsoDate | None = Query(default=None, alias="date")):
        d = date.fromisoformat(day) if day else today()
        with connect(settings.db_path) as c:
            return {"date": d.isoformat(), "items": agenda_for(c, d)}

    @r.get("/weekly-summary")
    def get_weekly_summary(week_start: IsoDate | None = Query(default=None)):
        d = monday_of(date.fromisoformat(week_start) if week_start else today())
        with connect(settings.db_path) as c:
            return weekly_summary(c, d)

    return r


def _check_id(value: str) -> None:
    if not (1 <= len(value) <= 64) or not value.replace("-", "").replace("_", "").isalnum():
        raise HTTPException(status_code=422, detail="Identificativo non valido")


def _source(kcal, source):
    """Un valore senza fonte dichiarata è trattato come stima: mai presentato come misura."""
    if kcal is None:
        return None
    return source or "estimate"
