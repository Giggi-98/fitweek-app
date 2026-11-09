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


def _m004_workout_tables(c: sqlite3.Connection) -> None:
    """Sedute e serie in tabelle dedicate (D-003/D-005). I workouts del blob vengono copiati;
    il blob resta intatto come riferimento/rollback ma non viene più usato dall'interfaccia."""
    c.execute(
        """CREATE TABLE IF NOT EXISTS workout_sessions (
            id TEXT PRIMARY KEY,
            routine TEXT NOT NULL,
            week INTEGER NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('in_progress','done','skipped')),
            started_at TEXT,
            ended_at TEXT,
            duration_min REAL,
            cardio_min REAL,
            notes TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'app',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_ws_routine_date ON workout_sessions(routine, date)")
    c.execute(
        """CREATE TABLE IF NOT EXISTS set_logs (
            session_id TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
            exercise_id TEXT NOT NULL,
            set_index INTEGER NOT NULL,
            kg REAL,
            reps INTEGER,
            rir INTEGER,
            completed INTEGER NOT NULL DEFAULT 1,
            logged_at TEXT NOT NULL,
            PRIMARY KEY (session_id, exercise_id, set_index)
        )"""
    )
    row = c.execute("SELECT json FROM app_state WHERE id=1").fetchone()
    if not row:
        return
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    for w in json.loads(row[0]).get("workouts", []):
        if not all(w.get(k) for k in ("id", "routine", "date")):
            log.warning("seduta v1 incompleta non copiata", extra={"fields": {"id": w.get("id")}})
            continue
        c.execute(
            "INSERT OR IGNORE INTO workout_sessions (id, routine, week, date, status, duration_min, notes,"
            " source, created_at, updated_at) VALUES (?, ?, ?, ?, 'done', ?, ?, 'v1-blob', ?, ?)",
            (w["id"], w["routine"], w.get("week") or 1, w["date"], w.get("duration"), w.get("notes", ""), now, now),
        )
        for s in w.get("sets", []):
            if not s.get("exerciseId") or not s.get("set"):
                continue
            c.execute(
                "INSERT OR IGNORE INTO set_logs (session_id, exercise_id, set_index, kg, reps, completed,"
                " logged_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
                (w["id"], s["exerciseId"], s["set"], s.get("kg"), s.get("reps"), w["date"]),
            )


# Pasti abituali con valori nutrizionali STIMATI (medie indicative per porzione tipica, non
# misurate): sono marcati nutrition_source='estimate' e l'interfaccia li mostra come stima.
DEFAULT_MEAL_TEMPLATES = [
    # (id, slot, nome, kcal, proteine g, nota)
    ("t-mensa-primo", "lunch", "Primo + contorno (mensa)", 550, 15, "Porzione tipica di pasta/riso condito + verdure; molto variabile."),
    ("t-secondo", "dinner", "Secondo del lavoro", 300, 28, "Carne o pesce, porzione ~150 g cotta; variabile."),
    ("t-secondo-pane", "dinner", "Secondo del lavoro + pane", 430, 32, "Con ~50 g di pane."),
    ("t-secondo-verdure", "dinner", "Secondo del lavoro + verdure", 350, 29, "Con una porzione di verdure."),
    ("t-banana", "pre_workout", "Banana", 105, 1, "Banana media."),
    ("t-yogurt-greco", "pre_workout", "Yogurt greco 0% (170 g)", 100, 17, "Verifica l'etichetta del prodotto."),
    ("t-gallette", "pre_workout", "Gallette di riso (3)", 105, 2, "Verifica l'etichetta del prodotto."),
    ("t-frutta", "snack", "Frutta (1 porzione)", 70, 1, "Mela, pera, arancia…"),
    ("t-pasta-tonno", "lunch", "Pasta + tonno + verdure", 600, 30, "~90 g pasta, 1 scatoletta di tonno al naturale."),
    ("t-riso-legumi", "lunch", "Riso + legumi + verdure", 550, 20, "~80 g riso, 1 confezione di legumi."),
    ("t-pollo-patate", "dinner", "Pollo + patate + verdure", 550, 40, "~150 g pollo, ~200 g patate."),
    ("t-frittata", "dinner", "Frittata (2 uova) + pane + verdure", 450, 20, ""),
    ("t-dolce-colleghi", "other", "Dolce dei colleghi", 250, 4, "Molto variabile."),
    ("t-sushi", "other", "Sushi / cena fuori", 800, 35, "Molto variabile."),
]

GYM_DAYS = (0, 2, 4)
GYM_CODE = {0: "A", 2: "B", 4: "C"}


def default_reminders() -> list[tuple]:
    """Promemoria ricavati dalla routine dell'utente (CLAUDE.md). Tutti modificabili."""
    r = []
    for d in range(7):
        work = d < 5
        if work:
            r.append((d, "13:00", "meal", "lunch", "Pranzo al lavoro: cosa hai preso?", "log_meal"))
        else:
            r.append((d, "13:00", "meal", "lunch", "Pranzo", "log_meal"))
        if d in GYM_DAYS:
            r.append((d, "18:30", "meal", "pre_workout", "Spuntino pre-palestra", "log_meal"))
            r.append((d, "19:15", "workout", None, f"Palestra alle 19:30 · Giorno {GYM_CODE[d]}", "start_workout"))
            r.append((d, "22:30", "meal", "dinner", "Cena: secondo del lavoro", "log_meal"))
            r.append((d, "23:30", "sleep", None, "Verso il letto: obiettivo mezzanotte", "none"))
        else:
            r.append((d, "17:00", "meal", "snack", "Spuntino", "log_meal"))
            r.append((d, "20:00", "meal", "dinner", "Cena: secondo del lavoro" if work else "Cena: qualcosa di semplice da casa", "log_meal"))
            r.append((d, "23:45", "sleep", None, "Inizia a staccare: prova ad anticipare il sonno", "none"))
    r.append((1, "08:00", "weigh_in", None, "Pesata (a digiuno, dopo il bagno)", "log_weight"))
    r.append((4, "08:00", "weigh_in", None, "Pesata (a digiuno, dopo il bagno)", "log_weight"))
    r.append((6, "18:00", "shopping", None, "Ordina la spesa Esselunga (consegna lunedì)", "open_shopping"))
    return r


def _m005_meals_and_reminders(c: sqlite3.Connection) -> None:
    c.execute(
        """CREATE TABLE IF NOT EXISTS meal_templates (
            id TEXT PRIMARY KEY,
            slot TEXT NOT NULL,
            name TEXT NOT NULL,
            kcal REAL,
            protein_g REAL,
            nutrition_source TEXT,
            nutrition_note TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS meal_logs (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            slot TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('eaten','skipped')),
            description TEXT NOT NULL DEFAULT '',
            template_id TEXT,
            kcal REAL,
            protein_g REAL,
            nutrition_source TEXT,
            note TEXT NOT NULL DEFAULT '',
            logged_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )"""
    )
    c.execute("CREATE INDEX IF NOT EXISTS idx_meal_logs_date ON meal_logs(date)")
    c.execute(
        """CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
            time TEXT NOT NULL,
            kind TEXT NOT NULL,
            slot TEXT,
            title TEXT NOT NULL,
            action TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"""
    )
    c.execute(
        """CREATE TABLE IF NOT EXISTS reminder_acks (
            reminder_id TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('done','dismissed','snoozed')),
            snooze_until TEXT,
            at TEXT NOT NULL,
            PRIMARY KEY (reminder_id, date)
        )"""
    )
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    if not c.execute("SELECT 1 FROM meal_templates LIMIT 1").fetchone():
        for pos, (tid, slot, name, kcal, prot, note) in enumerate(DEFAULT_MEAL_TEMPLATES):
            c.execute(
                "INSERT INTO meal_templates VALUES (?, ?, ?, ?, ?, 'estimate', ?, ?, ?, ?, NULL)",
                (tid, slot, name, kcal, prot, note, pos, now, now),
            )
    if not c.execute("SELECT 1 FROM reminders LIMIT 1").fetchone():
        for d, time_, kind, slot, title, action in default_reminders():
            rid = f"r{d}-{time_.replace(':', '')}-{kind}"
            c.execute(
                "INSERT INTO reminders VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
                (rid, d, time_, kind, slot, title, action, now, now),
            )


# Catalogo piatti (mensa e casa) con valori STIMATI per porzione tipica: marcati 'estimate'.
# Categorie come nel menu della mensa aziendale. Si arricchisce con i piatti inseriti dall'utente.
DEFAULT_FOODS = [
    # (id, categoria, nome, kcal, proteine g, nota)
    ("f-pasta", "primo", "Pasta (porzione mensa, senza salsa)", 330, 11, "~90 g di pasta secca"),
    ("f-riso", "primo", "Riso (porzione, senza salsa)", 320, 6, "~85 g di riso crudo"),
    ("f-minestra", "primo", "Minestra / zuppa", 180, 6, ""),
    ("f-farro", "primo", "Insalata di farro con formaggio e verdure", 420, 14, ""),
    ("f-torta-salata", "primo", "Torta salata", 350, 10, ""),
    ("f-salsa-pomodoro", "salsa", "Salsa al pomodoro", 50, 2, ""),
    ("f-salsa-verdure", "salsa", "Salsa di verdure", 70, 2, ""),
    ("f-amatriciana", "salsa", "Salsa all'amatriciana", 140, 5, ""),
    ("f-burrino", "salsa", "Burro (burrino ~10 g)", 75, 0, ""),
    ("f-olio", "salsa", "Olio extravergine (1 cucchiaio)", 90, 0, ""),
    ("f-pollo", "secondo", "Petto di pollo ai ferri", 200, 35, "~150 g cotto"),
    ("f-scaloppina", "secondo", "Scaloppina al pomodoro", 260, 30, ""),
    ("f-pesce", "secondo", "Filetto di pesce gratinato", 220, 28, ""),
    ("f-mozzarella", "secondo", "Mozzarella fior di latte (125 g)", 315, 23, ""),
    ("f-cotto", "secondo", "Prosciutto cotto (100 g)", 215, 20, ""),
    ("f-ratatouille", "secondo", "Ratatouille", 120, 3, ""),
    ("f-spiedini", "piatto_unico", "Spiedini di carne mista", 350, 30, ""),
    ("f-verdure-vapore", "contorno", "Verdure al vapore (broccoli…)", 45, 4, ""),
    ("f-patate-forno", "contorno", "Patate al forno", 200, 4, ""),
    ("f-insalata", "contorno", "Insalata / cavolo cappuccio (senza condimento)", 30, 1, ""),
    ("f-mela", "frutta", "Mela", 80, 0, ""),
    ("f-yogurt", "frutta", "Yogurt (125 g)", 120, 4, ""),
    ("f-dessert", "dessert", "Dessert / torta (fetta)", 300, 4, ""),
    ("f-pane", "pane", "Pane, pagnottina (~100 g)", 270, 9, "2 pagnottine ≈ 200 g"),
    ("f-acqua", "altro", "Acqua", 0, 0, ""),
]


def _m006_meal_items_and_foods(c: sqlite3.Connection) -> None:
    """Pasti composti da più voci (vassoio della mensa) + catalogo piatti. Solo aggiunte."""
    cols = {r[1] for r in c.execute("PRAGMA table_info(meal_logs)")}
    if "items" not in cols:
        c.execute("ALTER TABLE meal_logs ADD COLUMN items TEXT")  # JSON: [{name, category, qty, kcal, protein_g, ...}]
    c.execute(
        """CREATE TABLE IF NOT EXISTS foods (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            name TEXT NOT NULL,
            kcal REAL,
            protein_g REAL,
            nutrition_source TEXT,
            note TEXT NOT NULL DEFAULT '',
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )"""
    )
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_foods_name ON foods(lower(name)) WHERE deleted_at IS NULL")
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    if not c.execute("SELECT 1 FROM foods LIMIT 1").fetchone():
        for fid, cat, name, kcal, prot, note in DEFAULT_FOODS:
            c.execute("INSERT INTO foods (id, category, name, kcal, protein_g, nutrition_source, note, created_at,"
                      " updated_at) VALUES (?, ?, ?, ?, ?, 'estimate', ?, ?, ?)", (fid, cat, name, kcal, prot, note, now, now))
    # Abitudine dichiarata dall'utente: dopo la palestra ~2 pagnottine di pane (~200 g) con il secondo.
    c.execute(
        "INSERT OR IGNORE INTO meal_templates VALUES ('t-secondo-pane2', 'dinner',"
        " 'Secondo del lavoro + 2 pagnottine (~200 g)', 840, 46, 'estimate', 'Secondo ~300 kcal + pane ~540 kcal.',"
        " 2, ?, ?, NULL)",
        (now, now),
    )


MIGRATIONS: list[Migration] = [
    (1, "app_state", _m001_app_state),
    (2, "sessions", _m002_sessions),
    (3, "fix_progressions_b6_c5", _m003_fix_progressions),
    (4, "workout_tables", _m004_workout_tables),
    (5, "meals_and_reminders", _m005_meals_and_reminders),
    (6, "meal_items_and_foods", _m006_meal_items_and_foods),
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
