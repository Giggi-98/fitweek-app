// Stato condiviso dell'app. Le viste leggono da `app` e chiamano le funzioni di scrittura qui.
import { net, request } from "./api.js";
import * as cache from "./cache.js";
import { DAYS, GYM } from "./constants.js";
import { standalone } from "./platform.js";
import { mondayOf } from "./stats.js";
import { localAgenda, localToday, mergeState } from "./sync.js";
import { toast } from "./ui.js";
import { $, isoDate, storage } from "./util.js";

const SESSIONS_PATH = "/api/v1/workout-sessions?limit=200";
const STATE_PENDING = "fitweek.statePending.v1"; // modifiche allo stato non ancora arrivate al server
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

async function reloadState() {
  adoptState(await request("/api/state"));
  app.render();
}

// ---- salvataggio dello stato (blob) -----------------------------------------------------------
async function handleSaveError(e) {
  setSync("error");
  if (e.status === 401) {
    toast("Sessione scaduta: accedi di nuovo.");
    app.onUnauthorized();
    return;
  }
  if (e.status === 422) {
    toast(`Modifica rifiutata, dati non validi${e.field ? ` (${e.field})` : ""}. Ho ricaricato i dati salvati.`, { timeout: 6000 });
    storage.remove(STATE_PENDING);
    try {
      await reloadState();
      setSync("ok");
    } catch {
      /* resta in errore, il prossimo salvataggio riprova */
    }
    return;
  }
  toast(`Salvataggio non riuscito (${e.message}). Riproverò alla prossima modifica.`);
}

async function putState() {
  const out = await request("/api/state", { method: "PUT", body: { version: app.version, data: app.state } });
  app.version = out.version;
  baseState = JSON.stringify(app.state);
  storage.remove(STATE_PENDING);
  snapshot();
  setSync("ok");
}

/** Il server ha una versione più nuova (altro dispositivo o modifiche offline): fusione e nuovo invio. */
async function mergeAndPut() {
  const server = await request("/api/state", { fresh: true });
  app.state = mergeState(JSON.parse(baseState), app.state, server.data);
  app.version = server.version;
  await putState();
  app.render();
}

let saveQueue = Promise.resolve(true);
/** Salva l'intero blob (domini non ancora migrati). Restituisce true se è al sicuro: sul server, oppure
 *  sul telefono in attesa di rete (verrà inviato da solo, fuso con ciò che nel frattempo è cambiato). */
export function persistState() {
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
      if (e.status === 0) {
        storage.set(STATE_PENDING, { version: app.version, base: baseState, local: app.state });
        snapshot();
        setSync();
        return true;
      }
      await handleSaveError(e);
      return false;
    }
  });
  return saveQueue;
}

/** Invia le modifiche allo stato rimaste in attesa (al ritorno della rete). */
export function syncState() {
  return statePending() ? persistState() : Promise.resolve(true);
}

export { reloadState };
