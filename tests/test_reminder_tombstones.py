"""Promemoria eliminati (1.21): una modifica fatta prima dell'eliminazione e arrivata dopo non li ricrea (D-036)."""
import sqlite3

from app.migrations import MIGRATIONS, run_migrations

from .test_migrations import legacy_db

RID = "r-e2e"
BODY = {"weekday": 0, "time": "13:00", "kind": "meal", "slot": "lunch", "title": "Pranzo", "action": "log_meal", "enabled": True}
T = lambda hhmm: {"X-Edited-At": f"2026-11-23T{hhmm}:00.000+01:00"}  # noqa: E731


def ids(c):
    return [r["id"] for r in c.get("/api/v1/reminders").json()["items"]]


def test_an_older_edit_arriving_after_the_delete_does_not_bring_it_back(auth_client):
    assert auth_client.put(f"/api/v1/reminders/{RID}", json=BODY, headers=T("10:00")).json() == {"ok": True}
    assert auth_client.delete(f"/api/v1/reminders/{RID}", headers=T("10:05")).json() == {"ok": True}
    late = auth_client.put(f"/api/v1/reminders/{RID}", json=BODY | {"title": "offline"}, headers=T("10:02"))
    assert late.json().get("stale") is True
    assert RID not in ids(auth_client)


def test_a_newer_edit_recreates_it_and_a_delete_older_than_the_last_edit_is_ignored(auth_client):
    auth_client.put(f"/api/v1/reminders/{RID}", json=BODY, headers=T("10:00"))
    auth_client.delete(f"/api/v1/reminders/{RID}", headers=T("10:05"))
    assert auth_client.put(f"/api/v1/reminders/{RID}", json=BODY | {"title": "di nuovo"}, headers=T("10:10")).json() == {"ok": True}
    assert RID in ids(auth_client)
    assert auth_client.delete(f"/api/v1/reminders/{RID}", headers=T("10:07")).json().get("stale") is True, "eliminazione più vecchia"
    assert RID in ids(auth_client)


def test_restore_clears_the_deletion_marks_of_the_reminders_in_the_file(auth_client, settings):
    auth_client.put(f"/api/v1/reminders/{RID}", json=BODY, headers=T("10:00"))
    backup = auth_client.get("/api/backup").json()
    auth_client.delete(f"/api/v1/reminders/{RID}", headers=T("10:05"))
    assert auth_client.post("/api/v1/restore", json=backup).status_code == 200
    assert RID in ids(auth_client)
    with sqlite3.connect(settings.db_path) as c:
        assert c.execute("SELECT count(*) FROM reminder_tombstones").fetchone()[0] == 0


def test_migration_14_adds_reminder_tombstones_without_touching_reminders(tmp_path):
    from app.db import connect, transaction
    from app.migrations import _applied

    db = tmp_path / "f.sqlite"
    legacy_db(db)
    with connect(db) as c:  # schema 13, come la 1.17–1.20
        _applied(c)
        for version, name, fn in MIGRATIONS:
            if version <= 13:
                with transaction(c):
                    fn(c)
                    c.execute("INSERT INTO schema_migrations VALUES (?, ?, 'x')", (version, name))
        before = c.execute("SELECT count(*) FROM reminders").fetchone()[0]
    assert run_migrations(db, tmp_path / "backups") == len(MIGRATIONS)
    assert run_migrations(db, tmp_path / "backups") == len(MIGRATIONS), "ripetibile"
    c = sqlite3.connect(db)
    assert c.execute("SELECT count(*) FROM reminders").fetchone()[0] == before
    assert c.execute("SELECT count(*) FROM reminder_tombstones").fetchone()[0] == 0
