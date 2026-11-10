import test from "node:test";
import assert from "node:assert/strict";
import { countdown, gapFor, nextEvent, pointerY, toMinutes } from "../../static/js/timeline.js";

const marks = [{ min: 780, y: 20 }, { min: 1050, y: 110 }, { min: 1170, y: 160 }];

test("puntatore: interpolato tra un evento e il successivo", () => {
  assert.equal(pointerY(marks, 780), 20);
  assert.equal(pointerY(marks, 915), 65); // a metà tra 13:00 e 17:30
  assert.equal(pointerY(marks, 1110), 135);
});

test("puntatore: prima del primo e dopo l'ultimo evento sporge al massimo di `edge`", () => {
  assert.equal(pointerY(marks, 750, 26), 7); // mezz'ora prima → metà sporgenza
  assert.equal(pointerY(marks, 300, 26), -6);
  assert.equal(pointerY(marks, 1440, 26), 186);
  assert.equal(pointerY([], 600), 0);
});

test("puntatore: due eventi alla stessa ora non dividono per zero", () => {
  assert.equal(pointerY([{ min: 600, y: 10 }, { min: 600, y: 60 }, { min: 660, y: 100 }], 600), 10);
  assert.equal(pointerY([{ min: 540, y: 0 }, { min: 600, y: 10 }, { min: 600, y: 60 }], 600), 60);
});

test("conto alla rovescia in parole", () => {
  assert.equal(countdown(108), "tra 1 h 48");
  assert.equal(countdown(120), "tra 2 h");
  assert.equal(countdown(12.4), "tra 12 min");
  assert.equal(countdown(0.2), "adesso");
  assert.equal(countdown(-25), "da 25 min");
});

test("distanza tra eventi proporzionale al tempo, con limiti", () => {
  assert.equal(gapFor(0), 6);
  assert.equal(gapFor(60), 18);
  assert.equal(gapFor(600), 64);
});

test("prossimo evento: il primo ancora aperto da adesso in poi", () => {
  const items = [
    { time: "13:00", state: "done" }, { time: "17:30", state: "pending" },
    { time: "19:30", state: "snoozed" }, { time: "22:30", state: "pending" },
  ];
  assert.equal(nextEvent(items, toMinutes("14:00")).time, "17:30");
  assert.equal(nextEvent(items, toMinutes("18:00")).time, "19:30");
  assert.equal(nextEvent(items, toMinutes("23:00")), null);
});
