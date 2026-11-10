// Coda persistente delle scritture di allenamento. Ogni operazione è idempotente (PUT/PATCH/POST
// con id del client), quindi può essere ripetuta senza duplicati. Se la rete manca, resta nel
// telefono e viene inviata appena possibile: in palestra non si perde nessuna serie.
import { request } from "../api.js";
import { setPending, setSync, app } from "../store.js";
import { toast } from "../ui.js";
import { isTransient } from "../stats.js";
import { storage } from "../util.js";

const KEY = "fitweek.workoutQueue.v1";
let ops = storage.get(KEY, []);

const save = () => {
  storage.set(KEY, ops);
  setPending(ops.length);
};

/** Accoda. `key` deduplica: una nuova operazione con la stessa chiave sostituisce quella vecchia
 *  (es. modifiche ripetute alla stessa serie), mantenendo l'ordine della prima. */
export function enqueue(method, path, body, key = `${method} ${path}`) {
  const i = ops.findIndex((o) => o.key === key);
  const op = { method, path, body, key };
  if (i >= 0) ops[i] = op;
  else ops.push(op);
  save();
  flush();
}

export const pendingCount = () => ops.length;

let running = null;
/** Invia la coda; restituisce una promessa che si risolve quando la coda è vuota (o la rete manca).
 *  Chiamate concorrenti condividono lo stesso invio. */
export function flush() {
  if (!running) running = drain().finally(() => (running = null));
  return running;
}

let retrying = false;
const MAX_TRIES = 6; // errori del server ripetuti: dopo ~90 s di tentativi l'operazione viene scartata con avviso

async function drain() {
  while (ops.length) {
    const op = ops[0];
    try {
      await request(op.path, { method: op.method, body: op.body });
    } catch (e) {
      if (e.status === 0) break; // offline: riprova più tardi
      if (e.status === 401) {
        app.onUnauthorized();
        break;
      }
      // Errore passeggero del server (riavvio, DB occupato): la serie resta in coda e si ritenta.
      if (isTransient(e.status) && (op.tries = (op.tries || 0) + 1) < MAX_TRIES) {
        save();
        retrying = true;
        setSync("error");
        break;
      }
      // Rifiuto definitivo (4xx) o troppi tentativi: scarta per non bloccare la coda, ma avvisa.
      toast(`Una modifica non è stata accettata dal server (${e.message}).`, { timeout: 6000 });
      setSync("error");
      ops.shift();
      save();
      continue;
    }
    ops.shift();
    save();
    if (retrying) {
      retrying = false;
      setSync("ok"); // l'errore mostrato era solo il tentativo fallito, ora recuperato
    }
  }
  setPending(ops.length);
}

export function startQueue() {
  setPending(ops.length);
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && flush());
  setInterval(flush, 15000);
  flush();
}
