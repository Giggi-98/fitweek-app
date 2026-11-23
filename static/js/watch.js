// Importazione dei dati dall'orologio nell'app Android (D-040). Il plugin nativo `HealthConnect` legge Health
// Connect sul telefono; da qui partono verso il server, dalla coda come ogni altra modifica, solo i valori
// cambiati (regole in health.js). Il server non legge mai l'orologio. Nel browser il plugin non c'è e non
// succede nulla.
import { app, localCopy, persistState } from "./store.js";
import { standalone } from "./platform.js";
import { commit, enqueue } from "./workout/queue.js";
import { storage, uid } from "./util.js";
import { watchSamples } from "./wear.js";
import { averageByDay, healthDays, healthDayWrites, heartChanged, heartSummary, MIN_HEART_SAMPLES, heartWindows, importStart, liveHeart, nightsFromSessions, restingByDay, sleepWrites, stepsByDay, weightWrites } from "./health.js";

const LAST_KEY = "fitweek.healthImport.v1"; // orario dell'ultima importazione riuscita
const MIN_GAP_MS = 15 * 60_000; // all'apertura e al ritorno sull'app, non più spesso di così
const LIVE_MS = 60_000; // durante una seduta il battito si rilegge ogni minuto (con l'app aperta)
const plugin = () => globalThis.Capacitor?.Plugins?.HealthConnect || null;

export const canReadHealth = () => standalone && Boolean(plugin());
/** availability: available | update_required | unavailable | unknown;
 *  granted: sleep, steps, heart_rate, resting_heart_rate, hrv, spo2, weight */
export const healthStatus = { availability: "unknown", granted: [], last: storage.get(LAST_KEY, null), imported: null, error: null };

const announce = () => window.dispatchEvent(new Event("fitweek:health-status"));

export async function refreshHealthStatus() {
  if (!canReadHealth()) return;
  try {
    healthStatus.availability = (await plugin().availability()).status;
    healthStatus.granted = healthStatus.availability === "available" ? (await plugin().grantedPermissions()).granted : [];
  } catch (e) {
    healthStatus.error = e.message || "Health Connect non risponde";
  }
  announce();
}

/** Chiede i permessi (finestra di Android) e, se ne è stato concesso almeno uno, importa subito. */
export async function connectHealth() {
  healthStatus.granted = (await plugin().requestAccess()).granted;
  announce();
  if (healthStatus.granted.length) await importHealth({ force: true });
}

export const openHealthSettings = () => plugin().openSettings();

let importing = null;
/** Importa se è passato abbastanza tempo dall'ultima volta (o subito con `force`). Una sola alla volta. */
export function importHealth({ force = false } = {}) {
  const last = storage.get(LAST_KEY, null);
  if (!canReadHealth() || (!force && last && Date.now() - new Date(last).getTime() < MIN_GAP_MS)) return Promise.resolve(null);
  // Forzata mentre un'altra è in corso (es. a fine seduta): quella in corso non conosce la seduta appena chiusa,
  // quindi ne parte un'altra subito dopo, invece di riusarne il risultato.
  if (force && importing) return importing.then(() => importHealth({ force: true }));
  return (importing ??= run().finally(() => (importing = null)));
}

