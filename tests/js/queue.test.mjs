// Coda offline delle scritture (static/js/workout/queue.js) con rete finta e risposte comandate dal test.
import test from "node:test";
import assert from "node:assert/strict";
import { deferredFetch, fakeBrowser, settle } from "./helpers.mjs";

const stored = fakeBrowser();
const net = deferredFetch();
const { clearQueue, enqueue, pendingCount, rejected } = await import("../../static/js/workout/queue.js");
const QUEUE = "fitweek.workoutQueue.v1";
const SET = "/api/v1/workout-sessions/s1/sets/a1/1";
const KEY = "set:a1:1:s1";
const saved = () => JSON.parse(stored.get(QUEUE) || "[]");

test("FW-REV-001: una modifica fatta mentre la precedente è in volo viene inviata, non buttata", async () => {
  enqueue("PUT", SET, { kg: 40, reps: 8 }, KEY);
  await settle();
  assert.equal(net.calls.length, 1, "A è in volo");
  enqueue("PUT", SET, { kg: 42.5, reps: 8 }, KEY); // B sostituisce A nella coda mentre A aspetta la risposta
  net.reply(0);
  await settle();
  assert.equal(net.calls.length, 2, "dopo la risposta di A parte anche B");
  assert.deepEqual(net.calls[1].body, { kg: 42.5, reps: 8 });
  assert.equal(pendingCount(), 1, "B resta in coda finché il server non risponde");
  assert.deepEqual(saved().map((o) => o.body.kg), [42.5], "B è anche sul dispositivo");
  net.reply(1);
  await settle();
  assert.equal(pendingCount(), 0);
  assert.ok(net.calls[1].headers["X-Edited-At"] >= net.calls[0].headers["X-Edited-At"]);
});

test("FW-REV-001: se A viene rifiutata dopo essere stata sostituita, B parte e A non finisce tra gli scarti", async () => {
  const from = net.calls.length;
  enqueue("PUT", SET, { kg: 9999, reps: 8 }, KEY);
  await settle();
  enqueue("PUT", SET, { kg: 45, reps: 8 }, KEY);
  net.reply(from, 422, { detail: "Serie non valida" });
  await settle();
  assert.equal(net.calls.length, from + 2);
  assert.deepEqual(net.calls[from + 1].body, { kg: 45, reps: 8 });
  assert.deepEqual(rejected(), [], "la versione superata non va riproposta all'utente");
  net.reply(from + 1);
  await settle();
  assert.equal(pendingCount(), 0);
});

test("FW-REV-001: una eliminazione fatta durante l'invio della serie arriva al server", async () => {
  const from = net.calls.length;
  enqueue("PUT", SET, { kg: 40, reps: 8 }, KEY);
  await settle();
  enqueue("DELETE", SET, undefined, KEY);
  net.reply(from);
  await settle();
  assert.equal(net.calls[from + 1]?.method, "DELETE");
  net.reply(from + 1);
  await settle();
  assert.equal(pendingCount(), 0);
});

test("FW-REV-006: clearQueue elimina davvero le operazioni in attesa, anche con un invio in corso", async () => {
  const from = net.calls.length;
  enqueue("PUT", SET, { kg: 50, reps: 5 }, KEY);
  enqueue("PUT", "/api/v1/meal-logs/m1", { date: "2026-11-13", slot: "lunch" }, "meal:m1");
  await settle();
  assert.equal(pendingCount(), 2);
  clearQueue();
  assert.equal(pendingCount(), 0);
  assert.equal(stored.has(QUEUE), false, "niente resta sul dispositivo");
  net.reply(from); // la risposta dell'invio che era in volo non deve far ripartire nulla
  await settle();
  assert.equal(net.calls.length, from + 1, "nessun altro invio dopo l'uscita");
  assert.equal(pendingCount(), 0);
});
