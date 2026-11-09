#!/usr/bin/env bash
# GIÀ ESEGUITO il 2026-11-09 (completato a mano dopo il bug sotto). Conservato come riferimento.
# Bug corretto: la copia deve girare come root (backup con permessi 600) e poi fare chown 10001.
# Deploy una tantum di M1: passa al volume esterno fitweek_data copiando i dati con backup coerente.
# Il vecchio volume fitweek-app_fitweek_data NON viene toccato (resta come copia di sicurezza).
# Downtime previsto: ~15 secondi. Le sessioni esistenti vanno rifatte (nuovo sistema di login).
set -euo pipefail
cd "$(dirname "$0")/.."
OLD_VOL_DB=/var/lib/docker/volumes/fitweek-app_fitweek_data/_data/fitweek.sqlite

docker volume inspect fitweek_data >/dev/null 2>&1 && { echo "Il volume fitweek_data esiste già: interrompo."; exit 1; }
B="$(scripts/backup.sh pre-deploy-m1)"; echo "Backup: $B"
docker stop fitweek >/dev/null; echo "Container vecchio fermato"
python3 - "$B" "$OLD_VOL_DB" <<'PY'
import sqlite3, sys
q = "SELECT version, json FROM app_state"
bk = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True).execute(q).fetchone()
live = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True).execute(q).fetchone()
assert bk == live, "Il DB è cambiato dopo il backup: riavvia il vecchio container (docker start fitweek) e riprova"
print("Backup identico al DB live, versione", bk[0])
PY
docker volume create fitweek_data >/dev/null
docker compose build -q
docker run --rm --network none --user 0:0 -v fitweek_data:/data -v "$B":/restore.sqlite:ro \
  --entrypoint python fitweek:latest -c '
import sqlite3
src = sqlite3.connect("file:/restore.sqlite?mode=ro", uri=True); dst = sqlite3.connect("/data/fitweek.sqlite")
with dst: src.backup(dst)
assert dst.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
dst.close(); import os; os.chown("/data/fitweek.sqlite", 10001, 10001)
print("Dati copiati in fitweek_data")'
docker compose up -d
for i in $(seq 1 20); do
  s="$(docker inspect fitweek --format '{{.State.Health.Status}}')"; [[ "$s" == healthy ]] && break; sleep 3
done
echo "Stato: $s"; curl -s http://192.168.222.200:8088/api/health; echo
[[ "$s" == healthy ]] || { echo "ROLLBACK: docker compose down; git checkout v1.0.0 -- . ; ripristina il vecchio compose e 'docker compose up -d'"; exit 1; }
