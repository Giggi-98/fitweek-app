import test from "node:test";
import assert from "node:assert/strict";
import { localAgenda, localToday, mergeState, programWeek } from "../../static/js/sync.js";

const state = (over = {}) => ({
  profile: { name: "", budget: 50, proteinTarget: null },
  weights: [{ id: "w1", date: "2026-11-01", weight: 90 }],
  groceries: [{ id: "g1", name: "Banane", checked: false }, { id: "g2", name: "Riso", checked: false }],
  inventory: [],
  meals: { Lunedì: { lunch: "a", pre: "b", dinner: "c" } },
  routines: { A: [{ id: "a1" }] },
  ...over,
});

test("fusione: modifiche solo locali o solo sul server passano intatte", () => {
  const base = state();
  const local = state({ weights: [...base.weights, { id: "w2", date: "2026-11-10", weight: 89 }] });
  const server = state({ inventory: [{ id: "i1", name: "Pasta" }] });
  const out = mergeState(base, local, server);
  assert.deepEqual(out.weights.map((w) => w.id), ["w1", "w2"]);
  assert.deepEqual(out.inventory, [{ id: "i1", name: "Pasta" }]);
  assert.deepEqual(out.groceries, base.groceries);
});

test("fusione: stesso elenco cambiato da entrambe le parti → nessuna pesata persa", () => {
  const base = state();
  const local = state({ weights: [...base.weights, { id: "w-tel", date: "2026-11-10", weight: 89 }] });
  const server = state({ weights: [...base.weights, { id: "w-pc", date: "2026-11-09", weight: 89.5 }] });
  assert.deepEqual(mergeState(base, local, server).weights.map((w) => w.id), ["w1", "w-pc", "w-tel"]);
});

test("fusione: eliminazioni e modifiche locali valgono, il resto segue il server", () => {
  const base = state();
  const local = state({ groceries: [{ id: "g2", name: "Riso", checked: true }] }); // g1 tolto, g2 spuntato
  const server = state({ groceries: [{ id: "g1", name: "Banane bio", checked: false }, { id: "g2", name: "Riso", checked: false }, { id: "g3", name: "Uova", checked: false }] });
  assert.deepEqual(mergeState(base, local, server).groceries, [
    { id: "g2", name: "Riso", checked: true },
    { id: "g3", name: "Uova", checked: false },
  ]);
});

test("fusione: una voce modificata solo sul server non viene riportata indietro", () => {
  const base = state();
  const local = state({ groceries: [...base.groceries, { id: "g9", name: "Pane", checked: false }] });
  const server = state({ groceries: [{ id: "g1", name: "Banane", checked: true }, base.groceries[1]] });
  const out = mergeState(base, local, server).groceries;
  assert.equal(out.find((g) => g.id === "g1").checked, true);
  assert.ok(out.some((g) => g.id === "g9"));
});

test("fusione: profilo e piano pasti campo per campo", () => {
  const base = state();
  const local = state({ profile: { ...base.profile, proteinTarget: 130 }, meals: { Lunedì: { lunch: "a", pre: "banana", dinner: "c" } } });
  const server = state({ profile: { ...base.profile, budget: 45 }, meals: { Lunedì: { lunch: "a", pre: "b", dinner: "c" }, Martedì: { lunch: "x", pre: "", dinner: "" } } });
  const out = mergeState(base, local, server);
  assert.deepEqual(out.profile, { name: "", budget: 45, proteinTarget: 130 });
  assert.equal(out.meals.Lunedì.pre, "banana");
  assert.equal(out.meals.Martedì.lunch, "x");
});

test("fusione: non modifica gli oggetti in ingresso", () => {
  const base = state(), local = state({ weights: [] }), server = state();
  const snapshot = JSON.stringify([base, local, server]);
  mergeState(base, local, server);
  assert.equal(JSON.stringify([base, local, server]), snapshot);
});

test("settimana del programma come sul server", () => {
  assert.equal(programWeek("2026-11-09", "2026-11-09"), 1);
  assert.equal(programWeek("2026-11-09", "2026-11-15"), 1);
  assert.equal(programWeek("2026-11-09", "2026-11-16"), 2);
  assert.equal(programWeek("2026-11-09", "2026-11-01"), 1);
  assert.equal(programWeek("2026-11-09", "2027-06-01"), 8);
});

test("oggi senza rete: un giorno nuovo ricalcola giornata e settimana, la seduta in corso resta", () => {
  const cached = { date: "2026-11-10", weekday: 1, routine: null, program_week: 1, program_weeks: 8, active_session: { id: "s1" }, done_today: [{ id: "x" }] };
  const schedule = { 0: "A", 2: "B", 4: "C" };
  assert.equal(localToday(cached, "2026-11-09", "2026-11-10", schedule), cached);
  const wed = localToday(cached, "2026-11-09", "2026-11-18", schedule);
  assert.deepEqual([wed.date, wed.weekday, wed.routine, wed.program_week], ["2026-11-18", 2, "B", 2]);
  assert.deepEqual(wed.done_today, []);
  assert.equal(wed.active_session.id, "s1");
});

test("agenda senza rete: promemoria attivi del giorno, in ordine, con lo scaduto calcolato sull'ora", () => {
  const reminders = [
    { id: "b", weekday: 2, time: "19:30", enabled: true, title: "Palestra" },
    { id: "a", weekday: 2, time: "13:00", enabled: true, title: "Pranzo" },
    { id: "c", weekday: 2, time: "08:00", enabled: false, title: "Spento" },
    { id: "d", weekday: 3, time: "08:00", enabled: true, title: "Giovedì" },
  ];
  const out = localAgenda(reminders, "2026-11-18", "14:00");
  assert.deepEqual(out.map((i) => [i.id, i.state, i.due]), [["a", "pending", true], ["b", "pending", false]]);
  assert.equal(out[1].due_at, "2026-11-18T19:30");
});
