// Pasti: diario (cosa hai mangiato), piano ricorrente, pasti abituali con valori stimati.
import { request } from "../api.js";
import { DAYS, DAYSHORT, GYM, MEAL_DEFAULTS, SLOTS, SOURCE_LABEL } from "../constants.js";
import { icon } from "../icons.js";
import { openComposer } from "../composer.js";
import { guessSlot } from "../reminders.js";
import { app, persistState, refreshDaily } from "../store.js";
import { formatQty, parseQty } from "../stats.js";
import { empty, panel, tabs, toast } from "../ui.js";
import { esc, fmtDate, fmtNum, isoDate, num, uid } from "../util.js";
import { openPlanProposal } from "./shopping.js";
import { enqueue, flush } from "../workout/queue.js";

const ui = { tab: "diary", weekOffset: 0, day: null, logs: null, loadedFor: null, planDay: (new Date().getDay() + 6) % 7, slot: "lunch" };
// Un pasto registrato da un promemoria invalida il diario in cache.
window.addEventListener("fitweek:changed", () => (ui.loadedFor = null));
function weekDays(offset) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return isoDate(x);
  });
}

async function loadLogs() {
  const days = weekDays(ui.weekOffset);
  const key = days[0];
  const out = await request(`/api/v1/meal-logs?from=${days[0]}&to=${days[6]}`);
  ui.logs = out.items;
  ui.loadedFor = key;
}

const SLOT_ICON = { lunch: "soup", pre_workout: "zap", snack: "apple", dinner: "utensils", other: "cookie" };
const viewTabs = () => tabs([["diary", "Diario", "notebook-pen"], ["plan", "Piano", "calendar"], ["templates", "Abituali", "sparkles"]], ui.tab, "Pasti");

const kcalLabel = (m) =>
  m.kcal != null ? `${m.nutrition_source === "estimate" ? "~" : ""}${fmtNum(m.kcal, 0)} kcal${m.protein_g != null ? ` · ${fmtNum(m.protein_g, 0)} g prot.` : ""} · ${SOURCE_LABEL[m.nutrition_source] || "stima"}` : "senza valori";

const sum = (list, key) => list.filter((m) => m[key] != null).reduce((n, m) => n + m[key], 0);

/** Giorno mostrato: quello scelto, se è nella settimana; altrimenti oggi o l'ultimo giorno della settimana. */
function selectedDay(days, today) {
  if (ui.day && days.includes(ui.day) && ui.day <= today) return ui.day;
  return days.includes(today) ? today : days[6];
}

/** Riquadro con il totale del giorno e, se l'utente ha scelto un riferimento, la barra verso quel valore. */
function dayTotal(label, iconName, value, target, unit, has) {
  const pct = has && target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return `<div class="metric tile"><div class="metric-label">${icon(iconName, "sm")}${label} <span class="badge-calc">stima</span></div>
    <div class="metric-value">${has ? `~${fmtNum(value, 0)}` : "—"}<small>${target ? ` / ${fmtNum(target, 0)}` : ""} ${unit}</small></div>
    ${target ? `<div class="bar" role="img" aria-label="${pct}% del riferimento"><div data-pct-w="${pct}"></div></div>` : ""}</div>`;
}

