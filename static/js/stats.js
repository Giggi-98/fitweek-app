// Calcoli puri per Progressi e allenamento (testati in tests/js/stats.test.mjs). Nessun DOM, nessuno stato.
// Tutto ciò che esce da qui è un valore CALCOLATO: l'interfaccia lo marca come tale.

const DAY_MS = 86_400_000;
/** Giorni dall'epoca per una data ISO (mezzogiorno UTC: nessun effetto dell'ora legale). */
export const dayNumber = (iso) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const mondayOf = (iso) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Media mobile sugli ultimi `days` giorni di calendario (non sulle ultime n pesate): le pesate
 * sono irregolari, e una finestra a tempo non dà più peso alle settimane con più misure.
 * @param readings [{date, weight}] in qualsiasi ordine
 * @returns [{date, value, n}] una voce per ogni giorno con pesata, in ordine di data
 */
export function movingAverage(readings, days = 7) {
  const sorted = readings
    .filter((r) => Number.isFinite(Number(r.weight)) && Number(r.weight) > 0)
    .map((r) => ({ day: dayNumber(r.date), date: r.date, weight: Number(r.weight) }))
    .sort((a, b) => a.day - b.day);
  const out = [];
  for (const r of sorted) {
    if (out.length && out[out.length - 1].date === r.date) out.pop(); // più pesate nello stesso giorno: una voce
    const window = sorted.filter((x) => x.day <= r.day && x.day > r.day - days);
    out.push({ date: r.date, value: window.reduce((s, x) => s + x.weight, 0) / window.length, n: window.length });
  }
  return out;
}

const doneSets = (session, exerciseId) =>
  (session.sets || []).filter((x) => x.exercise_id === exerciseId && x.completed && x.kg != null);

/**
 * Storia di un esercizio: per ogni seduta conclusa la serie più pesante e il volume.
 * @returns [{date, week, kg, reps, volume, sets}] dalla più vecchia alla più recente
 */
export function exerciseHistory(sessions, exerciseId) {
  return sessions
    .filter((s) => s.status === "done")
    .map((s) => {
      const sets = doneSets(s, exerciseId);
      if (!sets.length) return null;
      const top = sets.reduce((a, b) => (b.kg > a.kg || (b.kg === a.kg && (b.reps ?? 0) > (a.reps ?? 0)) ? b : a));
      return {
        date: s.date, week: s.week, kg: top.kg, reps: top.reps, sets: sets.length,
        volume: sets.reduce((v, x) => v + x.kg * (x.reps ?? 0), 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Carico massimo per esercizio nelle sedute concluse, esclusa `exceptId`. Map exerciseId → kg. */
export function bestLoads(sessions, exceptId = null) {
  const best = new Map();
  for (const s of sessions) {
    if (s.status !== "done" || s.id === exceptId) continue;
    for (const x of s.sets || []) {
      if (!x.completed || x.kg == null) continue;
      if (x.kg > (best.get(x.exercise_id) ?? 0)) best.set(x.exercise_id, x.kg);
    }
  }
  return best;
}

/** Una serie è un record solo se esiste un precedente e lo supera (la prima volta non è un record). */
export const isRecord = (best, exerciseId, kg) => kg != null && best.has(exerciseId) && kg > best.get(exerciseId);

/**
 * Griglia della costanza: una cella per ogni seduta prevista dal programma.
 * @param schedule {weekdayIndex(0=lun): routine}
 * @returns {cells: [{week, routine, date, state: "done"|"missed"|"today"|"upcoming"}], done, due}
 *          `due` = sedute previste fino a oggi compreso; `done` = quelle fatte (anche recuperate in altro giorno).
 */
export function consistency(sessions, startDate, today, weeks, schedule) {
  const start = mondayOf(startDate);
  const done = new Set(sessions.filter((s) => s.status === "done").map((s) => `${s.week}:${s.routine}`));
  const cells = [];
  for (let week = 1; week <= weeks; week++) {
    for (const [weekday, routine] of Object.entries(schedule)) {
      const date = addDays(start, (week - 1) * 7 + Number(weekday));
      const state = done.has(`${week}:${routine}`) ? "done" : date < today ? "missed" : date === today ? "today" : "upcoming";
      cells.push({ week, routine, date, state });
    }
  }
  const due = cells.filter((c) => c.date <= today || c.state === "done");
  return { cells, done: due.filter((c) => c.state === "done").length, due: due.length };
}

/** Tacche "pulite" (1, 2, 5 × 10ⁿ) che coprono [min, max] con al massimo `max` righe. */
export function niceTicks(min, max, maxTicks = 5) {
  if (!(max > min)) max = min + 1;
  const raw = (max - min) / Math.max(1, maxTicks - 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1e6; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

/** Errori di rete o del server passeggeri: l'operazione in coda va ritentata, non scartata. */
export const isTransient = (status) => status === 0 || status === 408 || status === 429 || status >= 500;
