import sqlite3
from datetime import date, datetime, timedelta

from app import daily
from app.migrations import default_reminders
from app.workouts import TZ

MON = "2026-11-09"  # lunedì: giorno palestra A


def test_default_reminders_cover_routine(auth_client):
    items = auth_client.get("/api/v1/reminders").json()["items"]
    assert len(items) == len(default_reminders())
    monday = [(i["time"], i["action"]) for i in items if i["weekday"] == 0]
    assert ("18:30", "log_meal") in monday and ("19:15", "start_workout") in monday and ("22:30", "log_meal") in monday
    assert any(i["action"] == "log_weight" for i in items)
    assert any(i["action"] == "open_shopping" and i["weekday"] == 6 for i in items)


def test_agenda_states_and_auto_completion(auth_client):
    ag = auth_client.get(f"/api/v1/agenda?date={MON}").json()["items"]
    assert all(i["state"] == "pending" for i in ag)
    pre = next(i for i in ag if i["slot"] == "pre_workout")
    # registrare il pasto completa il promemoria
    assert auth_client.put("/api/v1/meal-logs/m1", json={"date": MON, "slot": "pre_workout", "description": "Banana",
                                                          "template_id": "t-banana"}).status_code == 200
    # la palestra si completa avviando la seduta
    auth_client.post("/api/v1/workout-sessions", json={"id": "s1", "routine": "A", "week": 1, "date": MON})
    ag = {i["id"]: i for i in auth_client.get(f"/api/v1/agenda?date={MON}").json()["items"]}
    assert ag[pre["id"]]["state"] == "done" and ag[pre["id"]]["detail"] == "Banana"
    assert next(i for i in ag.values() if i["action"] == "start_workout")["state"] == "done"


def test_skipped_meal_and_ack(auth_client):
    ag = auth_client.get(f"/api/v1/agenda?date={MON}").json()["items"]
    lunch = next(i for i in ag if i["slot"] == "lunch")
    sleep = next(i for i in ag if i["kind"] == "sleep")
    auth_client.put("/api/v1/meal-logs/m2", json={"date": MON, "slot": "lunch", "status": "skipped"})
    assert auth_client.put(f"/api/v1/reminders/{sleep['id']}/ack", json={"date": MON, "status": "dismissed"}).status_code == 200
    ag = {i["id"]: i for i in auth_client.get(f"/api/v1/agenda?date={MON}").json()["items"]}
    assert ag[lunch["id"]]["state"] == "skipped" and ag[sleep["id"]]["state"] == "skipped"


def test_snooze_moves_due_time(auth_client, settings):
    d = datetime.now(TZ).date()
    item = auth_client.get(f"/api/v1/agenda?date={d}").json()["items"][0]
    r = auth_client.put(f"/api/v1/reminders/{item['id']}/ack", json={"date": d.isoformat(), "status": "snoozed", "snooze_minutes": 30})
    assert r.json()["snooze_until"]
    with sqlite3.connect(settings.db_path) as c:
        now = datetime.now(TZ)
        later = daily.agenda_for(c, d, now)
        snoozed = next(i for i in later if i["id"] == item["id"])
        assert snoozed["state"] == "snoozed" and not snoozed["due"]
        expired = daily.agenda_for(c, d, now + timedelta(minutes=31))
        assert next(i for i in expired if i["id"] == item["id"])["state"] == "pending"


def test_due_flag_depends_on_time(settings, auth_client):
    with sqlite3.connect(settings.db_path) as c:
        morning = daily.agenda_for(c, date(2026, 11, 9), datetime(2026, 11, 9, 13, 30, tzinfo=TZ))
        due = {i["time"]: i["due"] for i in morning}
        assert due["13:00"] is True and due["18:30"] is False


def test_reminder_crud_and_validation(auth_client):
    body = {"weekday": 2, "time": "07:45", "kind": "custom", "title": "Prepara la borsa", "action": "none"}
    assert auth_client.put("/api/v1/reminders/custom-1", json=body).status_code == 200
    assert auth_client.put("/api/v1/reminders/custom-1", json={**body, "time": "25:00"}).status_code == 422
    assert auth_client.put("/api/v1/reminders/custom-2", json={**body, "action": "log_meal"}).status_code == 422
    assert auth_client.put("/api/v1/reminders/custom-1", json={**body, "enabled": False}).status_code == 200
    ag = auth_client.get("/api/v1/agenda?date=2026-11-11").json()["items"]
    assert all(i["id"] != "custom-1" for i in ag), "i promemoria disattivati non compaiono"
    assert auth_client.delete("/api/v1/reminders/custom-1").status_code == 200


