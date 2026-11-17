"""Copia per l'app autonoma (`/api/v1/sync/snapshot`), pasto collegato al promemoria, polvere proteica nel
profilo e modifiche vecchie che non sovrascrivono le più recenti anche su abituali, catalogo, promemoria e spesa."""
MON = "2026-11-09"
OLD = "2026-11-09T10:00:00.000+01:00"
NEW = "2026-11-09T12:00:00.000+01:00"


def at(moment):
    return {"X-Edited-At": moment}


def test_snapshot_has_every_daily_domain(auth_client):
    auth_client.put("/api/v1/meal-logs/m1", json={"date": MON, "slot": "lunch", "items": [
        {"name": "Pasta al pomodoro", "category": "primo", "kcal": 400, "protein_g": 12, "nutrition_source": "manual"}]})
    auth_client.put("/api/v1/meal-logs/gone", json={"date": MON, "slot": "dinner", "description": "x"})
    auth_client.delete("/api/v1/meal-logs/gone")
    auth_client.put(f"/api/v1/sleep/{MON}", json={"bed_time": "00:10", "wake_time": "07:30"})
    auth_client.put("/api/v1/exercise-notes/a1", json={"note": "sedile 4"})
    auth_client.put(f"/api/v1/grocery-spend/{MON}", json={"amount": 41.5})
    rid = auth_client.get("/api/v1/reminders").json()["items"][0]["id"]
    auth_client.put(f"/api/v1/reminders/{rid}/ack", json={"date": MON, "status": "dismissed"})

    snap = auth_client.get("/api/v1/sync/snapshot?days=400").json()
    assert [m["id"] for m in snap["meal_logs"]] == ["m1"]  # i pasti eliminati non viaggiano
    assert snap["meal_logs"][0]["items"][0]["protein_g"] == 12
    assert snap["reminders"] == auth_client.get("/api/v1/reminders").json()["items"]
    assert snap["foods"] == auth_client.get("/api/v1/foods").json()["items"]
    assert snap["meal_templates"] == auth_client.get("/api/v1/meal-templates").json()["items"]
    assert snap["sleep_logs"] == [{"date": MON, "bed_time": "00:10", "wake_time": "07:30", "source": "manual", "note": "",
                                  "deep_min": None, "light_min": None, "rem_min": None, "awake_min": None}]
    assert snap["exercise_notes"][0]["exercise_id"] == "a1"
    assert snap["grocery_spend"] == [{"week_start": MON, "amount": 41.5, "note": ""}]
    assert [(a["reminder_id"], a["status"]) for a in snap["reminder_acks"]] == [(rid, "dismissed")]


def test_snapshot_window_and_auth(client, auth_client):
    auth_client.put("/api/v1/meal-logs/old", json={"date": "2020-01-01", "slot": "lunch", "description": "vecchio"})
    assert auth_client.get("/api/v1/sync/snapshot").json()["meal_logs"] == []
    assert auth_client.get("/api/v1/sync/snapshot?days=3").status_code == 422
    client.cookies.clear()
    assert client.get("/api/v1/sync/snapshot").status_code == 401


def test_agenda_links_the_meal_that_closed_the_reminder(auth_client):
    auth_client.put("/api/v1/meal-logs/m1", json={"date": MON, "slot": "lunch", "description": "Riso"})
    auth_client.put("/api/v1/meal-logs/m2", json={"date": MON, "slot": "pre_workout", "status": "skipped"})
    by_slot = {i["slot"]: i for i in auth_client.get(f"/api/v1/agenda?date={MON}").json()["items"] if i["slot"]}
    assert by_slot["lunch"]["meal_id"] == "m1"
    assert by_slot["pre_workout"]["meal_id"] == "m2"
    assert by_slot["dinner"]["meal_id"] is None


def test_profile_accepts_protein_powder_and_rejects_bad_values(auth_client):
    state = auth_client.get("/api/state").json()
    state["data"]["profile"]["proteinPowder"] = {"name": "Whey", "scoopG": 30, "proteinG": 24, "kcal": 118}
    assert auth_client.put("/api/state", json=state).status_code == 200
    saved = auth_client.get("/api/state").json()
    assert saved["data"]["profile"]["proteinPowder"]["proteinG"] == 24
    saved["data"]["profile"]["proteinPowder"] = {"name": "Whey", "proteinG": -1}
    assert auth_client.put("/api/state", json=saved).status_code == 422


TEMPLATE = {"slot": "snack", "name": "Yogurt", "kcal": 120, "protein_g": 17, "nutrition_source": "label"}
FOOD = {"category": "altro", "name": "Skyr", "kcal": 100, "protein_g": 17, "nutrition_source": "label"}
REMINDER = {"weekday": 0, "time": "17:00", "kind": "custom", "title": "Acqua", "action": "none"}


def test_older_edit_does_not_overwrite_a_newer_one(auth_client):
    cases = [("/api/v1/meal-templates/t-x", TEMPLATE, "name", "/api/v1/meal-templates"),
             ("/api/v1/foods/f-x", FOOD, "name", "/api/v1/foods"),
             ("/api/v1/reminders/r-x", REMINDER, "title", "/api/v1/reminders")]
    for path, body, field, listing in cases:
        rid = path.rsplit("/", 1)[1]
        assert auth_client.put(path, json={**body, field: "nuovo"}, headers=at(NEW)).json() == {"ok": True}
        assert auth_client.put(path, json={**body, field: "vecchio"}, headers=at(OLD)).json()["stale"] is True
        row = next(i for i in auth_client.get(listing).json()["items"] if i["id"] == rid)
        assert row[field] == "nuovo", path


def test_older_delete_does_not_remove_a_newer_edit(auth_client):
    for path, body, listing in [("/api/v1/meal-templates/t-y", TEMPLATE, "/api/v1/meal-templates"),
                                ("/api/v1/foods/f-y", FOOD, "/api/v1/foods")]:
        auth_client.put(path, json=body, headers=at(NEW))
        assert auth_client.delete(path, headers=at(OLD)).json()["stale"] is True
        assert any(i["id"] == path.rsplit("/", 1)[1] for i in auth_client.get(listing).json()["items"]), path


def test_older_grocery_spend_does_not_overwrite(auth_client):
    auth_client.put(f"/api/v1/grocery-spend/{MON}", json={"amount": 45}, headers=at(NEW))
    assert auth_client.put(f"/api/v1/grocery-spend/{MON}", json={"amount": 30}, headers=at(OLD)).json()["stale"] is True
    assert auth_client.get("/api/v1/grocery-spend").json()["items"][0]["amount"] == 45
