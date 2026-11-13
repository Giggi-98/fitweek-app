// Oggi: cosa fare adesso (allenamento + linea del tempo live) e come sta andando la settimana.
import { DAYS, DAYSHORT, GYM, ROUTINES } from "../constants.js";
import { icon } from "../icons.js";
import { ring } from "../motion.js";
import { openComposer } from "../composer.js";
import { guessSlot, openReminder, openSleepLog, openWeighIn } from "../reminders.js";
import { dayNumber } from "../stats.js";
import { app } from "../store.js";
import { modalOpen, tabId, tabs } from "../ui.js";
import { clock, countdown, gapFor, nextEvent, nowAction, positionNow, toMinutes } from "../timeline.js";
import { esc, fmtDate, fmtDuration, fmtNum, isoDate, num } from "../util.js";
import { todayStatus } from "./training.js";

const KIND_ICON = { meal: "utensils", workout: "dumbbell", weigh_in: "scale", shopping: "shopping-cart", sleep: "moon", custom: "bell" };
const SLOT_ICON = { lunch: "soup", pre_workout: "zap", snack: "apple", dinner: "utensils", other: "cookie" };
const ui = { tab: "day" }; // solo su telefono: su schermo largo giornata e settimana stanno affiancate
const CTA = { log_meal: "Registra", start_workout: "Inizia", log_weight: "Pesa", open_shopping: "Apri", none: "Fatto" };

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

/** Orario della palestra dal promemoria di oggi (modificabile in Impostazioni), non scritto a mano. */
const gymTime = () => app.agenda.find((i) => i.action === "start_workout")?.time || "";

function hero() {
  const st = todayStatus();
  const w = app.weekly?.totals;
  const r = st.routine;
  if (st.kind === "active" || st.kind === "planned") {
    const done = st.kind === "active" ? st.done : 0;
    const planned = st.planned || plannedFor(r, st.week);
    return `<section class="today-hero">
      <div class="today-top">
        ${ring(planned ? done / planned : 0, { size: 92, label: `<span data-count="${done}">${done}</span>`, sub: `di ${planned} serie` })}
        <div class="today-text">
          <span class="eyebrow">${st.kind === "active" ? "Allenamento in corso" : `Oggi palestra${gymTime() ? ` · ${esc(gymTime())}` : ""}`}</span>
          <h2>Giorno ${esc(r)} · W${esc(st.week)}</h2>
          <p>${esc(ROUTINES[r]?.focus || "")}</p>
        </div>
      </div>
      <a class="btn primary xl today-cta ${st.kind === "planned" ? "glow" : ""}" href="#training">${icon(st.kind === "active" ? "arrow-right" : "play")}${st.kind === "active" ? "Riprendi l'allenamento" : "Inizia l'allenamento"}</a>
    </section>`;
  }
  const doneWeek = w?.workouts_done ?? 0;
  const plannedWeek = w?.workouts_planned ?? 3;
  return `<section class="today-hero ${st.kind === "done" ? "done" : ""}">
    <div class="today-top">
      ${ring(plannedWeek ? doneWeek / plannedWeek : 0, { size: 92, label: `<span data-count="${doneWeek}">${doneWeek}</span>`, sub: `di ${plannedWeek}` })}
      <div class="today-text">
        <span class="eyebrow">${greeting()} · questa settimana</span>
        <h2>${st.kind === "done" ? `Giorno ${esc(r)} fatto ${icon("circle-check", "sm")}` : "Giorno di riposo"}</h2>
        <p>${st.kind === "done" ? "Ottimo lavoro. Recupera bene stanotte." : `Prossimo: ${esc(nextGym())}`}</p>
      </div>
    </div>
  </section>`;
}

function plannedFor(routine, week) {
  return (app.state.routines[routine] || []).reduce((n, ex) => n + num(ex.sets[Math.min(week, ex.sets.length) - 1]), 0);
}

// ---- riquadri di oggi: calorie e proteine (stime, con il riferimento scelto dall'utente), sonno, peso ----
/** Riquadro con barra verso il riferimento. Sopra il riferimento la barra è piena, senza colori d'allarme. */
function intakeTile(label, iconName, value, target, unit, missing) {
  const has = value != null;
  const pct = has && target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const left = has && target ? target - value : null;
  const sub = !has
    ? missing ? `${missing} senza valori` : "registra i pasti"
    : target
      ? left > 0 ? `mancano ~${fmtNum(left, 0)} ${unit}` : "riferimento raggiunto"
      : missing ? `+${missing} senza valori` : "dai pasti registrati";
  return `<div class="metric tile">
    <div class="metric-label">${icon(iconName, "sm")}${label} <span class="badge-calc">stima</span></div>
    <div class="metric-value">${has ? `~<span data-count="${Math.round(value)}">${fmtNum(value, 0)}</span>` : "—"}<small>${target ? ` / ${fmtNum(target, 0)}` : ""} ${unit}</small></div>
    ${target ? `<div class="bar" role="img" aria-label="${pct}% del riferimento"><div data-pct-w="${pct}"></div></div>` : ""}
    <div class="metric-sub">${sub}</div>
  </div>`;
}

