process.env.TZ = "Europe/Rome"; // giorni e orari locali come sul telefono dell'utente
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDb } from "../../static/js/local.js";
import { healthDayWrites, healthDays, heartSummary, heartWindows, importStart, MIN_HEART_SAMPLES, nightsFromSessions, restingByDay, sleepWrites } from "../../static/js/health.js";

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

test("passi e battito a riposo uniti per giorno; l'ultima misura del giorno; invio solo se cambiano", () => {
  const resting = restingByDay([{ time: "2026-11-10T20:00:00Z", bpm: 61.4 }, { time: "2026-11-10T05:00:00Z", bpm: 66 }, { time: "2026-11-11T05:00:00Z", bpm: 63 }]);
  const days = healthDays([{ date: "2026-11-09", steps: 7000 }, { date: "2026-11-10", steps: 9100 }], resting);
  assert.deepEqual(days, [
    { date: "2026-11-09", body: { steps: 7000, resting_hr: null } },
    { date: "2026-11-10", body: { steps: 9100, resting_hr: 61 } },
    { date: "2026-11-11", body: { steps: null, resting_hr: 63 } },
  ]);
  const db = normalizeDb({ health_days: [{ date: "2026-11-09", steps: 7000, resting_hr: null }, { date: "2026-11-10", steps: 8000, resting_hr: 61 }] });
  assert.deepEqual(healthDayWrites(days, db).map((d) => d.date), ["2026-11-10", "2026-11-11"]);
});

test("battito della seduta: solo i campioni dentro la seduta, e solo se sono abbastanza", () => {
  const sessions = [
    { id: "ok", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-09T20:50:00.000Z", heart: null },
    { id: "has", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-09T21:00:00Z", heart: { avg_bpm: 1 } },
    { id: "open", status: "in_progress", started_at: "2026-11-09T19:30:00+01:00", ended_at: null },
    { id: "forgot", status: "done", started_at: "2026-11-09T19:30:00+01:00", ended_at: "2026-11-10T09:00:00Z" },
    { id: "old", status: "done", started_at: "2026-10-01T19:30:00+01:00", ended_at: "2026-10-01T21:00:00Z" },
  ];
  const [w, ...rest] = heartWindows(sessions, "2026-11-01T00:00:00Z");
  assert.deepEqual([w.id, rest.length], ["ok", 0]);
  const inside = Array.from({ length: MIN_HEART_SAMPLES }, (_, i) => ({ time: `2026-11-09T19:${String(i + 10).padStart(2, "0")}:00Z`, bpm: 100 + i * 10 }));
  const outside = [{ time: "2026-11-09T18:00:00Z", bpm: 190 }];
  assert.deepEqual(heartSummary([...outside, ...inside], w), { avg_bpm: 145, max_bpm: 190, samples: MIN_HEART_SAMPLES });
  assert.equal(heartSummary(inside.slice(1), w), null, "troppo pochi campioni");
});

test("finestra: 30 giorni la prima volta, poi dall'ultima importazione meno due giorni", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  assert.equal(importStart(null, now), "2026-10-18T10:00:00.000Z");
  assert.equal(importStart("2026-11-16T10:00:00Z", now), "2026-11-14T10:00:00.000Z");
  assert.equal(importStart("2026-01-01T00:00:00Z", now), "2026-10-18T10:00:00.000Z");
});
