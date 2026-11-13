// Dove gira il frontend: webapp servita dal server (stessa origine, cookie di sessione) oppure app Android
// autonoma, con le pagine dentro l'APK, che parla con il server a un indirizzo configurabile usando un token.
// Nel bundle dell'APK /app-config.js definisce window.FITWEEK_APP = { server: "http://…" }; nella webapp non esiste.
// Su Android il token vive nel Keystore nativo (plugin Capacitor SecureToken), con migrazione automatica dal
// vecchio valore in localStorage.
import { storage } from "./util.js";

const config = globalThis.FITWEEK_APP || null;
const SERVER_KEY = "fitweek.server.v1";
const TOKEN_KEY = "fitweek.token.v1";
const SIGNED_OUT_KEY = "fitweek.signedOut.v1"; // uscita fatta, ma il Keystore non ha confermato l'eliminazione

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

/** Toglie il token dal Keystore e controlla rileggendolo che sia sparito davvero.
 *  @returns true solo se l'eliminazione è confermata */
async function wiped(plugin) {
  try {
    await plugin.clear();
  } catch { /* lo dice la rilettura qui sotto */ }
  try {
    return !(await plugin.get())?.value;
  } catch {
    return false;
  }
}

/** Carica il token dal Keystore Android (se presente) e migra un eventuale token salvato in localStorage.
 *  Il vecchio valore viene tolto solo a scrittura confermata: se il Keystore fallisce resta l'unica copia
 *  persistente, e la migrazione si ritenta al prossimo avvio.
 *  Dopo un'uscita in cui il Keystore non ha confermato l'eliminazione, il token rimasto lì non viene usato:
 *  si riprova a eliminarlo e l'app si apre sulla schermata di accesso (FW-REV-010). */
export async function initToken() {
  if (!standalone) return null;
  const legacy = storage.get(TOKEN_KEY);
  const plugin = secureStore();
  if (plugin && storage.get(SIGNED_OUT_KEY)) {
    if (await wiped(plugin)) storage.remove(SIGNED_OUT_KEY);
    memToken = null;
    return memToken;
  }
  if (plugin) {
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

/** @returns false solo se all'uscita il Keystore non ha confermato l'eliminazione del token: l'app non lo userà
 *  più (vedi `initToken`), ma chi chiama deve dirlo all'utente */
export async function setToken(value) {
  memToken = value || null;
  const plugin = secureStore();
  if (plugin) {
    if (!value) {
      storage.remove(TOKEN_KEY); // uscita: il token in chiaro sparisce comunque
      if (await wiped(plugin)) storage.remove(SIGNED_OUT_KEY);
      else {
        storage.set(SIGNED_OUT_KEY, true);
        return false;
      }
    } else if (await secured(plugin, value)) {
      storage.remove(TOKEN_KEY);
      storage.remove(SIGNED_OUT_KEY); // nel Keystore ora c'è il token del nuovo accesso
    }
    // Keystore guasto: il token nuovo vale per questa sessione (in memoria) e non viene mai scritto in chiaro;
    // un eventuale vecchio token non ancora migrato resta dov'è.
    return true;
  }
  if (value) storage.set(TOKEN_KEY, value);
  else storage.remove(TOKEN_KEY);
  return true;
}

export const apiUrl = (path) => serverUrl() + path;
