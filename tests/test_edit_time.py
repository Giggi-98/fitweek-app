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


# ---- FW-REV-002: una serie eliminata non torna per una scrittura offline più vecchia ----------------
def at(**ago):
    return {"X-Edited-At": (datetime.now(timezone.utc) - timedelta(**ago)).isoformat()}


def test_offline_put_older_than_delete_does_not_resurrect_the_set(auth_client):
    """Telefono offline accoda il PUT lunedì, il PC elimina la serie martedì, il telefono si riconnette."""
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=at(days=3)).json() == {"ok": True}
    assert auth_client.delete(SET, headers=at(days=1)).json() == {"ok": True}
    late = auth_client.put(SET, json={"kg": 55, "reps": 8}, headers=at(days=2))
    assert late.status_code == 200 and late.json() == {"ok": True, "stale": True}
    assert sets(auth_client) == []


def test_put_newer_than_delete_recreates_the_set_and_older_delete_is_then_ignored(auth_client):
    new_session(auth_client)
    auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=at(days=3))
    auth_client.delete(SET, headers=at(days=2))
    assert auth_client.put(SET, json={"kg": 60, "reps": 6}, headers=at(hours=1)).json() == {"ok": True}
    assert [s["kg"] for s in sets(auth_client)] == [60]
    assert auth_client.delete(SET, headers=at(days=1)).json()["stale"] is True  # eliminazione più vecchia della serie
    assert [s["kg"] for s in sets(auth_client)] == [60]
    assert auth_client.put(SET, json={"kg": 61, "reps": 6}).json() == {"ok": True}  # modifica normale, adesso
    assert [s["kg"] for s in sets(auth_client)] == [61]


def test_delete_arriving_before_the_older_put_still_wins(auth_client):
    """L'eliminazione arriva per prima su una serie che il server non ha ancora visto."""
    new_session(auth_client)
    assert auth_client.delete(SET, headers=at(hours=1)).json() == {"ok": True}
    assert auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=at(hours=2)).json()["stale"] is True
    assert sets(auth_client) == []
    other = SET.replace("/a1/1", "/a1/2")  # le altre serie non sono toccate
    assert auth_client.put(other, json={"kg": 40, "reps": 10}, headers=at(hours=2)).json() == {"ok": True}
    assert len(sets(auth_client)) == 1


def test_older_delete_does_not_move_the_deletion_back_in_time(auth_client):
    new_session(auth_client)
    auth_client.delete(SET, headers=at(hours=1))
    auth_client.delete(SET, headers=at(days=5))  # ripetizione vecchia: il segno resta quello più recente
    assert auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=at(hours=3)).json()["stale"] is True


def test_delete_for_unknown_session_is_harmless(auth_client):
    assert auth_client.delete(SET).json() == {"ok": True}


def test_restore_clears_deletion_marks(auth_client):
    new_session(auth_client)
    auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=at(days=3))
    backup = auth_client.get("/api/backup").json()
    auth_client.delete(SET, headers=at(days=1))
    assert auth_client.post("/api/v1/restore", json=backup).status_code == 200
    assert [s["kg"] for s in sets(auth_client)] == [50], "il ripristino riporta la serie del backup"
    # il segno dell'eliminazione (1 giorno fa) è sparito con il ripristino: una modifica di 2 giorni fa vale
    assert auth_client.put(SET, json={"kg": 52, "reps": 8}, headers=at(days=2)).json() == {"ok": True}


# --- FW-REV-009: due modifiche nello stesso secondo, arrivate in ordine inverso ---------------------------------

def _same_second(*millis: int) -> list[dict]:
    """Intestazioni con orari nello stesso secondo (un'ora fa), nel formato che manda il telefono
    (`Date.toISOString()`: UTC con millisecondi e `Z`)."""
    second = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0)
    return [{"X-Edited-At": (second + timedelta(milliseconds=ms)).isoformat(timespec="milliseconds").replace("+00:00", "Z")}
            for ms in millis]


def test_earlier_put_in_same_second_does_not_resurrect_deleted_set(auth_client):
    put_at_100, delete_at_900 = _same_second(100, 900)
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=OLD).json() == {"ok": True}
    assert auth_client.delete(SET, headers=delete_at_900).json() == {"ok": True}
    late = auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=put_at_100)  # fatta PRIMA, arrivata dopo
    assert late.json() == {"ok": True, "stale": True}
    assert sets(auth_client) == []


def test_earlier_edit_in_same_second_does_not_overwrite_set(auth_client):
    at_100, at_900 = _same_second(100, 900)
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=at_900).json() == {"ok": True}
    assert auth_client.put(SET, json={"kg": 40, "reps": 10}, headers=at_100).json() == {"ok": True, "stale": True}
    assert auth_client.delete(SET, headers=at_100).json() == {"ok": True, "stale": True}
    assert [s["kg"] for s in sets(auth_client)] == [50]


def test_earlier_edit_in_same_second_does_not_overwrite_meal_sleep_note(auth_client):
    at_100, at_900 = _same_second(100, 900)
    meal = {"date": "2026-11-09", "slot": "lunch", "description": "Pasta"}
    auth_client.put("/api/v1/meal-logs/m1", json=meal, headers=at_900)
    assert auth_client.put("/api/v1/meal-logs/m1", json={**meal, "description": "Riso"}, headers=at_100).json()["stale"] is True
    night = "/api/v1/sleep/2026-11-10"
    auth_client.put(night, json={"bed_time": "00:10", "wake_time": "07:30"}, headers=at_900)
    assert auth_client.put(night, json={"bed_time": "02:00", "wake_time": "07:30"}, headers=at_100).json()["stale"] is True
    auth_client.put("/api/v1/exercise-notes/a1", json={"note": "sedile 4"}, headers=at_900)
    assert auth_client.put("/api/v1/exercise-notes/a1", json={"note": "sedile 2"}, headers=at_100).json()["stale"] is True


def test_edit_after_a_value_saved_with_whole_seconds_still_applies(auth_client):
    """Compatibilità: i dati già salvati hanno orari al secondo (prima di FW-REV-009). Una modifica fatta più
    tardi nello stesso secondo deve passare; a parità esatta di orario vale l'ultima arrivata."""
    (at_500,) = _same_second(500)
    whole = {"X-Edited-At": at_500["X-Edited-At"].replace(".500Z", "Z")}
    new_session(auth_client)
    assert auth_client.put(SET, json={"kg": 50, "reps": 8}, headers=whole).json() == {"ok": True}
    assert auth_client.put(SET, json={"kg": 52.5, "reps": 8}, headers=at_500).json() == {"ok": True}
    assert auth_client.put(SET, json={"kg": 55, "reps": 8}, headers=at_500).json() == {"ok": True}  # stesso istante
    assert [s["kg"] for s in sets(auth_client)] == [55]
