// Dove gira il frontend: webapp servita dal server (stessa origine, cookie di sessione) oppure app Android
// autonoma, con le pagine dentro l'APK, che parla con il server a un indirizzo configurabile usando un token.
// Nel bundle dell'APK /app-config.js definisce window.FITWEEK_APP = { server: "http://…" }; nella webapp non esiste.
// Su Android il token vive nel Keystore nativo (plugin Capacitor SecureToken), con migrazione automatica dal
// vecchio valore in localStorage.
// Uscita (FW-REV-010): l'eliminazione dal Keystore vale solo se una rilettura lo conferma; se non è confermata
// l'uscita viene registrata in localStorage e, se anche quello non scrive, su un cookie della WebView (canale
// indipendente). Se non funziona nessun canale, all'avvio l'app non rientra da sola: senza memoria scrivibile
// non si può verificare lo stato di uscita, e il token rimasto viene eliminato senza essere usato (fail-closed).
// Se all'uscita non riesce nulla (né revoca sul server, né eliminazione, né marcatore) l'uscita non si
// conclude: `logout.js` rimette in uso il token con `keepToken()` e l'utente resta collegato, sapendolo.
import { storage } from "./util.js";

const config = globalThis.FITWEEK_APP || null;
const SERVER_KEY = "fitweek.server.v1";
const TOKEN_KEY = "fitweek.token.v1";
const SIGNED_OUT_KEY = "fitweek.signedOut.v1"; // uscita fatta, ma il Keystore non ha confermato l'eliminazione
const SIGNED_OUT_COOKIE = "fitweek.signedOut.v1=1"; // lo stesso marcatore sul canale cookie (senza il token)
const PROBE_KEY = "fitweek.probe.v1";

export const standalone = Boolean(config);
const clean = (url) => String(url || "").trim().replace(/\/+$/, "");
const secureStore = () => globalThis.Capacitor?.Plugins?.SecureToken || null;

export const serverUrl = () => (standalone ? clean(storage.get(SERVER_KEY) || config.server) : "");
export const setServerUrl = (url) => storage.set(SERVER_KEY, clean(url));
export const validServerUrl = (url) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(clean(url));
export const isHttpUrl = (url = standalone ? serverUrl() : globalThis.location?.origin || "") =>
  /^http:\/\//i.test(clean(url));

let memToken = undefined;

/** Scrive il token nel Keystore. @returns true solo se la scrittura è confermata */
async function secured(plugin, value) {
  try {
    await plugin.set({ value });
    return true;
  } catch {
    return false;
  }
}

/** Toglie il token dal Keystore e controlla rileggendolo che sia sparito davvero; se `clear()` non ha
 *  effetto, prova a sovrascrivere il token con un valore vuoto (per il plugin equivale a un secondo clear).
 *  @returns true solo se l'eliminazione è confermata */
async function wiped(plugin) {
  try {
    await plugin.clear();
  } catch { /* lo dice la rilettura qui sotto */ }
  try {
    if (!(await plugin.get())?.value) return true;
  } catch {
    return false;
  }
  try {
    await plugin.set({ value: "" });
    return !(await plugin.get())?.value;
  } catch {
    return false;
  }
}

// Marcatore di uscita su due canali indipendenti: localStorage e cookie della WebView (quest'ultimo gestito
// dal sistema nativo Android, non dal motore di storage della pagina). Contiene solo il marcatore, mai il token.
const cookieMarked = () => {
  try {
    return typeof document !== "undefined"
      && String(document.cookie || "").split(";").some((c) => c.trim() === SIGNED_OUT_COOKIE);
  } catch {
    return false;
  }
};
function setCookieMark() {
  try {
    if (typeof document === "undefined") return false;
    document.cookie = `${SIGNED_OUT_COOKIE}; path=/; max-age=31536000; SameSite=Lax`;
    return cookieMarked(); // la WebView può rifiutare i cookie: vale solo la rilettura
  } catch {
    return false;
  }
}
function clearCookieMark() {
  try {
    if (typeof document !== "undefined") document.cookie = `${SIGNED_OUT_COOKIE}; path=/; max-age=0`;
  } catch { /* niente da fare */ }
}
const signedOutMarked = () => Boolean(storage.get(SIGNED_OUT_KEY)) || cookieMarked();
/** @returns true se almeno un canale ha confermato la registrazione dell'uscita */
function markSignedOut() {
  if (storage.set(SIGNED_OUT_KEY, true)) return true;
  return setCookieMark();
}
function clearSignedOutMark() {
  storage.remove(SIGNED_OUT_KEY);
  clearCookieMark();
}

