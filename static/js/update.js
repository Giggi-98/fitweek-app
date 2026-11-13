// Aggiornamento dell'app Android (1.11, D-033). Nel browser non fa nulla.
// Rilevamento: la versione installata (plugin App di Capacitor) si confronta con quella dell'APK che il server
// ha pronto per lo stesso canale (`GET /api/v1/app/android`, già esistente).
// Installazione: il plugin nativo `AppUpdate` scarica l'APK dal server, ne controlla l'impronta SHA-256 e apre
// l'installatore di Android. Android chiede sempre conferma all'utente e accetta l'aggiornamento solo se è
// firmato con la stessa chiave dell'app installata: è questa la protezione contro un file manomesso in rete.
// Niente si scarica da solo: il download parte solo quando l'utente tocca "Aggiorna".
import { request } from "./api.js";
import { apiUrl, token } from "./platform.js";

const cap = () => globalThis.Capacitor;
const AppPlugin = () => cap()?.Plugins?.App || null;
const Updater = () => cap()?.Plugins?.AppUpdate || null;
const STABLE_ID = "app.fitweek.personal";
const RECHECK_MS = 60 * 60 * 1000; // al ritorno in primo piano non si richiede più di una volta l'ora

/** installed = { id, version, build } dell'app in uso; available = APK più recente sul server o null;
 *  canInstall = l'app ha il plugin per installarlo da sola (le versioni fino alla 1.10 non lo hanno). */
export const updateStatus = { installed: null, available: null, canInstall: false, busy: false, error: null, checkedAt: 0 };

/** Regola pura: quale APK del server aggiorna l'app installata. Vale solo lo stesso canale (stesso `app_id`:
 *  la versione di prova non sostituisce la stabile) e solo un `version_code` più alto.
 *  @param installed { id, build } da `App.getInfo()`  @param info risposta di `/api/v1/app/android`
 *  @returns { version, version_code, size, sha256, channel } oppure null */
export function pickUpdate(installed, info) {
  if (!installed?.id || !info) return null;
  const candidates = [
    info.available ? { ...info, app_id: info.app_id || STABLE_ID, channel: "stable" } : null,
    info.next ? { ...info.next, channel: "next" } : null,
  ];
  const meta = candidates.find((m) => m && m.app_id === installed.id);
  const have = Number(installed.build);
  if (!meta || !Number.isInteger(meta.version_code) || !Number.isInteger(have) || meta.version_code <= have) return null;
  if (!/^[0-9a-f]{64}$/.test(meta.sha256 || "")) return null; // senza impronta non si installa nulla
  return { version: String(meta.version || ""), version_code: meta.version_code, size: meta.size, sha256: meta.sha256, channel: meta.channel };
}

const changed = () => globalThis.dispatchEvent?.(new Event("fitweek:update-status"));

/** Chiede al server se c'è un APK più recente di quello installato. Senza rete o senza sessione non cambia nulla.
 *  @param force false = al massimo una volta l'ora  @returns l'aggiornamento disponibile o null */
export async function checkForUpdate({ force = true } = {}) {
  if (!cap()?.isNativePlatform?.() || !AppPlugin()?.getInfo) return null;
  if (!force && Date.now() - updateStatus.checkedAt < RECHECK_MS) return updateStatus.available;
  try {
    const [installed, info] = await Promise.all([AppPlugin().getInfo(), request("/api/v1/app/android", { fresh: true })]);
    Object.assign(updateStatus, {
      installed: { id: installed.id, version: installed.version, build: installed.build },
      available: pickUpdate(installed, info),
      canInstall: Boolean(Updater()),
      checkedAt: Date.now(),
      error: null,
    });
  } catch (e) {
    updateStatus.error = e.message || String(e);
  }
  changed();
  return updateStatus.available;
}

/** Scarica l'APK disponibile e apre l'installatore di Android. @returns true se l'installatore è stato aperto */
export async function installUpdate() {
  const up = updateStatus.available;
  if (!up || !Updater() || updateStatus.busy) return false;
  Object.assign(updateStatus, { busy: true, error: null });
  changed();
  try {
    const path = `/api/v1/app/android/download?channel=${up.channel}`;
    await Updater().install({
      url: new URL(apiUrl(path), globalThis.location?.origin).href, // guscio: stesso server della pagina
      authorization: token() ? `Bearer ${token()}` : "", // guscio: nessun token, il plugin usa il cookie della WebView
      sha256: up.sha256,
    });
    return true;
  } catch (e) {
    updateStatus.error = e.message || String(e);
    return false;
  } finally {
    updateStatus.busy = false;
    changed();
  }
}
