// Uscita dall'account. Tutto ciò che è sul dispositivo viene eliminato (D-024), quindi le modifiche non
// ancora arrivate al server andrebbero perse: prima si prova a inviarle, e se ne restano l'utente deve
// confermare esplicitamente di volerle eliminare. Senza conferma non si esce e non si tocca nulla.
// L'uscita non si dà mai per riuscita se non lo è (FW-REV-010): se il server non revoca la sessione o il
// Keystore non elimina il token, l'utente lo viene a sapere. Se il token non è eliminato e nessun canale
// registra l'uscita (memoria del dispositivo piena) conta la revoca: con la sessione revocata il token rimasto
// non vale più e l'uscita si conclude con un avviso; senza revoca nulla impedirebbe all'app di rientrare da
// sola alla riapertura, quindi l'uscita NON si conclude: l'utente resta collegato, i dati sul dispositivo non
// vengono toccati e un avviso dice cosa fare.
import { request } from "./api.js";
import { keepToken, setToken, standalone, token } from "./platform.js";
import { clearLocalState, syncState, unsentStateCount } from "./store.js";
import { clearQueue, flush, pendingCount, rejected } from "./workout/queue.js";

const LAST_TRY_MS = 4000; // un ultimo tentativo di invio prima di chiedere

const NOT_SIGNED_OUT = "Uscita non riuscita: il server non ha risposto e questo dispositivo è ancora collegato. "
  + "Riprova quando il server è raggiungibile.";
const NOT_REVOKED = "Il server non ha risposto: la sessione di questo dispositivo non è stata revocata e resta valida "
  + "sul server.\n\nSe esci adesso l'accesso viene eliminato solo da questo dispositivo. Per chiudere anche la "
  + "sessione, quando il server è raggiungibile revocala da Impostazioni → Dati e accesso.\n\nUscire comunque?";
const TOKEN_NOT_WIPED = "Sei uscito, ma l'accesso salvato non è stato eliminato dall'archivio sicuro di Android. "
  + "L'app non lo userà più e riproverà a eliminarlo a ogni avvio.";
const TOKEN_DEAD_NOT_WIPED = "Sei uscito e il server ha revocato la sessione: l'accesso salvato non è più valido. "
  + "Non è stato però eliminato dall'archivio sicuro di Android e il dispositivo non ha potuto registrare l'uscita "
  + "(memoria piena?).";
const SIGN_OUT_INCOMPLETE = "Uscita non riuscita: sei ancora collegato.\n\n"
  + "Il server non ha revocato la sessione, l'accesso salvato non è stato eliminato dall'archivio sicuro di Android "
  + "e il dispositivo non ha potuto registrare l'uscita (memoria piena?). Uscendo così, alla riapertura l'app "
  + "potrebbe rientrare da sola.\n\nNulla è stato eliminato da questo dispositivo. Riprova quando il server è "
  + "raggiungibile o dopo aver liberato spazio.";
const TOKEN_STILL_VALID = "\n\nLa sessione è ancora valida sul server: revocala da Impostazioni → Dati e accesso "
  + "appena possibile.";

/** Quante modifiche esistono solo su questo dispositivo (coda, scarti, stato in attesa o rifiutato). */
export const unsentCount = () => pendingCount() + rejected().length + unsentStateCount();

/** @returns false se l'utente ha rinunciato o se l'uscita non è possibile (resta collegato); altrimenti
 *  ricarica la pagina */
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
  const revoked = await request(all ? "/api/logout-all" : "/api/logout", { method: "POST" }).then(() => true, () => false);
  if (!revoked && !standalone) {
    alert(NOT_SIGNED_OUT); // webapp: il cookie di sessione lo può togliere solo il server
    return false;
  }
  if (!revoked && !confirm(NOT_REVOKED)) return false;
  const held = token();
  const outcome = await setToken(null); // true = eliminazione confermata; "marked" = uscita registrata; false = nessun canale
  if (outcome === false && !revoked) {
    keepToken(held); // né revocato, né eliminato, né registrato: l'uscita non è avvenuta
    alert(SIGN_OUT_INCOMPLETE);
    return false;
  }
  clearQueue();
  clearLocalState();
  if (outcome === "marked") alert(TOKEN_NOT_WIPED + (revoked ? "" : TOKEN_STILL_VALID));
  else if (outcome === false) alert(TOKEN_DEAD_NOT_WIPED);
  location.reload();
  return true;
}
