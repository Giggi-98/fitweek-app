import json
import sqlite3

from app.migrations import MIGRATIONS, run_migrations
from app.seed import initial_state

from .conftest import db_state

OLD_B6 = [3, 3, 3, 4, 4, 4, 4, 4]
OLD_C5 = [5, 5, 5, 5, 5, 6, 6, 6]


def legacy_db(path, mutate=None):
    """DB creato dalla versione 1.0 (senza schema_migrations), con le progressioni errate."""
    state = initial_state()
    for ex in state["routines"]["B"]:
        if ex["id"] == "b6":
            ex["sets"] = list(OLD_B6)
    for ex in state["routines"]["C"]:
        if ex["id"] == "c5":
            ex["sets"] = list(OLD_C5)
    if mutate:
        mutate(state)
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE app_state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, json TEXT NOT NULL)")
    c.execute("INSERT INTO app_state VALUES (1, 7, ?)", (json.dumps(state),))
    c.commit()
    c.close()
    return state


def sets_of(state, day, ex_id):
    return next(e["sets"] for e in state["routines"][day] if e["id"] == ex_id)


def test_fresh_db_gets_seed_with_correct_progressions(tmp_path):
    db = tmp_path / "f.sqlite"
    run_migrations(db, tmp_path / "backups")
    _, state = db_state(db)
    assert sets_of(state, "B", "b6") == [3, 3, 3, 3, 4, 4, 4, 4]
    assert sets_of(state, "C", "c5") == [5, 5, 5, 5, 5, 5, 6, 6]
    assert not list((tmp_path / "backups").glob("*")), "nessun backup per un DB nuovo"


def test_legacy_db_is_backed_up_and_fixed_preserving_everything_else(tmp_path):
    db = tmp_path / "f.sqlite"
    before = legacy_db(db, lambda s: s["workouts"].append({"id": "w1", "routine": "A"}))
    run_migrations(db, tmp_path / "backups")
    version, after = db_state(db)
    assert version == 8, "la versione aumenta così i client aperti ricevono 409"
    assert sets_of(after, "B", "b6") == [3, 3, 3, 3, 4, 4, 4, 4]
    assert sets_of(after, "C", "c5") == [5, 5, 5, 5, 5, 5, 6, 6]
    for day in ("A", "B", "C"):
        for old, new in zip(before["routines"][day], after["routines"][day]):
            if old["id"] not in ("b6", "c5"):
                assert old == new
    assert after["workouts"] == before["workouts"]
    backups = list((tmp_path / "backups").glob("pre-migration-*.sqlite"))
    assert len(backups) == 1
    _, backed = db_state(backups[0])
    assert sets_of(backed, "B", "b6") == OLD_B6


def test_user_modified_progression_is_not_touched(tmp_path):
    db = tmp_path / "f.sqlite"

    def custom(s):
        next(e for e in s["routines"]["B"] if e["id"] == "b6")["sets"] = [2, 2, 2, 2, 2, 2, 2, 2]

    legacy_db(db, custom)
    run_migrations(db, tmp_path / "backups")
    _, state = db_state(db)
    assert sets_of(state, "B", "b6") == [2, 2, 2, 2, 2, 2, 2, 2]
    assert sets_of(state, "C", "c5") == [5, 5, 5, 5, 5, 5, 6, 6]


def test_migrations_are_idempotent(tmp_path):
    db = tmp_path / "f.sqlite"
    legacy_db(db)
    run_migrations(db, tmp_path / "backups")
    v1, s1 = db_state(db)
    run_migrations(db, tmp_path / "backups")
    v2, s2 = db_state(db)
    assert (v1, s1) == (v2, s2)
    c = sqlite3.connect(db)
    assert c.execute("SELECT count(*) FROM schema_migrations").fetchone()[0] == len(MIGRATIONS)
    assert len(list((tmp_path / "backups").glob("*"))) == 1