async function run() {
  const db = localCopy();
  if (!db) return null; // la copia dei dati non è ancora arrivata: serve per non reinviare ciò che c'è già
  await refreshHealthStatus();
  const has = (kind) => healthStatus.granted.includes(kind);
  if (healthStatus.availability !== "available" || !healthStatus.granted.length) return null;
  const p = plugin();
  const to = new Date().toISOString();
  const from = importStart(storage.get(LAST_KEY, null), new Date(to));
  let count = 0;
  const send = (path, body, key) => {
    enqueue("PUT", path, body, key);
    count++;
  };
  try {
    if (has("sleep")) {
      for (const n of sleepWrites(nightsFromSessions((await p.readSleep({ from, to })).sessions), db)) send(`/api/v1/sleep/${n.date}`, n.body, `sleep:${n.date}`);
    }
    const read = {};
    if (has("steps")) read.steps = stepsByDay((await p.readSteps({ from, to })).days);
    if (has("resting_heart_rate")) read.resting_hr = restingByDay((await p.readRestingHeartRate({ from, to })).records);
    if (has("hrv")) read.hrv_ms = averageByDay((await p.readHrv({ from, to })).records);
    if (has("spo2")) read.spo2 = averageByDay((await p.readSpo2({ from, to })).records);
    for (const d of healthDayWrites(healthDays(read, db), db)) send(`/api/v1/health-days/${d.date}`, d.body, `health:${d.date}`);
    if (has("heart_rate")) {
      for (const w of heartWindows(app.sessions, from)) {
        const heart = heartSummary(await sessionSamples(w), w);
        if (!heart || !heartChanged(w.heart, heart)) continue;
        send(`/api/v1/workout-heart/${encodeURIComponent(w.id)}`, heart, `heart:${w.id}`);
        app.sessions = app.sessions.map((s) => (s.id === w.id ? { ...s, heart } : s)); // le sedute non sono nella copia
      }
    }
    if (has("weight") && app.state) {
      const added = weightWrites((await p.readWeight({ from, to })).records, app.state.weights);
      for (const w of added) app.state.weights.push({ id: uid(), date: w.date, weight: w.weight, waist: null, note: "", source: "health_connect" });
      if (added.length) {
        count += added.length;
        await persistState({ quiet: true }); // le pesate sono ancora nello stato a blob
      }
    }
    storage.set(LAST_KEY, to);
    Object.assign(healthStatus, { last: to, imported: count, error: null });
  } catch (e) {
    healthStatus.error = e.message || "Lettura non riuscita";
  }
  if (count) await commit();
  announce();
  return count;
}

/** Campioni di una seduta: quelli dell'app sull'orologio se bastano (uno ogni 1–2 s), altrimenti Health Connect. */
async function sessionSamples(w) {
  const own = watchSamples(w.id);
  return own.length >= MIN_HEART_SAMPLES ? own : (await plugin().readHeartRate({ from: w.start, to: w.end })).samples;
}

// ---- battito dal vivo durante la seduta ------------------------------------------------------------------
/** Ultimo battito della seduta in corso; `value` = {bpm, at, avg, max, samples} di liveHeart(), oppure null. */
export const heartLive = { sessionId: null, value: null };
let polling = null;

/** Rilegge il battito della seduta aperta (al massimo una lettura alla volta). Nel browser non fa nulla. */
export function pollLiveHeart() {
  const s = app.today?.active_session;
  if (!canReadHealth() || !s?.started_at || document.visibilityState !== "visible") return Promise.resolve(null);
  return (polling ??= readLive(s).finally(() => (polling = null)));
}

async function readLive(session) {
  const own = watchSamples(session.id); // dall'app sull'orologio: più fitti e senza il ritardo di OHealth
  if (!own.length && healthStatus.availability === "unknown") await refreshHealthStatus();
  if (!own.length && !healthStatus.granted.includes("heart_rate")) return null;
  try {
    const samples = own.length ? own : (await plugin().readHeartRate({ from: session.started_at, to: new Date().toISOString() })).samples;
    Object.assign(heartLive, { sessionId: session.id, value: liveHeart(samples, session.started_at) });
  } catch {
    return null; // la prossima lettura riprova; il riassunto definitivo arriva comunque a fine seduta
  }
  window.dispatchEvent(new Event("fitweek:heart-live"));
  return heartLive.value;
}

/** Da chiamare una volta all'avvio dell'app Android. */
export function startLiveHeart() {
  if (!canReadHealth()) return;
  setInterval(pollLiveHeart, LIVE_MS);
  document.addEventListener("visibilitychange", () => pollLiveHeart());
  pollLiveHeart();
}
