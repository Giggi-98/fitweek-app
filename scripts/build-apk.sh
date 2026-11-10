#!/usr/bin/env bash
# Compila e firma l'APK Android di FitWeek in un container (nessuna installazione sull'host).
# Uso: scripts/build-apk.sh [URL_SERVER] [stable|next]   (predefiniti: http://192.168.222.200:8088, stable)
#   stable: guscio che carica la webapp dal server            → mobile/dist/fitweek.apk
#   next:   app autonoma con le pagine dentro l'APK (D-021),  → mobile/dist/fitweek-next.apk
#           appId diverso: si installa ACCANTO alla stable, senza sostituirla.
# Output servito dalla webapp in Impostazioni (con il relativo file .json).
# La chiave di firma vive in /opt/fitweek-secrets (fuori dal repository): NON perderla, altrimenti
# gli aggiornamenti non si installano sopra la versione già presente sul telefono.
set -euo pipefail
cd "$(dirname "$0")/.."
APP_URL="${1:-http://192.168.222.200:8088}"
CHANNEL="${2:-stable}"
[[ "$CHANNEL" == stable || "$CHANNEL" == next ]] || { echo "Canale non valido: $CHANNEL (stable|next)" >&2; exit 2; }
APP_VERSION="$(python3 -c 'import re;print(re.search(r"APP_VERSION = \"(.+?)\"", open("app/__init__.py").read()).group(1))')"
SECRETS=/opt/fitweek-secrets
CACHE="${HOME}/.cache/fitweek-android"
OUT="$PWD/mobile/dist"
IMAGE=fitweek-android-builder:1

[[ "$APP_URL" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || { echo "URL non valido: $APP_URL" >&2; exit 2; }
mkdir -p "$CACHE/gradle" "$CACHE/npm" "$OUT"
install -d -m 700 "$SECRETS"

echo "== Builder"
docker build -q -t "$IMAGE" mobile/build >/dev/null

if [[ ! -f "$SECRETS/fitweek-release.jks" ]]; then
  echo "== Creo la chiave di firma (una sola volta) in $SECRETS"
  PASS="$(openssl rand -hex 24)"
  umask 077
  printf 'KEYSTORE_PASSWORD=%s\n' "$PASS" > "$SECRETS/android-keystore.env"
  docker run --rm -v "$SECRETS":/secrets "$IMAGE" keytool -genkeypair -keystore /secrets/fitweek-release.jks \
    -alias fitweek -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=FitWeek, O=Personal" \
    -storepass "$PASS" -keypass "$PASS" >/dev/null 2>&1
  chmod 600 "$SECRETS"/*
fi

# Canale next: le pagine del frontend entrano nell'APK, già configurate per il server indicato.
BUNDLE="$(mktemp -d)"
trap '[[ -d "$BUNDLE" ]] && rm -rf -- "$BUNDLE"' EXIT
[[ "$CHANNEL" == next ]] && scripts/bundle-www.sh "$BUNDLE" "$APP_URL"

echo "== Compilo FitWeek $APP_VERSION ($CHANNEL) per $APP_URL"
docker run --rm \
  -e APP_URL="$APP_URL" -e APP_VERSION="$APP_VERSION" -e CHANNEL="$CHANNEL" \
  -v "$PWD/mobile":/src:ro -v "$BUNDLE":/bundle:ro -v "$SECRETS":/secrets:ro -v "$OUT":/out \
  -v "$CACHE/gradle":/root/.gradle -v "$CACHE/npm":/root/.npm \
  "$IMAGE" bash /src/build/build-inside.sh
STEM=fitweek; [[ "$CHANNEL" == next ]] && STEM=fitweek-next
echo "== Pronto: $OUT/$STEM.apk"
cat "$OUT/$STEM-apk.json"; echo
