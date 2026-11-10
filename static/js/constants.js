export const DAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
export const DAYSHORT = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
// Deve coincidere con app/domain.py SCHEDULE.
export const GYM = { Lunedì: "A", Mercoledì: "B", Venerdì: "C" };
export const ROUTINES = {
  A: { day: "Lunedì", focus: "Schiena · spalle · tricipiti · femorali", cardio: "Cyclette" },
  B: { day: "Mercoledì", focus: "Petto · quadricipiti · bicipiti", cardio: "Tapis roulant inclinato" },
  C: { day: "Venerdì", focus: "Spinta · trazione · gambe · polpacci", cardio: "Vogatore" },
};
export const CARDIO_MIN = 10;
// Riferimento del PDF, non obiettivo personalizzato.
export const cardioBpm = (week) => (week <= 4 ? "130–150" : "150–170");
export const PROGRAM_WEEKS = 8;
export const MEAL_DEFAULTS = {
  Lunedì: ["Primo + contorno dal lavoro", "Banana", "Secondo del lavoro + accompagnamento"],
  Martedì: ["Primo + contorno dal lavoro", "Yogurt o frutta", "Secondo del lavoro + verdure"],
  Mercoledì: ["Primo + contorno dal lavoro", "Banana o gallette", "Secondo del lavoro + accompagnamento"],
  Giovedì: ["Primo + contorno dal lavoro", "Frutta o yogurt", "Secondo del lavoro + contorno"],
  Venerdì: ["Primo + contorno dal lavoro", "Banana", "Secondo del lavoro + accompagnamento"],
  Sabato: ["Pasta + ceci o tonno + verdure", "Frutta (facoltativo)", "Pollo + patate + verdure"],
  Domenica: ["Riso + legumi + verdure", "Yogurt (facoltativo)", "Frittata + pane + verdure"],
};
export const todayName = () => DAYS[(new Date().getDay() + 6) % 7];

export const SLOTS = {
  lunch: "Pranzo",
  pre_workout: "Spuntino pre-palestra",
  snack: "Spuntino",
  dinner: "Cena",
  other: "Fuori pasto",
};
// Collegamento tra i pasti del piano ricorrente (blob) e i tipi di pasto del diario.
export const PLAN_KEY = { lunch: "lunch", pre_workout: "pre", snack: "pre", dinner: "dinner" };
export const SOURCE_LABEL = { estimate: "stima", label: "etichetta", manual: "inserito", off: "Open Food Facts" };
