// Dati dall'orologio letti da Health Connect (D-040): regole pure, testate in tests/js/health.test.mjs.
// Il plugin nativo legge i record; qui si decide quali valori mandare al server: una notte per giorno di
// risveglio, passi, battito a riposo, HRV e SpO2 per giorno, battito medio e massimo per seduta (anche dal vivo,
// durante la seduta), pesate dalla bilancia. Solo ciò che è cambiato
// rispetto alla copia sul telefono, così a regime un'importazione non scrive nulla.

const FIRST_IMPORT_DAYS = 30; // Health Connect non dà dati più vecchi senza un permesso in più
const OVERLAP_DAYS = 2; // l'orologio può sincronizzare in ritardo: si rilegge un po' indietro
export const MIN_HEART_SAMPLES = 10; // meno campioni in una seduta non fanno una media che dica qualcosa
const MAX_SESSION_HOURS = 6;
const HEART_REFRESH_HOURS = 24; // una seduta finita da meno di così si rilegge: i campioni possono arrivare tardi // una seduta "aperta" per ore è stata chiusa tardi: il battito non sarebbe suo
const STAGE_KEYS = { deep: "deep_min", light: "light_min", rem: "rem_min", awake: "awake_min" };
const DAY_MS = 86_400_000;

const pad = (n) => String(n).padStart(2, "0");
/** Giorno locale (fuso del telefono) di un istante. */
const localDay = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localClock = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60_000));

/** Da quando leggere: 30 giorni la prima volta, poi dall'ultima importazione meno due giorni. */
export function importStart(lastImport, now) {
  const first = now.getTime() - FIRST_IMPORT_DAYS * DAY_MS;
  if (!lastImport) return new Date(first).toISOString();
  return new Date(Math.max(first, new Date(lastImport).getTime() - OVERLAP_DAYS * DAY_MS)).toISOString();
}

/** Minuti per fase; tutti null se l'orologio non ha registrato le fasi. */
function stageMinutes(stages) {
  const out = Object.fromEntries(Object.values(STAGE_KEYS).map((k) => [k, stages.length ? 0 : null]));
  for (const s of stages) if (STAGE_KEYS[s.stage]) out[STAGE_KEYS[s.stage]] += minutesBetween(s.start, s.end);
  return out;
}

/**
 * Una notte per giorno di risveglio: la sessione più lunga che finisce quel giorno (i pisolini non contano).
 * @param sessions [{start, end, stages: [{start, end, stage}]}] @returns [{date, body}] con body per PUT /sleep
 */
export function nightsFromSessions(sessions) {
  const longest = new Map();
  for (const s of sessions) {
    const day = localDay(s.end);
    const old = longest.get(day);
    if (!old || minutesBetween(s.start, s.end) > minutesBetween(old.start, old.end)) longest.set(day, s);
  }
  return [...longest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({
    date,
    body: { bed_time: localClock(s.start), wake_time: localClock(s.end), source: "health_connect", note: "", ...stageMinutes(s.stages) },
  }));
}

/** Battito a riposo: per ogni giorno l'ultima misura. @param records [{time, bpm}] @returns Map giorno → bpm */
export function restingByDay(records) {
  const out = new Map();
  for (const r of [...records].sort((a, b) => a.time.localeCompare(b.time))) out.set(localDay(r.time), Math.round(r.bpm));
  return out;
}

/** Media del giorno (ora locale), arrotondata all'intero. @param records [{time, value}] @returns Map giorno → valore */
export function averageByDay(records) {
  const sums = new Map();
  for (const r of records) {
    const [sum, n] = sums.get(localDay(r.time)) || [0, 0];
    sums.set(localDay(r.time), [sum + r.value, n + 1]);
  }
  return new Map([...sums].map(([day, [sum, n]]) => [day, Math.round(sum / n)]));
}

const DAY_FIELDS = ["steps", "resting_hr", "hrv_ms", "spo2"];

/**
 * Passi, battito a riposo, HRV e SpO2 uniti per giorno. Un valore che l'orologio non dà (permesso tolto, nessuna
 * misura quel giorno) non cancella quello già salvato: si riparte dalla riga che c'è sul telefono.
 * @param read { steps: Map, resting_hr: Map, hrv_ms: Map, spo2: Map } giorno → valore, solo i tipi letti
 * @returns [{date, body}] con body per PUT /health-days
 */
