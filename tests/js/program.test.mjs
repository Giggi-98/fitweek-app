import test from "node:test";
import assert from "node:assert/strict";
import { findExercise, library, moveExercise, muscleOf, removeExercise, replaceExercise, restoreRoutine, routineChanges, saveExercise, sessionExercises } from "../../static/js/workout/program.js";

const ex = (id, name, extra = {}) => ({ id, name, reps: "8–10", sets: [3, 3, 4], video: "", ...extra });
const ORIGINAL = [ex("a1", "Lat machine"), ex("a2", "Face pull"), ex("a3", "Military press")];
const state = () => ({ routines: { A: ORIGINAL.map((e) => ({ ...e })), B: [ex("b1", "Chest press")] } });
const ids = (s, r = "A") => s.routines[r].map((e) => e.id);
const archived = (s) => (s.exerciseArchive || []).map((e) => e.id);

test("modificare, aggiungere e togliere: chi esce dalla scheda va in archivio, chi rientra ne esce", () => {
  let s = saveExercise(state(), "A", { ...ORIGINAL[0], sets: [4, 4, 4], rest: 120 });
  assert.deepEqual([ids(s), s.routines.A[0].sets, archived(s)], [["a1", "a2", "a3"], [4, 4, 4], []]);
  s = saveExercise(s, "A", ex("x-1", "Rematore"));
  assert.deepEqual(ids(s), ["a1", "a2", "a3", "x-1"]);
  s = removeExercise(s, "A", "a2");
  assert.deepEqual([ids(s), archived(s)], [["a1", "a3", "x-1"], ["a2"]]);
  s = saveExercise(s, "A", findExercise(s, "a2"));
  assert.deepEqual([ids(s), archived(s)], [["a1", "a3", "x-1", "a2"], []]);
});

test("sostituire tiene il posto; l'esercizio sostituito resta trovabile per lo storico", () => {
  const s = replaceExercise(state(), "A", "a2", ex("x-2", "Alzate posteriori"));
  assert.deepEqual([ids(s), archived(s)], [["a1", "x-2", "a3"], ["a2"]]);
  assert.equal(findExercise(s, "a2").name, "Face pull");
  assert.equal(findExercise(s, "nessuno"), null);
  assert.deepEqual(library(s, ids(s)).map((e) => e.id), ["b1", "a2"]); // altre giornate e archivio, non quelli già presenti
});

test("spostare: un posto alla volta, ai bordi non succede nulla", () => {
  let s = moveExercise(state(), "A", "a3", -1);
  assert.deepEqual(ids(s), ["a1", "a3", "a2"]);
  s = moveExercise(s, "A", "a1", -1);
  assert.deepEqual(ids(s), ["a1", "a3", "a2"]);
  assert.deepEqual(ids(moveExercise(s, "A", "a2", 1)), ["a1", "a3", "a2"]);
});

test("confronto con il PDF e ripristino della giornata", () => {
  assert.equal(routineChanges(state().routines.A, ORIGINAL).modified, false);
  let s = saveExercise(state(), "A", { ...ORIGINAL[0], reps: "6–8" });
  s = replaceExercise(s, "A", "a2", ex("x-2", "Alzate posteriori"));
  s = moveExercise(s, "A", "a3", -1);
  const c = routineChanges(s.routines.A, ORIGINAL);
  assert.deepEqual([c.modified, [...c.status], c.removed.map((e) => e.id)], [true, [["a1", "changed"], ["x-2", "added"]], ["a2"]]);
  assert.equal(routineChanges(moveExercise(state(), "A", "a1", 1).routines.A, ORIGINAL).reordered, true);
  const back = restoreRoutine(s, "A", ORIGINAL);
  assert.deepEqual([back.routines.A, archived(back)], [ORIGINAL, ["x-2"]]);
  assert.deepEqual(back.routines.B, state().routines.B); // le altre giornate non si toccano
});

test("gruppo muscolare: quello scelto dall'utente, altrimenti quello predefinito della scheda", () => {
  assert.deepEqual([muscleOf({ id: "a1" }), muscleOf({ id: "a1", muscle: "Bicipiti" }), muscleOf({ id: "x-9" }), muscleOf(null)], ["Dorsali", "Bicipiti", "", ""]);
});

test("esercizi della seduta: salta, sostituisci e aggiungi valgono solo per oggi", () => {
  const s = { ...state(), exerciseArchive: [ex("x-7", "Pulldown al cavo")] };
  const names = (plan, logged = []) => sessionExercises(s, "A", 3, plan, logged).map((e) => `${e.id}:${e.planned}`);
  assert.deepEqual(names({}), ["a1:4", "a2:4", "a3:4"]);
  assert.deepEqual(names({ skipped: { a2: true } }), ["a1:4", "a3:4"]);
  const swapped = sessionExercises(s, "A", 1, { swapped: { a1: "x-7" } });
  assert.deepEqual([swapped[0].id, swapped[0].name, swapped[0].planned, swapped[0].swappedFor], ["x-7", "Pulldown al cavo", 3, "a1"]);
  assert.deepEqual(names({ added: ["b1"] }), ["a1:4", "a2:4", "a3:4", "b1:4"]);
  assert.deepEqual(names({ order: ["a3", "a1"] }), ["a3:4", "a1:4", "a2:4"]);
  // serie registrate altrove: l'esercizio compare comunque, anche se saltato o non in scheda
  assert.deepEqual(names({ skipped: { a2: true } }, ["a2", "zz"]), ["a1:4", "a2:4", "a3:4", "zz:0"]);
  assert.equal(sessionExercises(s, "A", 1, {}, ["zz"]).pop().name, "Esercizio non più in scheda");
  assert.deepEqual(s.routines.A.map((e) => e.id), ["a1", "a2", "a3"]); // la scheda non cambia
});
