#!/usr/bin/env bash
# Ripristina un backup SQLite di FitWeek nel volume. OPERAZIONE DISTRUTTIVA sullo stato corrente:
# prima salva automaticamente il DB attuale come backup "pre-restore".
# Uso: scripts/restore.sh /opt/backups/fitweek/fitweek-XXXX.sqlite [--yes]
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?Indica il file di backup}"
CONTAINER="${FITWEEK_CONTAINER:-fitweek}"
VOLUME="${FITWEEK_VOLUME:-fitweek_data}"
IMAGE="$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')"
[[ -f "$SRC" ]] || { echo "File non trovato: $SRC" >&2; exit 2; }

python3 - "$SRC" <<'PY'
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "backup corrotto"
v = c.execute("SELECT version FROM app_state WHERE id=1").fetchone()[0]
print(f"Backup valido, versione stato {v}")
PY

if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "Sostituire il DB corrente con $SRC? [scrivi SI] " answer
  [[ "$answer" == "SI" ]] || { echo "Annullato"; exit 1; }
fi

scripts/backup.sh pre-restore
docker stop "$CONTAINER" >/dev/null
# Gira come root perché i backup sono leggibili solo da root (600); poi restituisce i file all'utente dell'app.
docker run --rm --network none --user 0:0 \
  -v "$VOLUME":/data -v "$(realpath "$SRC")":/restore.sqlite:ro \
  --entrypoint python "$IMAGE" -c '
import os, sqlite3
for s in ("-wal", "-shm"):
    p = "/data/fitweek.sqlite" + s
    if os.path.exists(p): os.remove(p)
src = sqlite3.connect("file:/restore.sqlite?mode=ro", uri=True)
dst = sqlite3.connect("/data/fitweek.sqlite")
with dst: src.backup(dst)
assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
dst.close()
os.chown("/data/fitweek.sqlite", 10001, 10001)
'
docker start "$CONTAINER" >/dev/null
echo "Ripristino completato. Verifica: docker inspect $CONTAINER --format '{{.State.Health.Status}}'"
