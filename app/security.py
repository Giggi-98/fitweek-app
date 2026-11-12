"""Sessioni revocabili, rate limit del login, controllo Origin, header di sicurezza."""
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import Settings
from .db import connect

COOKIE_NAME = "fitweek_session"

# CSP: niente script né stili inline o esterni. Le dimensioni dinamiche (barre, anelli) passano da
# attributi data-* applicati via CSSOM (static/js/ui.js applyDynamicStyles), che la CSP consente.
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; "
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
)
BASE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def password_matches(candidate: str, expected: str) -> bool:
    return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


class LoginRateLimiter:
    """Limita i tentativi falliti per IP in una finestra mobile (in memoria, processo singolo)."""

    def __init__(self, max_failures: int, window_s: int):
        self.max_failures = max_failures
        self.window_s = window_s
        self._failures: dict[str, deque[float]] = defaultdict(deque)

    def _recent(self, key: str, now: float) -> deque[float]:
        q = self._failures[key]
        while q and now - q[0] > self.window_s:
            q.popleft()
        return q

    def retry_after(self, key: str) -> int:
        now = time.monotonic()
        q = self._recent(key, now)
        if len(q) >= self.max_failures:
            return max(1, int(self.window_s - (now - q[0])) + 1)
        return 0

    def record_failure(self, key: str) -> None:
        self._failures[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


class SessionManager:
    RENEW_AFTER_S = 86_400  # dopo 24 h emette un token con firma fresca (rinnovo scorrevole)

    def __init__(self, settings: Settings):
        self.settings = settings
        self._serializer = URLSafeTimedSerializer(settings.session_secret, salt="fitweek-session-v2")

    def create(self, user_agent: str) -> str:
        sid = secrets.token_urlsafe(32)
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        with connect(self.settings.db_path) as c:
            c.execute(
                "INSERT INTO sessions (id, created_at, user_agent, last_seen_at) VALUES (?, ?, ?, ?)",
                (sid, now, user_agent[:200], now),
            )
        return self._serializer.dumps(sid)

    def verify(self, token: str) -> tuple[str | None, str | None]:
        """Verifica il token e aggiorna `last_seen_at` (scadenza scorrevole).
        Restituisce `(sid, token_rinnovato)` se la sessione è valida, altrimenti `(None, None)`."""
        if not token:
            return None, None
        try:
            sid, signed_at = self._serializer.loads(token, return_timestamp=True)
        except (BadSignature, SignatureExpired):
            return None, None
        if not isinstance(sid, str):
            return None, None
        now_dt = datetime.now().astimezone()
        now_iso = now_dt.isoformat(timespec="seconds")
        cutoff = now_dt.timestamp() - self.settings.session_max_age_s
        with connect(self.settings.db_path) as c:
            row = c.execute(
                "SELECT created_at, COALESCE(last_seen_at, created_at) FROM sessions WHERE id=?", (sid,)
            ).fetchone()
            if not row:
                return None, None
            try:
                last_ts = datetime.fromisoformat(row[1]).timestamp()
            except ValueError:
                last_ts = 0.0
            if last_ts < cutoff:
                c.execute("DELETE FROM sessions WHERE id=?", (sid,))
                return None, None
            if row[1] != now_iso:
                c.execute("UPDATE sessions SET last_seen_at=? WHERE id=?", (now_iso, sid))
        signed_age = now_dt.timestamp() - signed_at.timestamp()
        renewed = self._serializer.dumps(sid) if signed_age >= self.RENEW_AFTER_S else None
        return sid, renewed

    def session_id(self, token: str) -> str | None:
        sid, _ = self.verify(token)
        return sid

    def list_sessions(self, current_sid: str) -> list[dict]:
        self.purge_expired()
        with connect(self.settings.db_path) as c:
            rows = c.execute(
                "SELECT id, created_at, COALESCE(last_seen_at, created_at), user_agent "
                "FROM sessions ORDER BY COALESCE(last_seen_at, created_at) DESC, id"
            ).fetchall()
        return [
            {
                "id": r[0],
                "created_at": r[1],
                "last_seen_at": r[2],
                "user_agent": r[3],
                "current": r[0] == current_sid,
            }
            for r in rows
        ]

    def revoke(self, sid: str) -> bool:
        with connect(self.settings.db_path) as c:
            cur = c.execute("DELETE FROM sessions WHERE id=?", (sid,))
            return cur.rowcount > 0

    def revoke_all(self) -> None:
        with connect(self.settings.db_path) as c:
            c.execute("DELETE FROM sessions")

    def purge_expired(self) -> None:
        cutoff = time.time() - self.settings.session_max_age_s
        limit = datetime.fromtimestamp(cutoff).astimezone().isoformat(timespec="seconds")
        with connect(self.settings.db_path) as c:
            c.execute("DELETE FROM sessions WHERE COALESCE(last_seen_at, created_at) < ?", (limit,))


def request_token(request: Request) -> str:
    """Token di sessione: cookie (webapp) oppure `Authorization: Bearer` (app Android autonoma)."""
    header = request.headers.get("authorization", "")
    if header[:7].lower() == "bearer ":
        return header[7:].strip()
    return request.cookies.get(COOKIE_NAME, "")


def check_origin(request: Request) -> None:
    """Le scritture provenienti da un browser devono avere Origin uguale all'host servito."""
    origin = request.headers.get("origin")
    if not origin:
        return
    if origin.rstrip("/") in getattr(request.app.state, "app_origins", ()):
        return  # app Android autonoma (pagine nell'APK): origine fissa e dichiarata in configurazione
    parsed = urlparse(origin)
    if parsed.scheme not in ("http", "https") or parsed.netloc != request.headers.get("host", ""):
        raise HTTPException(status_code=403, detail="Origin non autorizzata")
