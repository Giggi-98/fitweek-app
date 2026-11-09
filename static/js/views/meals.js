// Pasti: diario (cosa hai mangiato), piano ricorrente, pasti abituali con valori stimati.
import { request } from "../api.js";
import { DAYS, GYM, MEAL_DEFAULTS, SLOTS, SOURCE_LABEL } from "../constants.js";
import { icon } from "../icons.js";
import { openComposer } from "../composer.js";
import { guessSlot } from "../reminders.js";
import { app, persistState, refreshDaily } from "../store.js";
import { empty, panel, sectionTitle, toast } from "../ui.js";
import { esc, fmtDate, fmtNum, isoDate, num, uid } from "../util.js";
import { enqueue, flush } from "../workout/queue.js";

const ui = { tab: "diary", weekOffset: 0, logs: null, loadedFor: null };
// Un pasto registrato da un promemoria invalida il diario in cache.
window.addEventListener("fitweek:changed", () => (ui.loadedFor = null));
const PLAN_SLOTS = [
  ["lunch", "Pranzo · 13:00"],
  ["pre", "Spuntino / pre-palestra"],
  ["dinner", "Cena"],
];

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
const tabs = () =>
  `<div class="segmented" role="tablist">${[["diary", "Diario"], ["plan", "Piano"], ["templates", "Abituali"]]
    .map(([k, l]) => `<button class="chip ${ui.tab === k ? "active" : ""}" role="tab" aria-selected="${ui.tab === k}" data-tab="${k}">${l}</button>`)
    .join("")}</div>`;

const kcalLabel = (m) =>
  m.kcal != null ? `${m.nutrition_source === "estimate" ? "~" : ""}${fmtNum(m.kcal, 0)} kcal${m.protein_g != null ? ` · ${fmtNum(m.protein_g, 0)} g prot.` : ""} · ${SOURCE_LABEL[m.nutrition_source] || "stima"}` : "senza valori";

function diary() {
  const days = weekDays(ui.weekOffset);
  if (ui.loadedFor !== days[0]) {
    loadLogs().then(() => app.render()).catch((e) => toast("Diario non disponibile: " + e.message));
    return '<p class="subtle">Caricamento…</p>';
  }
  const today = isoDate();
  return `<div class="week-nav"><button class="icon-btn" data-week-shift="-1" aria-label="Settimana precedente">${icon("chevron-left")}</button><strong>${esc(fmtDate(days[0]))} – ${esc(fmtDate(days[6]))}</strong><button class="icon-btn" data-week-shift="1" ${ui.weekOffset >= 0 ? "disabled" : ""} aria-label="Settimana successiva">${icon("chevron-right")}</button></div>
  <p class="subtle">Le calorie sono <strong>stime teoriche</strong> (pasti abituali o valori inseriti da te), non misure né obiettivi.</p>
  <div class="day-grid">${days
    .filter((d) => d <= today)
    .reverse()
    .map((d) => {
      const logs = ui.logs.filter((m) => m.date === d);
      const eaten = logs.filter((m) => m.status === "eaten");
      const kcal = eaten.filter((m) => m.kcal != null).reduce((s, m) => s + m.kcal, 0);
      const missing = eaten.filter((m) => m.kcal == null).length;
      return panel(
        `${esc(fmtDate(d))}${d === today ? " · oggi" : ""}`,
        `${logs.length ? logs.map((m) => `<div class="entry ${m.status} clickable" data-edit-log="${esc(m.id)}" role="button" tabindex="0" aria-label="Modifica pasto"><div class="entry-main"><span class="slot-ic">${icon(SLOT_ICON[m.slot] || "utensils")}</span><div><div class="entry-title">${m.status === "skipped" ? "Saltato" : esc(m.description || "—")}</div><div class="entry-sub">${esc(SLOTS[m.slot] || m.slot)}${m.status === "skipped" ? "" : ` · ${esc(kcalLabel(m))}`}</div></div></div><button type="button" class="icon-btn" data-del-log="${esc(m.id)}" aria-label="Elimina">${icon("trash-2", "sm")}</button></div>`).join("") : '<p class="subtle">Niente registrato.</p>'}
        <div class="day-foot"><span>${eaten.length ? `Totale teorico <span class="kcal">~${fmtNum(kcal, 0)} kcal</span>${missing ? ` · ${missing} senza valori` : ""}` : ""}</span><button class="btn small" data-add-log="${esc(d)}">${icon("plus", "sm")}Pasto</button></div>`,
      );
    })
    .join("")}</div>`;
}