function diary() {
  const days = weekDays(ui.weekOffset);
  if (ui.loadedFor !== days[0]) {
    loadLogs().then(() => app.render()).catch((e) => toast("Diario non disponibile: " + e.message));
    return '<p class="subtle">Caricamento…</p>';
  }
  const today = isoDate();
  const day = selectedDay(days, today);
  const eatenOn = (d) => ui.logs.filter((m) => m.date === d && m.status === "eaten");
  const strip = days
    .map((d, i) => {
      const eaten = eatenOn(d);
      const kcal = sum(eaten, "kcal");
      return `<button type="button" class="day-tab ${d === day ? "active" : ""} ${d === today ? "today" : ""}" role="tab" aria-selected="${d === day}" data-day="${d}" ${d > today ? "disabled" : ""} aria-label="${esc(fmtDate(d))}${eaten.length ? `, circa ${fmtNum(kcal, 0)} kcal` : ""}">
        <span>${DAYSHORT[i]}</span><strong>${Number(d.slice(8))}</strong><small>${eaten.length ? `~${fmtNum(kcal, 0)}` : "—"}</small>
      </button>`;
    })
    .join("");
  const logs = ui.logs.filter((m) => m.date === day);
  const eaten = eatenOn(day);
  const kcal = sum(eaten, "kcal");
  const missing = eaten.filter((m) => m.kcal == null).length;
  const targets = app.weekly?.targets || {};
  const maxSlot = Math.max(1, ...eaten.map((m) => m.kcal || 0));
  const breakdown = eaten.length
    ? `<div class="hbars" role="img" aria-label="Calorie per pasto">${eaten.map((m) => `<div class="hbar"><span>${esc(SLOTS[m.slot] || m.slot)}</span><div class="bar"><div data-pct-w="${m.kcal ? Math.max(2, Math.round((m.kcal / maxSlot) * 100)) : 0}"></div></div><strong>${m.kcal != null ? fmtNum(m.kcal, 0) : "—"}</strong></div>`).join("")}</div>`
    : empty("Niente registrato", "Aggiungi il primo pasto del giorno.");
  return `<section class="week-strip">
    <div class="week-nav"><button class="icon-btn" data-week-shift="-1" aria-label="Settimana precedente">${icon("chevron-left")}</button><strong>${esc(fmtDate(days[0]))} – ${esc(fmtDate(days[6]))}</strong><button class="icon-btn" data-week-shift="1" ${ui.weekOffset >= 0 ? "disabled" : ""} aria-label="Settimana successiva">${icon("chevron-right")}</button></div>
    <div class="day-tabs" role="tablist" aria-label="Giorno">${strip}</div>
  </section>
  <div class="split wide-left">
    ${panel(
      `${icon("utensils")}${esc(fmtDate(day))}${day === today ? " · oggi" : ""}`,
      `${logs.length ? logs.map((m) => `<div class="entry ${m.status} clickable" data-edit-log="${esc(m.id)}" role="button" tabindex="0" aria-label="Modifica pasto"><div class="entry-main"><span class="slot-ic">${icon(SLOT_ICON[m.slot] || "utensils")}</span><div><div class="entry-title">${m.status === "skipped" ? "Saltato" : esc(m.description || "—")}</div><div class="entry-sub">${esc(SLOTS[m.slot] || m.slot)}${m.status === "skipped" ? "" : ` · ${esc(kcalLabel(m))}`}</div></div></div><button type="button" class="icon-btn" data-del-log="${esc(m.id)}" aria-label="Elimina">${icon("trash-2", "sm")}</button></div>`).join("") : '<p class="subtle">Niente registrato.</p>'}
        <div class="day-foot"><span>${eaten.length ? `Totale teorico <span class="kcal">~${fmtNum(kcal, 0)} kcal</span>${missing ? ` · ${missing} senza valori` : ""}` : ""}</span></div>`,
      `<button class="btn small" data-add-log="${esc(day)}">${icon("plus", "sm")}Pasto</button>`,
    )}
    ${panel(
      `${icon("flame")}Riepilogo del giorno`,
      `<div class="tiles pair">${dayTotal("Calorie", "flame", kcal, targets.kcal, "kcal", eaten.length > 0)}${dayTotal("Proteine", "beef", sum(eaten, "protein_g"), targets.protein_g, "g", eaten.some((m) => m.protein_g != null))}</div>
      ${breakdown}
      <p class="subtle">Stime teoriche dai pasti registrati, non misure.</p>`,
    )}
  </div>`;
}

const PLAN_SLOTS = [
  ["lunch", "Pranzo"],
  ["pre", "Spuntino"],
  ["dinner", "Cena"],
];

