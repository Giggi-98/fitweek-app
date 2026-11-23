process.env.TZ = "Europe/Rome"; // giorni e orari locali come sul telefono dell'utente
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDb } from "../../static/js/local.js";
import { averageByDay, healthDayWrites, healthDays, heartChanged, heartCurve, heartSummary, setPeaks, heartWindows, importStart, liveHeart, MIN_HEART_SAMPLES, nightsFromSessions, restingByDay, sleepWrites, stepsByDay, weightWrites } from "../../static/js/health.js";

const stage = (start, end, s) => ({ start, end, stage: s });

test("una notte per giorno di risveglio, la sessione più lunga, con i minuti per fase in ora locale", () => {
  const main = { start: "2026-11-09T23:20:00Z", end: "2026-11-10T06:40:00Z", stages: [
    stage("2026-11-09T23:20:00Z", "2026-11-10T00:40:00Z", "light"), stage("2026-11-10T00:40:00Z", "2026-11-10T02:00:00Z", "deep"),
    stage("2026-11-10T02:00:00Z", "2026-11-10T02:10:00Z", "awake"), stage("2026-11-10T02:10:00Z", "2026-11-10T06:40:00Z", "rem"),
    stage("2026-11-10T06:40:00Z", "2026-11-10T06:40:00Z", "out_of_bed")] };
  const nap = { start: "2026-11-10T14:00:00Z", end: "2026-11-10T14:30:00Z", stages: [] };
  const plain = { start: "2026-11-10T23:55:00Z", end: "2026-11-11T06:00:00Z", stages: [] };
  assert.deepEqual(nightsFromSessions([nap, main, plain]), [
    { date: "2026-11-10", body: { bed_time: "00:20", wake_time: "07:40", source: "health_connect", note: "", deep_min: 80, light_min: 80, rem_min: 270, awake_min: 10 } },
    { date: "2026-11-11", body: { bed_time: "00:55", wake_time: "07:00", source: "health_connect", note: "", deep_min: null, light_min: null, rem_min: null, awake_min: null } },
  ]);
});

test("solo le notti cambiate e mai quelle decise dall'utente", () => {
  const nights = nightsFromSessions([{ start: "2026-11-09T23:20:00Z", end: "2026-11-10T06:40:00Z", stages: [] }, { start: "2026-11-10T23:00:00Z", end: "2026-11-11T06:00:00Z", stages: [] },
    { start: "2026-11-11T23:00:00Z", end: "2026-11-12T06:00:00Z", stages: [] }]);
  const db = normalizeDb({ sleep_owned: ["2026-11-11"], sleep_logs: [{ date: "2026-11-10", ...nights[0].body }] });
  assert.deepEqual(sleepWrites(nights, db).map((n) => n.date), ["2026-11-12"]);
});

test("passi, battito a riposo, HRV e SpO2 uniti per giorno; l'ultima misura a riposo; invio solo se cambiano", () => {
  const resting = restingByDay([{ time: "2026-11-10T20:00:00Z", bpm: 61.4 }, { time: "2026-11-10T05:00:00Z", bpm: 66 }, { time: "2026-11-11T05:00:00Z", bpm: 63 }]);
  const hrv = averageByDay([{ time: "2026-11-10T03:00:00Z", value: 40 }, { time: "2026-11-10T04:00:00Z", value: 51 }]);
  const empty = normalizeDb({});
  const days = healthDays({ steps: stepsByDay([{ date: "2026-11-09", steps: 7000 }, { date: "2026-11-10", steps: 9100 }]), resting_hr: resting, hrv_ms: hrv }, empty);
  assert.deepEqual(days, [
    { date: "2026-11-09", body: { steps: 7000, resting_hr: null, hrv_ms: null, spo2: null } },
    { date: "2026-11-10", body: { steps: 9100, resting_hr: 61, hrv_ms: 46, spo2: null } },
    { date: "2026-11-11", body: { steps: null, resting_hr: 63, hrv_ms: null, spo2: null } },
  ]);
  const db = normalizeDb({ health_days: [{ date: "2026-11-09", steps: 7000, resting_hr: null, hrv_ms: null, spo2: null }, { date: "2026-11-10", steps: 8000, resting_hr: 61, hrv_ms: 46, spo2: null }] });
  assert.deepEqual(healthDayWrites(days, db).map((d) => d.date), ["2026-11-10", "2026-11-11"]);
});

test("un tipo non letto (permesso tolto) o senza misure quel giorno non cancella il valore salvato", () => {
  const db = normalizeDb({ health_days: [{ date: "2026-11-10", steps: 8000, resting_hr: 60, hrv_ms: 45, spo2: 97 }] });
  const [day] = healthDays({ steps: stepsByDay([{ date: "2026-11-10", steps: 8200 }]), hrv_ms: new Map() }, db);
  assert.deepEqual(day.body, { steps: 8200, resting_hr: 60, hrv_ms: 45, spo2: 97 });
});

