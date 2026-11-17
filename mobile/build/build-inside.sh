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
  APP_ID="app.fitweek.personal.next"   # id storico dell'app autonoma: cambiarlo impedirebbe di aggiornarla
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

# Plugin nativo BarcodeScan: legge un codice a barre con lo scanner di Google Play Services (ML Kit).
# La schermata della fotocamera è di Play Services: l'app non chiede il permesso CAMERA e non riceve immagini,
# solo le cifre lette. Alla prima lettura il telefono scarica il modulo dello scanner (serve la rete).
cat > "$PKG_DIR/BarcodeScanPlugin.java" <<JAVA
package ${APP_ID};

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

@CapacitorPlugin(name = "BarcodeScan")
public class BarcodeScanPlugin extends Plugin {
    @PluginMethod
    public void scan(final PluginCall call) {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_ITF)
                .build();
        GmsBarcodeScanning.getClient(getContext(), options).startScan()
                .addOnSuccessListener(barcode -> {
                    JSObject out = new JSObject();
                    out.put("code", barcode.getRawValue());
                    call.resolve(out);
                })
                .addOnCanceledListener(() -> call.resolve(new JSObject()))
                .addOnFailureListener(e -> call.reject("Lettura del codice non riuscita: " + e.getMessage()));
    }
}
JAVA
sed -i "s#^dependencies {#dependencies {\\n    implementation 'com.google.android.gms:play-services-code-scanner:16.1.0'#" android/app/build.gradle
grep -q 'play-services-code-scanner' android/app/build.gradle || { echo "build.gradle non riconosciuto: lo scanner dei codici a barre non è stato aggiunto" >&2; exit 1; }

# Plugin nativo HealthConnect (D-040): legge da Health Connect sonno, passi, battito a riposo e battito, solo
# con l'app aperta e solo i tipi consentiti dall'utente. Non scrive nulla su Health Connect. Il JS riassume e
# invia al server (static/js/watch.js). Libreria 1.1.0-alpha08: l'ultima che compila con compileSdk 34 e
# AGP 8.2.1 di Capacitor 6 (dalla 1.1.0-alpha09 serve compileSdk 35, dalla 1.1.0 compileSdk 36 e AGP 8.9.1).
# È in Kotlin perché la libreria espone solo funzioni sospese: si aggiunge il plugin Kotlin a Gradle.
cat > "$PKG_DIR/HealthConnectPlugin.kt" <<'KOTLIN'
package __APP_ID__

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    // Nome usato dal JS → permesso di lettura di Health Connect
    private val kinds: Map<String, String> = mapOf(
        "sleep" to HealthPermission.getReadPermission(SleepSessionRecord::class),
        "steps" to HealthPermission.getReadPermission(StepsRecord::class),
        "heart_rate" to HealthPermission.getReadPermission(HeartRateRecord::class),
        "resting_heart_rate" to HealthPermission.getReadPermission(RestingHeartRateRecord::class),
    )

    private fun client() = HealthConnectClient.getOrCreate(context)
    private fun namesOf(granted: Set<String>) = JSArray(kinds.filterValues { it in granted }.keys.toList())
    private fun instant(call: PluginCall, key: String): Instant =
        OffsetDateTime.parse(call.getString(key) ?: throw IllegalArgumentException("manca $key")).toInstant()

    /** Esegue `block` e risponde; ogni errore diventa un rifiuto leggibile, mai un crash dell'app. */
    private fun run(call: PluginCall, block: suspend () -> JSObject) {
        scope.launch {
            try {
                call.resolve(block())
            } catch (e: Exception) {
                call.reject(e.message ?: "Health Connect non risponde")
            }
        }
    }

    @PluginMethod
    fun availability(call: PluginCall) {
        val status = when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update_required"
            else -> "unavailable"
        }
        call.resolve(JSObject().put("status", status))
    }

    @PluginMethod
    fun grantedPermissions(call: PluginCall) = run(call) {
        JSObject().put("granted", namesOf(client().permissionController.getGrantedPermissions()))
    }

    @PluginMethod
    fun requestAccess(call: PluginCall) {
        val intent = PermissionController.createRequestPermissionResultContract().createIntent(context, kinds.values.toSet())
        startActivityForResult(call, intent, "permissionsResult")
    }

    @ActivityCallback
    fun permissionsResult(call: PluginCall, result: ActivityResult) {
        // La finestra di Android può essere chiusa senza scegliere: conta ciò che risulta concesso adesso.
        grantedPermissions(call)
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    private suspend fun <T : Record> readAll(type: KClass<T>, from: Instant, to: Instant): List<T> {
        val out = mutableListOf<T>()
        var page: String? = null
        do {
            val response = client().readRecords(ReadRecordsRequest(type, TimeRangeFilter.between(from, to), pageToken = page))
            out += response.records
            page = response.pageToken
        } while (!page.isNullOrEmpty())
        return out
    }

    private fun stageName(type: Int) = when (type) {
        SleepSessionRecord.STAGE_TYPE_DEEP -> "deep"
        SleepSessionRecord.STAGE_TYPE_LIGHT -> "light"
        SleepSessionRecord.STAGE_TYPE_REM -> "rem"
        SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED -> "awake"
        else -> "other"
    }

    @PluginMethod
    fun readSleep(call: PluginCall) = run(call) {
        val sessions = JSArray()
        for (s in readAll(SleepSessionRecord::class, instant(call, "from"), instant(call, "to"))) {
            val stages = JSArray()
            for (st in s.stages) {
                stages.put(JSObject().put("start", st.startTime.toString()).put("end", st.endTime.toString()).put("stage", stageName(st.stage)))
            }
            sessions.put(JSObject().put("start", s.startTime.toString()).put("end", s.endTime.toString()).put("stages", stages))
        }
        JSObject().put("sessions", sessions)
    }

    /** Passi per giorno locale, sommati da Health Connect senza contare due volte le stesse fonti. */
    @PluginMethod
    fun readSteps(call: PluginCall) = run(call) {
        val zone = ZoneId.systemDefault()
        val from = LocalDateTime.ofInstant(instant(call, "from"), zone).toLocalDate().atStartOfDay()
        val to = LocalDateTime.ofInstant(instant(call, "to"), zone)
        val groups = client().aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(from, to), Period.ofDays(1)),
        )
        val days = JSArray()
        for (g in groups) {
            val steps = g.result[StepsRecord.COUNT_TOTAL] ?: continue
            days.put(JSObject().put("date", g.startTime.toLocalDate().toString()).put("steps", steps))
        }
        JSObject().put("days", days)
    }

    @PluginMethod
    fun readRestingHeartRate(call: PluginCall) = run(call) {
        val records = JSArray()
        for (r in readAll(RestingHeartRateRecord::class, instant(call, "from"), instant(call, "to"))) {
            records.put(JSObject().put("time", r.time.toString()).put("bpm", r.beatsPerMinute))
        }
        JSObject().put("records", records)
    }

    @PluginMethod
    fun readHeartRate(call: PluginCall) = run(call) {
        val samples = JSArray()
        for (r in readAll(HeartRateRecord::class, instant(call, "from"), instant(call, "to"))) {
            for (s in r.samples) samples.put(JSObject().put("time", s.time.toString()).put("bpm", s.beatsPerMinute))
        }
        JSObject().put("samples", samples)
    }

    override fun handleOnDestroy() {
        scope.cancel()
    }
}
KOTLIN
sed -i "s/__APP_ID__/${APP_ID}/" "$PKG_DIR/HealthConnectPlugin.kt"