/** Piano ricorrente: su schermo largo l'intera settimana in una griglia, su telefono un giorno alla volta. */
function plan() {
  const slotShort = { lunch: "Pranzo", pre: "Spuntino", dinner: "Cena" };
  return `<div class="plan-days">${tabs(DAYS.map((d, i) => [String(i), DAYSHORT[i]]), String(ui.planDay), "Giorno del piano", "plan-day")}</div>
  <div class="plan-grid">${DAYS.map((day, i) => {
    const m = app.state.meals[day] || {};
    const items = m.items || [];
    const weekday = i < 5;
    return `<section class="meal-card ${i === ui.planDay ? "on" : ""}"><h3>${esc(day)} ${GYM[day] ? `<span class="pill accent">${icon("dumbbell", "sm")}${GYM[day]}</span>` : ""}</h3>${PLAN_SLOTS.map(
      ([k, label]) =>
        `<div class="field"><label for="meal-${esc(day)}-${k}">${label}</label><textarea id="meal-${esc(day)}-${k}" rows="2" maxlength="1000" data-meal-day="${esc(day)}" data-meal-key="${k}">${esc(m[k] || "")}</textarea></div>`,
    ).join("")}
      <div class="plan-ing">
        <span class="eyebrow">Ingredienti per la spesa${weekday ? " · secondo cena dal lavoro" : ""}</span>
        ${items.length
          ? `<div class="pick-list">${items.map((it, idx) => `<span class="pill">${esc(it.name)} · ${esc(formatQty(it.amount, it.unit))} (${esc(slotShort[it.slot] || "Cena")}) <button type="button" class="icon-btn" data-del-plan-ing="${esc(day)}:${idx}" aria-label="Rimuovi ${esc(it.name)}">${icon("x", "sm")}</button></span>`).join("")}</div>`
          : '<p class="subtle">Nessun ingrediente per la spesa in questo giorno.</p>'}
        <details class="free"><summary>${icon("plus", "sm")}Ingredienti di ${esc(day.toLowerCase())}</summary>
          <form class="stack" data-plan-ing-form="${esc(day)}">
            <div class="form-grid four">
              <div class="field"><label>Ingrediente</label><input name="name" required maxlength="120" placeholder="es. Verdure fresche"></div>
              <div class="field"><label>Quantità</label><input name="qty" required maxlength="40" placeholder="es. 250 g"></div>
              <div class="field"><label>Momento</label><select name="slot"><option value="dinner">Cena</option><option value="pre">Spuntino</option><option value="lunch">Pranzo</option></select></div>
              <div class="field"><label>Categoria</label><select name="category"><option>Verdure e frutta</option><option>Spuntini</option><option>Dispensa</option><option>Proteine</option><option>Altro</option></select></div>
            </div>
            <button class="btn small primary" type="submit">Aggiungi ingrediente</button>
          </form>
        </details>
      </div>
    </section>`;
  }).join("")}</div>
  <div class="view-foot"><p class="subtle">È il "come previsto" proposto nei promemoria. Le cene lun–ven usano il secondo del lavoro.</p><div class="button-row"><button class="btn primary small" data-generate-list>${icon("sparkles", "sm")}Genera lista</button><button class="btn small" data-reset-meals>${icon("rotate-ccw", "sm")}Ripristina il piano iniziale</button></div></div>`;
}

