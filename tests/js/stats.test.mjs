import test from "node:test";
import assert from "node:assert/strict";
import {
  bestLoads, consistency, exerciseHistory, isRecord, isTransient, mondayOf, movingAverage, niceTicks,
} from "../../static/js/stats.js";

const set = (exercise_id, kg, reps, completed = true) => ({ exercise_id, set_index: 1, kg, reps, completed });
const session = (id, date, week, routine, sets, status = "done") => ({ id, date, week, routine, status, sets });

test("media mobile: finestra di 7 giorni di calendario, non le ultime 7 pesate", () => {
  const avg = movingAverage([
    { date: "2026-11-10", weight: 89 },
    { date: "2026-11-01", weight: 91 },
    { date: "2026-11-03", weight: 90 },
    { date: "2026-11-08", weight: 88 },
  ]);
  assert.deepEqual(avg.map((a) => a.date), ["2026-11-01", "2026-11-03", "2026-11-08", "2026-11-10"]);
  assert.equal(avg[0].value, 91);
  assert.equal(avg[1].value, 90.5);
  assert.equal(avg[2].value, 89); // l'1/11 è uscito dalla finestra (8 − 7 = 1): restano 3/11 e 8/11
  assert.equal(avg[3].n, 2); // 8/11 e 10/11
  assert.equal(avg[3].value, 88.5);
});

test("media mobile: ignora valori non validi e unisce le pesate dello stesso giorno", () => {
  const avg = movingAverage([
    { date: "2026-11-02", weight: 90 },
    { date: "2026-11-02", weight: 89 },
    { date: "2026-11-03", weight: "x" },
  ]);
  assert.equal(avg.length, 1);
  assert.equal(avg[0].value, 89.5);
});

test("media mobile: il cambio dell'ora non sposta i giorni", () => {
  const avg = movingAverage([{ date: "2026-10-24", weight: 90 }, { date: "2026-10-25", weight: 92 }, { date: "2026-10-31", weight: 88 }]);
  assert.equal(avg[2].n, 2); // 25/10 e 31/10; il 24/10 è a 7 giorni esatti, fuori
});

test("storia esercizio: serie più pesante e volume per seduta, in ordine di data", () => {
  const sessions = [
    session("s2", "2026-11-16", 2, "A", [set("a1", 42.5, 8), set("a1", 42.5, 10), set("a2", 20, 12)]),
    session("s1", "2026-11-09", 1, "A", [set("a1", 40, 10), set("a1", 35, 12), set("a1", 60, 5, false)]),
    session("s3", "2026-11-23", 3, "A", [set("a1", 45, 8)], "in_progress"),
    session("s4", "2026-11-11", 1, "B", [set("b1", 30, 10)]),
  ];
  const h = exerciseHistory(sessions, "a1");
  assert.deepEqual(h.map((x) => [x.date, x.kg, x.reps, x.sets]), [["2026-11-09", 40, 10, 2], ["2026-11-16", 42.5, 10, 2]]);
  assert.equal(h[0].volume, 40 * 10 + 35 * 12);
  assert.deepEqual(exerciseHistory(sessions, "zz"), []);
});

test("record: serve un precedente, e la seduta in corso non conta contro se stessa", () => {
  const sessions = [
    session("s1", "2026-11-09", 1, "A", [set("a1", 40, 10), set("a2", null, 12)]),
    session("s2", "2026-11-16", 2, "A", [set("a1", 45, 8)]),
  ];
  const best = bestLoads(sessions, "s2");
  assert.equal(best.get("a1"), 40);
  assert.equal(isRecord(best, "a1", 42.5), true);
  assert.equal(isRecord(best, "a1", 40), false);
  assert.equal(isRecord(best, "a2", 20), false); // nessun carico precedente: prima volta, non record
  assert.equal(isRecord(best, "a1", null), false);
});

test("costanza: fatte, saltate, oggi e future; una seduta recuperata conta per la sua settimana", () => {
  const sessions = [
    session("s1", "2026-11-09", 1, "A", []),
    session("s2", "2026-11-14", 1, "C", []), // recuperata di sabato
    session("s3", "2026-11-16", 2, "A", [], "in_progress"),
  ];
  const c = consistency(sessions, "2026-11-11", "2026-11-18", 2, { 0: "A", 2: "B", 4: "C" });
  assert.deepEqual(c.cells.map((x) => `${x.week}${x.routine}:${x.state}`), [
    "1A:done", "1B:missed", "1C:done", "2A:missed", "2B:today", "2C:upcoming",
  ]);
  assert.equal(c.cells[0].date, "2026-11-09"); // l'inizio è riportato al lunedì
  assert.equal(c.done, 2);
  assert.equal(c.due, 5);
});

test("lunedì della settimana", () => {
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
});

test("tacche dell'asse: passi puliti che coprono i dati", () => {
  assert.deepEqual(niceTicks(88.6, 90.4), [88.5, 89, 89.5, 90, 90.5]);
  assert.deepEqual(niceTicks(40, 52.5), [40, 45, 50, 55]);
  assert.deepEqual(niceTicks(50, 50), [50, 50.5, 51]);
  assert.ok(niceTicks(0, 1000).length <= 6);
});

test("coda: errori passeggeri da ritentare, errori del client da scartare", () => {
  for (const s of [0, 408, 429, 500, 502, 503]) assert.equal(isTransient(s), true, String(s));
  for (const s of [400, 404, 409, 422]) assert.equal(isTransient(s), false, String(s));
});
