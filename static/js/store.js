// Stato condiviso dell'app. Le viste leggono da `app` e chiamano le funzioni di scrittura qui.
import { request } from "./api.js";
import { toast } from "./ui.js";
import { $ } from "./util.js";

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

let pendingOps = 0;
let lastError = false;
export function setSync(kind) {
  if (kind === "error") lastError = true;
  if (kind === "ok") lastError = false;
  const el = $("#sync");
  if (!el) return;
  const queued = pendingOps > 0;
  el.dataset.state = lastError ? "error" : queued ? "saving" : "ok";
  const text = lastError ? "Non salvato" : queued ? `Salvataggio (${pendingOps})` : "Sincronizzato";
  el.querySelector(".sync-text").textContent = text;
  el.title = text;
}
export function setPending(n) {
  pendingOps = n;
  setSync(n ? "saving" : lastError ? "error" : "ok");
}

export async function loadAll() {
  const [s, today, sessions, notes, spend] = await Promise.all([
    request("/api/state"),
    request("/api/v1/today"),
    request("/api/v1/workout-sessions?limit=200"),
    request("/api/v1/exercise-notes"),
    request("/api/v1/grocery-spend"),
  ]);
  app.state = s.data;
  app.version = s.version;
  app.today = today;
  app.sessions = sessions.items;
  app.exNotes = Object.fromEntries(notes.items.map((n) => [n.exercise_id, n.note]));
  app.spend = spend.items;
  await refreshDaily();
}

/** Agenda di oggi, riepilogo settimanale e pasti abituali. */
export async function refreshDaily() {
  const [agenda, weekly, templates, foods, sleep] = await Promise.all([
    request("/api/v1/agenda"),
    request("/api/v1/weekly-summary"),
    request("/api/v1/meal-templates"),
    request("/api/v1/foods"),
    request("/api/v1/sleep"),
  ]);
  app.sleep = sleep;
  app.agenda = agenda.items;
  app.weekly = weekly;
  app.templates = templates.items;
  app.foods = foods.items;
}

export async function refreshWorkouts() {
  const [today, sessions] = await Promise.all([
    request("/api/v1/today"),
    request("/api/v1/workout-sessions?limit=200"),
  ]);
  app.today = today;
  app.sessions = sessions.items;
}

async function reloadState() {
  const s = await request("/api/state");
  app.state = s.data;
  app.version = s.version;
  app.render();
}

async function handleSaveError(e) {
  setSync("error");
  if (e.status === 401) {
    toast("Sessione scaduta: accedi di nuovo.");
    app.onUnauthorized();
    return;
  }
  if (e.status === 409 || e.status === 422) {
    toast(
      e.status === 409
        ? "Dati cambiati su un altro dispositivo: ho caricato la versione aggiornata. Ripeti l'ultima modifica."
        : `Modifica rifiutata, dati non validi${e.field ? ` (${e.field})` : ""}. Ho ricaricato i dati salvati.`,
      { timeout: 6000 },
    );
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

let saveQueue = Promise.resolve(true);
/** Salva l'intero blob (domini non ancora migrati). Restituisce true se è sul server. */
export function persistState() {
  if (!app.state) return Promise.resolve(false);
  setSync("saving");
  saveQueue = saveQueue.then(async () => {
    try {
      const out = await request("/api/state", { method: "PUT", body: { version: app.version, data: app.state } });
      app.version = out.version;
      setSync("ok");
      return true;
    } catch (e) {
      await handleSaveError(e);
      return false;
    }
  });
  return saveQueue;
}

export { reloadState };
