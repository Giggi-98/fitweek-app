// Unico punto di accesso HTTP. Gli errori portano status e primo campo non valido.
// Nell'app autonoma: indirizzo del server configurabile, token al posto del cookie, e le letture che
// non raggiungono il server rispondono con l'ultima copia locale (segnalando che si è offline).
import * as cache from "./cache.js";
import { apiUrl, setToken, standalone, token } from "./platform.js";

export class ApiError extends Error {
  constructor(message, status, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** Stato della rete visto dalle richieste: `offlineSince` = orario della copia locale in uso, o null.
 *  `onBack` scatta quando il server torna raggiungibile dopo un periodo offline. */
export const net = { offlineSince: null, onChange: () => {}, onBack: () => {} };
function setOffline(since) {
  if (net.offlineSince === since) return;
  const wasOffline = net.offlineSince != null;
  net.offlineSince = since;
  net.onChange();
  if (wasOffline && since == null) net.onBack();
}

// App autonoma: un server irraggiungibile (es. fuori casa in 4G) non risponde con un errore, resta muto.
// Ogni richiesta ha quindi un tempo massimo, dopo il quale vale come "rete assente".
const READ_TIMEOUT_MS = 6000;
const WRITE_TIMEOUT_MS = 12000;
const PROBE_EVERY_MS = 10000;
const PROBE_TIMEOUT_MS = 3000;
const inFlight = new Set();

function timedFetch(url, options, ms) {
  if (!standalone) return fetch(url, options);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  inFlight.add(ctl);
  return fetch(url, { ...options, signal: ctl.signal }).finally(() => {
    clearTimeout(timer);
    inFlight.delete(ctl);
  });
}

/** Scelta dell'utente: smette di aspettare il server; le letture in corso rispondono con la copia locale. */
export function workOffline() {
  for (const ctl of [...inFlight]) ctl.abort();
}

let lastProbe = 0;
/** Da offline, controlla (non più di una volta ogni 10 s) se il server è tornato raggiungibile. */
export function probeServer() {
  if (!standalone || net.offlineSince == null || Date.now() - lastProbe < PROBE_EVERY_MS) return;
  lastProbe = Date.now();
  timedFetch(apiUrl("/api/health"), {}, PROBE_TIMEOUT_MS)
    .then((res) => res.ok && setOffline(null))
    .catch(() => {});
}

/** @param fresh true = mai dalla copia locale (serve il dato vero del server, es. prima di una fusione)
 *  @param timeout tempo massimo in ms (solo app autonoma)
 *  @param editedAt orario ISO della modifica: il server non la applica sopra un dato modificato più di recente */
export async function request(path, { method = "GET", body, fresh = false, timeout, editedAt } = {}) {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  if (editedAt) headers["X-Edited-At"] = editedAt; // scrittura in coda: quando è stata fatta, non quando arriva
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const cacheable = standalone && method === "GET" && !fresh;
  // Già offline: la lettura risponde subito con la copia locale, senza far aspettare; intanto si sonda il server.
  if (cacheable && net.offlineSince != null) {
    const hit = cache.get(path);
    if (hit) {
      probeServer();
      return hit.data;
    }
  }
  let res;
  try {
    res = await timedFetch(apiUrl(path), {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }, timeout ?? (method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS));
  } catch {
    const hit = cacheable ? cache.get(path) : null;
    if (standalone) setOffline(net.offlineSince ?? hit?.at ?? Date.now());
    if (hit) return hit.data;
    throw new ApiError("Rete non raggiungibile", 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.detail || `HTTP ${res.status}`, res.status, data.errors?.[0]?.field);
  }
  const renewed = res.headers?.get?.("X-Renewed-Token");
  if (renewed && standalone) setToken(renewed);
  const data = await res.json();
  if (standalone && method === "GET") cache.put(path, data);
  setOffline(null);
  return data;
}
