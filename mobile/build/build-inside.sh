#!/usr/bin/env bash
# Eseguito DENTRO il container builder (vedi scripts/build-apk.sh). Non lanciarlo sull'host.
# Input:  /src (mobile/ in sola lettura), /bundle (pagine dell'app, solo canale next), /secrets (keystore +
#         password), env APP_URL, APP_VERSION, CHANNEL (stable|next)
# Output: /out/fitweek.apk + fitweek-apk.json  (next: fitweek-next.apk + fitweek-next-apk.json)
set -euo pipefail
: "${APP_URL:?}" "${APP_VERSION:?}"
CHANNEL="${CHANNEL:-stable}"
APP_ID="app.fitweek.personal"
APP_NAME="FitWeek"
STEM="fitweek"
if [[ "$CHANNEL" == next ]]; then
  APP_ID="app.fitweek.personal.next"   # si installa accanto alla stable
  APP_NAME="FitWeek β"
  STEM="fitweek-next"
fi

rm -rf /work/app && mkdir -p /work/app && cp -r /src/package.json /src/package-lock.json /src/www /work/app/
cd /work/app
npm ci --no-audit --no-fund --loglevel=error

if [[ "$CHANNEL" == next ]]; then
  # App autonoma: le pagine stanno nell'APK (origine http://localhost) e chiamano il server via rete.
  rm -rf www && cp -r /bundle www
  test -f www/index.html && test -f www/app-config.js
  SERVER_JSON='"server": { "androidScheme": "http", "cleartext": true },'
else
  # Guscio: carica la webapp dal server; la pagina offline ha il pulsante "Riprova" verso quel server.
  sed -i "s#window.FITWEEK_URL||'/'#'${APP_URL}'#" www/offline.html
  SERVER_JSON="\"server\": { \"url\": \"${APP_URL}\", \"cleartext\": true, \"errorPath\": \"offline.html\" },"
fi

cat > capacitor.config.json <<JSON
{
  "appId": "${APP_ID}",
  "appName": "${APP_NAME}",
  "webDir": "www",
  ${SERVER_JSON}
  "android": { "allowMixedContent": false },
  "plugins": {
    "LocalNotifications": { "smallIcon": "ic_stat_fitweek", "iconColor": "#3f7d1f" }
  }
}
JSON

npx cap add android >/dev/null
MANIFEST=android/app/src/main/AndroidManifest.xml
# HTTP verso il server di casa (solo LAN/VPN) + permessi per notifiche e sveglie esatte.
sed -i 's#<application#<application android:usesCleartextTraffic="true"#' "$MANIFEST"
sed -i 's#</manifest>#    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />\n    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n    <uses-permission android:name="android.permission.VIBRATE" />\n</manifest>#' "$MANIFEST"

# Versione: 1.4.0 → versionCode 10400
IFS=. read -r MA MI PA <<<"$APP_VERSION"
CODE=$((MA * 10000 + MI * 100 + PA))
sed -i "s/versionCode [0-9]*/versionCode ${CODE}/; s/versionName \"[^\"]*\"/versionName \"${APP_VERSION}\"/" android/app/build.gradle

# Icone: quadrato verde con rombo (launcher) e rombo bianco monocromatico (barra notifiche).
RES=android/app/src/main/res
rm -rf "$RES/mipmap-anydpi-v26"
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; s=${pair##*:}; r=$((s * 22 / 100)); c=$((s / 2)); k=$((s * 30 / 100)); i=$((s * 14 / 100))
  mkdir -p "$RES/mipmap-$d"
  convert -size ${s}x${s} xc:none -fill '#b8ee7b' -draw "roundrectangle 0,0 $((s-1)),$((s-1)) $r,$r" \
    -fill '#11260f' -draw "polygon $c,$((c-k)) $((c+k)),$c $c,$((c+k)) $((c-k)),$c" \
    -fill '#b8ee7b' -draw "polygon $c,$((c-i)) $((c+i)),$c $c,$((c+i)) $((c-i)),$c" "$RES/mipmap-$d/ic_launcher.png"
  cp "$RES/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
  n=$((s / 2)); nc=$((n / 2)); nk=$((n * 42 / 100))
  mkdir -p "$RES/drawable-$d"
  convert -size ${n}x${n} xc:none -fill white -draw "polygon $nc,$((nc-nk)) $((nc+nk)),$nc $nc,$((nc+nk)) $((nc-nk)),$nc" "$RES/drawable-$d/ic_stat_fitweek.png"
done
rm -f "$RES"/mipmap-*/ic_launcher_foreground.png

npx cap sync android >/dev/null
(cd android && ./gradlew --no-daemon -q assembleRelease)

UNSIGNED=android/app/build/outputs/apk/release/app-release-unsigned.apk
source /secrets/android-keystore.env
zipalign -f -p 4 "$UNSIGNED" /work/aligned.apk
apksigner sign --ks /secrets/fitweek-release.jks --ks-key-alias fitweek \
  --ks-pass "pass:${KEYSTORE_PASSWORD}" --key-pass "pass:${KEYSTORE_PASSWORD}" --out "/out/${STEM}.apk" /work/aligned.apk
# verify segnala come WARNING i file META-INF non firmati dallo schema v1: normali, non li stampiamo.
if ! verify_out=$(apksigner verify "/out/${STEM}.apk" 2>&1); then echo "$verify_out" >&2; exit 1; fi
rm -f "/out/${STEM}.apk.idsig"

SHA=$(sha256sum "/out/${STEM}.apk" | cut -d' ' -f1)
SIZE=$(stat -c %s "/out/${STEM}.apk")
cat > "/out/${STEM}-apk.json" <<JSON
{"version": "${APP_VERSION}", "version_code": ${CODE}, "server_url": "${APP_URL}", "size": ${SIZE}, "sha256": "${SHA}", "built_at": "$(date -Iseconds)", "app_id": "${APP_ID}", "channel": "${CHANNEL}"}
JSON
aapt dump badging "/out/${STEM}.apk" | grep -E "^(package|sdkVersion|targetSdkVersion|uses-permission)" || true
