// Stato condiviso dell'app. Le viste leggono da `app` e chiamano le funzioni di scrittura qui.
import { net, request } from "./api.js";
import * as cache from "./cache.js";
import { DAYS, GYM } from "./constants.js";
import { standalone } from "./platform.js";
import { mondayOf } from "./stats.js";
import { localAgenda, localToday, mergeState } from "./sync.js";
import { toast } from "./ui.js";
import { $, isoDate, storage, uid } from "./util.js";

const SESSIONS_PATH = "/api/v1/workout-sessions?limit=200";
const STATE_PENDING = "fitweek.statePending.v1"; // modifiche allo stato non ancora arrivate al server
const STATE_REJECTED = "fitweek.stateRejected.v1"; // modifiche rifiutate dal server (422), tenute da parte
const SCHEDULE = Object.fromEntries(DAYS.map((d, i) => [i, GYM[d]]).filter(([, r]) => r));

export const app = {
  state: null, // blob v1: profile, routines, meals, groceries, inventory, weights…
  version: 0,
  today: null, // /api/v1/today
  sessions: [], // sedute recenti (API v1), più recenti prima
  agenda: [], // promemoria di oggi con stato (/api/v1/agenda)
  weekly: null, // /api/v1/weekly-summary
  templates: [], // pasti abituali
  foods: [], // catalogo piatti (mensa e casa)
  sleep: { items: [], summary: null }, // ultime 60 notti (/api/v1/sleep)
  exNotes: {}, // note per esercizio: id → testo
  spend: [], // spesa reale per settimana, più recenti prima
  view: "dashboard",
  render: () => {}, // impostata da main.js
  onUnauthorized: () => {}, // impostata da main.js
};

// ---- indicatore di sincronizzazione ---------------------------------------------------------
let pendingOps = 0;
let lastError = false;
let baseState = null; // JSON dell'ultimo stato confermato dal server: base per la fusione
const statePending = () => storage.get(STATE_PENDING, null);

let warnedFull = 0;
/** Salva sul dispositivo ciò che non è ancora sul server. Se lo spazio è finito lo dice, invece di tacere. */
export function keep(key, value) {
  if (storage.set(key, value)) return true;
  if (Date.now() - warnedFull > 60_000) {
    warnedFull = Date.now();
    toast("Memoria del dispositivo piena: questa modifica resta solo finché l'app è aperta. Non chiuderla prima dell'invio.", { timeout: 8000 });
  }
  setSync("error");
  return false;
}
const clockOf = (ms) => new Date(ms).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

export function setSync(kind) {
  if (kind === "error") lastError = true;
  if (kind === "ok") lastError = false;
  const el = $("#sync");
  if (!el) return;
  const waiting = pendingOps + (statePending() ? 1 : 0);
  const offline = net.offlineSince != null;
  el.dataset.state = lastError ? "error" : offline ? "offline" : waiting ? "saving" : "ok";
  const text = lastError
    ? "Non salvato"
    : offline
      ? `Offline · dati delle ${clockOf(net.offlineSince)}${waiting ? ` · ${waiting} da inviare` : ""}`
      : waiting ? `Salvataggio (${waiting})` : "Sincronizzato";
  el.querySelector(".sync-text").textContent = text;
  el.title = text;
}
export function setPending(n) {
  pendingOps = n;
  snapshot();
  setSync(n ? "saving" : lastError ? "error" : "ok");
}
net.onChange = () => setSync();

/** App autonoma: la copia locale segue le modifiche fatte sul telefono, così sopravvivono a un riavvio senza rete. */
function snapshot() {
  if (!standalone || !app.state) return;
  cache.put("/api/v1/today", app.today);
  cache.put(SESSIONS_PATH, { items: app.sessions });
  cache.put("/api/state", { version: app.version, data: app.state });
}

function adoptState(s) {
  app.state = s.data;
  app.version = s.version;
  baseState = JSON.stringify(s.data);
  // Modifiche fatte offline in una sessione precedente: restano in primo piano finché non arrivano al server.
  const pending = statePending();
  if (pending) {
    app.state = pending.local;
    app.version = pending.version;
    baseState = pending.base;
  }
}

