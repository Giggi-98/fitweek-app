import test from "node:test";
import assert from "node:assert/strict";
import { e1rm, exerciseBests, exerciseSessions, exerciseSummary, isWork, repRange, setRecords, setTarget, weeklyMuscleSets, workSets } from "../../static/js/workout/calc.js";

const set = (exercise_id, set_index, kg, reps, extra = {}) => ({ exercise_id, set_index, kg, reps, completed: true, kind: "normal", ...extra });
const session = (id, date, sets, extra = {}) => ({ id, date, week: 1, status: "done", routine: "A", sets, ...extra });
const S1 = session("s1", "2026-11-02", [set("a1", 1, 20, 12, { kind: "warmup" }), set("a1", 2, 40, 10), set("a1", 3, 40, 8), set("a2", 1, 15, 10)]);
const S2 = session("s2", "2026-11-09", [set("a1", 1, 42.5, 8), set("a1", 2, 40, 9), set("a1", 3, 40, 9, { completed: false })]);

test("massimale stimato: Epley tra 1 e 12 ripetizioni, mai oltre né senza carico", () => {
  assert.equal(e1rm(100, 1), 100);
  assert.equal(e1rm(40, 10), 53.3);
  assert.equal(e1rm(40, 12), 56);
  assert.equal(e1rm(40, 13), null);
  assert.equal(e1rm(0, 10), null);
  assert.equal(e1rm(40, 0), null);
});

test("serie di lavoro: fatta, con carico e ripetizioni, non di riscaldamento", () => {
  assert.equal(isWork(set("a1", 1, 20, 12, { kind: "warmup" })), false);
  assert.equal(isWork(set("a1", 1, 40, 10, { completed: false })), false);
  assert.equal(isWork(set("a1", 1, null, 10)), false);
  assert.equal(isWork(set("a1", 1, 40, 10, { kind: "drop" })), true);
  assert.equal(isWork({ exercise_id: "a1", set_index: 1, kg: 40, reps: 10, completed: true }), true); // serie registrate prima dei tipi
  assert.deepEqual(workSets(S1, "a1").map((s) => s.set_index), [2, 3]);
});

test("storia dell'esercizio: serie migliore, volume e massimale senza il riscaldamento", () => {
  const [first, second] = exerciseSessions([S2, S1, session("s3", "2026-11-10", [set("a1", 1, 99, 5)], { status: "in_progress" })], "a1");
  assert.deepEqual([first.date, first.top.kg, first.top.reps, first.volume, first.e1rm], ["2026-11-02", 40, 10, 720, 53.3]);
  assert.deepEqual([second.date, second.top.kg, second.volume, second.e1rm], ["2026-11-09", 42.5, 700, 53.8]);
  assert.deepEqual(exerciseSessions([S1], "zz"), []);
});

test("record di una serie: carico, massimale stimato, ripetizioni a parità di carico; mai la prima volta", () => {
  const bests = exerciseBests([S1, S2], "a1", "s2");
  assert.deepEqual([bests.kg, bests.e1rm, bests.volume, bests.repsAt.get(40)], [40, 53.3, 720, 10]);
  assert.deepEqual(setRecords(bests, set("a1", 1, 42.5, 8)), ["kg", "e1rm"]);
  assert.deepEqual(setRecords(bests, set("a1", 1, 40, 11)), ["e1rm", "reps"]);
  assert.deepEqual(setRecords(bests, set("a1", 1, 40, 10)), []);
  assert.deepEqual(setRecords(bests, set("a1", 1, 37.5, 12)), []); // carico mai usato: nessun confronto sulle ripetizioni
  assert.deepEqual(setRecords(bests, set("a1", 1, 60, 10, { kind: "warmup" })), []);
  assert.equal(exerciseBests([S1], "a1", "s1"), null);
  assert.deepEqual(setRecords(null, set("a1", 1, 100, 10)), []);
});

test("riepilogo di un esercizio: confronto con la volta precedente e record, volume compreso", () => {
  const out = exerciseSummary([S1, S2], S2, "a1");
  assert.deepEqual([out.top.kg, out.volume, out.prev.top.kg, out.prev.volume, out.records], [42.5, 700, 40, 720, ["kg", "e1rm"]]);
  const big = session("s9", "2026-11-16", [set("a1", 1, 40, 10), set("a1", 2, 40, 10), set("a1", 3, 40, 10)]);
  assert.deepEqual(exerciseSummary([S1, S2, big], big, "a1").records, ["volume"]);
  assert.equal(exerciseSummary([S1], S1, "a1").prev, null);
  assert.deepEqual(exerciseSummary([S1], S1, "a1").records, []);
  assert.equal(exerciseSummary([S1], S1, "b9"), null);
});

test("obiettivo della serie: una ripetizione in più, poi un passo di carico dal minimo dell'intervallo", () => {
  assert.deepEqual(setTarget({ kg: 40, reps: 8 }, [8, 10], 2.5), { kg: 40, reps: 9, step: "reps" });
  assert.deepEqual(setTarget({ kg: 40, reps: 10 }, [8, 10], 2.5), { kg: 42.5, reps: 8, step: "load" });
  assert.deepEqual(setTarget({ kg: 40, reps: 12 }, [8, 10], 1.25), { kg: 41.25, reps: 8, step: "load" });
  assert.deepEqual(setTarget({ kg: 0, reps: 15 }, [10, 12], 2.5), { kg: 0, reps: 16, step: "reps" }); // corpo libero: solo ripetizioni
  assert.deepEqual(setTarget({ kg: 40, reps: 10 }, [0, 0], 2.5), { kg: 40, reps: 11, step: "reps" }); // intervallo non indicato
  assert.equal(setTarget(null, [8, 10], 2.5), null);
  assert.deepEqual([repRange("8–10"), repRange("10-12"), repRange("12"), repRange("a esaurimento")], [[8, 10], [10, 12], [12, 12], [0, 0]]);
});

test("serie per gruppo muscolare nella settimana: solo serie di lavoro, gruppi non indicati esclusi", () => {
  const muscle = (id) => ({ a1: "Dorsali", a2: "Spalle" }[id] || "");
  const live = session("s3", "2026-11-11", [set("a2", 1, 15, 10), set("zz", 1, 10, 10)], { status: "in_progress" });
  const skipped = session("s4", "2026-11-12", [set("a1", 1, 40, 10)], { status: "skipped" });
  assert.deepEqual(weeklyMuscleSets([S1, S2, live, skipped], "2026-11-09", "2026-11-15", muscle), [{ muscle: "Dorsali", sets: 2 }, { muscle: "Spalle", sets: 1 }]);
});

test("dischi per lato: i più pesanti che ci stanno, con il resto se il carico non si può fare", async () => {
  const { platesPerSide } = await import("../../static/js/workout/calc.js");
  assert.deepEqual(platesPerSide(100), { perSide: [25, 15], rest: 0 });
  assert.deepEqual(platesPerSide(62.5), { perSide: [20, 1.25], rest: 0 });
  assert.deepEqual(platesPerSide(20), { perSide: [], rest: 0 }, "solo il bilanciere");
  assert.deepEqual(platesPerSide(41, 20), { perSide: [10], rest: 0.5 }, "0,5 kg per lato non si possono fare");
  assert.deepEqual(platesPerSide(30, 10), { perSide: [10], rest: 0 }, "bilanciere corto da 10 kg");
  assert.equal(platesPerSide(15, 20), null, "sotto il bilanciere");
});