function plan() {
  return `<div class="inline-note">Piano ricorrente: è il "come previsto" proposto nei promemoria. Lun–ven pranzo al lavoro e secondo per cena.</div>
  <div class="grid3">${DAYS.map((day) => {
    const m = app.state.meals[day] || {};
    return `<section class="meal-card"><h3>${esc(day)} ${GYM[day] ? `<span class="pill accent">Palestra ${GYM[day]}</span>` : ""}</h3>${PLAN_SLOTS.map(
      ([k, label]) =>
        `<div class="field"><label for="meal-${esc(day)}-${k}">${label}</label><textarea id="meal-${esc(day)}-${k}" rows="2" maxlength="1000" data-meal-day="${esc(day)}" data-meal-key="${k}">${esc(m[k] || "")}</textarea></div>`,
    ).join("")}</section>`;
  }).join("")}</div>
  <button class="btn small" data-reset-meals>Ripristina il piano iniziale</button>`;
}

function templates() {
  const bySlot = Object.keys(SLOTS).map((slot) => [slot, app.templates.filter((t) => t.slot === slot)]);
  return `<p class="subtle">I pasti abituali compaiono come scelte rapide nei promemoria. I valori iniziali sono <strong>stime generiche</strong>: se hai l'etichetta, correggili e scegli la fonte "etichetta".</p>
  ${bySlot
    .map(([slot, items]) =>
      panel(
        esc(SLOTS[slot]),
        items.length
          ? items.map((t) => `<form class="tpl-row" data-tpl-form="${esc(t.id)}"><input name="name" value="${esc(t.name)}" maxlength="120" aria-label="Nome"><input name="kcal" inputmode="numeric" value="${esc(t.kcal ?? "")}" placeholder="kcal" aria-label="Calorie"><input name="protein_g" inputmode="numeric" value="${esc(t.protein_g ?? "")}" placeholder="prot. g" aria-label="Proteine"><select name="nutrition_source" aria-label="Fonte">${Object.entries(SOURCE_LABEL).map(([k, l]) => `<option value="${k}" ${t.nutrition_source === k ? "selected" : ""}>${l}</option>`).join("")}</select><input type="hidden" name="slot" value="${esc(t.slot)}"><input type="hidden" name="position" value="${esc(t.position)}"><button class="btn small" type="submit">Salva</button><button type="button" class="icon-btn" data-del-tpl="${esc(t.id)}" aria-label="Elimina">${icon("trash-2", "sm")}</button>${t.nutrition_note ? `<small class="tpl-note">${esc(t.nutrition_note)}</small>` : ""}</form>`).join("")
          : empty("Nessun pasto abituale", ""),
      ),
    )
    .join("")}
  ${panel(
    "Nuovo pasto abituale",
    `<form id="tpl-new" class="stack"><div class="form-grid"><div class="field"><label for="tn-name">Nome</label><input id="tn-name" name="name" required maxlength="120" placeholder="es. Mandorle (30 g)"></div><div class="field"><label for="tn-slot">Momento</label><select id="tn-slot" name="slot">${Object.entries(SLOTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div><div class="field"><label for="tn-kcal">Calorie (facoltativo)</label><input id="tn-kcal" name="kcal" inputmode="numeric"></div><div class="field"><label for="tn-prot">Proteine g (facoltativo)</label><input id="tn-prot" name="protein_g" inputmode="numeric"></div><div class="field"><label for="tn-src">Fonte dei valori</label><select id="tn-src" name="nutrition_source">${Object.entries(SOURCE_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div></div><button class="btn primary" type="submit">+ Aggiungi</button></form>`,
  )}`;
}

export function render() {
  const body = ui.tab === "plan" ? plan() : ui.tab === "templates" ? templates() : diary();
  return sectionTitle("Cosa hai mangiato", "Un tocco per registrare; le calorie teoriche le calcola l'app.", `<button class="btn primary" data-add-log="${isoDate()}">${icon("plus", "sm")}Pasto</button>`) + tabs() + body;
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
  if (t.matches("[data-reset-meals]")) {
    if (!confirm("Sostituire il piano con i suggerimenti iniziali?")) return false;
    for (const [d, [lunch, pre, dinner]] of Object.entries(MEAL_DEFAULTS)) app.state.meals[d] = { lunch, pre, dinner };
    persistState();
    return true;
  }
  return false;
}

export function onChange(t) {
  if (!t.dataset.mealDay) return false;
  app.state.meals[t.dataset.mealDay] ??= { lunch: "", pre: "", dinner: "" };
  app.state.meals[t.dataset.mealDay][t.dataset.mealKey] = t.value;
  persistState();
  return false;
}

export async function onSubmit(form, data) {
  if (form.dataset.tplForm) return saveTemplate(form.dataset.tplForm, data);
  if (form.id === "tpl-new") return saveTemplate(`t-${uid().slice(0, 12)}`, data);
  return false;
}
