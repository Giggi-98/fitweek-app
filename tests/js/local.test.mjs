import test from "node:test";
import assert from "node:assert/strict";
import { applyWrite, mealTotals, normalizeDb, readLocal, withPending } from "../../static/js/local.js";

const MON = "2026-11-09"; // lunedì: giornata A
const reminder = (id, time, extra) => ({ id, weekday: 0, time, kind: "meal", slot: null, title: id, action: "none", enabled: true, ...extra });
const base = () => normalizeDb({
  reminders: [
    reminder("r-lunch", "13:00", { slot: "lunch", action: "log_meal" }),
    reminder("r-gym", "19:15", { kind: "workout", action: "start_workout" }),
    reminder("r-dinner", "22:30", { slot: "dinner", action: "log_meal" }),
    reminder("r-bed", "23:30", { kind: "sleep" }),
    reminder("r-off", "08:00", { enabled: false }),
    reminder("r-tue", "08:00", { weekday: 1 }),
  ],
  foods: [{ id: "f-pasta", category: "primo", name: "Pasta", kcal: 330, protein_g: 11, nutrition_source: "estimate", use_count: 2 }],
  meal_templates: [{ id: "t-banana", slot: "pre_workout", name: "Banana", kcal: 105, protein_g: 1, nutrition_source: "estimate", position: 0 }],
});
const ctx = (over = {}) => ({
  state: { profile: { startDate: "2026-11-02", proteinTarget: 130, kcalTarget: null }, weights: [], routines: { A: [{ id: "a1", sets: [3, 3, 4] }, { id: "a2", sets: [2, 2, 3] }] } },
  sessions: [], now: new Date(`${MON}T14:00:00`), ...over,
});
const put = (db, path, body, at = `${MON}T12:00:00.000Z`) => applyWrite(db, { method: "PUT", path, body, at });
const del = (db, path) => applyWrite(db, { method: "DELETE", path, at: `${MON}T12:30:00.000Z` });
const agenda = (db, c = ctx()) => Object.fromEntries(readLocal(`/api/v1/agenda?date=${MON}`, db, c).items.map((i) => [i.id, i]));
const item = (name, kcal, extra = {}) => ({ name, category: "altro", qty: 1, kcal, protein_g: null, nutrition_source: "manual", takeaway: false, ...extra });

test("pasto composto offline: totali senza le voci portate a casa, descrizione, catalogo che impara", () => {
  const db = put(base(), "/api/v1/meal-logs/m1", { date: MON, slot: "lunch", items: [
    item("Pasta", 330, { protein_g: 11, nutrition_source: "estimate" }), item("Pollo", 220, { protein_g: 30, takeaway: true }), item("Mela", 80, { qty: 2 }),
  ] });
  const [meal] = readLocal(`/api/v1/meal-logs?from=${MON}&to=${MON}`, db, ctx()).items;
  assert.equal(meal.kcal, 490);
  assert.equal(meal.protein_g, 11);
  assert.equal(meal.nutrition_source, "estimate");
  assert.equal(meal.description, "Pasta + 2× Mela · a casa: Pollo");
  assert.deepEqual(readLocal(`/api/v1/takeaway?date=${MON}`, db, ctx()).items.map((i) => i.name), ["Pollo"]);
  const foods = readLocal("/api/v1/foods", db, ctx()).items;
  assert.equal(foods.find((f) => f.name === "Pasta").use_count, 3);
  assert.deepEqual(foods.filter((f) => f.name !== "Pasta").map((f) => [f.name, f.kcal, f.nutrition_source]), [["Mela", 80, "manual"], ["Pollo", 220, "manual"]]);
});

test("fonte dei totali: stima se una voce è stimata, etichetta solo se tutte, altrimenti la meno certa", () => {
  const src = (...sources) => mealTotals(sources.map((s) => item("x", 100, { nutrition_source: s }))).nutrition_source;
  assert.equal(src("label", "label"), "label");
  assert.equal(src("label", "off"), "off");
  assert.equal(src("label", "manual"), "manual");
  assert.equal(src("label", "estimate"), "estimate");
  assert.deepEqual(mealTotals([item("senza valori", null)]), { kcal: null, protein_g: null, nutrition_source: null });
});

