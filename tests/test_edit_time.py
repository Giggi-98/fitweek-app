"""Vince l'ultima modifica FATTA, non l'ultima arrivata: una scrittura rimasta in coda su un dispositivo offline
non deve sovrascrivere un dato corretto più di recente da un altro dispositivo."""
from datetime import datetime, timedelta, timezone

from .test_workouts import SID, new_session

OLD = {"X-Edited-At": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}
FUTURE = {"X-Edited-At": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()}
SET = f"/api/v1/workout-sessions/{SID}/sets/a1/1"


def sets(c):
    return c.get(f"/api/v1/workout-sessions/{SID}").json()["sets"]


def test_old_set_edit_does_not_overwrite_newer(auth_client):
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 50, "reps": 8}).json() == {"ok": True}
    stale = auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=OLD)
    assert stale.status_code == 200 and stale.json() == {"ok": True, "stale": True}
    assert sets(auth_client)[0]["kg"] == 50
    assert auth_client.delete(SET, headers=OLD).json()["stale"] is True and len(sets(auth_client)) == 1
    assert auth_client.put(SET, json={"kg": 52.5, "reps": 8}).json() == {"ok": True}  # senza orario = adesso
    assert sets(auth_client)[0]["kg"] == 52.5


def test_offline_edit_of_a_new_set_keeps_its_real_time(auth_client):
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=OLD).json() == {"ok": True}
    assert sets(auth_client)[0]["logged_at"][:10] == OLD["X-Edited-At"][:10]


def test_future_or_invalid_edit_time_counts_as_now(auth_client):
    new_session(auth_client)
    auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=FUTURE)
    assert datetime.fromisoformat(sets(auth_client)[0]["logged_at"]) <= datetime.now(timezone.utc) + timedelta(seconds=5)
    assert auth_client.put(SET, json={"kg": 41, "reps": 10}, headers={"X-Edited-At": "ieri"}).json() == {"ok": True}
    assert sets(auth_client)[0]["kg"] == 41


def test_old_meal_edit_and_delete_do_not_overwrite_newer(auth_client):
    meal = {"date": "2026-11-09", "slot": "lunch", "description": "Pasta"}
    assert auth_client.put("/api/v1/meal-logs/m1", json=meal).status_code == 200
    assert auth_client.put("/api/v1/meal-logs/m1", json={**meal, "description": "Riso"}, headers=OLD).json()["stale"] is True
    assert auth_client.delete("/api/v1/meal-logs/m1", headers=OLD).json()["stale"] is True
    items = auth_client.get("/api/v1/meal-logs?from=2026-11-09&to=2026-11-09").json()["items"]
    assert [m["description"] for m in items] == ["Pasta"]
    assert auth_client.delete("/api/v1/meal-logs/m1").json() == {"ok": True}
    assert auth_client.get("/api/v1/meal-logs?from=2026-11-09&to=2026-11-09").json()["items"] == []


def test_old_sleep_and_note_edits_do_not_overwrite_newer(auth_client):
    night = "/api/v1/sleep/2026-11-10"
    auth_client.put(night, json={"bed_time": "00:10", "wake_time": "07:30"})
    assert auth_client.put(night, json={"bed_time": "02:00", "wake_time": "07:30"}, headers=OLD).json()["stale"] is True
    assert auth_client.delete(night, headers=OLD).json()["stale"] is True
    assert auth_client.get("/api/v1/sleep?from=2026-11-10&to=2026-11-10").json()["items"][0]["bed_time"] == "00:10"
    auth_client.put("/api/v1/exercise-notes/a1", json={"note": "sedile 4"})
    assert auth_client.put("/api/v1/exercise-notes/a1", json={"note": "sedile 2"}, headers=OLD).json()["stale"] is True
    assert auth_client.get("/api/v1/exercise-notes").json()["items"][0]["note"] == "sedile 4"
