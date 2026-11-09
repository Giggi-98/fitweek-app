"""Migrazioni versionate, idempotenti e solo additive.

Ogni migrazione è una funzione che riceve una connessione già in transazione.
Prima di applicare migrazioni a un DB che contiene dati viene creato un backup
automatico in <db_dir>/backups/pre-migration-*.sqlite.
"""
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Callable

from .db import backup_to, connect, transaction
from .seed import initial_state

log = logging.getLogger("fitweek.migrations")

Migration = tuple[int, str, Callable[[sqlite3.Connection], None]]


def _m001_app_state(c: sqlite3.Connection) -> None:
    c.execute(
        "CREATE TABLE IF NOT EXISTS app_state ("
        "id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, json TEXT NOT NULL)"
    )
    if not c.execute("SELECT 1 FROM app_state WHERE id=1").fetchone():
        c.execute(
            "INSERT INTO app_state VALUES (1, 1, ?)",
            (json.dumps(initial_state(), ensure_ascii=False),),
        )


def _m002_sessions(c: sqlite3.Connection) -> None:
    c.execute(
        "CREATE TABLE IF NOT EXISTS sessions ("
        "id TEXT PRIMARY KEY, created_at TEXT NOT NULL, user_agent TEXT NOT NULL DEFAULT '')"
    )


# Correzioni verificate sul PDF (docs/TRAINING_PROGRAM.md). Applicate solo se il valore
# corrente è esattamente quello errato del seed originale: non toccano modifiche dell'utente.
PROGRESSION_FIXES = {
    ("B", "b6"): ([3, 3, 3, 4, 4, 4, 4, 4], [3, 3, 3, 3, 4, 4, 4, 4]),
    ("C", "c5"): ([5, 5, 5, 5, 5, 6, 6, 6], [5, 5, 5, 5, 5, 5, 6, 6]),
}


def _m003_fix_progressions(c: sqlite3.Connection) -> None:
    row = c.execute("SELECT version, json FROM app_state WHERE id=1").fetchone()
    if not row:
        return
    version, blob = row
    state = json.loads(blob)
    changed = []
    for (day, ex_id), (wrong, right) in PROGRESSION_FIXES.items():
        for ex in state.get("routines", {}).get(day, []):
            if ex.get("id") == ex_id and ex.get("sets") == wrong:
                ex["sets"] = right
                changed.append(ex_id)
    if changed:
        # La versione aumenta: i client aperti riceveranno 409 invece di sovrascrivere la correzione.
        c.execute(
            "UPDATE app_state SET version=?, json=? WHERE id=1",
            (version + 1, json.dumps(state, ensure_ascii=False)),
        )
        log.info("progressioni corrette", extra={"fields": {"exercises": changed}})


MIGRATIONS: list[Migration] = [
    (1, "app_state", _m001_app_state),
    (2, "sessions", _m002_sessions),
    (3, "fix_progressions_b6_c5", _m003_fix_progressions),
]


def _applied(c: sqlite3.Connection) -> set[int]:
    c.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
    )
    return {r[0] for r in c.execute("SELECT version FROM schema_migrations")}


def _has_user_tables(c: sqlite3.Connection) -> bool:
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_state'").fetchone())


def _prune(backup_dir: Path, keep: int) -> None:
    files = sorted(backup_dir.glob("pre-migration-*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in files[keep:]:
        old.unlink(missing_ok=True)


def run_migrations(db_path: Path, backup_dir: Path, keep_backups: int = 10) -> int:
    """Applica le migrazioni mancanti. Restituisce la versione di schema risultante."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect(db_path) as c:
        c.execute("PRAGMA journal_mode=WAL")
        applied = _applied(c)
        pending = [m for m in MIGRATIONS if m[0] not in applied]
        if pending and _has_user_tables(c):
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            dest = backup_dir / f"pre-migration-{pending[0][0]:03d}-{stamp}.sqlite"
            backup_to(c, dest)
            _prune(backup_dir, keep_backups)
            log.info("backup pre-migrazione creato", extra={"fields": {"file": dest.name}})
        for version, name, fn in pending:
            with transaction(c):
                fn(c)
                c.execute(
                    "INSERT INTO schema_migrations VALUES (?, ?, ?)",
                    (version, name, datetime.now().astimezone().isoformat(timespec="seconds")),
                )
            log.info("migrazione applicata", extra={"fields": {"version": version, "name": name}})
        return max([m[0] for m in MIGRATIONS])