/** localStorage scrive davvero? All'avvio, se non posso registrare né verificare il marcatore di uscita,
 *  il token rimasto nel Keystore non viene usato per rientrare da soli (fail-closed, FW-REV-010). */
function storageWritable() {
  if (!storage.set(PROBE_KEY, 1)) return false;
  const ok = storage.get(PROBE_KEY) === 1;
  storage.remove(PROBE_KEY);
  return ok;
}

/** Carica il token dal Keystore Android (se presente) e migra un eventuale token salvato in localStorage.
 *  Il vecchio valore viene tolto solo a scrittura confermata: se il Keystore fallisce resta l'unica copia
 *  persistente, e la migrazione si ritenta al prossimo avvio.
 *  Dopo un'uscita in cui il Keystore non ha confermato l'eliminazione, il token rimasto lì non viene usato:
 *  si riprova a eliminarlo e l'app si apre sulla schermata di accesso (FW-REV-010). Lo stesso vale se il
 *  dispositivo non registra più nulla (memoria piena): senza verifica possibile, niente rientro automatico. */
export async function initToken() {
  if (!standalone) return null;
  const legacy = storage.get(TOKEN_KEY);
  const plugin = secureStore();
  if (plugin) {
    if (signedOutMarked()) {
      if (await wiped(plugin)) clearSignedOutMark();
      memToken = null;
      return memToken;
    }
    if (!storageWritable()) {
      await wiped(plugin); // se il Keystore funziona il token viene eliminato senza essere usato
      memToken = null;
      return memToken;
    }
    if (legacy) {
      if (await secured(plugin, legacy)) storage.remove(TOKEN_KEY);
      memToken = legacy;
      return memToken;
    }
    try {
      const out = await plugin.get();
      memToken = out?.value || null;
    } catch {
      memToken = null;
    }
    return memToken;
  }
  memToken = legacy || null;
  return memToken;
}

export const token = () => (standalone ? (memToken !== undefined ? memToken : storage.get(TOKEN_KEY)) : null);

/** Uscita (`value` null): @returns true solo se l'eliminazione dal Keystore è confermata; "marked" se non lo
 *  è ma l'uscita è registrata su almeno un canale (l'app non rientrerà da sola); false se nessun canale ha
 *  registrato nulla: resta solo il controllo all'avvio, che non basta se la memoria torna scrivibile prima
 *  della riapertura. Chi chiama non deve dare l'uscita per conclusa se la sessione non è revocata sul server. */
export async function setToken(value) {
  memToken = value || null;
  const plugin = secureStore();
  if (plugin) {
    if (!value) {
      storage.remove(TOKEN_KEY); // uscita: il token in chiaro sparisce comunque
      if (await wiped(plugin)) {
        clearSignedOutMark();
        return true;
      }
      return markSignedOut() ? "marked" : false;
    }
    if (await secured(plugin, value)) {
      storage.remove(TOKEN_KEY);
      clearSignedOutMark(); // nel Keystore ora c'è il token del nuovo accesso
    }
    // Keystore guasto: il token nuovo vale per questa sessione (in memoria) e non viene mai scritto in chiaro;
    // un eventuale vecchio token non ancora migrato resta dov'è.
    return true;
  }
  if (value) storage.set(TOKEN_KEY, value);
  else storage.remove(TOKEN_KEY);
  return true;
}

/** Uscita non conclusa (FW-REV-010): la sessione continua con il token di prima, solo in memoria.
 *  Nulla viene scritto: nel Keystore il token c'è ancora, proprio perché l'eliminazione non è riuscita. */
export function keepToken(value) {
  if (standalone && value) memToken = value;
}

export const apiUrl = (path) => serverUrl() + path;
