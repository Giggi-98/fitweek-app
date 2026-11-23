import test from "node:test";
import assert from "node:assert/strict";
import { mergeSamples, parseHr } from "../../static/js/wear.js";

test("battito dall'orologio: \"bpm,ms;bpm,ms\", i pezzi non validi si scartano", () => {
  assert.deepEqual(parseHr("120,1700000000000;0,1700000001000;abc;131,1700000002000"), [[1700000000000, 120], [1700000002000, 131]]);
  assert.deepEqual(parseHr(""), []);
});

test("campioni uniti per orario, senza doppioni e in ordine", () => {
  assert.deepEqual(mergeSamples([[2, 100], [1, 90]], [[2, 101], [3, 110]]), [[1, 90], [2, 101], [3, 110]]);
});