test("agenda locale: pasto, pasto saltato, conferme, posticipo, pesata e seduta chiudono il promemoria", () => {
  let db = base();
  assert.deepEqual(Object.keys(agenda(db)), ["r-lunch", "r-gym", "r-dinner", "r-bed"]); // solo oggi, solo attivi, per orario
  assert.equal(agenda(db)["r-lunch"].due, true); // 13:00 è passato alle 14:00
  assert.equal(agenda(db)["r-gym"].due, false);

  db = put(db, "/api/v1/meal-logs/m1", { date: MON, slot: "lunch", description: "Riso" });
  db = put(db, "/api/v1/meal-logs/m2", { date: MON, slot: "dinner", status: "skipped" });
  db = put(db, "/api/v1/reminders/r-bed/ack", { date: MON, status: "dismissed" });
  let a = agenda(db);
  assert.deepEqual([a["r-lunch"].state, a["r-lunch"].detail, a["r-lunch"].meal_id], ["done", "Riso", "m1"]);
  assert.deepEqual([a["r-dinner"].state, a["r-dinner"].meal_id], ["skipped", "m2"]);
  assert.equal(a["r-bed"].state, "skipped");

  db = del(db, "/api/v1/meal-logs/m1");
  assert.equal(agenda(db)["r-lunch"].state, "pending");
  db = put(db, "/api/v1/reminders/r-lunch/ack", { date: MON, status: "snoozed", snooze_minutes: 30 }, new Date(`${MON}T14:00:00`).toISOString());
  assert.deepEqual([agenda(db)["r-lunch"].state, agenda(db)["r-lunch"].due, agenda(db)["r-lunch"].due_at], ["snoozed", false, `${MON}T14:30`]);
  assert.equal(agenda(db, ctx({ now: new Date(`${MON}T14:31:00`) }))["r-lunch"].state, "pending"); // posticipo scaduto

  assert.equal(agenda(db, ctx({ sessions: [{ date: MON, status: "in_progress", sets: [] }] }))["r-gym"].state, "done");
});

test("riepilogo locale: pasti, proteine, sedute e serie previste della settimana del programma", () => {
  let db = put(base(), "/api/v1/meal-logs/m1", { date: MON, slot: "lunch", items: [item("Pasta", 330, { protein_g: 11 })] });
  db = put(db, "/api/v1/meal-logs/m2", { date: MON, slot: "pre_workout", description: "Banana", template_id: "t-banana" });
  db = put(db, "/api/v1/meal-logs/m3", { date: MON, slot: "other", description: "Caffè" });
  db = put(db, "/api/v1/meal-logs/m4", { date: "2026-11-10", slot: "lunch", items: [item("Riso", 434)] });
  db = put(db, `/api/v1/sleep/${MON}`, { bed_time: "23:30", wake_time: "07:00" });
  db = put(db, "/api/v1/sleep/2026-11-10", { bed_time: "00:30", wake_time: "07:30" });
  const sessions = [{ date: MON, status: "done", routine: "A", sets: [{ completed: 1 }, { completed: 1 }, { completed: 0 }] }, { date: "2026-11-11", status: "in_progress", routine: "B", sets: [] }];
  const w = readLocal("/api/v1/weekly-summary", db, ctx({ sessions, state: { ...ctx().state, weights: [{ date: MON, weight: 90 }, { date: "2026-11-10", weight: 89.5 }] } }));
  assert.equal(w.week_start, MON);
  assert.equal(w.program_week, 2);
  const mon = w.days[0];
  assert.deepEqual([mon.meals_eaten, mon.meals_expected, mon.meals_without_values, mon.kcal_estimate, mon.protein_estimate_g], [3, 2, 1, 435, 12]);
  assert.deepEqual(mon.workouts, [{ routine: "A", sets_done: 2, sets_planned: 5 }]);
  assert.equal(mon.sleep.duration_min, 450);
  assert.equal(w.totals.kcal_estimate_avg, 434); // (435 + 434) / 2 = 434,5 → verso il pari, come round() sul server
  assert.deepEqual([w.totals.workouts_done, w.totals.workouts_planned, w.totals.sets_done, w.totals.sets_planned], [1, 1, 2, 5]);
  assert.deepEqual(w.totals.sleep, { nights: 2, duration_avg_min: 435, bedtime_avg: "00:00" });
  assert.deepEqual([w.totals.weight_avg, w.totals.weigh_ins], [89.8, 2]);
  assert.deepEqual(w.targets, { protein_g: 130, kcal: null });
});

