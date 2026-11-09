#!/usr/bin/env bash
# Aggiorna l'istanza live alla versione del branch corrente.
# Passi: test → backup coerente → build → riavvio → verifica salute e versione.
# Le migrazioni del DB girano all'avvio con un loro backup automatico pre-migrazione.
# Rollback: git checkout <tag-precedente> && scripts/deploy.sh  (se lo schema è cambiato, anche
#           scripts/restore.sh con il backup "pre-deploy" stampato qui sotto).
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -z "$(git status --porcelain)" ]] || { echo "Ci sono modifiche non committate: interrompo."; exit 1; }
echo "== Test"
scripts/check.sh
echo "== Backup"
scripts/backup.sh "pre-deploy-$(git rev-parse --short HEAD)"
echo "== Build e riavvio"
docker compose build -q
docker compose up -d
echo "== Verifica"
status=""
for _ in $(seq 1 30); do
  status="$(docker inspect fitweek --format '{{.State.Health.Status}}')"
  [[ "$status" == healthy ]] && break
  sleep 2
done
echo "Stato container: $status"
curl -s http://192.168.222.200:8088/api/health; echo
docker logs --since 2m fitweek 2>&1 | grep -E '"migrazione applicata"|"backup pre-migrazione' || true
[[ "$status" == healthy ]] || { echo "ATTENZIONE: il container non è healthy. Vedi: docker logs fitweek"; exit 1; }
echo "Deploy completato: $(git describe --tags --always)"
