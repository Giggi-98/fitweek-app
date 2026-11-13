// Uscita dall'account. Tutto ciò che è sul dispositivo viene eliminato (D-024), quindi le modifiche non
// ancora arrivate al server andrebbero perse: prima si prova a inviarle, e se ne restano l'utente deve
// confermare esplicitamente di volerle eliminare. Senza conferma non si esce e non si tocca nulla.
import { request } from "./api.js";
import { setToken } from "./platform.js";
import { clearLocalState, syncState, unsentStateCount } from "./store.js";
import { clearQueue, flush, pendingCount, rejected } from "./workout/queue.js";

const LAST_TRY_MS = 4000; // un ultimo tentativo di invio prima di chiedere

/** Quante modifiche esistono solo su questo dispositivo (coda, scarti, stato in attesa o rifiutato). */
export const unsentCount = () => pendingCount() + rejected().length + unsentStateCount();

/** @returns false se l'utente ha rinunciato (nulla è cambiato); altrimenti ricarica la pagina */
export async function signOut({ all = false } = {}) {
  if (unsentCount()) {
    const lastTry = Promise.all([flush(), syncState()]).catch(() => {});
    await Promise.race([lastTry, new Promise((done) => setTimeout(done, LAST_TRY_MS))]);
  }
  const n = unsentCount();
  if (n && !confirm(
    `${n === 1 ? "C'è 1 modifica non ancora arrivata" : `Ci sono ${n} modifiche non ancora arrivate`} al server.\n\n`
    + "Uscendo adesso vengono eliminate da questo dispositivo e non si possono recuperare. "
    + "Per non perderle premi Annulla e riprova quando il server è raggiungibile.\n\nUscire ed eliminarle?")) return false;
  await request(all ? "/api/logout-all" : "/api/logout", { method: "POST" }).catch(() => {});
  await setToken(null);
  clearQueue();
  clearLocalState();
  location.reload();
  return true;
}
