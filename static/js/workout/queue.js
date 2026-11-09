// Coda persistente delle scritture di allenamento. Ogni operazione è idempotente (PUT/PATCH/POST
// con id del client), quindi può essere ripetuta senza duplicati. Se la rete manca, resta nel
// telefono e viene inviata appena possibile: in palestra non si perde nessuna serie.
import { request } from "../api.js";
import { setPending, setSync, app } from "../store.js";
import { toast } from "../ui.js";
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
      // 4xx/5xx non recuperabili: scarta per non bloccare la coda, ma avvisa.
      toast(`Una modifica all'allenamento non è stata accettata (${e.message}).`, { timeout: 6000 });
      setSync("error");
    }
    ops.shift();
    save();
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
