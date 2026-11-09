// Oggi: cosa fare adesso (agenda dei promemoria) e come sta andando la settimana.
import { DAYSHORT, PROGRAM_WEEKS, ROUTINES, todayName } from "../constants.js";
import { guessSlot, openMealLog, openReminder } from "../reminders.js";
import { app } from "../store.js";
import { panel, stat } from "../ui.js";
import { esc, fmtDate, fmtNum, isoDate, money, num } from "../util.js";
import { todayStatus } from "./training.js";

const STATE_ICON = { done: "✓", skipped: "–", snoozed: "⏱", pending: "" };

function trainingCard() {
  const st = todayStatus();
  const r = st.routine;
  if (st.kind === "active")
    return `<div class="today-cta active"><div><span class="tiny-label">Allenamento in corso</span><strong>Giorno ${esc(r)} · W${esc(st.week)}</strong><small>${st.done}/${st.planned} serie</small></div><a class="btn primary" href="#training">Riprendi →</a></div>`;
  if (st.kind === "done")
    return `<div class="today-cta done"><div><span class="tiny-label">Allenamento di oggi</span><strong>Giorno ${esc(r)} completato ✓</strong><small>Ottimo lavoro.</small></div></div>`;
  if (st.kind === "planned")
    return `<div class="today-cta"><div><span class="tiny-label">Oggi palestra · 19:30</span><strong>Giorno ${esc(r)} · W${esc(st.week)}</strong><small>${esc(ROUTINES[r]?.focus || "")}</small></div><a class="btn primary" href="#training">▶ Inizia</a></div>`;
  return "";
}

function agenda() {
  if (!app.agenda.length) return '<p class="subtle">Nessun promemoria per oggi. Puoi aggiungerli da Altro → Promemoria.</p>';
  const nextIdx = app.agenda.findIndex((i) => i.state === "pending" || i.state === "snoozed");
  return `<ol class="agenda">${app.agenda
    .map((i, k) => {
      const overdue = i.due && i.state === "pending";
      const cls = [i.state, k === nextIdx ? "next" : "", overdue ? "overdue" : ""].join(" ");
      const time = i.state === "snoozed" ? new Date(i.due_at).toTimeString().slice(0, 5) : i.time;
      return `<li class="${cls}"><button type="button" class="agenda-item" data-agenda="${esc(i.id)}" ${i.state === "done" || i.state === "skipped" ? 'aria-disabled="true"' : ""}>
        <span class="ag-time">${esc(time)}</span>
        <span class="ag-text"><strong>${esc(i.title)}</strong>${i.detail ? `<small>${esc(i.detail)}</small>` : overdue ? "<small>Da registrare</small>" : i.state === "snoozed" ? "<small>Posticipato</small>" : ""}</span>
        <span class="ag-state" aria-label="${esc(i.state)}">${STATE_ICON[i.state]}</span>
      </button></li>`;
    })
    .join("")}</ol>`;
}

function weeklyPanel() {
  const w = app.weekly;
  if (!w) return "";
  const t = w.totals;
  const maxKcal = Math.max(1, ...w.days.map((d) => d.kcal_estimate || 0));
  const today = isoDate();
  const bars = w.days
    .map((d, i) => {
      const h = d.kcal_estimate ? Math.max(6, Math.round((d.kcal_estimate / maxKcal) * 100)) : 0;
      const gym = d.workouts.length ? "gym" : "";
      return `<div class="wk-day ${d.date === today ? "today" : ""} ${gym}" title="${esc(fmtDate(d.date))}: ${d.kcal_estimate ? "~" + d.kcal_estimate + " kcal (stima)" : "nessun valore"}">
        <div class="wk-bar"><div style="height:${h}%"></div></div>
        <strong>${DAYSHORT[i]}</strong><small>${d.kcal_estimate ? fmtNum(d.kcal_estimate, 0) : "—"}</small><small>${d.meals_eaten}/${d.meals_expected}${d.workouts.length ? " · ◆" : ""}</small>
      </div>`;
    })
    .join("");
  return panel(
    "La settimana",
    `<div class="wk-days" aria-label="Calorie teoriche e pasti registrati per giorno">${bars}</div>
    <div class="metrics">
      ${stat("Calorie medie", t.kcal_estimate_avg ? `~${fmtNum(t.kcal_estimate_avg, 0)}<small> kcal</small>` : "—", t.days_with_values ? `su ${t.days_with_values} giorni registrati${t.meals_without_values ? ` · ${t.meals_without_values} pasti senza valori` : ""}` : "registra i pasti per vederle", { calc: true })}
      ${stat("Proteine medie", t.protein_estimate_avg_g ? `~${fmtNum(t.protein_estimate_avg_g, 0)}<small> g</small>` : "—", "stima dai pasti registrati", { calc: true })}
      ${stat("Pasti registrati", `${t.meals_eaten}<small>/${t.meals_expected}</small>`, "rispetto ai promemoria")}
      ${stat("Allenamenti", `${t.workouts_done}<small>/${t.workouts_planned}</small>`, `${t.sets_done}/${t.sets_planned} serie · W${esc(w.program_week)}`)}
    </div>
    <p class="subtle">Calorie e proteine sono <strong>stime teoriche</strong> dai pasti registrati, non misure né obiettivi. Peso medio della settimana: ${t.weight_avg ? `${fmtNum(t.weight_avg)} kg (${t.weigh_ins} pesate)` : "nessuna pesata"}.</p>`,
    `<a class="btn small" href="#meals">Diario →</a>`,
  );
}

export function render() {
  const day = todayName();
  const last = [...app.state.weights].sort((a, b) => a.date.localeCompare(b.date)).pop();
  const g = app.state.groceries;
  const pending = app.agenda.filter((i) => i.due && i.state === "pending").length;
  return `
  <div class="intro"><div><h2>${esc(day)} ${esc(fmtDate(app.today.date).replace(/^\S+\s/, ""))}</h2><p>Settimana ${esc(app.today.program_week)} di ${PROGRAM_WEEKS} del programma${pending ? ` · <strong>${pending} da registrare</strong>` : ""}</p></div></div>
  ${trainingCard()}
  <div class="twocol">
    ${panel("Agenda di oggi", agenda(), `<button class="btn small" data-quick-meal>+ Pasto</button>`)}
    ${weeklyPanel()}
  </div>
  <div class="metrics">
    ${stat("Peso", last ? `${fmtNum(last.weight)}<small> kg</small>` : "—", last ? `ultima: ${esc(fmtDate(last.date))}` : "nessuna pesata")}
    ${stat("Spesa", money(g.reduce((s, x) => s + num(x.price), 0)), `${g.filter((x) => x.checked).length}/${g.length} presi · stima`)}
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
    openMealLog({ slot: guessSlot() });
    return false;
  }
  return false;
}