def test_meal_log_estimates_from_template(auth_client):
    auth_client.put("/api/v1/meal-logs/a", json={"date": MON, "slot": "lunch", "template_id": "t-mensa-primo",
                                                 "description": "Primo + contorno"})
    auth_client.put("/api/v1/meal-logs/b", json={"date": MON, "slot": "dinner", "description": "Secondo",
                                                 "kcal": 320, "nutrition_source": "label"})
    auth_client.put("/api/v1/meal-logs/c", json={"date": MON, "slot": "snack", "description": "Qualcosa"})
    items = {m["id"]: m for m in auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"]}
    assert items["a"]["kcal"] == 550 and items["a"]["nutrition_source"] == "estimate"
    assert items["b"]["nutrition_source"] == "label"
    assert items["c"]["kcal"] is None and items["c"]["nutrition_source"] is None


def test_meal_log_validation(auth_client):
    assert auth_client.put("/api/v1/meal-logs/x", json={"date": MON, "slot": "brunch"}).status_code == 422
    assert auth_client.put("/api/v1/meal-logs/x", json={"date": MON, "slot": "lunch", "kcal": -1}).status_code == 422
    assert auth_client.put("/api/v1/meal-logs/bad%20id", json={"date": MON, "slot": "lunch"}).status_code == 422


def test_weekly_summary(auth_client):
    auth_client.put("/api/v1/meal-logs/a", json={"date": MON, "slot": "lunch", "template_id": "t-mensa-primo"})
    auth_client.put("/api/v1/meal-logs/b", json={"date": MON, "slot": "dinner", "template_id": "t-secondo"})
    auth_client.put("/api/v1/meal-logs/c", json={"date": MON, "slot": "snack", "description": "senza valori"})
    auth_client.post("/api/v1/workout-sessions", json={"id": "s1", "routine": "A", "week": 1, "date": MON})
    auth_client.put("/api/v1/workout-sessions/s1/sets/a1/1", json={"kg": 40, "reps": 10})
    auth_client.patch("/api/v1/workout-sessions/s1", json={"status": "done"})
    w = auth_client.get(f"/api/v1/weekly-summary?week_start=2026-11-11").json()
    assert w["week_start"] == MON
    mon = w["days"][0]
    assert mon["kcal_estimate"] == 850 and mon["protein_estimate_g"] == 43 and mon["meals_without_values"] == 1
    assert mon["meals_eaten"] == 3 and mon["meals_expected"] == 3
    assert mon["workouts"] == [{"routine": "A", "sets_done": 1, "sets_planned": 17}]
    t = w["totals"]
    assert t["workouts_done"] == 1 and t["workouts_planned"] == 3 and t["sets_done"] == 1 and t["days_with_values"] == 1
    assert "stime" in w["estimate_note"]


def test_templates_crud(auth_client):
    items = auth_client.get("/api/v1/meal-templates").json()["items"]
    assert any(t["id"] == "t-banana" and t["nutrition_source"] == "estimate" for t in items)
    assert auth_client.put("/api/v1/meal-templates/t-mio", json={"slot": "snack", "name": "Mandorle (30 g)", "kcal": 180,
                                                                  "nutrition_source": "label"}).status_code == 200
    assert auth_client.delete("/api/v1/meal-templates/t-mio").status_code == 200
    assert all(t["id"] != "t-mio" for t in auth_client.get("/api/v1/meal-templates").json()["items"])


def test_backup_v3_roundtrip_includes_meals_and_reminders(auth_client):
    auth_client.put("/api/v1/meal-logs/a", json={"date": MON, "slot": "lunch", "template_id": "t-mensa-primo"})
    auth_client.put("/api/v1/reminders/r0-1300-meal", json={"weekday": 0, "time": "13:15", "kind": "meal",
                                                            "slot": "lunch", "title": "Pranzo", "action": "log_meal"})
    b = auth_client.get("/api/backup").json()
    assert b["format"] == "fitweek-backup-v3" and len(b["meal_logs"]) == 1 and b["reminders"]
    auth_client.delete("/api/v1/meal-logs/a")
    assert auth_client.post("/api/v1/restore", json=b).status_code == 200
    assert len(auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"]) == 1
    r = next(x for x in auth_client.get("/api/v1/reminders").json()["items"] if x["id"] == "r0-1300-meal")
    assert r["time"] == "13:15"


def test_restore_v2_keeps_meal_tables(auth_client):
    auth_client.put("/api/v1/meal-logs/a", json={"date": MON, "slot": "lunch"})
    b = auth_client.get("/api/backup").json()
    v2 = {k: b[k] for k in ("version", "data", "workout_sessions")} | {"format": "fitweek-backup-v2"}
    assert auth_client.post("/api/v1/restore", json=v2).status_code == 200
    assert len(auth_client.get(f"/api/v1/meal-logs?from={MON}&to={MON}").json()["items"]) == 1