function tiles() {
  const today = app.weekly?.days?.find((d) => d.date === app.today.date);
  const targets = app.weekly?.targets || {};
  const sorted = [...app.state.weights].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const prev = sorted.slice(-8, -1);
  const avgPrev = prev.length ? prev.reduce((s, x) => s + num(x.weight), 0) / prev.length : null;
  const delta = last && avgPrev ? last.weight - avgPrev : null;
  const night = app.sleep.items.find((n) => n.date === app.today.date);
  return `<div class="tiles dash-stats">
    ${intakeTile("Calorie", "flame", today?.kcal_estimate, targets.kcal, "kcal", today?.meals_without_values)}
    ${intakeTile("Proteine", "beef", today?.protein_estimate_g, targets.protein_g, "g", 0)}
    <button type="button" class="metric tile" data-sleep aria-label="${night ? "Modifica il sonno di stanotte" : "Registra il sonno di stanotte"}">
      <div class="metric-label">${icon("moon", "sm")}Sonno</div>
      <div class="metric-value">${night ? esc(fmtDuration(night.duration_min)) : "—"}</div>
      <div class="metric-sub">${night ? `${esc(night.bed_time)} → ${esc(night.wake_time)}` : "tocca per registrare stanotte"}</div>
    </button>
    <button type="button" class="metric tile" data-weigh aria-label="Registra il peso">
      <div class="metric-label">${icon("scale", "sm")}Peso</div>
      <div class="metric-value">${last ? `<span data-count="${last.weight}" data-decimals="1">${fmtNum(last.weight)}</span><small> kg</small>` : "—"}</div>
      <div class="metric-sub">${delta == null ? (last ? esc(fmtDate(last.date)) : "tocca per la prima pesata") : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmtNum(Math.abs(delta))} sulla media precedente`}</div>
    </button>
  </div>`;
}

// ---- adesso: una sola azione, la più rilevante per l'ora e la routine ---------------------------
const minutesNow = () => new Date().getHours() * 60 + new Date().getMinutes();
/** Agenda di oggi con l'orario mostrato (quello posticipato, se "Più tardi"), in ordine. */
const agendaRows = () =>
  app.agenda
    .map((i) => ({ ...i, shown: i.state === "snoozed" ? clock(new Date(i.due_at)) : i.time }))
    .sort((a, b) => a.shown.localeCompare(b.shown));

function currentAction() {
  const st = todayStatus();
  if (st.kind === "active") return null; // c'è già "Riprendi l'allenamento"
  const a = nowAction(agendaRows().map((i) => ({ ...i, time: i.shown })), minutesNow());
  // L'allenamento di oggi ha già il suo pulsante grande: non lo si ripete.
  return a && !(a.item.action === "start_workout" && st.kind === "planned") ? a : null;
}
const actionKey = (a) => (a ? `${a.item.id}:${a.due}` : "");

function nowCard() {
  const a = currentAction();
  shownAction = actionKey(a);
  if (!a) return "";
  const i = a.item;
  const ic = i.kind === "meal" ? SLOT_ICON[i.slot] || "utensils" : KIND_ICON[i.kind] || "bell";
  const when = countdown(a.due ? -a.minutes : a.minutes);
  return `<button type="button" class="now-card ${a.due ? "due" : ""}" data-agenda="${esc(i.id)}">
    <span class="now-ic">${icon(ic)}</span>
    <span class="now-text"><span class="eyebrow">${a.due ? (a.minutes ? `Da registrare · ${esc(when)}` : "Adesso") : esc(when)}</span><strong>${esc(i.title)}</strong></span>
    <span class="tl-cta">${CTA[i.action] || "Apri"}</span>
  </button>`;
}
// Col passare dei minuti l'azione giusta cambia: la pagina si ridisegna solo quando cambia davvero.
let shownAction = "";
setInterval(() => {
  if (app.view === "dashboard" && app.state && !modalOpen() && actionKey(currentAction()) !== shownAction) app.render();
}, 30_000);

// ---- linea del tempo ------------------------------------------------------------------------
function timeline() {
  if (!app.agenda.length) return '<p class="subtle">Nessun promemoria per oggi. Aggiungili da Impostazioni → Promemoria.</p>';
  const nowMin = minutesNow();
  const rows = agendaRows();
  const next = nextEvent(rows.map((i) => ({ ...i, time: i.shown })), nowMin);
  const items = rows.map((i, k) => {
    const open = i.state === "pending" || i.state === "snoozed";
    const overdue = i.due && i.state === "pending";
    const isNext = next && i.id === next.id;
    const ic = i.state === "done" ? "check" : i.kind === "meal" ? SLOT_ICON[i.slot] || "utensils" : KIND_ICON[i.kind] || "bell";
    const sub = i.detail ? esc(i.detail) : overdue ? "Da registrare" : i.state === "snoozed" ? "Posticipato" : i.state === "skipped" ? "Saltato" : "";
    const gap = k ? gapFor(toMinutes(i.shown) - toMinutes(rows[k - 1].shown)) : 0;
    return `<li class="tl-item ${i.state} ${isNext ? "next" : ""} ${overdue ? "overdue" : ""}" data-min="${toMinutes(i.shown)}" data-open="${open ? 1 : 0}" data-title="${esc(i.title)}" data-vars="gap:${gap}px">
      <span class="tl-time">${esc(i.shown)}</span>
      <span class="tl-node">${icon(ic)}</span>
      <button type="button" class="tl-card" data-agenda="${esc(i.id)}">
        <span class="tl-text"><strong>${esc(i.title)}</strong>${sub ? `<small>${sub}</small>` : ""}</span>
        ${isNext || overdue ? `<span class="tl-cta">${CTA[i.action] || "Apri"}</span>` : i.state === "done" ? icon("circle-check", "sm") : ""}
      </button>
    </li>`;
  });
  const label = next ? `${next.title} ${countdown(toMinutes(next.shown) - nowMin)}` : "Giornata completata";
  return `<p class="tl-next"><span class="eyebrow">Prossimo</span><strong data-next-label data-empty="Giornata completata">${esc(label)}</strong></p>
  <ol class="tl" data-timeline>
    <li class="tl-rail" aria-hidden="true"><i class="tl-fill"></i></li>
    ${items.join("")}
    <li class="tl-now" aria-hidden="true"><i class="tl-now-dot"></i></li>
  </ol>`;
}

/** Alimenti della dispensa che scadono entro 3 giorni (o già scaduti): un promemoria discreto. */
function pantryNote() {
  const today = dayNumber(app.today.date);
  const soon = app.state.inventory
    .filter((x) => x.expiry && dayNumber(x.expiry) - today <= 3)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!soon.length) return "";
  const when = (x) => {
    const d = dayNumber(x.expiry) - today;
    return d < 0 ? "scaduto" : d === 0 ? "oggi" : d === 1 ? "domani" : `tra ${d} giorni`;
  };
  return `<a class="inline-note warn dash-note" href="#shopping">${icon("hourglass")}<div><strong>In scadenza in dispensa</strong><span>${esc(soon.slice(0, 4).map((x) => `${x.name} (${when(x)})`).join(" · "))}</span></div></a>`;
}

function week() {
  const w = app.weekly;
  if (!w) return "";
  const t = w.totals;
  const today = isoDate();
  const target = w.targets?.kcal || 0;
  const max = Math.max(1, target, ...w.days.map((d) => d.kcal_estimate || 0)) * 1.08;
  const cols = w.days
    .map((d, i) => {
      const h = d.kcal_estimate ? Math.max(3, Math.round((d.kcal_estimate / max) * 100)) : 0;
      const label = `${DAYS[i]}: ${d.kcal_estimate ? `circa ${fmtNum(d.kcal_estimate, 0)} kcal teoriche` : "nessun valore"}, ${d.meals_eaten} pasti su ${d.meals_expected}`;
      return `<button type="button" class="wk-col ${d.kcal_estimate ? "" : "empty"} ${d.date === today ? "today" : ""}" aria-label="${esc(label)}">
        <span class="wk-tip">${d.kcal_estimate ? `~${fmtNum(d.kcal_estimate, 0)} kcal` : "Nessun valore"}<small>${d.meals_eaten}/${d.meals_expected} pasti${d.meals_without_values ? ` · ${d.meals_without_values} senza valori` : ""}</small></span>
        <span class="wk-stack" data-pct-h="${h}">${d.kcal_estimate ? `<em class="wk-val">${fmtNum(d.kcal_estimate, 0)}</em>` : ""}<span class="wk-fill"></span></span>
      </button>`;
    })
    .join("");
  const ref = target ? `<span class="wk-ref" data-vars="ref:${(target / max).toFixed(3)}"></span>` : "";
  const days = w.days
    .map((d, i) => {
      const gym = GYM[DAYS[i]];
      const did = d.workouts.length > 0;
      return `<span class="${d.date === today ? "today" : ""}">${DAYSHORT[i]}<i class="gym-dot ${did ? "done" : gym ? "planned" : ""}" title="${did ? "Allenamento fatto" : gym ? `Giorno ${gym}` : ""}">${did ? icon("check") : gym ? esc(gym) : ""}</i></span>`;
    })
    .join("");
  const sleep = t.sleep || { nights: 0 };
  return `<section class="panel dash-week" role="tabpanel" id="dash-week" aria-labelledby="${tabId("Oggi", "week")}" tabindex="0">
    <div class="panel-head"><h3>${icon("chart-line")}La settimana</h3><a class="btn small" href="#meals">Diario${icon("arrow-right", "sm")}</a></div>
    <div class="chart-caption"><span>Calorie teoriche al giorno <span class="badge-calc">stima</span></span><span class="chart-legend">${target ? `<span><i class="key ref"></i>riferimento ${fmtNum(target, 0)} kcal</span>` : ""}<span><i class="key gym done"></i>allenamento fatto</span><span><i class="key gym"></i>in programma</span></span></div>
    <div class="wk-chart">${cols}${ref}</div>
    <div class="wk-days">${days}</div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Calorie <span class="badge-calc">stima</span></div><div class="metric-value">${t.kcal_estimate_avg ? `~<span data-count="${t.kcal_estimate_avg}">${fmtNum(t.kcal_estimate_avg, 0)}</span>` : "—"}<small> kcal/die</small></div><div class="metric-sub">${t.days_with_values ? `media su ${t.days_with_values} ${t.days_with_values === 1 ? "giorno" : "giorni"}` : "registra i pasti"}</div></div>
      <div class="metric"><div class="metric-label">Proteine <span class="badge-calc">stima</span></div><div class="metric-value">${t.protein_estimate_avg_g ? `~<span data-count="${t.protein_estimate_avg_g}">${t.protein_estimate_avg_g}</span>` : "—"}<small> g/die</small></div><div class="metric-sub">dai pasti registrati</div></div>
      <div class="metric"><div class="metric-label">Allenamenti</div><div class="metric-value"><span data-count="${t.workouts_done}">${t.workouts_done}</span><small>/${t.workouts_planned}</small></div><div class="metric-sub">${t.sets_done}/${t.sets_planned} serie · W${esc(w.program_week)}</div></div>
      <div class="metric"><div class="metric-label">Sonno <span class="badge-calc">media</span></div><div class="metric-value">${sleep.nights ? esc(fmtDuration(sleep.duration_avg_min)) : "—"}</div><div class="metric-sub">${sleep.nights ? `a letto verso le ${esc(sleep.bedtime_avg)} · ${sleep.nights} ${sleep.nights === 1 ? "notte" : "notti"}` : "nessuna notte registrata"}</div></div>
    </div>
  </section>`;
}

export function render() {
  const pending = app.agenda.filter((i) => i.due && i.state === "pending").length;
  return `<div class="dash" data-tab="${ui.tab}">
  <div class="dash-top"><div class="dash-hero">${hero()}${nowCard()}</div>${tiles()}</div>
  ${pantryNote()}
  <div class="dash-main">
    <div class="dash-tabs">${tabs([["day", "La giornata", "clock", pending || null], ["week", "La settimana", "chart-line"]], ui.tab, "Oggi", "tab", { day: "dash-agenda", week: "dash-week" })}</div>
    <section class="panel dash-agenda" role="tabpanel" id="dash-agenda" aria-labelledby="${tabId("Oggi", "day")}" tabindex="0">
      <div class="panel-head"><h3>${icon("clock")}La giornata${pending ? ` <span class="pill accent">${pending} da fare</span>` : ""}</h3><div class="panel-actions"><span class="now-chip" title="Ora attuale">${icon("clock", "sm")}<span class="tl-now-time">${clock(new Date())}</span></span><button class="btn small" data-quick-meal>${icon("plus", "sm")}Pasto</button></div></div>
      ${timeline()}
    </section>
    ${week()}
  </div>
  </div>`;
}

// Il puntatore segue l'orologio anche senza ridisegnare la pagina.
export function afterRender() {
  positionNow();
  // Durante l'animazione d'ingresso le schede si spostano: riallinea a fine movimento.
  for (const ms of [450, 1300]) setTimeout(positionNow, ms);
}
setInterval(positionNow, 15_000);
window.addEventListener("resize", () => positionNow());

export async function onClick(t) {
  if (t.dataset.tab) return (ui.tab = t.dataset.tab), true;
  if (t.dataset.agenda) {
    const item = app.agenda.find((i) => i.id === t.dataset.agenda);
    if (item && item.state !== "done" && item.state !== "skipped") {
      if (item.action === "start_workout") location.hash = "#training";
      else openReminder(item);
    }
    return false;
  }
  if (t.matches("[data-quick-meal]")) return openComposer({ slot: guessSlot() }), false;
  if (t.matches("[data-sleep]")) return openSleepLog({ date: app.today.date }), false;
  if (t.matches("[data-weigh]")) return openWeighIn(), false;
  return false;
}
