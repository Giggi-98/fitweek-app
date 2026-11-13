"""Accesso a SQLite: una connessione per operazione, WAL, transazioni esplicite."""
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(str(db_path), timeout=15, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE: serializza gli scrittori ed evita race read-then-write."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


@contextmanager
def snapshot(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Lettura coerente su più tabelle: tutte le SELECT nel blocco vedono lo stesso istante del DB, anche se
    intanto un altro dispositivo scrive (in WAL chi scrive non viene bloccato). Sola lettura: si chiude con ROLLBACK."""
    conn.execute("BEGIN")
    try:
        yield conn
    finally:
        conn.execute("ROLLBACK")


def backup_to(conn: sqlite3.Connection, dest: Path) -> None:
    """Backup coerente (API SQLite) in un file autonomo senza WAL, verificato."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    out = sqlite3.connect(str(dest))
    try:
        with out:
            conn.backup(out)
        out.execute("PRAGMA journal_mode=DELETE")
        result = out.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        out.close()
    if result != "ok":
        dest.unlink(missing_ok=True)
        raise RuntimeError(f"Backup non valido: {result}")
