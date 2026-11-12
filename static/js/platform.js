// Dove gira il frontend: webapp servita dal server (stessa origine, cookie di sessione) oppure app Android
// autonoma, con le pagine dentro l'APK, che parla con il server a un indirizzo configurabile usando un token.
// Nel bundle dell'APK /app-config.js definisce window.FITWEEK_APP = { server: "http://…" }; nella webapp non esiste.
// Su Android il token vive nel Keystore nativo (plugin Capacitor SecureToken), con migrazione automatica dal
// vecchio valore in localStorage.
import { storage } from "./util.js";

const config = globalThis.FITWEEK_APP || null;
const SERVER_KEY = "fitweek.server.v1";
const TOKEN_KEY = "fitweek.token.v1";

export const standalone = Boolean(config);
const clean = (url) => String(url || "").trim().replace(/\/+$/, "");
const secureStore = () => globalThis.Capacitor?.Plugins?.SecureToken || null;

export const serverUrl = () => (standalone ? clean(storage.get(SERVER_KEY) || config.server) : "");
export const setServerUrl = (url) => storage.set(SERVER_KEY, clean(url));
export const validServerUrl = (url) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(clean(url));
export const isHttpUrl = (url = standalone ? serverUrl() : globalThis.location?.origin || "") =>
  /^http:\/\//i.test(clean(url));

let memToken = undefined;

/** Carica il token dal Keystore Android (se presente) e migra un eventuale token salvato in localStorage. */
export async function initToken() {
  if (!standalone) return null;
  const legacy = storage.get(TOKEN_KEY);
  const plugin = secureStore();
  if (plugin) {
    if (legacy) {
      await plugin.set({ value: legacy }).catch(() => {});
      storage.remove(TOKEN_KEY);
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

export async function setToken(value) {
  memToken = value || null;
  const plugin = secureStore();
  if (plugin) {
    storage.remove(TOKEN_KEY);
    try {
      if (value) await plugin.set({ value });
      else await plugin.clear();
    } catch {
      /* fallback in memoria per la sessione corrente */
    }
    return;
  }
  if (value) storage.set(TOKEN_KEY, value);
  else storage.remove(TOKEN_KEY);
}

export const apiUrl = (path) => serverUrl() + path;
