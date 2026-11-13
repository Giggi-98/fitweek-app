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
sed -i 's#</manifest>#    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />\n    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />\n    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />\n    <uses-permission android:name="android.permission.VIBRATE" />\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n</manifest>#' "$MANIFEST"
grep -q 'REQUEST_INSTALL_PACKAGES' "$MANIFEST" || { echo "Manifest non riconosciuto: permesso di installazione non inserito" >&2; exit 1; }
# L'aggiornamento dell'app (AppUpdatePlugin) consegna l'APK scaricato all'installatore di Android tramite il
# FileProvider già dichiarato da Capacitor: deve esporre la cartella cache dell'app.
grep -q 'fileprovider' "$MANIFEST" && grep -q '<cache-path' android/app/src/main/res/xml/file_paths.xml \
  || { echo "FileProvider di Capacitor non riconosciuto: l'aggiornamento dell'app non funzionerebbe" >&2; exit 1; }

# Plugin nativo SecureToken: custodisce il token di sessione nell'Android Keystore (AES-256-GCM)
# invece che in chiaro in localStorage.
PKG_DIR="android/app/src/main/java/${APP_ID//.//}"
cat > "$PKG_DIR/SecureTokenPlugin.java" <<JAVA
package ${APP_ID};

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureToken")
public class SecureTokenPlugin extends Plugin {
    private static final String ALIAS = "fitweek_token_key";
    private static final String PREFS = "fitweek_secure";
    private static final String KEY_DATA = "token_gcm";
    private static final String KEY_IV = "token_iv";

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(ALIAS)) {
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            kg.init(new KeyGenParameterSpec.Builder(
                ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            return kg.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            String enc = prefs().getString(KEY_DATA, null);
            String iv = prefs().getString(KEY_IV, null);
            if (enc == null || iv == null) {
                ret.put("value", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = c.doFinal(Base64.decode(enc, Base64.NO_WRAP));
            ret.put("value", new String(plain, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            prefs().edit().clear().apply();
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value", "");
        if (value == null || value.isEmpty()) {
            prefs().edit().clear().apply();
            call.resolve();
            return;
        }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] cipher = c.doFinal(value.getBytes(StandardCharsets.UTF_8));
            prefs().edit()
                .putString(KEY_DATA, Base64.encodeToString(cipher, Base64.NO_WRAP))
                .putString(KEY_IV, Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                .apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Keystore error", e);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }
}
JAVA

# Plugin nativo AppUpdate: scarica dal server l'APK più recente, controlla l'impronta SHA-256 attesa e apre
# l'installatore di Android (che chiede conferma e accetta solo un APK firmato con la stessa chiave).
cat > "$PKG_DIR/AppUpdatePlugin.java" <<JAVA
package ${APP_ID};

import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private static final long MAX_BYTES = 100L * 1024 * 1024;

    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url", "");
        final String expected = call.getString("sha256", "");
        final String authorization = call.getString("authorization", "");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))
                || expected == null || !expected.matches("[0-9a-f]{64}")) {
            call.reject("Parametri non validi");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                download(call, url, expected, authorization);
            }
        }).start();
    }

    private void download(PluginCall call, String url, String expected, String authorization) {
        File dir = new File(getContext().getCacheDir(), "update");
        File apk = new File(dir, "fitweek-update.apk");
        HttpURLConnection conn = null;
        try {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cartella temporanea non disponibile");
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(false);
            if (authorization != null && !authorization.isEmpty()) {
                conn.setRequestProperty("Authorization", authorization);
            } else {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) conn.setRequestProperty("Cookie", cookie);
            }
            int status = conn.getResponseCode();
            if (status != 200) {
                call.reject("Download non riuscito (HTTP " + status + ")");
                return;
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            InputStream in = conn.getInputStream();
            OutputStream out = new FileOutputStream(apk);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > MAX_BYTES) throw new IOException("file troppo grande");
                    digest.update(buf, 0, n);
                    out.write(buf, 0, n);
                }
            } finally {
                out.close();
                in.close();
            }
            StringBuilder hex = new StringBuilder();
            for (byte b : digest.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equals(expected)) {
                apk.delete();
                call.reject("Il file scaricato non corrisponde all'impronta attesa: aggiornamento annullato");
                return;
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            apk.delete();
            call.reject("Download o installazione non riusciti: " + e.getMessage(), e);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
JAVA

cat > "$PKG_DIR/MainActivity.java" <<JAVA
package ${APP_ID};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureTokenPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
JAVA

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