# Gradle: plugin Kotlin (stessa JVM 17 di Capacitor), libreria Health Connect, minSdk 26 richiesto dalla libreria.
sed -i "s#\(classpath 'com.android.tools.build:gradle:[^']*'\)#\1\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25'#" android/build.gradle
grep -q 'kotlin-gradle-plugin' android/build.gradle || { echo "build.gradle principale non riconosciuto: plugin Kotlin non aggiunto" >&2; exit 1; }
sed -i "s#^apply plugin: 'com.android.application'#apply plugin: 'com.android.application'\napply plugin: 'kotlin-android'#" android/app/build.gradle
sed -i "s#^android {#android {\n    kotlinOptions { jvmTarget = '17' }#" android/app/build.gradle
sed -i "s#^dependencies {#dependencies {\n    implementation 'androidx.health.connect:connect-client:1.1.0-alpha08'\n    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'#" android/app/build.gradle
grep -q "apply plugin: 'kotlin-android'" android/app/build.gradle && grep -q 'connect-client' android/app/build.gradle && grep -q "jvmTarget = '17'" android/app/build.gradle \
  || { echo "build.gradle dell'app non riconosciuto: Health Connect non aggiunto" >&2; exit 1; }
sed -i 's/minSdkVersion = [0-9]*/minSdkVersion = 26/' android/variables.gradle
grep -q 'minSdkVersion = 26' android/variables.gradle || { echo "variables.gradle non riconosciuto: minSdk non portato a 26" >&2; exit 1; }

# Manifest: permessi di sola lettura, visibilità dell'app Health Connect (Android 13 e precedenti) e la schermata
# che spiega l'uso dei dati, senza la quale Android non mostra la richiesta dei permessi: apre l'app stessa.
sed -i 's#</manifest>#    <uses-permission android:name="android.permission.health.READ_SLEEP" />\n    <uses-permission android:name="android.permission.health.READ_STEPS" />\n    <uses-permission android:name="android.permission.health.READ_HEART_RATE" />\n    <uses-permission android:name="android.permission.health.READ_RESTING_HEART_RATE" />\n    <queries><package android:name="com.google.android.apps.healthdata" /></queries>\n</manifest>#' "$MANIFEST"
sed -i 's#</application>#    <activity-alias android:name="ViewPermissionUsageActivity" android:exported="true" android:targetActivity=".MainActivity" android:permission="android.permission.START_VIEW_PERMISSION_USAGE">\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />\n                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />\n            </intent-filter>\n        </activity-alias>\n    </application>#' "$MANIFEST"
sed -i '0,/<intent-filter>/s#<intent-filter>#<intent-filter>\n                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />\n            </intent-filter>\n            <intent-filter>#' "$MANIFEST"
grep -q 'READ_SLEEP' "$MANIFEST" && grep -q 'HEALTH_PERMISSIONS' "$MANIFEST" && grep -q 'ACTION_SHOW_PERMISSIONS_RATIONALE' "$MANIFEST" \
  || { echo "Manifest non riconosciuto: permessi di Health Connect non inseriti" >&2; exit 1; }

cat > "$PKG_DIR/MainActivity.java" <<JAVA
package ${APP_ID};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureTokenPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(BarcodeScanPlugin.class);
        registerPlugin(HealthConnectPlugin.class);
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
