// Importazione dei dati dall'orologio nell'app Android (D-040). Il plugin nativo `HealthConnect` legge Health
// Connect sul telefono; da qui partono verso il server, dalla coda come ogni altra modifica, solo i valori
// cambiati (regole in health.js). Il server non legge mai l'orologio. Nel browser il plugin non c'è e non
// succede nulla.
import { app, localCopy } from "./store.js";
import { standalone } from "./platform.js";
import { commit, enqueue } from "./workout/queue.js";
import { storage } from "./util.js";
import { healthDays, healthDayWrites, heartSummary, heartWindows, importStart, nightsFromSessions, restingByDay, sleepWrites } from "./health.js";

const LAST_KEY = "fitweek.healthImport.v1"; // orario dell'ultima importazione riuscita
const MIN_GAP_MS = 15 * 60_000; // all'apertura e al ritorno sull'app, non più spesso di così
const plugin = () => globalThis.Capacitor?.Plugins?.HealthConnect || null;

export const canReadHealth = () => standalone && Boolean(plugin());
/** availability: available | update_required | unavailable | unknown; granted: sleep, steps, heart_rate, resting_heart_rate */
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
    const steps = has("steps") ? (await p.readSteps({ from, to })).days : [];
    const resting = has("resting_heart_rate") ? restingByDay((await p.readRestingHeartRate({ from, to })).records) : new Map();
    for (const d of healthDayWrites(healthDays(steps, resting), db)) send(`/api/v1/health-days/${d.date}`, d.body, `health:${d.date}`);
    if (has("heart_rate")) {
      for (const w of heartWindows(app.sessions, from)) {
        const heart = heartSummary((await p.readHeartRate({ from: w.start, to: w.end })).samples, w);
        if (!heart) continue;
        send(`/api/v1/workout-heart/${encodeURIComponent(w.id)}`, heart, `heart:${w.id}`);
        app.sessions = app.sessions.map((s) => (s.id === w.id ? { ...s, heart } : s)); // le sedute non sono nella copia
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
