// Unico punto di accesso HTTP. Gli errori portano status e primo campo non valido.
// Nell'app autonoma: indirizzo del server configurabile, token al posto del cookie, e le letture che
// non raggiungono il server rispondono con l'ultima copia locale (segnalando che si è offline).
import * as cache from "./cache.js";
import { apiUrl, standalone, token } from "./platform.js";

export class ApiError extends Error {
  constructor(message, status, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** Stato della rete visto dalle richieste: `offlineSince` = orario della copia locale in uso, o null. */
export const net = { offlineSince: null, onChange: () => {} };
function setOffline(since) {
  if (net.offlineSince === since) return;
  net.offlineSince = since;
  net.onChange();
}

/** @param fresh true = mai dalla copia locale (serve il dato vero del server, es. prima di una fusione) */
export async function request(path, { method = "GET", body, fresh = false } = {}) {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: "same-origin",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const hit = standalone && method === "GET" && !fresh ? cache.get(path) : null;
    if (standalone) setOffline(net.offlineSince ?? hit?.at ?? Date.now());
    if (hit) return hit.data;
    throw new ApiError("Rete non raggiungibile", 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.detail || `HTTP ${res.status}`, res.status, data.errors?.[0]?.field);
  }
  const data = await res.json();
  if (standalone && method === "GET") cache.put(path, data);
  setOffline(null);
  return data;
}
