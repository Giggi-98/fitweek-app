// Panoramica: cosa fare adesso e come sta andando la settimana.
import { DAYS, DAYSHORT, GYM, PROGRAM_WEEKS, ROUTINES, todayName } from "../constants.js";
import { app } from "../store.js";
import { empty, panel, stat } from "../ui.js";
import { esc, fmtDate, fmtNum, isoDate, money, num } from "../util.js";
import { todayStatus } from "./training.js";

/** Timeline del giorno ricavata dalla routine (CLAUDE.md). Orari indicativi. */
function timeline(day, meal) {
  const work = DAYS.indexOf(day) < 5;
  const gym = Boolean(GYM[day]);
  const items = [];
  if (work) items.push({ at: "13:00", min: 13 * 60, title: "Pranzo al lavoro", text: meal.lunch });
  else items.push({ at: "Pranzo", min: 13 * 60, title: "Pranzo", text: meal.lunch });
  if (gym) {
    items.push({ at: "18:30", min: 18 * 60 + 30, title: "Spuntino pre-palestra", text: meal.pre });
    items.push({ at: "19:30", min: 19 * 60 + 30, title: `Palestra · Giorno ${GYM[day]}`, text: "19:30–22:00", gym: true });
    items.push({ at: "22:30", min: 22 * 60 + 30, title: "Cena", text: meal.dinner });
  } else {
    if (meal.pre) items.push({ at: "Spuntino", min: 17 * 60, title: "Spuntino", text: meal.pre });
    items.push({ at: "Cena", min: 20 * 60, title: "Cena", text: meal.dinner });
  }
  const now = new Date().getHours() * 60 + new Date().getMinutes();
  const next = items.findIndex((i) => i.min + 30 >= now);
  return items.map((i, k) => ({ ...i, state: next === -1 || k < next ? "past" : k === next ? "next" : "" }));
}

function weekDates() {
  const d = new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return DAYS.map((_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return isoDate(x);
  });
}

function weightStats() {
  const w = [...app.state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const last = w[w.length - 1];
  const since = new Date();
  since.setDate(since.getDate() - 6);
  const recent = w.filter((x) => x.date >= isoDate(since));
  const avg = recent.length ? recent.reduce((s, x) => s + num(x.weight), 0) / recent.length : null;
  return { last, avg, count: recent.length };
}

function trainingCard() {
  const st = todayStatus();
  const r = st.routine;
  if (st.kind === "active")
    return `<div class="today-cta active"><div><span class="tiny-label">Allenamento in corso</span><strong>Giorno ${esc(r)} · W${esc(st.week)}</strong><small>${st.done}/${st.planned} serie</small></div><a class="btn primary" href="#training">Riprendi →</a></div>`;
  if (st.kind === "done")
    return `<div class="today-cta done"><div><span class="tiny-label">Allenamento di oggi</span><strong>Giorno ${esc(r)} completato ✓</strong><small>Ricordati la cena con il secondo del lavoro.</small></div></div>`;
  if (st.kind === "planned")
    return `<div class="today-cta"><div><span class="tiny-label">Oggi palestra · 19:30</span><strong>Giorno ${esc(r)} · W${esc(st.week)}</strong><small>${esc(ROUTINES[r]?.focus || "")}</small></div><a class="btn primary" href="#training">▶ Inizia</a></div>`;
  return `<div class="today-cta rest"><div><span class="tiny-label">Oggi</span><strong>Giorno di riposo</strong><small>Prossimo: ${nextGymLabel()}</small></div></div>`;
}

function nextGymLabel() {
  const idx = (new Date().getDay() + 6) % 7;
  for (let k = 1; k <= 7; k++) {
    const d = DAYS[(idx + k) % 7];
    if (GYM[d]) return `${d.toLowerCase()} · Giorno ${GYM[d]}`;
  }
  return "—";
}

export function render() {
  const day = todayName();
  const meal = app.state.meals[day] || {};
  const dates = weekDates();
  const doneByDate = new Map(app.sessions.filter((s) => s.status === "done").map((s) => [s.date, s]));
  const doneThisWeek = app.sessions.filter((s) => s.status === "done" && dates.includes(s.date)).length;
  const ws = weightStats();
  const g = app.state.groceries;
  const total = g.reduce((s, x) => s + num(x.price), 0);
  const bought = g.filter((x) => x.checked).length;
  const recent = app.sessions.filter((s) => s.status === "done").slice(0, 4);

  return `
  <div class="intro"><div><h2>${esc(day)} ${esc(fmtDate(app.today.date).replace(/^\S+\s/, ""))}</h2><p>Settimana ${esc(app.today.program_week)} di ${PROGRAM_WEEKS} del programma</p></div></div>
  ${trainingCard()}
  <div class="metrics">
    ${stat("Peso", ws.last ? `${fmtNum(ws.last.weight)}<small> kg</small>` : "—", ws.last ? `ultima: ${esc(fmtDate(ws.last.date))}` : `<a href="#progress">Registra la prima pesata</a>`)}
    ${stat("Media 7 giorni", ws.avg ? `${fmtNum(ws.avg)}<small> kg</small>` : "—", ws.count ? `${ws.count} pesate` : "servono pesate", { calc: true })}
    ${stat("Allenamenti", `${doneThisWeek}<small>/3</small>`, "questa settimana")}
    ${stat("Spesa", money(total), `${bought}/${g.length} presi · budget ${money(app.state.profile.budget)}`)}
  </div>
  <div class="twocol">
    ${panel(
      "La tua giornata",
      `<ol class="timeline">${timeline(day, meal)
        .map((i) => `<li class="${i.state} ${i.gym ? "gym" : ""}"><span class="tl-at">${esc(i.at)}</span><div><strong>${esc(i.title)}</strong><small>${esc(i.text || "Da pianificare")}</small></div></li>`)
        .join("")}</ol>`,
      `<a class="btn small" href="#meals">Pasti →</a>`,
    )}
    ${panel(
      "Questa settimana",
      `<div class="daygrid">${DAYS.map((d, i) => {
        const done = doneByDate.get(dates[i]);
        const isToday = dates[i] === app.today.date;
        return `<div class="daybox ${GYM[d] ? "gym" : ""} ${done ? "done" : ""} ${isToday ? "today" : ""}"><strong>${DAYSHORT[i]}</strong><span>${done ? "✓ " + esc(done.routine) : GYM[d] ? GYM[d] : "·"}</span></div>`;
      }).join("")}</div>
      <div class="spacer12"></div>
      ${recent.length ? recent.map((s) => `<div class="entry"><div><div class="entry-title">Giorno ${esc(s.routine)} · W${esc(s.week)}</div><div class="entry-sub">${esc(fmtDate(s.date))} · ${s.sets.filter((x) => x.completed).length} serie${s.duration_min ? ` · ${esc(Math.round(s.duration_min))} min` : ""}</div></div></div>`).join("") : empty("Nessun allenamento registrato", "Il primo sarà nella schermata Palestra.")}`,
      `<a class="btn small" href="#progress">Storico →</a>`,
    )}
  </div>`;
}
