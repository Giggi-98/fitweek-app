// Coda persistente delle scritture di allenamento. Ogni operazione è idempotente (PUT/PATCH/POST
// con id del client), quindi può essere ripetuta senza duplicati. Se la rete manca, resta nel
// telefono e viene inviata appena possibile: in palestra non si perde nessuna serie.
// Nessuna operazione viene mai buttata: gli errori passeggeri (rete, 5xx, 429) si ritentano senza limite;
// i rifiuti definitivi (4xx) finiscono in un elenco visibile in Impostazioni, da riprovare o scartare.
import { request } from "../api.js";
import { keep, setPending, setSync, app } from "../store.js";
import { toast } from "../ui.js";
import { isTransient } from "../stats.js";
import { storage } from "../util.js";

const KEY = "fitweek.workoutQueue.v1";
let ops = storage.get(KEY, []);

let retrying = false; // c'è un errore mostrato che un invio riuscito deve cancellare
const REJECTED_KEY = "fitweek.rejected.v1";
const MAX_REJECTED = 50;

const save = () => {
  setPending(ops.length);
  keep(KEY, ops);
};

/** Operazioni rifiutate dal server, dalla più vecchia: [{at, message, method, path, body, key}]. */
export const rejected = () => storage.get(REJECTED_KEY, []);
function setAside(op, message) {
  const { method, path, body, key } = op;
  keep(REJECTED_KEY, [...rejected(), { at: new Date().toISOString(), message, method, path, body, key }].slice(-MAX_REJECTED));
}
export function dropRejected(index) {
  storage.set(REJECTED_KEY, rejected().filter((_, i) => i !== index));
}
export function retryRejected(index) {
  const op = rejected()[index];
  if (!op) return;
  dropRejected(index);
  retrying = true; // se questa volta va a buon fine, l'indicatore "Non salvato" si spegne
  enqueue(op.method, op.path, op.body, op.key);
}

/** Accoda. `key` deduplica: una nuova operazione con la stessa chiave sostituisce quella vecchia
 *  (es. modifiche ripetute alla stessa serie), mantenendo l'ordine della prima. */
export function enqueue(method, path, body, key = `${method} ${path}`) {
  const i = ops.findIndex((o) => o.key === key);
  const op = { method, path, body, key, at: new Date().toISOString() };
  if (i >= 0) ops[i] = op;
  else ops.push(op);
  save();
  flush();
}

export const pendingCount = () => ops.length;

/** Pulisce la coda inviata (e gli scarti) all'uscita dall'account. */
export function clearQueue() {
  if (!ops.length) storage.remove(KEY);
  storage.remove(REJECTED_KEY);
}

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
      await request(op.path, { method: op.method, body: op.body, editedAt: op.at });
    } catch (e) {
      if (e.status === 401) {
        app.onUnauthorized();
        break;
      }
      // Rete assente o errore passeggero del server (riavvio, DB occupato): resta in coda, si ritenta più tardi.
      if (isTransient(e.status)) {
        if (e.status !== 0) {
          retrying = true;
          setSync("error");
        }
        break;
      }
      // Eliminare qualcosa che sul server non c'è più: è già nello stato voluto.
      if (!(op.method === "DELETE" && e.status === 404)) {
        setAside(op, e.message);
        toast(`Una modifica non è stata accettata dal server (${e.message}). La trovi in Impostazioni → Dati e accesso.`, { timeout: 6000 });
        setSync("error");
      }
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
