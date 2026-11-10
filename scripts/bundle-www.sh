#!/usr/bin/env bash
# Prepara le pagine dell'app Android autonoma: copia il frontend (static/) in una cartella e lo configura per
# parlare con il server a un indirizzo esplicito, con token al posto del cookie (vedi static/js/platform.js).
# Uso: scripts/bundle-www.sh <cartella-di-uscita> <URL_SERVER>
# Usato da scripts/build-apk.sh (canale "next") e da scripts/e2e.sh (test dell'app autonoma nel browser).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:?cartella di uscita}"
SERVER="${2:?URL del server, es. http://192.168.222.200:8088}"
[[ "$SERVER" =~ ^https?://[A-Za-z0-9.:-]+$ ]] || { echo "URL non valido: $SERVER" >&2; exit 2; }
[[ -n "$OUT" && "$OUT" != "/" ]] || { echo "Cartella di uscita non valida" >&2; exit 2; }

mkdir -p "$OUT"
cp -r static "$OUT/"
# index.html: configurazione prima del modulo principale + CSP (nell'APK non ci sono le intestazioni del server).
# connect-src ampio perché l'indirizzo del server si può cambiare dalla schermata di accesso.
CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src http: https:; font-src 'self'; object-src 'none'; base-uri 'none'"
sed -e "s#<script type=\"module\" src=\"/static/js/main.js\"></script>#<script src=\"/app-config.js\"></script>\n    <script type=\"module\" src=\"/static/js/main.js\"></script>#" \
    -e "s#<meta charset=\"utf-8\" />#<meta charset=\"utf-8\" />\n    <meta http-equiv=\"Content-Security-Policy\" content=\"${CSP}\" />#" \
    static/index.html > "$OUT/index.html"
grep -q 'app-config.js' "$OUT/index.html" && grep -q 'Content-Security-Policy' "$OUT/index.html" \
  || { echo "index.html non riconosciuto: configurazione non inserita" >&2; exit 1; }
printf 'window.FITWEEK_APP = { server: "%s" };\n' "$SERVER" > "$OUT/app-config.js"
echo "Pagine dell'app in $OUT (server: $SERVER)"
