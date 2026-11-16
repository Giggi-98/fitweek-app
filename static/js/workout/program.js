// La scheda come dato modificabile: funzioni pure sullo stato (testate in tests/js/program.test.mjs).
// La scheda del PDF resta la fonte autorevole: l'app non la cambia mai da sola. Le modifiche le fa l'utente
// dall'editor, e l'originale (`GET /api/v1/program/original`) serve a mostrare cosa è cambiato e a ripristinare.
// Un esercizio tolto o sostituito finisce in `exerciseArchive`: lo storico delle sedute continua ad avere un
// nome e l'esercizio si può riprendere quando se ne aggiunge uno.

export const MUSCLES = ["Petto", "Dorsali", "Spalle", "Bicipiti", "Tricipiti", "Quadricipiti", "Femorali", "Glutei", "Polpacci", "Lombari", "Addome", "Altro"];
// Gruppo principale degli esercizi della scheda, usato finché l'utente non ne sceglie uno nell'editor.
// È una classificazione dell'app (il PDF non la riporta): serve solo al conteggio delle serie per gruppo.
const DEFAULT_MUSCLE = {
  a1: "Dorsali", a2: "Spalle", a3: "Spalle", a4: "Femorali", a5: "Lombari", a6: "Tricipiti", a7: "Tricipiti",
  b1: "Petto", b2: "Petto", b3: "Spalle", b4: "Quadricipiti", b5: "Quadricipiti", b6: "Bicipiti", b7: "Bicipiti",
  c1: "Petto", c2: "Dorsali", c3: "Quadricipiti", c4: "Bicipiti", c5: "Polpacci",
};
export const muscleOf = (ex) => ex?.muscle || DEFAULT_MUSCLE[ex?.id] || "";

const archiveOf = (state) => state.exerciseArchive || [];
const inRoutines = (state) => Object.values(state.routines).flat();

/** Un esercizio per id: prima nelle giornate, poi tra quelli archiviati. */
export const findExercise = (state, id) => inRoutines(state).find((e) => e.id === id) || archiveOf(state).find((e) => e.id === id) || null;

/** Esercizi tra cui scegliere quando se ne aggiunge o sostituisce uno: quelli delle giornate e gli archiviati,
 *  senza doppioni e senza quelli già presenti (`exclude` = id). */
export function library(state, exclude = []) {
  const seen = new Set(exclude);
  return [...inRoutines(state), ...archiveOf(state)].filter((e) => !seen.has(e.id) && seen.add(e.id));
}

const shape = (e) => JSON.stringify([e.name, e.reps, e.sets, e.video || "", e.rest ?? null, e.muscle || ""]);
export const sameExercise = (a, b) => shape(a) === shape(b);

/** Confronto di una giornata con quella del PDF.
 *  @returns {{modified, status: Map id → "changed"|"added", removed: [esercizi del PDF assenti], reordered}} */
export function routineChanges(list, original) {
  const byId = new Map(original.map((e) => [e.id, e]));
  const status = new Map();
  for (const e of list) {
    if (!byId.has(e.id)) status.set(e.id, "added");
    else if (!sameExercise(e, byId.get(e.id))) status.set(e.id, "changed");
  }
  const kept = list.filter((e) => byId.has(e.id)).map((e) => e.id);
  const removed = original.filter((e) => !kept.includes(e.id));
  const reordered = kept.join() !== original.filter((e) => kept.includes(e.id)).map((e) => e.id).join();
  return { modified: status.size > 0 || removed.length > 0 || reordered, status, removed, reordered };
}

/** Nuovo stato con la giornata `routine` sostituita da `list`; gli esercizi usciti dalle giornate vanno in
 *  archivio, quelli rientrati ne escono. */
function withRoutine(state, routine, list) {
  const routines = { ...state.routines, [routine]: list };
  const active = new Set(Object.values(routines).flat().map((e) => e.id));
  const dropped = (state.routines[routine] || []).filter((e) => !active.has(e.id));
  const archive = [...archiveOf(state).filter((e) => !active.has(e.id) && !dropped.some((d) => d.id === e.id)), ...dropped];
  return { ...state, routines, exerciseArchive: archive };
}

