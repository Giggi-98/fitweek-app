// Avvisi in tempo reale dal server (1.15): con il server raggiungibile (es. sulla stessa rete Wi-Fi) una modifica
// fatta da un altro dispositivo arriva in un attimo invece che al prossimo ritorno sull'app. Il flusso
// (GET /api/v1/events, Server-Sent Events) dice solo QUALE dominio è cambiato; i dati si rileggono con le API di
// sempre. Si legge con fetch e non con EventSource perché l'app autonoma si autentica con il token Bearer.
// Con l'app in secondo piano il flusso si chiude (batteria); al ritorno si riapre e main.js rilegge tutto.
import { clientId } from "./api.js";
import { apiUrl, token } from "./platform.js";

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
const DEBOUNCE_MS = 250; // più scritture di fila (es. una seduta salvata serie per serie) = una sola rilettura

/** Il flusso degli avvisi è aperto adesso (per la finestra "Stato dei dati"). */
export const live = { connected: false };
let active = false; // tra l'accesso e l'uscita
let listening = false; // listener di pagina già messi
let ctl = null;
let retry = RETRY_MIN_MS;
let retryTimer = null;
let onChange = () => {};
const waiting = new Set();
let debounce = null;

/** Domini cambiati da altri, da un blocco SSE ("event: change\ndata: {...}"); quelli di questa pagina no. */
export function parseBlock(block, self = clientId) {
  const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
  if (!data) return null;
  try {
    const ev = JSON.parse(data);
    return ev.by === self || typeof ev.domain !== "string" ? null : ev.domain;
  } catch {
    return null;
  }
}

function received(domain) {
  waiting.add(domain);
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const domains = [...waiting];
    waiting.clear();
    onChange(domains);
  }, DEBOUNCE_MS);
}

async function connect() {
  if (!active || ctl || document.visibilityState !== "visible") return;
  clearTimeout(retryTimer);
  ctl = new AbortController();
  let refused = false;
  try {
    const res = await fetch(apiUrl("/api/v1/events"), {
      credentials: "same-origin",
      headers: token() ? { Authorization: `Bearer ${token()}` } : {},
      signal: ctl.signal,
    });
    refused = res.status === 401; // sessione finita: ci pensano le altre richieste a riportare all'accesso
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    retry = RETRY_MIN_MS;
    live.connected = true;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value.replace(/\r\n/g, "\n");
      for (let i; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const domain = parseBlock(buf.slice(0, i));
        if (domain) received(domain);
      }
    }
  } catch {
    /* rete assente, server riavviato o flusso chiuso da noi: si riprova sotto */
  }
  ctl = null;
  live.connected = false;
  if (active && !refused && document.visibilityState === "visible") {
    retryTimer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, RETRY_MAX_MS);
  }
}

function disconnect() {
  clearTimeout(retryTimer);
  ctl?.abort();
}

/** Da chiamare dopo l'accesso. @param handler (domini cambiati) => void */
export function startLive(handler) {
  onChange = handler;
  active = true;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => (document.visibilityState === "visible" ? connect() : disconnect()));
    window.addEventListener("online", () => {
      retry = RETRY_MIN_MS;
      connect();
    });
    window.addEventListener("offline", disconnect); // un flusso aperto non si accorge subito che la rete è caduta
  }
  connect();
}

/** All'uscita: chiude il flusso e non lo riapre. */
export function stopLive() {
  active = false;
  onChange = () => {};
  disconnect();
}