test("una seduta finita da meno di un giorno si rilegge anche con il battito già salvato; si invia solo se cambia", () => {
  const done = { status: "done", started_at: "2026-11-09T18:30:00Z", ended_at: "2026-11-09T20:00:00Z", heart: { avg_bpm: 120, max_bpm: 150, samples: 40, curve: [[0, 120, 150]] } };
  const from = "2026-11-01T00:00:00Z";
  assert.equal(heartWindows([done], from, new Date("2026-11-10T08:00:00Z")).length, 1, "12 ore dopo: si rilegge");
  assert.equal(heartWindows([done], from, new Date("2026-11-11T08:00:00Z")).length, 0, "il giorno dopo: resta com'è");
  assert.equal(heartWindows([{ ...done, heart: { ...done.heart, curve: null } }], from, new Date("2026-11-11T08:00:00Z")).length, 1, "senza curva (1.14–1.16): si rilegge una volta");
  assert.equal(heartChanged(done.heart, { avg_bpm: 120, max_bpm: 150, samples: 40 }), false);
  assert.equal(heartChanged(done.heart, { avg_bpm: 121, max_bpm: 150, samples: 55 }), true);
  assert.equal(heartChanged(null, done.heart), true);
});

test("battito dal vivo: ultimo valore con il suo orario, media e massimo da inizio seduta", () => {
  const start = "2026-11-09T18:30:00Z";
  const samples = [{ time: "2026-11-09T18:20:00Z", bpm: 70 }, { time: "2026-11-09T18:41:00Z", bpm: 140.6 }, { time: "2026-11-09T18:35:00Z", bpm: 110 }];
  assert.deepEqual(liveHeart(samples, start), { bpm: 141, at: "2026-11-09T18:41:00Z", samples: 2, avg: 125, max: 141, curve: [[300, 110, 110], [660, 141, 141]] });
  assert.equal(liveHeart(samples.slice(0, 1), start), null, "prima dell'inizio non conta");
});

test("bilancia: la prima pesata del giorno, solo nei giorni senza pesata, mai una modifica", () => {
  const records = [{ time: "2026-11-10T19:00:00Z", kg: 89.9 }, { time: "2026-11-10T06:30:00Z", kg: 89.44 }, { time: "2026-11-11T06:30:00Z", kg: 89.2 }];
  assert.deepEqual(weightWrites(records, [{ date: "2026-11-11", weight: 89.5 }]), [{ date: "2026-11-10", weight: 89.4 }]);
});

test("battito della seduta: solo i campioni dentro la seduta, e solo se sono abbastanza", () => {
  const sessions = [
    { id: "ok", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-09T20:50:00.000Z", heart: null },
    { id: "has", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-09T21:00:00Z", heart: { avg_bpm: 1, curve: [[0, 1, 1]] } },
    { id: "open", status: "in_progress", started_at: "2026-11-09T19:30:00+01:00", ended_at: null },
    { id: "forgot", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-10T09:00:00Z" },
    { id: "old", status: "done", started_at: "2026-10-01T19:30:00+01:00", ended_at: "2026-10-01T21:00:00Z" },
  ];
  const [w, ...rest] = heartWindows(sessions, "2026-11-01T00:00:00Z", new Date("2026-11-12T00:00:00Z"));
  assert.deepEqual([w.id, rest.length], ["ok", 0]);
  const inside = Array.from({ length: MIN_HEART_SAMPLES }, (_, i) => ({ time: `2026-11-09T19:${String(i + 10).padStart(2, "0")}:00Z`, bpm: 100 + i * 10 }));
  const outside = [{ time: "2026-11-09T18:00:00Z", bpm: 190 }];
  const summary = heartSummary([...outside, ...inside], w);
  assert.deepEqual({ ...summary, curve: summary.curve.length }, { avg_bpm: 145, max_bpm: 190, samples: MIN_HEART_SAMPLES, curve: MIN_HEART_SAMPLES }, "un punto per minuto, nessuno da fuori seduta");
  assert.equal(heartSummary(inside.slice(1), w), null, "troppo pochi campioni");
});

test("finestra: 30 giorni la prima volta, poi dall'ultima importazione meno due giorni", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  assert.equal(importStart(null, now), "2026-10-18T10:00:00.000Z");
  assert.equal(importStart("2026-11-16T10:00:00Z", now), "2026-11-14T10:00:00.000Z");
  assert.equal(importStart("2026-01-01T00:00:00Z", now), "2026-10-18T10:00:00.000Z");
});

test("curva: un punto ogni 30 s con media e massimo; i tratti senza campioni non ci sono", () => {
  const at = (sec) => new Date(Date.parse("2026-11-09T18:30:00Z") + sec * 1000).toISOString();
  const curve = heartCurve([{ time: at(5), bpm: 100 }, { time: at(20), bpm: 111 }, { time: at(95), bpm: 140 }], "2026-11-09T18:30:00Z");
  assert.deepEqual(curve, [[0, 106, 111], [90, 140, 140]]);
});

test("picco di ogni serie: dalla serie prima (al più 3 minuti) a 30 s dopo averla segnata", () => {
  const start = "2026-11-09T18:30:00Z";
  const at = (sec) => new Date(Date.parse(start) + sec * 1000).toISOString();
  const curve = [[0, 90, 95], [60, 120, 150], [120, 110, 118], [240, 100, 104], [300, 130, 161], [600, 140, 175]];
  const sets = [
    { exercise_id: "a1", set_index: 1, completed: true, logged_at: at(100) },
    { exercise_id: "a1", set_index: 2, completed: true, logged_at: at(320) },
    { exercise_id: "a2", set_index: 1, completed: false, logged_at: at(610) },
    { exercise_id: "a2", set_index: 2, completed: true, logged_at: null },
  ];
  assert.deepEqual([...setPeaks(curve, start, sets)], [["a1:1", 150], ["a1:2", 161]]);
  assert.equal(setPeaks(null, start, sets).size, 0, "senza curva nessun picco");
});
