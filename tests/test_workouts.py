import json
import sqlite3

from app.migrations import run_migrations

from .test_migrations import legacy_db

SID = "6b0c9e7a-0000-4000-8000-000000000001"


def new_session(c, sid=SID, routine="A", week=1, d="2026-11-09"):
    return c.post("/api/v1/workout-sessions", json={"id": sid, "routine": routine, "week": week, "date": d})


def test_v1_requires_auth(client):
    assert client.get("/api/v1/today").status_code == 401
    assert client.get("/api/v1/workout-sessions").status_code == 401


def test_today_shape(auth_client):
    t = auth_client.get("/api/v1/today").json()
    assert 1 <= t["program_week"] <= 8 and t["active_session"] is None
    assert t["routine"] in ("A", "B", "C", None)


def test_create_is_idempotent(auth_client):
    a = new_session(auth_client).json()
    b = new_session(auth_client).json()
    assert a["id"] == b["id"] == SID and a["status"] == "in_progress" and a["started_at"]
    assert len(auth_client.get("/api/v1/workout-sessions").json()["items"]) == 1
    assert auth_client.get("/api/v1/today").json()["active_session"]["id"] == SID


def test_set_upsert_and_delete(auth_client):
    new_session(auth_client)
    url = f"/api/v1/workout-sessions/{SID}/sets/a1/1"
    assert auth_client.put(url, json={"kg": 40, "reps": 10}).status_code == 200
    assert auth_client.put(url, json={"kg": 42.5, "reps": 9, "rir": 2}).status_code == 200  # ripetizione = update
    sets = auth_client.get(f"/api/v1/workout-sessions/{SID}").json()["sets"]
    assert len(sets) == 1 and sets[0]["kg"] == 42.5 and sets[0]["reps"] == 9 and sets[0]["rir"] == 2
    assert auth_client.put(f"/api/v1/workout-sessions/{SID}/sets/a1/2", json={"completed": False}).status_code == 200
    assert auth_client.delete(url).status_code == 200
    sets = auth_client.get(f"/api/v1/workout-sessions/{SID}").json()["sets"]
    assert [(s["set_index"], s["completed"]) for s in sets] == [(2, False)]


def test_set_validation(auth_client):
    new_session(auth_client)
    assert auth_client.put(f"/api/v1/workout-sessions/{SID}/sets/a1/1", json={"kg": -5}).status_code == 422
    assert auth_client.put(f"/api/v1/workout-sessions/{SID}/sets/a1/99", json={"kg": 5}).status_code == 422
    assert auth_client.put(f"/api/v1/workout-sessions/{SID}/sets/a1/1", json={"kg": "x"}).status_code == 422
    assert auth_client.put("/api/v1/workout-sessions/nope/sets/a1/1", json={"kg": 5}).status_code == 404


def test_finish_computes_duration(auth_client):
    new_session(auth_client)
    r = auth_client.patch(f"/api/v1/workout-sessions/{SID}", json={"status": "done", "cardio_min": 10, "notes": "ok"})
    s = r.json()
    assert s["status"] == "done" and s["ended_at"] and s["duration_min"] is not None and s["cardio_min"] == 10
    assert auth_client.get("/api/v1/today").json()["active_session"] is None


def test_soft_delete(auth_client, settings):
    new_session(auth_client)
    assert auth_client.delete(f"/api/v1/workout-sessions/{SID}").status_code == 200
    assert auth_client.get("/api/v1/workout-sessions").json()["items"] == []
    c = sqlite3.connect(settings.db_path)
    assert c.execute("SELECT deleted_at IS NOT NULL FROM workout_sessions").fetchone()[0] == 1


def test_filters(auth_client):
    new_session(auth_client, "s-a", "A", 1, "2026-11-09")
    new_session(auth_client, "s-b", "B", 1, "2026-11-11")
    auth_client.patch("/api/v1/workout-sessions/s-a", json={"status": "done"})
    items = auth_client.get("/api/v1/workout-sessions?routine=A&status=done&limit=1").json()["items"]
    assert [i["id"] for i in items] == ["s-a"]


def test_program_week_sets_start_date(auth_client):
    r = auth_client.put("/api/v1/program-week", json={"week": 3}).json()
    assert auth_client.get("/api/v1/today").json()["program_week"] == 3
    state = auth_client.get("/api/state").json()
    assert state["data"]["profile"]["startDate"] == r["startDate"] and state["data"]["profile"]["week"] == 3


def test_foreign_origin_rejected_on_v1(auth_client):
    r = auth_client.post("/api/v1/workout-sessions", json={"id": SID, "routine": "A", "week": 1, "date": "2026-11-09"},
                         headers={"Origin": "http://evil.example"})
    assert r.status_code == 403


def test_backup_v2_and_restore_roundtrip(auth_client):
    new_session(auth_client)
    auth_client.put(f"/api/v1/workout-sessions/{SID}/sets/a1/1", json={"kg": 40, "reps": 10})
    backup = auth_client.get("/api/backup").json()
    assert backup["format"] == "fitweek-backup-v2" and backup["workout_sessions"][0]["sets"][0]["kg"] == 40
    auth_client.delete(f"/api/v1/workout-sessions/{SID}")
    r = auth_client.post("/api/v1/restore", json=backup)
    assert r.status_code == 200 and r.json()["sessions"] == 1
    s = auth_client.get(f"/api/v1/workout-sessions/{SID}").json()
    assert s["sets"][0]["kg"] == 40


def test_restore_v1_backup_converts_workouts(auth_client, settings):
    state = auth_client.get("/api/state").json()
    state["data"]["workouts"] = [{"id": "old1", "routine": "B", "week": 2, "date": "2026-10-01", "duration": 80,
                                  "notes": "n", "sets": [{"exerciseId": "b1", "set": 1, "kg": 30, "reps": 8}]}]
    r = auth_client.post("/api/v1/restore", json={"format": "fitweek-backup-v1", "version": 1, "data": state["data"]})
    assert r.status_code == 200
    items = auth_client.get("/api/v1/workout-sessions").json()["items"]
    assert items[0]["id"] == "old1" and items[0]["sets"][0]["kg"] == 30
    assert list(settings.backup_dir.glob("pre-restore-*.sqlite"))


def test_restore_rejects_invalid(auth_client):
    assert auth_client.post("/api/v1/restore", json={"format": "x", "data": {}}).status_code == 422


def test_migration_copies_blob_workouts(tmp_path):
    db = tmp_path / "f.sqlite"

    def add(s):
        s["workouts"] = [{"id": "w1", "routine": "A", "week": 1, "date": "2026-11-09", "duration": 90, "notes": "x",
                          "sets": [{"exerciseId": "a1", "set": 1, "kg": 40, "reps": 10},
                                   {"exerciseId": "a1", "set": 2, "kg": 40, "reps": 9}]}]

    legacy_db(db, add)
    run_migrations(db, tmp_path / "b")
    run_migrations(db, tmp_path / "b")  # idempotente
    c = sqlite3.connect(db)
    assert c.execute("SELECT id, status, duration_min, source FROM workout_sessions").fetchall() == [("w1", "done", 90, "v1-blob")]
    assert c.execute("SELECT count(*) FROM set_logs").fetchone()[0] == 2
    blob = json.loads(c.execute("SELECT json FROM app_state").fetchone()[0])
    assert len(blob["workouts"]) == 1, "il blob resta intatto"
