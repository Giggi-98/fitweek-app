"""Configurazione centralizzata letta dall'ambiente. Nessun segreto ha valori di default."""
import os
from dataclasses import dataclass
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    app_password: str
    session_secret: str
    cookie_secure: bool
    db_path: Path
    session_max_age_s: int = 60 * 60 * 24 * 30
    login_max_failures: int = 5
    login_window_s: int = 60
    max_state_bytes: int = 2_000_000
    pre_migration_backups_kept: int = 10

    @property
    def backup_dir(self) -> Path:
        return self.db_path.parent / "backups"


def load_settings() -> Settings:
    password = os.environ.get("APP_PASSWORD", "")
    secret = os.environ.get("SESSION_SECRET", "")
    if len(password) < 10:
        raise RuntimeError("Imposta APP_PASSWORD (almeno 10 caratteri) nel file .env")
    if len(secret) < 32:
        raise RuntimeError("Imposta SESSION_SECRET (almeno 32 caratteri) nel file .env")
    return Settings(
        app_password=password,
        session_secret=secret,
        cookie_secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
        db_path=Path(os.environ.get("DB_PATH", "/data/fitweek.sqlite")),
    )
