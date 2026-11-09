// Piano pasti settimanale (testo libero, dominio ancora nel blob v1; calendario per data in M4).
import { DAYS, GYM, MEAL_DEFAULTS } from "../constants.js";
import { app, persistState } from "../store.js";
import { panel, sectionTitle } from "../ui.js";
import { esc } from "../util.js";

const SLOTS = [
  ["lunch", "Pranzo · 13:00"],
  ["pre", "Spuntino / pre-palestra"],
  ["dinner", "Cena"],
];

export function render() {
  return (
    sectionTitle("Mangiare bene, senza complicazioni.", "Piano ricorrente della settimana. Modifica un campo e viene salvato.") +
    `<div class="inline-note">Lun–ven: pranzo al lavoro (primo + contorno) e secondo sottovuoto per la cena. Nei giorni di palestra spuntino leggero verso le 18:30 e cena alle 22:15–22:30.</div>
    <div class="grid3">${DAYS.map((day) => {
      const m = app.state.meals[day] || {};
      return `<section class="meal-card"><h3>${esc(day)} ${GYM[day] ? `<span class="pill accent">Palestra ${GYM[day]}</span>` : '<span class="pill">Riposo</span>'}</h3>${SLOTS.map(
        ([k, label]) =>
          `<div class="field"><label for="meal-${esc(day)}-${k}">${label}</label><textarea id="meal-${esc(day)}-${k}" rows="2" maxlength="1000" data-meal-day="${esc(day)}" data-meal-key="${k}">${esc(m[k] || "")}</textarea></div>`,
      ).join("")}</section>`;
    }).join("")}</div>
    ${panel(
      "Linee guida",
      `<div class="summary-list"><div class="summary-row"><i>1</i><div><strong>Non forzare la colazione</strong><small>Conta la giornata nel suo insieme, non l'orario dei pasti.</small></div></div><div class="summary-row"><i>2</i><div><strong>Proteine distribuite</strong><small>Primo e contorno ne contengono poche: yogurt, legumi, uova o tonno aiutano.</small></div></div><div class="summary-row"><i>3</i><div><strong>Weekend semplice</strong><small>Priorità alle cene con alimenti già in casa. Esempi, non dosi prescritte.</small></div></div></div>
      <div class="spacer12"></div><button class="btn small" data-reset-meals>Ripristina i suggerimenti iniziali</button>`,
    )}`
  );
}

export async function onClick(t) {
  if (!t.matches("[data-reset-meals]")) return false;
  if (!confirm("Sostituire tutti i pasti pianificati con i suggerimenti iniziali?")) return false;
  for (const [d, [lunch, pre, dinner]] of Object.entries(MEAL_DEFAULTS)) app.state.meals[d] = { lunch, pre, dinner };
  persistState();
  return true;
}

export function onChange(t) {
  if (!t.dataset.mealDay) return false;
  app.state.meals[t.dataset.mealDay] ??= { lunch: "", pre: "", dinner: "" };
  app.state.meals[t.dataset.mealDay][t.dataset.mealKey] = t.value;
  persistState();
  return false;
}
