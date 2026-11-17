"""Dati dall'orologio via Health Connect (D-040): notti importate, passi e battito a riposo, battito delle sedute."""
import sqlite3

from app.migrations import MIGRATIONS, run_migrations

from .test_migrations import legacy_db
from .test_workouts import SID, new_session

DAY = "2026-11-10"
NIGHT = {"bed_time": "00:20", "wake_time": "07:40", "source": "health_connect",
         "deep_min": 80, "light_min": 230, "rem_min": 95, "awake_min": 15}
OLDER = {"X-Edited-At": "2026-01-01T10:00:00.000+01:00"}


def night(c, day=DAY):
    items = c.get(f"/api/v1/sleep?from={day}&to={day}").json()["items"]
    return items[0] if items else None


def test_imported_night_keeps_stages_and_can_be_updated_by_a_later_import(auth_client):
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT).json()["duration_min"] == 440
    assert night(auth_client) | {} == {"date": DAY, "note": "", "duration_min": 440, **NIGHT}
    auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT | {"wake_time": "08:00", "rem_min": 100})
    assert night(auth_client)["wake_time"] == "08:00" and night(auth_client)["rem_min"] == 100


def test_import_never_replaces_a_night_written_by_hand(auth_client):
    auth_client.put(f"/api/v1/sleep/{DAY}", json={"bed_time": "01:00", "wake_time": "08:00", "note": "a mano"})
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT).json() == {"ok": True, "kept": True}
    assert night(auth_client)["note"] == "a mano" and night(auth_client)["source"] == "manual"


def test_import_does_not_bring_back_a_night_the_user_deleted(auth_client):
    auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT)
    auth_client.delete(f"/api/v1/sleep/{DAY}")
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT).json()["kept"] is True
    assert night(auth_client) is None
    # scriverla a mano resta sempre possibile
    auth_client.put(f"/api/v1/sleep/{DAY}", json={"bed_time": "00:00", "wake_time": "07:00"})
    assert night(auth_client)["source"] == "manual" and night(auth_client)["deep_min"] is None


def test_hand_edit_turns_an_imported_night_into_a_manual_one(auth_client):
    auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT)
    auth_client.put(f"/api/v1/sleep/{DAY}", json={"bed_time": "23:50", "wake_time": "07:40"})
    assert night(auth_client)["source"] == "manual"
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT).json()["kept"] is True


def test_stage_minutes_are_validated(auth_client):
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT | {"deep_min": -1}).status_code == 422
    assert auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT | {"rem_min": 2000}).status_code == 422


def test_health_days_store_nulls_reject_bad_input_and_older_writes(auth_client):
    assert auth_client.put(f"/api/v1/health-days/{DAY}", json={"steps": 8432, "resting_hr": None}).status_code == 200
    assert auth_client.put("/api/v1/health-days/2026-11-11", json={"resting_hr": 61}).status_code == 200
    items = auth_client.get("/api/v1/health-days?from=2026-11-09&to=2026-11-15").json()["items"]
    assert items == [{"date": DAY, "steps": 8432, "resting_hr": None}, {"date": "2026-11-11", "steps": None, "resting_hr": 61}]
    assert auth_client.put(f"/api/v1/health-days/{DAY}", json={"steps": -5}).status_code == 422
    assert auth_client.put(f"/api/v1/health-days/{DAY}", json={"resting_hr": 300}).status_code == 422
    assert auth_client.put("/api/v1/health-days/2026-02-30", json={"steps": 1}).status_code == 422
    assert auth_client.put(f"/api/v1/health-days/{DAY}", json={"steps": 1}, headers=OLDER).json()["stale"] is True
    assert auth_client.get(f"/api/v1/health-days?from={DAY}&to={DAY}").json()["items"][0]["steps"] == 8432