// ---- caricamento ------------------------------------------------------------------------------
export async function loadAll() {
  const [s, today, sessions, notes, spend] = await Promise.all([
    request("/api/state"),
    request("/api/v1/today"),
    request(SESSIONS_PATH),
    request("/api/v1/exercise-notes"),
    request("/api/v1/grocery-spend"),
  ]);
  adoptState(s);
  app.today = today;
  app.sessions = sessions.items;
  app.exNotes = Object.fromEntries(notes.items.map((n) => [n.exercise_id, n.note]));
  app.spend = spend.items;
  await refreshDaily();
  if (statePending()) syncState();
}

/** Agenda di oggi, riepilogo settimanale e pasti abituali. */
export async function refreshDaily() {
  const [agenda, weekly, templates, foods, sleep, reminders] = await Promise.all([
    request("/api/v1/agenda"),
    request("/api/v1/weekly-summary"),
    request("/api/v1/meal-templates"),
    request("/api/v1/foods"),
    request("/api/v1/sleep"),
    standalone ? request("/api/v1/reminders") : null, // nell'app serve per ricostruire l'agenda senza rete
  ]);
  app.agenda = agenda.items;
  app.weekly = weekly;
  app.templates = templates.items;
  app.foods = foods.items;
  app.sleep = sleep;
  if (net.offlineSince != null) adoptOfflineDay(agenda, reminders);
}

/** Senza rete la copia locale può essere di un altro giorno: data, giornata e agenda si ricalcolano qui. */
function adoptOfflineDay(agenda, reminders) {
  const day = isoDate();
  app.today = localToday(app.today, app.state.profile.startDate, day, SCHEDULE);
  if (agenda.date !== day && reminders) app.agenda = localAgenda(reminders.items, day, new Date().toTimeString().slice(0, 5));
  if (app.weekly && app.weekly.week_start !== mondayOf(day)) app.weekly = null; // riepilogo di un'altra settimana
}

export async function refreshWorkouts() {
  const [today, sessions] = await Promise.all([request("/api/v1/today"), request(SESSIONS_PATH)]);
  app.today = net.offlineSince == null ? today : localToday(today, app.state.profile.startDate, isoDate(), SCHEDULE);
  app.sessions = sessions.items;
}

/** Al rientro sull'app: prende dal server lo stato cambiato altrove, senza toccare modifiche locali non inviate. */
export async function refreshState() {
  const untouched = () => !statePending() && JSON.stringify(app.state) === baseState;
  await saveQueue;
  if (!untouched()) return;
  const fresh = await request("/api/state");
  if (untouched()) adoptState(fresh);
}

async function reloadState() {
  adoptState(await request("/api/state"));
  app.render();
}

/** Una pesata per giorno: una seconda misura nello stesso giorno corregge la prima invece di affiancarla.
 *  @returns true se ha aggiornato una pesata già presente */
export function recordWeight({ date, weight, waist = null, note = "" }) {
  const existing = app.state.weights.find((w) => w.date === date);
  if (!existing) {
    app.state.weights.push({ id: uid(), date, weight, waist, note });
    return false;
  }
  Object.assign(existing, { weight, waist: waist ?? existing.waist, note: note || existing.note });
  return true;
}

// ---- salvataggio dello stato (blob) -----------------------------------------------------------
/** Il server ha rifiutato i dati (422): le modifiche locali non si buttano, si mettono da parte
 *  (Impostazioni → Dati e accesso) e si torna ai dati salvati. */
async function setAside(e) {
  keep(STATE_REJECTED, { at: new Date().toISOString(), field: e.field || "", base: baseState, local: app.state });
  storage.remove(STATE_PENDING);
  toast(`Modifica rifiutata, dati non validi${e.field ? ` (${e.field})` : ""}. Ne ho tenuta una copia in Impostazioni → Dati e accesso.`, { timeout: 7000 });
  setSync("error");
  try {
    await reloadState();
    setSync("ok");
  } catch {
    /* resta in errore, il prossimo salvataggio riprova */
  }
}

