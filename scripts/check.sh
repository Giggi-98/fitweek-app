#!/usr/bin/env bash
# Controlli non distruttivi: sintassi + test automatici in un container usa-e-getta (nessuna rete
# verso l'app live, nessun volume reale). Uso: scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node --check static/app.js
python3 -m py_compile app/*.py
docker build -q -t fitweek:test . >/dev/null
docker run --rm --user root -v "$PWD":/src:ro -w /src --entrypoint sh fitweek:test -c \
  'pip install -q --no-cache-dir --root-user-action=ignore -r requirements-dev.txt >/dev/null && \
   PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider tests'