def test_workout_heart_is_part_of_the_session(auth_client):
    new_session(auth_client)
    assert auth_client.put("/api/v1/workout-heart/nope", json={"avg_bpm": 120, "max_bpm": 160, "samples": 90}).status_code == 404
    assert auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 170, "max_bpm": 160, "samples": 90}).status_code == 422
    assert auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 118, "max_bpm": 161, "samples": 140}).status_code == 200
    heart = auth_client.get(f"/api/v1/workout-sessions/{SID}").json()["heart"]
    assert heart == {"avg_bpm": 118, "max_bpm": 161, "samples": 140}
    assert auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 90, "max_bpm": 95, "samples": 10},
                           headers=OLDER).json()["stale"] is True
    auth_client.delete(f"/api/v1/workout-sessions/{SID}")
    assert auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 118, "max_bpm": 161, "samples": 140}).json()["kept"] is True


def test_backup_carries_heart_stages_and_health_days(auth_client):
    new_session(auth_client)
    auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 118, "max_bpm": 161, "samples": 140})
    auth_client.put(f"/api/v1/sleep/{DAY}", json=NIGHT)
    auth_client.put(f"/api/v1/health-days/{DAY}", json={"steps": 9000, "resting_hr": 62})
    backup = auth_client.get("/api/backup").json()
    auth_client.put(f"/api/v1/workout-heart/{SID}", json={"avg_bpm": 100, "max_bpm": 120, "samples": 20})
    auth_client.put(f"/api/v1/health-days/{DAY}", json={"steps": 1})
    auth_client.delete(f"/api/v1/sleep/{DAY}")
    assert auth_client.post("/api/v1/restore", json=backup).status_code == 200
    assert auth_client.get(f"/api/v1/workout-sessions/{SID}").json()["heart"]["avg_bpm"] == 118
    assert night(auth_client)["deep_min"] == 80
    assert auth_client.get(f"/api/v1/health-days?from={DAY}&to={DAY}").json()["items"][0]["steps"] == 9000


def test_snapshot_has_watch_data_and_the_nights_import_must_not_touch(auth_client):
    auth_client.put("/api/v1/sleep/2026-11-17", json=NIGHT)
    auth_client.put("/api/v1/sleep/2026-11-16", json={"bed_time": "00:00", "wake_time": "07:00"})
    auth_client.put("/api/v1/sleep/2026-11-15", json=NIGHT)
    auth_client.delete("/api/v1/sleep/2026-11-15")
    auth_client.put("/api/v1/health-days/2026-11-16", json={"steps": 7000})
    snap = auth_client.get("/api/v1/sync/snapshot?days=400").json()
    assert snap["sleep_owned"] == ["2026-11-15", "2026-11-16"]
    assert snap["health_days"] == [{"date": "2026-11-16", "steps": 7000, "resting_hr": None}]
    assert next(n for n in snap["sleep_logs"] if n["date"] == "2026-11-17")["rem_min"] == 95


def test_migration_11_adds_watch_tables_without_touching_nights(tmp_path):
    from app.db import connect, transaction
    from app.migrations import _applied

    db = tmp_path / "f.sqlite"
    legacy_db(db)
    with connect(db) as c:  # schema 10, come l'istanza in uso con la 1.13
        _applied(c)
        for version, name, fn in MIGRATIONS:
            if version <= 10:
                with transaction(c):
                    fn(c)
                    c.execute("INSERT INTO schema_migrations VALUES (?, ?, 'x')", (version, name))
        c.execute("INSERT INTO sleep_logs (date, bed_time, wake_time, updated_at) VALUES ('2026-11-10', '00:10', '07:30', 't')")
    assert run_migrations(db, tmp_path / "backups") == 11
    assert run_migrations(db, tmp_path / "backups") == 11, "ripetibile"
    c = sqlite3.connect(db)
    assert c.execute("SELECT bed_time, source, deep_min FROM sleep_logs").fetchall() == [("00:10", "manual", None)]
    assert c.execute("SELECT count(*) FROM health_days").fetchone()[0] == 0
    assert len(list((tmp_path / "backups").glob("pre-migration-011-*.sqlite"))) == 1
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("INSERT INTO workout_sessions (id, routine, week, date, status, created_at, updated_at)"
              " VALUES ('s1', 'A', 1, '2026-11-09', 'done', 't', 't')")
    c.execute("INSERT INTO workout_heart VALUES ('s1', 120, 150, 60, 't')")
    c.execute("DELETE FROM workout_sessions WHERE id='s1'")
    assert c.execute("SELECT count(*) FROM workout_heart").fetchone()[0] == 0, "sparisce con la seduta"
