// Stato condiviso dell'app. Le viste leggono da `app` e chiamano le funzioni di scrittura qui.
import { request } from "./api.js";
import { toast } from "./ui.js";
import { $ } from "./util.js";

export const app = {
  state: null, // blob v1: profile, routines, meals, groceries, inventory, weights…
  version: 0,
  today: null, // /api/v1/today
  sessions: [], // sedute recenti (API v1), più recenti prima
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
  el.textContent = lastError ? "● Non salvato" : queued ? `◌ In salvataggio (${pendingOps})` : "● Sincronizzato";
}
export function setPending(n) {
  pendingOps = n;
  setSync(n ? "saving" : lastError ? "error" : "ok");
}

export async function loadAll() {
  const [s, today, sessions] = await Promise.all([
    request("/api/state"),
    request("/api/v1/today"),
    request("/api/v1/workout-sessions?limit=200"),
  ]);
  app.state = s.data;
  app.version = s.version;
  app.today = today;
  app.sessions = sessions.items;
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