function templates() {
  const slot = SLOTS[ui.slot] ? ui.slot : "lunch";
  const items = app.templates.filter((t) => t.slot === slot);
  const sources = (cur) => Object.entries(SOURCE_LABEL).map(([k, l]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${l}</option>`).join("");
  return panel(
    `${icon("sparkles")}Pasti abituali`,
    `${tabs(Object.entries(SLOTS).map(([k, l]) => [k, l, null, app.templates.filter((t) => t.slot === k).length]), slot, "Momento del giorno", "tpl-slot")}
    ${items.length
      ? `<div class="tpl-list">${items.map((t) => `<form class="tpl-row" data-tpl-form="${esc(t.id)}"><input name="name" value="${esc(t.name)}" maxlength="120" aria-label="Nome"><input name="kcal" inputmode="numeric" value="${esc(t.kcal ?? "")}" placeholder="kcal" aria-label="Calorie"><input name="protein_g" inputmode="numeric" value="${esc(t.protein_g ?? "")}" placeholder="prot. g" aria-label="Proteine"><select name="nutrition_source" aria-label="Fonte">${sources(t.nutrition_source)}</select><input type="hidden" name="slot" value="${esc(t.slot)}"><input type="hidden" name="position" value="${esc(t.position)}"><button class="btn small" type="submit">Salva</button><button type="button" class="icon-btn" data-del-tpl="${esc(t.id)}" aria-label="Elimina">${icon("trash-2", "sm")}</button>${t.nutrition_note ? `<small class="tpl-note">${esc(t.nutrition_note)}</small>` : ""}</form>`).join("")}</div>`
      : empty("Nessun pasto abituale", "Aggiungine uno qui sotto.")}
    <details class="free"><summary>${icon("plus", "sm")}Nuovo pasto abituale</summary>
      <form id="tpl-new" class="stack"><div class="form-grid four"><div class="field"><label for="tn-name">Nome</label><input id="tn-name" name="name" required maxlength="120" placeholder="es. Mandorle (30 g)"></div><div class="field"><label for="tn-kcal">Calorie (facoltativo)</label><input id="tn-kcal" name="kcal" inputmode="numeric"></div><div class="field"><label for="tn-prot">Proteine g (facoltativo)</label><input id="tn-prot" name="protein_g" inputmode="numeric"></div><div class="field"><label for="tn-src">Fonte dei valori</label><select id="tn-src" name="nutrition_source">${sources("")}</select></div></div><input type="hidden" name="slot" value="${esc(slot)}"><button class="btn primary" type="submit">${icon("plus", "sm")}Aggiungi a ${esc(SLOTS[slot].toLowerCase())}</button></form>
    </details>
    <p class="subtle">Scelte rapide nei promemoria. I valori iniziali sono stime generiche: con l'etichetta in mano, correggili.</p>`,
  );
}

export function render() {
  const body = ui.tab === "plan" ? plan() : ui.tab === "templates" ? templates() : diary();
  return `<div class="view-bar">${viewTabs()}<button class="btn primary" data-add-log="${isoDate()}">${icon("plus", "sm")}Pasto</button></div>${body}`;
}

const optNum = (v) => (String(v ?? "").trim() === "" ? null : num(String(v).replace(",", ".")));

async function saveTemplate(id, data) {
  const body = {
    slot: data.slot, name: data.name.trim(), kcal: optNum(data.kcal), protein_g: optNum(data.protein_g),
    nutrition_source: data.nutrition_source, position: num(data.position, app.templates.length),
  };
  if (!body.name) return toast("Inserisci un nome"), false;
  try {
    await request(`/api/v1/meal-templates/${encodeURIComponent(id)}`, { method: "PUT", body });
    await refreshDaily();
    toast("Pasto abituale salvato");
  } catch (e) {
    toast("Non salvato: " + e.message);
  }
  return true;
}

export async function onClick(t) {
  if (t.dataset.tab) return (ui.tab = t.dataset.tab), true;
  if (t.dataset.day) return (ui.day = t.dataset.day), true;
  if (t.dataset.planDay) return (ui.planDay = num(t.dataset.planDay)), true;
  if (t.dataset.tplSlot) return (ui.slot = t.dataset.tplSlot), true;
  if (t.dataset.weekShift) {
    ui.weekOffset = Math.min(0, ui.weekOffset + num(t.dataset.weekShift));
    return true;
  }
  if (t.dataset.addLog) {
    openComposer({ date: t.dataset.addLog, slot: t.dataset.addLog === isoDate() ? guessSlot() : "dinner" });
    return false;
  }
  const entry = t.closest?.("[data-edit-log]");
  if (entry && !t.closest("[data-del-log]")) {
    const log = ui.logs?.find((m) => m.id === entry.dataset.editLog);
    if (log) openComposer({ log });
    return false;
  }
  if (t.dataset.delLog) {
    if (!confirm("Eliminare questo pasto dal diario?")) return false;
    enqueue("DELETE", `/api/v1/meal-logs/${encodeURIComponent(t.dataset.delLog)}`);
    await flush();
    ui.loadedFor = null;
    refreshDaily().then(() => app.render()).catch(() => {});
    return true;
  }
  if (t.dataset.delTpl) {
    if (!confirm("Eliminare questo pasto abituale?")) return false;
    await request(`/api/v1/meal-templates/${encodeURIComponent(t.dataset.delTpl)}`, { method: "DELETE" }).catch((e) => toast(e.message));
    await refreshDaily();
    return true;
  }
  if (t.matches("[data-generate-list]")) return openPlanProposal(), false;
  if (t.dataset.delPlanIng) {
    const [day, idx] = t.dataset.delPlanIng.split(":");
    const list = app.state.meals[day]?.items || [];
    list.splice(num(idx), 1);
    persistState();
    return true;
  }
  if (t.matches("[data-reset-meals]")) {
    if (!confirm("Sostituire il piano con i suggerimenti iniziali?")) return false;
    for (const [d, [lunch, pre, dinner]] of Object.entries(MEAL_DEFAULTS)) {
      app.state.meals[d] = { lunch, pre, dinner, items: app.state.meals[d]?.items || [] };
    }
    persistState();
    return true;
  }
  return false;
}

export function onChange(t) {
  if (!t.dataset.mealDay) return false;
  app.state.meals[t.dataset.mealDay] ??= { lunch: "", pre: "", dinner: "", items: [] };
  app.state.meals[t.dataset.mealDay][t.dataset.mealKey] = t.value;
  persistState();
  return false;
}

export async function onSubmit(form, data) {
  if (form.dataset.planIngForm) {
    const day = form.dataset.planIngForm;
    const parsed = parseQty(data.qty);
    if (!parsed.amount || parsed.amount <= 0) return toast("Inserisci una quantità valida (es. 250 g, 2 pz)"), false;
    app.state.meals[day] ??= { lunch: "", pre: "", dinner: "", items: [] };
    app.state.meals[day].items ??= [];
    app.state.meals[day].items.push({
      name: data.name.trim(), amount: parsed.amount, unit: parsed.unit || "g",
      category: data.category || "Altro", slot: data.slot || "dinner",
    });
    if (await persistState()) toast("Ingrediente aggiunto al piano");
    return true;
  }
  if (form.dataset.tplForm) return saveTemplate(form.dataset.tplForm, data);
  if (form.id === "tpl-new") return saveTemplate(`t-${uid().slice(0, 12)}`, data);
  return false;
}
