// Linea del tempo di oggi: calcoli puri (testati in tests/js/timeline.test.mjs) + posizionamento del
// puntatore "adesso", che scorre lungo il binario in proporzione all'ora tra un evento e il successivo.
import { $, $$ } from "./util.js";

export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const clock = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

/** Spazio verticale prima di un evento, proporzionale ai minuti dal precedente (con minimo e massimo). */
export const gapFor = (minutes) => Math.round(Math.min(28, Math.max(4, minutes * 0.12)));

/**
 * Posizione verticale del puntatore.
 * @param marks [{min, y}] centri dei nodi in ordine di orario
 * @param edge  quanto sporgere sopra il primo / sotto l'ultimo evento
 */
export function pointerY(marks, nowMin, edge = 26) {
  if (!marks.length) return 0;
  const first = marks[0], last = marks[marks.length - 1];
  if (nowMin <= first.min) return first.y - edge * Math.min(1, (first.min - nowMin) / 60);
  if (nowMin >= last.min) return last.y + edge * Math.min(1, (nowMin - last.min) / 60);
  for (let i = 1; i < marks.length; i++) {
    const a = marks[i - 1], b = marks[i];
    if (nowMin <= b.min) return b.min === a.min ? b.y : a.y + ((nowMin - a.min) / (b.min - a.min)) * (b.y - a.y);
  }
  return last.y;
}

/** "tra 1 h 48", "tra 12 min", "adesso", "da 25 min" (per ciò che è già passato). */
export function countdown(minutes) {
  const m = Math.abs(Math.round(minutes));
  const text = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`;
  if (m === 0) return "adesso";
  return minutes > 0 ? `tra ${text}` : `da ${text}`;
}

/** Prossimo evento ancora da fare (in attesa o posticipato) a partire da adesso; null se la giornata è finita. */
export function nextEvent(items, nowMin) {
  const open = items.filter((i) => i.state === "pending" || i.state === "snoozed");
  return open.find((i) => toMinutes(i.time) >= nowMin) || null;
}

/** Riposiziona il puntatore e aggiorna i testi "vivi". Chiamata dopo ogni render e ogni 15 secondi. */
export function positionNow(root = document) {
  const tl = $("[data-timeline]", root);
  if (!tl) return;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const box = tl.getBoundingClientRect();
  const rows = $$(".tl-item", tl);
  const marks = rows.map((li) => {
    const node = $(".tl-node", li).getBoundingClientRect();
    return { min: Number(li.dataset.min), y: node.top + node.height / 2 - box.top };
  });
  const y = pointerY(marks, nowMin);
  $(".tl-now", tl).style.top = `${y}px`;
  $(".tl-fill", tl).style.height = `${Math.max(0, y)}px`;
  const chip = $(".tl-now-time", root);
  if (chip) chip.textContent = clock(now);
  rows.forEach((li) => li.classList.toggle("past", Number(li.dataset.min) < nowMin));
  const label = $("[data-next-label]", root);
  const next = rows.find((li) => li.dataset.open === "1" && Number(li.dataset.min) >= nowMin);
  if (label) label.textContent = next ? `${next.dataset.title} ${countdown(Number(next.dataset.min) - nowMin)}` : label.dataset.empty;
}
