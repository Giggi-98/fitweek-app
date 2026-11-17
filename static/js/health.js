// Dati dall'orologio letti da Health Connect (D-040): regole pure, testate in tests/js/health.test.mjs.
// Il plugin nativo legge i record; qui si decide quali valori mandare al server: una notte per giorno di
// risveglio, passi e battito a riposo per giorno, battito medio e massimo per seduta. Solo ciò che è cambiato
// rispetto alla copia sul telefono, così a regime un'importazione non scrive nulla.

const FIRST_IMPORT_DAYS = 30; // Health Connect non dà dati più vecchi senza un permesso in più
const OVERLAP_DAYS = 2; // l'orologio può sincronizzare in ritardo: si rilegge un po' indietro
export const MIN_HEART_SAMPLES = 10; // meno campioni in una seduta non fanno una media che dica qualcosa
const MAX_SESSION_HOURS = 6; // una seduta "aperta" per ore è stata chiusa tardi: il battito non sarebbe suo
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

/** Passi e battito a riposo uniti per giorno. @returns [{date, body}] con body per PUT /health-days */
export function healthDays(steps, resting) {
  const days = new Set([...steps.map((d) => d.date), ...resting.keys()]);
  return [...days].sort().map((date) => ({
    date,
    body: { steps: steps.find((d) => d.date === date)?.steps ?? null, resting_hr: resting.get(date) ?? null },
  }));
}

const same = (row, body) => Object.entries(body).every(([k, v]) => (row?.[k] ?? null) === v);

/** Le notti da inviare: non quelle decise dall'utente (`sleep_owned`) né quelle già uguali sul telefono. */
export const sleepWrites = (nights, db) =>
  nights.filter(({ date, body }) => !db.sleep_owned.includes(date) && !same(db.sleep_logs.find((n) => n.date === date), body));

/** I giorni da inviare: solo quelli cambiati. */
export const healthDayWrites = (days, db) => days.filter(({ date, body }) => !same(db.health_days.find((d) => d.date === date), body));

/** Sedute concluse dopo `from`, con orari veri e senza battito: la finestra in cui cercare i campioni. */
export const heartWindows = (sessions, from) =>
  sessions
    .filter((s) => s.status === "done" && !s.heart && s.started_at && s.ended_at && new Date(s.ended_at) >= new Date(from))
    .filter((s) => {
      const length = minutesBetween(s.started_at, s.ended_at);
      return length > 0 && length <= MAX_SESSION_HOURS * 60;
    })
    .map((s) => ({ id: s.id, start: s.started_at, end: s.ended_at }));

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
