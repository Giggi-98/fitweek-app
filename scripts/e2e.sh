#!/usr/bin/env bash
# Test end-to-end con Chromium headless (Playwright) su un container usa-e-getta:
# DB temporaneo, porta solo su 127.0.0.1, nessun dato reale. Uso: scripts/e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
TOOLS="${E2E_TOOLS:-$HOME/.cache/fitweek-e2e}"   # playwright + browser, fuori dal repo
PORT="${E2E_PORT:-18088}"
NAME="fitweek-e2e-$$"
export E2E_PASSWORD="e2e-$(openssl rand -hex 8)"
export E2E_URL="http://127.0.0.1:$PORT"
export E2E_SHOTS="${E2E_SHOTS:-$(mktemp -d)}"
export PLAYWRIGHT_BROWSERS_PATH="$TOOLS/browsers"

if [[ ! -d "$TOOLS/node_modules/playwright" ]]; then
  mkdir -p "$TOOLS" && (cd "$TOOLS" && npm init -y >/dev/null && npm i -s playwright@1.49.1 >/dev/null)
  (cd "$TOOLS" && npx playwright install chromium >/dev/null)
fi
docker build -q -t fitweek:test . >/dev/null
# App autonoma: le sue pagine sono servite da un'altra origine (come nell'APK), con un piccolo server statico.
APP_PORT="${E2E_APP_PORT:-18090}"
export E2E_APP_URL="http://127.0.0.1:$APP_PORT"
BUNDLE="$(mktemp -d)"
scripts/bundle-www.sh "$BUNDLE" "$E2E_URL" >/dev/null
python3 -m http.server "$APP_PORT" --bind 127.0.0.1 --directory "$BUNDLE" >/dev/null 2>&1 &
STATIC_PID=$!
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; kill "$STATIC_PID" 2>/dev/null || true; [[ -d "$BUNDLE" ]] && rm -rf -- "$BUNDLE"' EXIT
failed=0
for test in tests/e2e/${E2E_ONLY:-*}.e2e.js; do   # E2E_ONLY=native per un solo file
  echo "== $test"
  docker rm -f "$NAME" >/dev/null 2>&1 || true   # container nuovo per ogni file: test indipendenti
  APK_MOUNT=(); [[ -f mobile/dist/fitweek.apk ]] && APK_MOUNT=(-v "$PWD/mobile/dist:/app/downloads:ro")
  docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:8080" -e APP_PASSWORD="$E2E_PASSWORD" -e APP_ORIGINS="$E2E_APP_URL" "${APK_MOUNT[@]}" \
    -e SESSION_SECRET="$(openssl rand -hex 32)" -e DB_PATH=/tmp/e2e.sqlite fitweek:test >/dev/null
  for _ in $(seq 1 30); do curl -sf "$E2E_URL/api/health" >/dev/null && break; sleep 0.5; done
  # La creazione del container cambia le interfacce di rete dell'host: Chromium annulla i caricamenti in corso
  # (net::ERR_NETWORK_CHANGED) e la pagina resta sul caricamento. Si aspetta che la rete si assesti.
  sleep 3
  NODE_PATH="$TOOLS/node_modules" node "$test" || failed=1
done
echo "Screenshot: $E2E_SHOTS"
exit $failed