export function healthDays(read, db) {
  const days = new Set(Object.values(read).flatMap((m) => [...m.keys()]));
  return [...days].sort().map((date) => {
    const old = db.health_days.find((d) => d.date === date);
    return { date, body: Object.fromEntries(DAY_FIELDS.map((k) => [k, read[k]?.get(date) ?? old?.[k] ?? null])) };
  });
}

/** Passi per giorno dal plugin ([{date, steps}]) come Map. */
export const stepsByDay = (days) => new Map(days.map((d) => [d.date, d.steps]));

const same = (row, body) => Object.entries(body).every(([k, v]) => (row?.[k] ?? null) === v);

/** Le notti da inviare: non quelle decise dall'utente (`sleep_owned`) né quelle già uguali sul telefono. */
export const sleepWrites = (nights, db) =>
  nights.filter(({ date, body }) => !db.sleep_owned.includes(date) && !same(db.sleep_logs.find((n) => n.date === date), body));

/** I giorni da inviare: solo quelli cambiati. */
export const healthDayWrites = (days, db) => days.filter(({ date, body }) => !same(db.health_days.find((d) => d.date === date), body));

/**
 * Sedute concluse dopo `from`, con orari veri: la finestra in cui cercare i campioni. Una seduta finita da meno
 * di un giorno si rilegge anche se ha già un battito, perché OHealth può sincronizzare i campioni in ritardo.
 */
export const heartWindows = (sessions, from, now = new Date()) =>
  sessions
    .filter((s) => s.status === "done" && s.started_at && s.ended_at && new Date(s.ended_at) >= new Date(from))
    .filter((s) => !s.heart || now - new Date(s.ended_at) < HEART_REFRESH_HOURS * 3_600_000)
    .filter((s) => {
      const length = minutesBetween(s.started_at, s.ended_at);
      return length > 0 && length <= MAX_SESSION_HOURS * 60;
    })
    .map((s) => ({ id: s.id, start: s.started_at, end: s.ended_at, heart: s.heart || null }));

/** Vero se il riassunto nuovo dice qualcosa di diverso da quello salvato. */
export const heartChanged = (old, next) => !old || ["avg_bpm", "max_bpm", "samples"].some((k) => old[k] !== next[k]);

/**
 * Battito della seduta in corso: ultimo valore (con il suo orario), media e massimo da `start` in poi.
 * @returns {bpm, at, avg, max, samples} oppure null se non è ancora arrivato nessun campione
 */
export function liveHeart(samples, start) {
  const from = new Date(start).getTime();
  const own = samples.filter((s) => new Date(s.time).getTime() >= from).sort((a, b) => a.time.localeCompare(b.time));
  if (!own.length) return null;
  const bpm = own.map((s) => s.bpm);
  const last = own[own.length - 1];
  return {
    bpm: Math.round(last.bpm), at: last.time, samples: bpm.length,
    avg: Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length), max: Math.round(Math.max(...bpm)),
  };
}

/**
 * Pesate dalla bilancia: la prima misura di ogni giorno (quella del mattino), solo nei giorni senza una pesata.
 * Una pesata già salvata, a mano o importata, non viene mai cambiata.
 * @param records [{time, kg}] @returns [{date, weight}] col peso a un decimale
 */
export function weightWrites(records, weights) {
  const taken = new Set(weights.map((w) => w.date));
  const first = new Map();
  for (const r of [...records].sort((a, b) => a.time.localeCompare(b.time))) {
    const day = localDay(r.time);
    if (!taken.has(day) && !first.has(day)) first.set(day, Math.round(r.kg * 10) / 10);
  }
  return [...first].map(([date, weight]) => ({ date, weight }));
}

/** Battito medio e massimo dei campioni dentro la seduta; null se sono troppo pochi. */
export function heartSummary(samples, { start, end }) {
  const from = new Date(start).getTime(), to = new Date(end).getTime();
  const bpm = samples.filter((s) => {
    const t = new Date(s.time).getTime();
    return t >= from && t <= to;
  }).map((s) => s.bpm);
  if (bpm.length < MIN_HEART_SAMPLES) return null;
  return { avg_bpm: Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length), max_bpm: Math.round(Math.max(...bpm)), samples: bpm.length };
}
