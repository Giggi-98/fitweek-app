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
