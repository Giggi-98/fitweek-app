// Oggi: cosa fare adesso (allenamento + agenda) e come sta andando la settimana.
import { DAYS, DAYSHORT, GYM, ROUTINES } from "../constants.js";
import { icon } from "../icons.js";
import { ring } from "../motion.js";
import { openComposer } from "../composer.js";
import { guessSlot, openReminder } from "../reminders.js";
import { app } from "../store.js";
import { esc, fmtDate, fmtNum, isoDate, num } from "../util.js";
import { todayStatus } from "./training.js";

const KIND_ICON = { meal: "utensils", workout: "dumbbell", weigh_in: "scale", shopping: "shopping-cart", sleep: "moon", custom: "bell" };
const SLOT_ICON = { lunch: "soup", pre_workout: "zap", snack: "apple", dinner: "utensils", other: "cookie" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Buonanotte" : h < 13 ? "Buongiorno" : h < 18 ? "Buon pomeriggio" : "Buonasera";
}

function nextGym() {
  const idx = (new Date().getDay() + 6) % 7;
  for (let k = 1; k <= 7; k++) {
    const d = DAYS[(idx + k) % 7];
    if (GYM[d]) return `${d.toLowerCase()} · Giorno ${GYM[d]}`;
  }
  return "—";
}

function hero() {
  const st = todayStatus();
  const w = app.weekly?.totals;
  const r = st.routine;
  if (st.kind === "active" || st.kind === "planned") {
    const done = st.kind === "active" ? st.done : 0;
    const planned = st.planned || plannedFor(r, st.week);
    return `<section class="today-hero">
      <div class="today-top">
        ${ring(planned ? done / planned : 0, { size: 104, label: `<span data-count="${done}">${done}</span>`, sub: `/${planned} serie` })}
        <div class="today-text">
          <span class="eyebrow">${st.kind === "active" ? "Allenamento in corso" : "Oggi palestra · 19:30"}</span>
          <h2>Giorno ${esc(r)} · W${esc(st.week)}</h2>
          <p>${esc(ROUTINES[r]?.focus || "")}</p>
        </div>
      </div>
      <a class="btn primary xl full ${st.kind === "planned" ? "glow" : ""}" href="#training">${icon(st.kind === "active" ? "arrow-right" : "play")}${st.kind === "active" ? "Riprendi l'allenamento" : "Inizia l'allenamento"}</a>
    </section>`;
  }
  const doneWeek = w?.workouts_done ?? 0;
  const plannedWeek = w?.workouts_planned ?? 3;
  return `<section class="today-hero ${st.kind === "done" ? "done" : ""}">
    <div class="today-top">
      ${ring(plannedWeek ? doneWeek / plannedWeek : 0, { size: 104, label: `<span data-count="${doneWeek}">${doneWeek}</span>`, sub: `/${plannedWeek} allenam.` })}
      <div class="today-text">
        <span class="eyebrow">${greeting()}</span>
        <h2>${st.kind === "done" ? `Giorno ${esc(r)} fatto ${icon("circle-check", "sm")}` : "Giorno di riposo"}</h2>
        <p>${st.kind === "done" ? "Ottimo lavoro. Recupera bene stanotte." : `Prossimo: ${esc(nextGym())}`}</p>
      </div>
    </div>
  </section>`;
}

function plannedFor(routine, week) {
  return (app.state.routines[routine] || []).reduce((n, ex) => n + num(ex.sets[Math.min(week, ex.sets.length) - 1]), 0);
}