test("abituali, catalogo, promemoria, note e spesa: scrivere ed eliminare offline si vede nelle letture", () => {
  let db = base();
  db = put(db, "/api/v1/meal-templates/t-yog", { slot: "snack", name: "Yogurt", kcal: 120, protein_g: 17, nutrition_source: "label", position: 1 });
  db = put(db, "/api/v1/foods/f-skyr", { category: "altro", name: "Skyr", kcal: 100, protein_g: 17 });
  db = put(db, "/api/v1/reminders/r-new", { weekday: 0, time: "17:00", kind: "custom", title: "Acqua", action: "none", enabled: true });
  db = put(db, "/api/v1/reminders/r-lunch", { ...db.reminders[0], time: "13:30" });
  db = put(db, "/api/v1/exercise-notes/a1", { note: " sedile 4 " });
  db = put(db, "/api/v1/grocery-spend/2026-11-11", { amount: 41.5 }); // qualsiasi giorno → lunedì della settimana
  const c = ctx();
  assert.deepEqual(readLocal("/api/v1/meal-templates", db, c).items.map((t) => t.name), ["Banana", "Yogurt"]);
  assert.equal(readLocal("/api/v1/foods", db, c).items.find((f) => f.id === "f-skyr").nutrition_source, "estimate");
  assert.deepEqual(readLocal("/api/v1/reminders", db, c).items.filter((r) => r.weekday === 0 && r.enabled).map((r) => `${r.time} ${r.id}`),
    ["13:30 r-lunch", "17:00 r-new", "19:15 r-gym", "22:30 r-dinner", "23:30 r-bed"]);
  assert.deepEqual(readLocal("/api/v1/exercise-notes", db, c).items.map((n) => n.note), ["sedile 4"]);
  assert.deepEqual(readLocal("/api/v1/grocery-spend", db, c).items, [{ note: "", amount: 41.5, week_start: MON }]);

  db = put(db, "/api/v1/reminders/r-new/ack", { date: MON, status: "done" });
  for (const path of ["/api/v1/meal-templates/t-yog", "/api/v1/foods/f-skyr", "/api/v1/reminders/r-new", `/api/v1/grocery-spend/${MON}`]) db = del(db, path);
  assert.deepEqual(readLocal("/api/v1/meal-templates", db, c).items.map((t) => t.id), ["t-banana"]);
  assert.equal(readLocal("/api/v1/foods", db, c).items.some((f) => f.id === "f-skyr"), false);
  assert.equal(db.reminders.some((r) => r.id === "r-new"), false);
  assert.deepEqual(db.reminder_acks, []); // le conferme del promemoria eliminato spariscono con lui
  assert.deepEqual(readLocal("/api/v1/grocery-spend", db, c).items, []);
});

test("la coda si riapplica in ordine sulla copia del server; percorsi di altri domini non la toccano", () => {
  const ops = [
    { method: "PUT", path: "/api/v1/meal-logs/m1", body: { date: MON, slot: "lunch", description: "Riso" }, at: `${MON}T12:00:00.000Z` },
    { method: "PUT", path: "/api/v1/workout-sessions/s1/sets/a1/1", body: { kg: 40 }, at: `${MON}T12:01:00.000Z` },
    { method: "DELETE", path: "/api/v1/meal-logs/m1", at: `${MON}T12:02:00.000Z` },
    { method: "PUT", path: "/api/v1/meal-logs/m2", body: { date: MON, slot: "dinner", description: "Pollo" }, at: `${MON}T12:03:00.000Z` },
  ];
  const db = withPending({ reminders: base().reminders }, ops);
  assert.deepEqual(db.meal_logs.map((m) => m.id), ["m2"]);
  assert.equal(readLocal("/api/v1/today", db, ctx()), undefined); // non ricostruibile qui: vale la vecchia risposta
});