export const rejectedState = () => storage.get(STATE_REJECTED, null);
export function dropRejectedState() {
  storage.remove(STATE_REJECTED);
}
/** Riapplica le modifiche messe da parte sopra lo stato attuale e le invia di nuovo. */
export function retryRejectedState() {
  const r = rejectedState();
  if (!r) return Promise.resolve(false);
  app.state = mergeState(JSON.parse(r.base), r.local, app.state);
  dropRejectedState();
  return persistState();
}

async function putState() {
  const out = await request("/api/state", { method: "PUT", body: { version: app.version, data: app.state } });
  app.version = out.version;
  baseState = JSON.stringify(app.state);
  storage.remove(STATE_PENDING);
  snapshot();
  setSync("ok");
}

const listed = (names) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` e altri ${names.length - 3}` : ""}`;
/** Testo dell'avviso dopo una fusione: cosa ha prevalso e cosa è rimasto nonostante l'eliminazione locale. */
export function conflictNotice(conflicts) {
  const names = (kept) => [...new Set(conflicts.filter((c) => (c.kind === "kept") === kept).map((c) => c.what))];
  const mine = names(false), kept = names(true);
  return [
    mine.length ? `Modificato anche da un altro dispositivo: ${listed(mine)}. Ho tenuto la versione di questo dispositivo.` : "",
    kept.length ? `Eliminato qui ma modificato su un altro dispositivo: ${listed(kept)}. È rimasto: se non serve, eliminalo di nuovo.` : "",
  ].filter(Boolean).join(" ");
}

/** Il server ha una versione più nuova (altro dispositivo o modifiche offline): fusione e nuovo invio. */
async function mergeAndPut() {
  const server = await request("/api/state", { fresh: true });
  const conflicts = [];
  app.state = mergeState(JSON.parse(baseState), app.state, server.data, conflicts);
  app.version = server.version;
  await putState();
  app.render();
  const notice = conflictNotice(conflicts);
  if (notice) toast(notice, { timeout: 10000 });
}

let saveQueue = Promise.resolve(true);
/** Salva l'intero blob (domini non ancora migrati). Restituisce true se è al sicuro: sul server, oppure
 *  sul telefono in attesa di rete (verrà inviato da solo, fuso con ciò che nel frattempo è cambiato).
 *  Qualsiasi errore non definitivo (rete, 5xx, 429, sessione scaduta, secondo conflitto) lascia le modifiche
 *  in attesa sul dispositivo: sopravvivono a una ricarica e vengono ritentate da sole.
 *  @param quiet true = nuovo tentativo automatico: niente avvisi ripetuti */
export function persistState({ quiet = false } = {}) {
  if (!app.state) return Promise.resolve(false);
  setSync("saving");
  saveQueue = saveQueue.then(async () => {
    try {
      await putState();
      return true;
    } catch (e) {
      if (e.status === 409) {
        try {
          await mergeAndPut();
          return true;
        } catch (again) {
          e = again;
        }
      }
      if (e.status === 422) {
        await setAside(e);
        return false;
      }
      keep(STATE_PENDING, { version: app.version, base: baseState, local: app.state });
      snapshot();
      if (e.status === 0) {
        setSync();
        return true;
      }
      setSync("error");
      if (e.status === 401) {
        toast("Sessione scaduta: accedi di nuovo. Le modifiche restano su questo dispositivo.");
        app.onUnauthorized();
      } else if (!quiet) {
        toast(`Salvataggio non riuscito (${e.message}). Le modifiche restano su questo dispositivo: riprovo da solo.`, { timeout: 6000 });
      }
      return false;
    }
  });
  return saveQueue;
}

/** Invia le modifiche allo stato rimaste in attesa (al ritorno della rete). */
export function syncState() {
  return statePending() ? persistState({ quiet: true }) : Promise.resolve(true);
}

/** Modifiche allo stato non arrivate al server (in attesa o rifiutate): 0, 1 o 2 blocchi. */
export const unsentStateCount = () => (statePending() ? 1 : 0) + (rejectedState() ? 1 : 0);

/** Cancella la copia locale e gli stati temporanei su questo dispositivo all'uscita. */
export function clearLocalState() {
  cache.clear();
  storage.remove(STATE_PENDING);
  storage.remove(STATE_REJECTED);
}

export { reloadState };
