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
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
failed=0
for test in tests/e2e/*.e2e.js; do
  echo "== $test"
  docker rm -f "$NAME" >/dev/null 2>&1 || true   # container nuovo per ogni file: test indipendenti
  APK_MOUNT=(); [[ -f mobile/dist/fitweek.apk ]] && APK_MOUNT=(-v "$PWD/mobile/dist:/app/downloads:ro")
  docker run -d --rm --name "$NAME" -p "127.0.0.1:$PORT:8080" -e APP_PASSWORD="$E2E_PASSWORD" "${APK_MOUNT[@]}" \
    -e SESSION_SECRET="$(openssl rand -hex 32)" -e DB_PATH=/tmp/e2e.sqlite fitweek:test >/dev/null
  for _ in $(seq 1 30); do curl -sf "$E2E_URL/api/health" >/dev/null && break; sleep 0.5; done
  NODE_PATH="$TOOLS/node_modules" node "$test" || failed=1
done
echo "Screenshot: $E2E_SHOTS"
exit $failed
