// Calcoli sull'allenamento: funzioni pure, testate in tests/js/calc.test.mjs.
// Una serie "di lavoro" è una serie fatta, con carico e ripetizioni, che non è di riscaldamento: solo queste
// contano in volume, record, massimale stimato e obiettivi.

export const isWork = (s) => Boolean(s.completed) && s.kg != null && s.reps != null && s.kind !== "warmup";
const round1 = (n) => Math.round(n * 10) / 10;
const E1RM_MAX_REPS = 12; // oltre, la formula sovrastima troppo per essere utile

/** Massimale stimato (formula di Epley: kg × (1 + rip/30)); una ripetizione vale il carico stesso.
 *  null fuori dall'intervallo 1–12 ripetizioni o senza carico. È una STIMA: va sempre mostrata come tale. */
export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps >= 1) || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? kg : round1(kg * (1 + reps / 30));
}

export const workSets = (session, exerciseId) =>
  (session?.sets || []).filter((s) => s.exercise_id === exerciseId && isWork(s)).sort((a, b) => a.set_index - b.set_index);

const volumeOf = (sets) => sets.reduce((v, s) => v + s.kg * s.reps, 0);
const bestE1rm = (sets) => sets.reduce((m, s) => Math.max(m, e1rm(s.kg, s.reps) ?? 0), 0) || null;
/** La serie migliore: la più pesante, a parità quella con più ripetizioni. */
const topSet = (sets) => sets.reduce((a, b) => (b.kg > a.kg || (b.kg === a.kg && b.reps > a.reps) ? b : a));

/**
 * Un esercizio seduta per seduta (solo sedute concluse con almeno una serie di lavoro), dalla più vecchia.
 * @returns [{id, date, week, sets, top: {kg, reps}, volume, e1rm}]
 */
export function exerciseSessions(sessions, exerciseId) {
  return sessions
    .filter((s) => s.status === "done")
    .map((s) => ({ session: s, sets: workSets(s, exerciseId) }))
    .filter((x) => x.sets.length)
    .map(({ session, sets }) => ({ id: session.id, date: session.date, week: session.week, sets, top: topSet(sets), volume: volumeOf(sets), e1rm: bestE1rm(sets) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * I migliori risultati di un esercizio nelle sedute concluse, esclusa `exceptId` (la seduta in corso).
 * @returns null se non c'è un precedente (la prima volta non è un record), altrimenti
 *          {kg, e1rm, volume, repsAt: Map carico → ripetizioni massime}
 */
export function exerciseBests(sessions, exerciseId, exceptId = null) {
  const past = exerciseSessions(sessions.filter((s) => s.id !== exceptId), exerciseId);
  if (!past.length) return null;
  const repsAt = new Map();
  for (const p of past) for (const s of p.sets) repsAt.set(s.kg, Math.max(repsAt.get(s.kg) ?? 0, s.reps));
  return { kg: Math.max(...past.map((p) => p.top.kg)), e1rm: Math.max(...past.map((p) => p.e1rm ?? 0)) || null, volume: Math.max(...past.map((p) => p.volume)), repsAt };
}

export const RECORD_LABEL = { kg: "carico", e1rm: "massimale stimato", reps: "ripetizioni", volume: "volume" };

/** Record battuti da una serie: "kg" (carico più alto), "e1rm" (massimale stimato), "reps" (più ripetizioni
 *  con un carico già usato). Vuoto se non è una serie di lavoro o non c'è un precedente. */
export function setRecords(bests, set) {
  if (!bests || !isWork(set)) return [];
  const est = e1rm(set.kg, set.reps);
  return [
    set.kg > bests.kg ? "kg" : null,
    est != null && bests.e1rm != null && est > bests.e1rm ? "e1rm" : null,
    bests.repsAt.has(set.kg) && set.reps > bests.repsAt.get(set.kg) ? "reps" : null,
  ].filter(Boolean);
}

/**
 * Riepilogo di un esercizio in una seduta, a confronto con la volta precedente.
 * @returns null senza serie di lavoro, altrimenti {top, volume, e1rm, prev: {top, volume} | null, records: [tipi]}
 */
export function exerciseSummary(sessions, session, exerciseId) {
  const sets = workSets(session, exerciseId);
  if (!sets.length) return null;
  const bests = exerciseBests(sessions, exerciseId, session.id);
  const past = exerciseSessions(sessions.filter((s) => s.id !== session.id && s.date <= session.date), exerciseId);
  const prev = past[past.length - 1] || null;
  const volume = volumeOf(sets);
  const records = [...new Set(sets.flatMap((s) => setRecords(bests, s)))];
  if (bests && volume > bests.volume) records.push("volume");
  return { top: topSet(sets), volume, e1rm: bestE1rm(sets), prev: prev && { top: prev.top, volume: prev.volume }, records };
}

/**
 * Obiettivo di una serie a partire da ciò che è stato fatto l'ultima volta (progressione doppia): una
 * ripetizione in più con lo stesso carico finché non si arriva in cima all'intervallo, poi un passo di carico
 * ripartendo dal minimo. È una proposta: l'utente la usa con un tocco o la ignora.
 * @param prev  serie di lavoro corrispondente dell'ultima seduta {kg, reps}, o null
 * @param range [minimo, massimo] delle ripetizioni della scheda (es. [8, 10]); massimo 0 = non indicato
 * @returns {{kg, reps, step: "reps"|"load"}} oppure null se non c'è un precedente
 */
export function setTarget(prev, [low, high], kgStep) {
  if (!prev || prev.reps == null) return null;
  if (prev.kg > 0 && high > 0 && prev.reps >= high) return { kg: Math.round((prev.kg + kgStep) * 100) / 100, reps: low || prev.reps, step: "load" };
  return { kg: prev.kg, reps: prev.reps + 1, step: "reps" };
}

/** "8–10" → [8, 10]; "12" → [12, 12]; testo libero → [0, 0]. */
export function repRange(text) {
  const nums = String(text).split(/[–-]/).map((x) => Number.parseInt(x.trim(), 10)).filter(Number.isFinite);
  return nums.length ? [nums[0], nums[nums.length - 1]] : [0, 0];
}

/**
 * Serie di lavoro fatte nella settimana per gruppo muscolare (sedute concluse o in corso).
 * @param muscleOf funzione id esercizio → gruppo ("" = non indicato, escluso dal conteggio)
 * @returns [{muscle, sets}] dal gruppo più allenato
 */
export function weeklyMuscleSets(sessions, weekStart, weekEnd, muscleOf) {
  const count = new Map();
  for (const s of sessions) {
    if (s.status === "skipped" || s.date < weekStart || s.date > weekEnd) continue;
    for (const x of s.sets || []) {
      const muscle = isWork(x) ? muscleOf(x.exercise_id) : "";
      if (muscle) count.set(muscle, (count.get(muscle) ?? 0) + 1);
    }
  }
  return [...count].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
}
