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
  assert.equal(gapFor(0), 4);
  assert.equal(gapFor(60), 7);
  assert.equal(gapFor(600), 28);
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

// ---- "Adesso": una sola azione, scelta dall'orario e dalla routine reale ----
const { nowAction } = await import("../../static/js/timeline.js");
const ev = (id, time, state = "pending") => ({ id, time, state });
const at = (hhmm) => toMinutes(hhmm);
const gymDay = (done = []) => [ev("pranzo", "13:00"), ev("spuntino", "18:30"), ev("palestra", "19:30"), ev("cena", "22:30"), ev("sonno", "23:45")]
  .map((e) => (done.includes(e.id) ? { ...e, state: "done" } : e));

test("adesso: casi della routine reale", () => {
  const cases = [
    // [descrizione, agenda, ora, id atteso, scaduto?, minuti]
    ["lunedì 18:30, pranzo registrato → spuntino pre-palestra, adesso", gymDay(["pranzo"]), "18:30", "spuntino", true, 0],
    ["mercoledì 22:20, palestra fatta → cena tra 10 minuti", gymDay(["pranzo", "spuntino", "palestra"]), "22:20", "cena", false, 10],
    ["sabato 20:00 → cena tra 30 minuti", [ev("pranzo", "13:30", "done"), ev("cena", "20:30")], "20:00", "cena", false, 30],
    ["martedì 08:00 → pesata, adesso", [ev("pesata", "08:00"), ev("pranzo", "13:00")], "08:00", "pesata", true, 0],
    ["pranzo non registrato da 40 minuti → resta la cosa da fare", gymDay(), "13:40", "pranzo", true, 40],
    ["due scaduti → il più recente", gymDay(), "18:45", "spuntino", true, 15],
    ["posticipato → vale il nuovo orario", [{ id: "pranzo", time: "13:20", state: "snoozed" }], "13:05", "pranzo", false, 15],
  ];
  for (const [name, agenda, clock, id, due, minutes] of cases) {
    const a = nowAction(agenda, at(clock));
    assert.deepEqual(a && [a.item.id, a.due, a.minutes], [id, due, minutes], name);
  }
});

test("adesso: nulla da proporre quando non c'è niente di vicino", () => {
  assert.equal(nowAction(gymDay(), at("10:00")), null); // pranzo tra 3 ore
  assert.equal(nowAction([ev("pranzo", "13:00")], at("16:30")), null); // scaduto da più di 3 ore: non si insiste
  assert.equal(nowAction(gymDay(["pranzo", "spuntino", "palestra", "cena", "sonno"]), at("23:00")), null);
  assert.equal(nowAction([ev("pranzo", "13:00", "skipped")], at("13:10")), null);
  assert.equal(nowAction([], at("12:00")), null);
});
