// Dove gira il frontend: webapp servita dal server (stessa origine, cookie di sessione) oppure app Android
// autonoma, con le pagine dentro l'APK, che parla con il server a un indirizzo configurabile usando un token.
// Nel bundle dell'APK /app-config.js definisce window.FITWEEK_APP = { server: "http://…" }; nella webapp non esiste.
import { storage } from "./util.js";

const config = globalThis.FITWEEK_APP || null;
const SERVER_KEY = "fitweek.server.v1";
const TOKEN_KEY = "fitweek.token.v1";

export const standalone = Boolean(config);
const clean = (url) => String(url || "").trim().replace(/\/+$/, "");

export const serverUrl = () => (standalone ? clean(storage.get(SERVER_KEY) || config.server) : "");
export const setServerUrl = (url) => storage.set(SERVER_KEY, clean(url));
export const validServerUrl = (url) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(clean(url));

export const token = () => (standalone ? storage.get(TOKEN_KEY) : null);
export const setToken = (value) => (value ? storage.set(TOKEN_KEY, value) : storage.remove(TOKEN_KEY));

export const apiUrl = (path) => serverUrl() + path;
