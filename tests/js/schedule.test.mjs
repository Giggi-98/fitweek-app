// node --test tests/js/  (eseguito da scripts/check.sh)
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchedule, notificationId } from "../../static/js/schedule.js";

const R = (id, weekday, time, extra = {}) => ({ id, weekday, time, title: id, action: "log_meal", enabled: true, ...extra });
const MON_1200 = new Date(2026, 10, 9, 12, 0); // lunedì 9/11/2026 12:00 ora locale

test("programma solo eventi futuri, per i giorni giusti", () => {
  const plan = buildSchedule([R("pranzo", 0, "13:00"), R("colazione", 0, "08:00"), R("mar", 1, "13:00")], new Map(), MON_1200, 7);
  assert.deepEqual(plan.map((p) => `${p.extra.reminderId}@${p.extra.date} ${p.at.getHours()}:${p.at.getMinutes()}`),
    ["pranzo@2026-11-09 13:0", "mar@2026-11-10 13:0"]);
});

test("14 giorni → due occorrenze per promemoria settimanale", () => {
  const plan = buildSchedule([R("mar", 1, "08:00")], new Map(), MON_1200);
  assert.deepEqual(plan.map((p) => p.extra.date), ["2026-11-10", "2026-11-17"]);
});

test("oggi: salta quelli già fatti o saltati, non i futuri", () => {
  const rs = [R("a", 0, "18:30"), R("b", 0, "22:30"), R("c", 0, "23:30")];
  const plan = buildSchedule(rs, new Map([["a", "done"], ["b", "skipped"], ["c", "snoozed"]]), MON_1200, 1);
  assert.deepEqual(plan.map((p) => p.extra.reminderId), ["c"]);
  const next = buildSchedule(rs, new Map([["a", "done"]]), MON_1200, 8).filter((p) => p.extra.date === "2026-11-16");
  assert.equal(next.length, 3, "la settimana dopo suonano tutti");
});

test("disattivati esclusi; id interi positivi, stabili e distinti", () => {
  assert.equal(buildSchedule([R("x", 0, "13:00", { enabled: false })], new Map(), MON_1200).length, 0);
  const a = notificationId("r0-1300-meal", "2026-11-09");
  assert.equal(a, notificationId("r0-1300-meal", "2026-11-09"));
  assert.notEqual(a, notificationId("r0-1300-meal", "2026-11-16"));
  assert.ok(Number.isInteger(a) && a > 0 && a < 2 ** 31);
});

test("testo della notifica in base all'azione", () => {
  const [p] = buildSchedule([R("w", 0, "13:00", { action: "log_weight" })], new Map(), MON_1200, 1);
  assert.match(p.body, /peso/);
});
