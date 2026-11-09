#!/usr/bin/env bash
# Controlli non distruttivi: sintassi + test automatici in un container usa-e-getta (nessuna rete
# verso l'app live, nessun volume reale). Uso: scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
for f in static/js/*.js static/js/*/*.js; do node --experimental-default-type=module --check "$f" 2>/dev/null || { echo "Errore di sintassi: $f"; exit 1; }; done
python3 -m py_compile app/*.py
node --test tests/js/*.test.mjs >/dev/null || { echo "Test JS falliti: node --test tests/js/*.test.mjs"; exit 1; }
docker build -q -t fitweek:test . >/dev/null
docker run --rm --user root -v "$PWD":/src:ro -w /src --entrypoint sh fitweek:test -c \
  'pip install -q --no-cache-dir --root-user-action=ignore -r requirements-dev.txt >/dev/null && \
   PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider tests'