function quickStats() {
  const today = app.weekly?.days?.find((d) => d.date === app.today.date);
  const last = [...app.state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();
  const prev = [...app.state.weights].sort((a, b) => a.date.localeCompare(b.date)).slice(-8, -1);
  const avgPrev = prev.length ? prev.reduce((s, x) => s + num(x.weight), 0) / prev.length : null;
  const delta = last && avgPrev ? last.weight - avgPrev : null;
  return `<div class="quick-stats">
    <div class="metric"><div class="metric-label">${icon("utensils", "sm")}Pasti oggi</div><div class="metric-value"><span data-count="${today?.meals_eaten ?? 0}">${today?.meals_eaten ?? 0}</span><small>/${today?.meals_expected ?? 0}</small></div><div class="metric-sub">registrati</div></div>
    <div class="metric"><div class="metric-label">${icon("flame", "sm")}Calorie oggi <span class="badge-calc">stima</span></div><div class="metric-value">${today?.kcal_estimate ? `<span data-count="${today.kcal_estimate}">${fmtNum(today.kcal_estimate, 0)}</span>` : "—"}</div><div class="metric-sub">${today?.meals_without_values ? `+${today.meals_without_values} senza valori` : "teoriche, dai pasti"}</div></div>
    <div class="metric"><div class="metric-label">${icon("scale", "sm")}Peso</div><div class="metric-value">${last ? `<span data-count="${last.weight}" data-decimals="1">${fmtNum(last.weight)}</span><small> kg</small>` : "—"}</div><div class="metric-sub">${delta == null ? (last ? esc(fmtDate(last.date)) : "nessuna pesata") : `${delta > 0 ? "+" : ""}${fmtNum(delta)} vs media precedente`}</div></div>
  </div>`;
}

function agenda() {
  if (!app.agenda.length) return '<p class="subtle">Nessun promemoria per oggi. Aggiungili da Impostazioni → Promemoria.</p>';
  const nextIdx = app.agenda.findIndex((i) => i.state === "pending" || i.state === "snoozed");
  const nowHM = new Date().toTimeString().slice(0, 5);
  const nowIdx = app.agenda.findIndex((i) => i.time > nowHM);
  const items = app.agenda.map((i, k) => {
    const overdue = i.due && i.state === "pending";
    const cls = [i.state, k === nextIdx ? "next" : "", overdue ? "overdue" : ""].join(" ");
    const time = i.state === "snoozed" ? new Date(i.due_at).toTimeString().slice(0, 5) : i.time;
    const ic = i.state === "done" ? "check" : i.kind === "meal" ? SLOT_ICON[i.slot] || "utensils" : KIND_ICON[i.kind] || "bell";
    const sub = i.detail ? esc(i.detail) : overdue ? "Da registrare" : i.state === "snoozed" ? "Posticipato" : i.state === "skipped" ? "Saltato" : "";
    return `<li class="${cls}"><button type="button" class="agenda-item" data-agenda="${esc(i.id)}">
      <span class="ag-time">${esc(time)}</span>
      <span class="ag-dot">${icon(ic)}</span>
      <span class="ag-text"><strong>${esc(i.title)}</strong>${sub ? `<small>${sub}</small>` : ""}</span>
      <span class="ag-state">${i.state === "done" ? icon("circle-check", "sm") : ""}</span>
    </button></li>`;
  });
  if (nowIdx > 0) items.splice(nowIdx, 0, '<li class="now-line" aria-hidden="true"></li>');
  return `<ol class="agenda">${items.join("")}</ol>`;
}

function week() {
  const w = app.weekly;
  if (!w) return "";
  const t = w.totals;
  const max = Math.max(1, ...w.days.map((d) => d.kcal_estimate || 0));
  const today = isoDate();
  const cols = w.days
    .map((d, i) => {
      const h = d.kcal_estimate ? Math.max(4, Math.round((d.kcal_estimate / max) * 100)) : 0;
      const label = `${DAYS[i]}: ${d.kcal_estimate ? `circa ${fmtNum(d.kcal_estimate, 0)} kcal teoriche` : "nessun valore"}, ${d.meals_eaten} pasti su ${d.meals_expected}`;
      return `<button type="button" class="wk-col ${d.kcal_estimate ? "" : "empty"} ${d.date === today ? "today" : ""}" aria-label="${esc(label)}">
        <span class="wk-tip">${d.kcal_estimate ? `~${fmtNum(d.kcal_estimate, 0)} kcal` : "—"}<small>${d.meals_eaten}/${d.meals_expected} pasti${d.meals_without_values ? ` · ${d.meals_without_values} senza valori` : ""}</small></span>
        <span class="wk-fill" style="height:${h}%"></span>
      </button>`;
    })
    .join("");
  const days = w.days
    .map((d, i) => {
      const gym = GYM[DAYS[i]];
      const did = d.workouts.length > 0;
      return `<span class="${d.date === today ? "today" : ""}">${DAYSHORT[i]}<i class="gym-dot ${did ? "done" : gym ? "planned" : ""}" title="${did ? "Allenamento fatto" : gym ? `Giorno ${gym}` : ""}"></i></span>`;
    })
    .join("");
  return `<section class="panel">
    <div class="panel-head"><h3>${icon("chart-line")}La settimana</h3><a class="btn small" href="#meals">Diario</a></div>
    <p class="subtle">Calorie teoriche al giorno · pallino verde = allenamento fatto</p>
    <div class="wk-chart">${cols}</div>
    <div class="wk-days">${days}</div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Media <span class="badge-calc">stima</span></div><div class="metric-value">${t.kcal_estimate_avg ? `~<span data-count="${t.kcal_estimate_avg}">${fmtNum(t.kcal_estimate_avg, 0)}</span>` : "—"}<small> kcal</small></div><div class="metric-sub">${t.days_with_values ? `su ${t.days_with_values} ${t.days_with_values === 1 ? "giorno" : "giorni"}` : "registra i pasti"}</div></div>
      <div class="metric"><div class="metric-label">Proteine <span class="badge-calc">stima</span></div><div class="metric-value">${t.protein_estimate_avg_g ? `~<span data-count="${t.protein_estimate_avg_g}">${t.protein_estimate_avg_g}</span>` : "—"}<small> g/die</small></div><div class="metric-sub">dai pasti registrati</div></div>
      <div class="metric"><div class="metric-label">Allenamenti</div><div class="metric-value"><span data-count="${t.workouts_done}">${t.workouts_done}</span><small>/${t.workouts_planned}</small></div><div class="metric-sub">${t.sets_done}/${t.sets_planned} serie · W${esc(w.program_week)}</div></div>
      <div class="metric"><div class="metric-label">Peso medio</div><div class="metric-value">${t.weight_avg ? `${fmtNum(t.weight_avg)}<small> kg</small>` : "—"}</div><div class="metric-sub">${t.weigh_ins} pesate</div></div>
    </div>
    <p class="subtle">Le calorie sono stime teoriche dai pasti registrati, non misure né obiettivi.</p>
  </section>`;
}

export function render() {
  const pending = app.agenda.filter((i) => i.due && i.state === "pending").length;
  return `<div class="dash">
  <div class="dash-hero">${hero()}</div>
  ${quickStats().replace('class="quick-stats"', 'class="quick-stats dash-stats"')}
  <section class="panel dash-agenda">
    <div class="panel-head"><h3>${icon("calendar")}Agenda di oggi${pending ? ` <span class="pill accent">${pending} da fare</span>` : ""}</h3><button class="btn small" data-quick-meal>${icon("plus", "sm")}Pasto</button></div>
    ${agenda()}
  </section>
  ${week().replace('<section class="panel">', '<section class="panel dash-week">')}
  </div>`;
}

export async function onClick(t) {
  if (t.dataset.agenda) {
    const item = app.agenda.find((i) => i.id === t.dataset.agenda);
    if (item && item.state !== "done" && item.state !== "skipped") {
      if (item.action === "start_workout") location.hash = "#training";
      else openReminder(item);
    }
    return false;
  }
  if (t.matches("[data-quick-meal]")) {
    openComposer({ slot: guessSlot() });
    return false;
  }
  return false;
}

