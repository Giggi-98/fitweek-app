// App FitWeek sull'orologio Wear OS (1.19, D-044). Il plugin nativo `WatchLink` riceve dal Data Layer i messaggi
// dell'orologio e li tiene da parte finché questa pagina non li ritira (`drain`); qui si decide cosa farne:
// battito (un campione ogni 1–2 s, salvato per seduta), "inizia seduta", "serie fatta", e si rimanda all'orologio
// lo stato della seduta. Percorsi e formati: mobile/wear/src/main/java/app/fitweek/wear/Link.kt. Nel browser il
// plugin non c'è e non succede nulla.
import { standalone } from "./platform.js";
import { storage } from "./util.js";

export const PATH = { hello: "/fitweek/hello", state: "/fitweek/state", start: "/fitweek/start", set: "/fitweek/set", hr: "/fitweek/hr" };
const SAMPLES_KEY = "fitweek.watchHeart.v1"; // {sessionId: [[epochMs, bpm], …]}
const KEEP_SESSIONS = 2; // la seduta in corso e quella appena chiusa (il riassunto parte a fine seduta)
const plugin = () => globalThis.Capacitor?.Plugins?.WatchLink || null;

export const canUseWatch = () => standalone && Boolean(plugin());

/** "bpm,epochMs;bpm,epochMs" → [[epochMs, bpm]], scartando i pezzi non validi. */
export function parseHr(data) {
  return String(data || "").split(";").map((part) => part.split(",").map(Number))
    .filter(([bpm, at]) => bpm >= 30 && bpm <= 240 && at > 0)
    .map(([bpm, at]) => [at, bpm]);
}

/** Unisce campioni nuovi a quelli salvati, senza doppioni per orario, in ordine di tempo. */
export function mergeSamples(saved, fresh) {
  const byTime = new Map(saved.map((s) => [s[0], s]));
  for (const s of fresh) byTime.set(s[0], s);
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}

/** Campioni dell'orologio di una seduta, nel formato di Health Connect ([{time, bpm}]). */
export function watchSamples(sessionId) {
  return (storage.get(SAMPLES_KEY, {})[sessionId] || []).map(([at, bpm]) => ({ time: new Date(at).toISOString(), bpm }));
}

function storeSamples(sessionId, fresh) {
  const all = storage.get(SAMPLES_KEY, {});
  const merged = { ...all, [sessionId]: mergeSamples(all[sessionId] || [], fresh) };
  const keep = Object.keys(merged).slice(-KEEP_SESSIONS); // ordine di inserimento: le sedute più vecchie escono
  storage.set(SAMPLES_KEY, Object.fromEntries(keep.map((id) => [id, merged[id]])));
}

let handlers = null;
let lastState = "";

/** Ritira i messaggi arrivati dall'orologio e li passa a chi li gestisce. */
async function drain() {
  if (!handlers || document.visibilityState !== "visible") return;
  const { messages } = await plugin().drain();
  let heart = false;
  for (const m of messages) {
    if (m.path === PATH.hr) {
      const session = handlers.sessionId();
      if (session) storeSamples(session, parseHr(m.data)), (heart = true);
    } else if (m.path === PATH.hello) sendState(true);
    else if (m.path === PATH.start) handlers.onStart();
    else if (m.path === PATH.set) {
      try {
        handlers.onSet(JSON.parse(m.data));
      } catch {
        /* messaggio malformato: l'orologio lo rimanda al prossimo tocco */
      }
    }
  }
  if (heart) handlers.onHeart();
}

/** Manda all'orologio lo stato della seduta, solo se è cambiato (o con `force`, quando l'orologio lo chiede). */
export function sendState(force = false) {
  if (!handlers) return;
  const data = JSON.stringify(handlers.state());
  if (!force && data === lastState) return;
  lastState = data;
  plugin().send({ path: PATH.state, data }).catch(() => {});
}

/**
 * Da chiamare una volta all'avvio dell'app Android.
 * @param h { sessionId(): id della seduta aperta o null, state(): stato per l'orologio, onStart(), onSet({exId, idx, kg, reps}), onHeart() }
 */
export function initWatch(h) {
  if (!canUseWatch()) return;
  handlers = h;
  plugin().addListener("message", () => drain().catch(() => {}));
  document.addEventListener("visibilitychange", () => drain().catch(() => {}));
  setInterval(() => drain().catch(() => {}), 3000); // se la pagina era in pausa quando è arrivato l'avviso
  drain().catch(() => {});
  sendState(true);
}