def test_migration_8_populates_quantities_and_offsite_backup_restores(tmp_path):
    import subprocess
    from pathlib import Path

    db = tmp_path / "fitweek-test-20261112-120000.sqlite"
    def strip_new_fields(s):
        for g in s["groceries"]:
            g.pop("amount", None)
            g.pop("unit", None)
        for d in s["meals"].values():
            d.pop("items", None)
        s["inventory"] = [{"id": "inv1", "name": "Riso", "qty": "1,5 kg", "expiry": ""}]

    legacy_db(db, strip_new_fields)
    run_migrations(db, tmp_path / "backups")
    _, state = db_state(db)
    assert state["groceries"][0]["amount"] == 1000 and state["groceries"][0]["unit"] == "g"
    assert state["inventory"][0]["amount"] == 1500 and state["inventory"][0]["unit"] == "g"
    assert len(state["meals"]["Lunedì"]["items"]) > 0

    # Verifica backup-offsite.sh: cifratura + verifica + ripristino da copia cifrata
    c = sqlite3.connect(db)
    c.execute("PRAGMA journal_mode=DELETE")
    c.close()
    offsite_dir = tmp_path / "offsite"
    secrets_dir = tmp_path / "secrets"
    secrets_dir.mkdir()
    (secrets_dir / "fitweek-release.jks").write_bytes(b"fake-jks-key")
    (secrets_dir / "android-keystore.env").write_text("KEYSTORE_PASSWORD=segreto\n")
    script = Path(__file__).resolve().parent.parent / "scripts" / "backup-offsite.sh"
    env = {
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "FITWEEK_BACKUP_DIR": str(tmp_path),
        "FITWEEK_SECRETS_DIR": str(secrets_dir),
        "OFFSITE_PASSPHRASE": "test-passphrase-sicura",
    }
    res = subprocess.run(["bash", str(script), str(offsite_dir)], env=env, capture_output=True, text=True, check=True)
    enc_file = Path(res.stdout.strip())
    assert enc_file.is_file() and (Path(str(enc_file) + ".sha256")).is_file()

    restored_dir = tmp_path / "restored"
    res2 = subprocess.run(
        ["bash", str(script), "--restore", str(enc_file), str(restored_dir)],
        env=env, capture_output=True, text=True, check=True,
    )
    restored_db = Path(res2.stdout.strip())
    assert restored_db.is_file()
    assert (restored_dir / "fitweek-release.jks").read_bytes() == b"fake-jks-key"
    _, restored_state = db_state(restored_db)
    assert restored_state["inventory"][0]["amount"] == 1500


def test_seed_progressions_match_the_pdf_table():
    """FW-REV-007: il seed porta le progressioni del PDF (b6: 4 serie da W5; c5: 6 serie da W7)."""
    from app.seed import ROUTINES

    assert (ROUTINES["B"][5]["id"], ROUTINES["B"][5]["sets"]) == ("b6", [3, 3, 3, 3, 4, 4, 4, 4])
    assert (ROUTINES["C"][4]["id"], ROUTINES["C"][4]["sets"]) == ("c5", [5, 5, 5, 5, 5, 5, 6, 6])
    assert [len(ROUTINES[d]) for d in "ABC"] == [7, 7, 5] and all(len(e["sets"]) == 8 for d in "ABC" for e in ROUTINES[d])


def test_migration_9_adds_deletion_marks_without_touching_logged_sets(tmp_path):
    """FW-REV-002: DB allo schema 8 con serie registrate → lo schema 9 aggiunge solo la tabella dei segni."""
    from app.migrations import _applied
    from app.db import connect, transaction

    db = tmp_path / "f.sqlite"
    legacy_db(db)
    with connect(db) as c:  # porta il DB allo schema 8, come l'istanza in uso oggi
        _applied(c)
        for version, name, fn in MIGRATIONS:
            if version <= 8:
                with transaction(c):
                    fn(c)
                    c.execute("INSERT INTO schema_migrations VALUES (?, ?, 'x')", (version, name))
        c.execute("INSERT INTO workout_sessions (id, routine, week, date, status, created_at, updated_at)"
                  " VALUES ('s1', 'A', 1, '2026-11-09', 'done', 't', 't')")
        c.execute("INSERT INTO set_logs VALUES ('s1', 'a1', 1, 40, 10, NULL, 1, '2026-11-09T20:00:00+01:00')")
        assert not c.execute("SELECT 1 FROM sqlite_master WHERE name='set_tombstones'").fetchone()
    version_before, state_before = db_state(db)

    assert run_migrations(db, tmp_path / "backups") == 9
    assert db_state(db) == (version_before, state_before), "lo stato dell'utente non cambia"
    c = sqlite3.connect(db)
    assert c.execute("SELECT kg, reps FROM set_logs").fetchall() == [(40.0, 10)]
    assert c.execute("SELECT count(*) FROM set_tombstones").fetchone()[0] == 0
    assert len(list((tmp_path / "backups").glob("pre-migration-009-*.sqlite"))) == 1
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("INSERT INTO set_tombstones VALUES ('s1', 'a1', 1, '2026-11-10T10:00:00+01:00')")
    c.execute("DELETE FROM workout_sessions WHERE id='s1'")
    assert c.execute("SELECT count(*) FROM set_tombstones").fetchone()[0] == 0, "spariscono con la seduta"
    c.close()
