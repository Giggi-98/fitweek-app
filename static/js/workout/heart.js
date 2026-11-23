// Battito di una seduta mostrato in Palestra (riepilogo) e in Progressi (storico): curva con le serie segnate e
// picco per serie. I dati vengono dall'orologio (Health Connect, D-040/D-041); qui solo la presentazione, nessuna
// soglia né zona (regola 4).
import { lineChart } from "../chart.js";
import { setPeaks } from "../health.js";
import { niceTicks } from "../stats.js";

/** Picchi per serie della seduta (Map "esercizio:indice" → bpm), vuota senza curva. */
export const sessionPeaks = (s) => setPeaks(s.heart?.curve, s.started_at, s.sets || []);

/** Grafico della curva del battito, con una tacca per ogni serie segnata; "" se la curva non c'è. */
export function heartChart(s, nameOf) {
  const curve = s.heart?.curve;
  if (!curve?.length || curve.length < 2 || !s.started_at) return "";
  const t0 = new Date(s.started_at).getTime();
  const marks = (s.sets || []).filter((x) => x.completed && x.logged_at).map((x) => ({
    t: (new Date(x.logged_at).getTime() - t0) / 60000,
    label: `${nameOf(x.exercise_id) || x.exercise_id} #${x.set_index}`,
  }));
  const values = curve.map(([, avg]) => avg);
  return lineChart({
    axis: "minutes", dots: "none", unit: "bpm", marks,
    points: curve.map(([sec, avg, max]) => ({ t: sec / 60, value: avg, tip: `max ${max}` })),
    ticks: niceTicks(Math.min(...values) - 5, Math.max(...values) + 5),
    format: (v) => String(Math.round(v)),
    label: `Battito durante la seduta: media ${s.heart.avg_bpm}, massimo ${s.heart.max_bpm} bpm; le tacche sono le serie.`,
  });
}