/** Salva un esercizio: se c'è già nella giornata lo aggiorna sul posto, altrimenti lo aggiunge in fondo. */
export function saveExercise(state, routine, ex) {
  const list = state.routines[routine] || [];
  return withRoutine(state, routine, list.some((e) => e.id === ex.id) ? list.map((e) => (e.id === ex.id ? ex : e)) : [...list, ex]);
}
export const removeExercise = (state, routine, id) => withRoutine(state, routine, state.routines[routine].filter((e) => e.id !== id));
/** Rimette nella giornata un esercizio appena tolto, alla posizione che aveva ("Annulla"). */
export function insertExercise(state, routine, ex, index) {
  const list = state.routines[routine].filter((e) => e.id !== ex.id);
  return withRoutine(state, routine, [...list.slice(0, index), ex, ...list.slice(index)]);
}
/** Cambia alcuni campi di un esercizio ovunque si trovi (giornate e archivio): es. il recupero scelto in seduta. */
export function patchExercise(state, id, fields) {
  const patch = (list) => list.map((e) => (e.id === id ? { ...e, ...fields } : e));
  return { ...state, routines: Object.fromEntries(Object.entries(state.routines).map(([r, list]) => [r, patch(list)])), exerciseArchive: patch(archiveOf(state)) };
}
/** Un esercizio usato solo in una seduta va in archivio, così lo storico ha il suo nome. */
export const archiveExercise = (state, ex) => (findExercise(state, ex.id) ? state : { ...state, exerciseArchive: [...archiveOf(state), ex] });
/** Mette `ex` al posto dell'esercizio `id`, nella stessa posizione. */
export const replaceExercise = (state, routine, id, ex) => withRoutine(state, routine, state.routines[routine].map((e) => (e.id === id ? ex : e)));
/** Sposta l'esercizio di un posto (`dir` −1 = su, +1 = giù); ai bordi non cambia nulla. */
export function moveExercise(state, routine, id, dir) {
  const list = [...state.routines[routine]];
  const from = list.findIndex((e) => e.id === id), to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return state;
  [list[from], list[to]] = [list[to], list[from]];
  return withRoutine(state, routine, list);
}
/** Riporta la giornata a quella del PDF; gli esercizi aggiunti dall'utente restano in archivio. */
export const restoreRoutine = (state, routine, original) => withRoutine(state, routine, original.map((e) => ({ ...e })));

/** Serie previste per la settimana (oltre l'ultima colonna vale l'ultima). */
export const plannedSets = (ex, week) => Number(ex.sets[Math.min(Math.max(week, 1), ex.sets.length) - 1]) || 0;

/**
 * Esercizi di UNA seduta: la giornata della scheda con le scelte fatte solo per oggi.
 * @param plan {skipped: {id: true}, swapped: {id: idSostituto}, added: [id], order: [id]} (tutto facoltativo)
 * @param loggedIds id degli esercizi con serie registrate nella seduta: compaiono sempre, anche se la scelta
 *                  è stata fatta su un altro dispositivo
 * @returns [{...esercizio, planned, swappedFor?: id dell'esercizio della scheda sostituito}]
 */
export function sessionExercises(state, routine, week, plan = {}, loggedIds = []) {
  const stub = (id) => findExercise(state, id) || { id, name: "Esercizio non più in scheda", reps: "", sets: [0], video: "" };
  const out = [];
  for (const ex of state.routines[routine] || []) {
    const swap = plan.swapped?.[ex.id];
    if (swap) out.push({ ...stub(swap), planned: plannedSets(ex, week), swappedFor: ex.id });
    else if (!plan.skipped?.[ex.id] || loggedIds.includes(ex.id)) out.push({ ...ex, planned: plannedSets(ex, week) });
  }
  for (const id of [...(plan.added || []), ...loggedIds]) {
    if (!out.some((e) => e.id === id)) out.push({ ...stub(id), planned: plannedSets(stub(id), week), added: true });
  }
  const order = plan.order || [];
  const rank = (e) => (order.includes(e.id) ? order.indexOf(e.id) : order.length + out.indexOf(e));
  return order.length ? [...out].sort((a, b) => rank(a) - rank(b)) : out;
}
