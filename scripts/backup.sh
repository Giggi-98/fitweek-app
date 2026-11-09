#!/usr/bin/env bash
# Backup coerente del DB FitWeek tramite l'API di backup di SQLite (sicuro con WAL, a caldo).
# Uso: scripts/backup.sh [etichetta]    es. scripts/backup.sh pre-deploy
# Variabili: FITWEEK_CONTAINER (default fitweek), FITWEEK_BACKUP_DIR (default /opt/backups/fitweek),
#            KEEP_DAILY (default 14), KEEP_TAGGED (default 20)
set -euo pipefail
CONTAINER="${FITWEEK_CONTAINER:-fitweek}"
DEST_DIR="${FITWEEK_BACKUP_DIR:-/opt/backups/fitweek}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_TAGGED="${KEEP_TAGGED:-20}"
LABEL="${1:-auto}"
[[ "$LABEL" =~ ^[a-z0-9-]+$ ]] || { echo "Etichetta non valida: $LABEL" >&2; exit 2; }

TS="$(date +%Y%m%d-%H%M%S)"
NAME="fitweek-${LABEL}-${TS}.sqlite"
mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

# 1. Backup online dentro al container (stesso utente proprietario del DB)
docker exec -i "$CONTAINER" python - "$NAME" <<'PY'
import os, sqlite3, sys
src_path = os.environ.get("DB_PATH", "/data/fitweek.sqlite")
out_dir = os.path.join(os.path.dirname(src_path), "backups")
os.makedirs(out_dir, exist_ok=True)
dst_path = os.path.join(out_dir, sys.argv[1])
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
with dst:
    src.backup(dst)
dst.execute("PRAGMA journal_mode=DELETE")  # file autonomo, senza -wal/-shm
ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
dst.close(); src.close()
if ok != "ok":
    os.remove(dst_path)
    sys.exit(f"integrity_check fallito: {ok}")
PY

# 2. Copia fuori dal volume e rimozione della copia interna
docker cp "$CONTAINER:/data/backups/$NAME" "$DEST_DIR/$NAME" >/dev/null
docker exec "$CONTAINER" rm -f "/data/backups/$NAME"
chmod 600 "$DEST_DIR/$NAME"

# 3. Verifica della copia esterna
python3 - "$DEST_DIR/$NAME" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "integrity_check fallito"
assert c.execute("SELECT count(*) FROM app_state").fetchone()[0] == 1, "app_state mancante"
PY

# 4. Rotazione: backup automatici e backup etichettati gestiti separatamente
prune() {  # prune <pattern-regex> <da-tenere>
  find "$DEST_DIR" -maxdepth 1 -type f -name 'fitweek-*.sqlite' -printf '%T@ %p\n' \
    | grep -E -- "$1" | sort -rn | tail -n +$(( $2 + 1 )) | cut -d' ' -f2- | xargs -r rm -f || true
}
prune '/fitweek-auto-' "$KEEP_DAILY"
prune '/fitweek-[a-z0-9]+(-[a-z0-9]+)*-[0-9]{8}-[0-9]{6}\.sqlite$' $(( KEEP_DAILY + KEEP_TAGGED ))

echo "$DEST_DIR/$NAME"
