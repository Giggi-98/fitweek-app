// Schermata allenamento: avvio seduta, registrazione serie con un tocco, recupero, riepilogo.
import { CARDIO_MIN, PROGRAM_WEEKS, ROUTINES, cardioBpm } from "../constants.js";
import { icon } from "../icons.js";
import { bump, confetti, haptic, pop, ring } from "../motion.js";
import { standalone } from "../platform.js";
import { app, persistState, refreshWorkouts } from "../store.js";
import { choices, openModal, toast } from "../ui.js";
import { $, esc, fmtClock, fmtDate, fmtNum, isoDate, num, safeUrl, storage, uid } from "../util.js";
import { enqueue, flush, pendingCount } from "../workout/queue.js";
import { prefs, restEnd, startRest, stopRest } from "../workout/timer.js";
import { PLATES, platesPerSide, RECORD_LABEL, exerciseBests, exerciseSessions, exerciseSummary, isWork, repRange, setRecords, setTarget } from "../workout/calc.js";
import { openExerciseEditor, openExercisePage, openPicker, originalProgram, restLabel } from "../workout/exercise.js";
import { canReadHealth, heartLive, importHealth } from "../watch.js";
import { setPeaks } from "../health.js";
import { heartChart, sessionPeaks } from "../workout/heart.js";
import { archiveExercise, findExercise, moveExercise, patchExercise, plannedSets, restoreRoutine, routineChanges, sessionExercises } from "../workout/program.js";

const EDITS_KEY = "fitweek.workoutEdits.v1";
const LEGACY_DRAFTS_KEY = "fitweek.workoutDrafts.v1";

// Selezione quando non c'è una seduta attiva.
// justDone/justComplete: animazioni da eseguire una sola volta al prossimo render.
// Un esercizio è completato solo quando lo conferma l'utente (edits.closed), non al raggiungimento delle
// serie previste: le serie di oggi si possono aggiungere o togliere senza toccare la scheda.
// rirFor: ultima serie segnata, per cui si può indicare lo sforzo (RIR) con un tocco facoltativo.
// editing: la scheda della giornata scelta è in modifica (riordino, aggiunta, ripristino dal PDF).
const ui = { routine: null, week: null, summary: null, justDone: null, justComplete: null, rirFor: null, open: new Set(), editing: false };

// ---- dati derivati ------------------------------------------------------------------------
const active = () => app.today?.active_session || null;
const routineExercises = (r) => app.state.routines[r] || [];
const lastDone = (routine, exceptId) =>
  app.sessions.find((s) => s.routine === routine && s.status === "done" && s.id !== exceptId) || null;
/** Esercizi della seduta: la giornata della scheda con le scelte fatte solo per oggi (salta, sostituisci, aggiungi). */
const exercisesOf = (session, ed = edits(session.id)) =>
  sessionExercises(app.state, session.routine, session.week, ed.plan, [...new Set(session.sets.map((x) => x.exercise_id))]);
/** Le serie di lavoro dell'ultima seduta conclusa in cui l'esercizio è stato fatto (in qualsiasi giornata). */
const lastTime = (session, exId) => exerciseSessions(app.sessions.filter((x) => x.id !== session.id), exId).pop() || null;
const setsOf = (session, exId) =>
  (session?.sets || []).filter((s) => s.exercise_id === exId).sort((a, b) => a.set_index - b.set_index);
const logged = (session, exId, idx) => (session?.sets || []).find((s) => s.exercise_id === exId && s.set_index === idx);
const parseNum = (v) => (String(v ?? "").trim() === "" ? null : num(String(v).replace(",", "."), null));
const fmtSet = (s) => `${s.kg == null ? "—" : fmtNum(s.kg)}×${s.reps ?? "—"}`;

function edits(sessionId) {
  const e = storage.get(EDITS_KEY, null);
  return e && e.sessionId === sessionId ? { closed: {}, plan: {}, kinds: {}, ...e } : { sessionId, values: {}, extra: {}, closed: {}, plan: {}, kinds: {} };
}
const saveEdits = (e) => storage.set(EDITS_KEY, e);

/** Valori da mostrare: registrati > modificati a mano > serie precedente > ultima seduta. */
function suggestion(session, ex, idx, prev, ed) {
  const own = logged(session, ex.id, idx);
  if (own) return { kg: own.kg, reps: own.reps };
  const typed = ed.values[`${ex.id}:${idx}`];
  if (typed) return typed;
  if (idx > 1) {
    const before = logged(session, ex.id, idx - 1) || ed.values[`${ex.id}:${idx - 1}`];
    if (before && (before.completed ?? true)) return { kg: before.kg, reps: before.reps };
  }
  const p = prev[idx - 1] || prev[prev.length - 1];
  return p ? { kg: p.kg, reps: p.reps } : { kg: null, reps: null };
}

function progressOf(session) {
  const planned = exercisesOf(session).reduce((n, ex) => n + ex.planned, 0);
  const done = session.sets.filter((s) => s.completed).length;
  return { planned, done };
}
const volume = (session) => session.sets.filter(isWork).reduce((v, s) => v + s.kg * s.reps, 0);

// Tipo di serie: un tocco sul numero lo cambia. Il riscaldamento non conta in volume, record e obiettivi.
const KINDS = ["normal", "warmup", "drop", "failure"];
const KIND_MARK = { warmup: "R", drop: "D", failure: "C" };
const KIND_NAME = { normal: "normale", warmup: "riscaldamento", drop: "drop set", failure: "a cedimento" };
const kindOf = (session, ed, exId, idx) => logged(session, exId, idx)?.kind || ed.kinds[`${exId}:${idx}`] || "normal";

const RIR_CHOICES = [[0, "0"], [1, "1"], [2, "2"], [3, "3"], [4, "4+"]];
/** Dopo il ✓: "quante ne avevi ancora?". Un tocco se vuoi, altrimenti si ignora e sparisce alla serie dopo. */
function rirStrip(session, ex) {
  if (!ui.rirFor || ui.rirFor.ex !== ex.id) return "";
  const own = logged(session, ex.id, ui.rirFor.idx);
  if (!own?.completed) return "";
  return `<div class="rir-strip" role="group" aria-label="Ripetizioni di riserva, serie ${ui.rirFor.idx}">
    <span>Serie ${ui.rirFor.idx}: ne avevi ancora?</span>
    <div>${RIR_CHOICES.map(([v, l]) => `<button type="button" class="chip ${own.rir === v ? "active" : ""}" data-rir="${v}" aria-pressed="${own.rir === v}">${l}</button>`).join("")}</div>
  </div>`;
}

/** Obiettivo della prossima serie da fare, calcolato da ciò che è stato fatto l'ultima volta. Una riga sola
 *  per esercizio: sparisce quando i campi della serie contengono già quei valori. */
function goalLine(session, ex, ed, last, count) {
  const idx = Array.from({ length: count }, (_, k) => k + 1).find((i) => !logged(session, ex.id, i)?.completed);
  if (!idx || !last || kindOf(session, ed, ex.id, idx) === "warmup") return "";
  const goal = setTarget(last.sets[idx - 1] || last.sets[last.sets.length - 1], repRange(ex.reps), prefs().kgStep);
  const typed = ed.values[`${ex.id}:${idx}`];
  if (!goal || (typed && typed.kg === goal.kg && typed.reps === goal.reps)) return "";
  return `<div class="ex-goal"><span>Obiettivo serie ${idx}<small>${goal.step === "load" ? `eri in cima alle ripetizioni: +${fmtNum(prefs().kgStep, 2)} kg` : "una ripetizione in più"}</small></span>
    <strong>${fmtNum(goal.kg)} kg × ${goal.reps}</strong><button type="button" class="btn small" data-goal="${esc(ex.id)}:${idx}" data-kg="${goal.kg}" data-reps="${goal.reps}">Usa</button></div>`;
}

function exerciseNote(ex) {
  const note = app.exNotes[ex.id];
  return `<button type="button" class="ex-note ${note ? "has" : ""}" data-note-ex="${esc(ex.id)}">${icon("notebook-pen", "sm")}<span>${note ? esc(note) : "Aggiungi una nota (sedile, presa, fastidi…)"}</span></button>`;
}

// ---- render -------------------------------------------------------------------------------
export function render() {
  if (ui.summary) return renderSummary(ui.summary);
  const s = active();
  return s ? renderActive(s) : renderStart();
}

function legacyDraftBanner() {
  const drafts = storage.get(LEGACY_DRAFTS_KEY, {});
  const items = Object.entries(drafts).filter(([, d]) =>
    Object.keys(d).some((k) => /^(kg|reps)_/.test(k) && d[k] !== ""),
  );
  if (!items.length) return "";
  return items
    .map(([id, d]) => {
      const [routine, w] = id.split("-W");
      return `<div class="inline-note warn">${icon("triangle-alert")}<div><span>Bozza non salvata dalla versione precedente: <strong>Giorno ${esc(routine)} · W${esc(w)}</strong>${d.date ? ` del ${esc(fmtDate(d.date))}` : ""}.</span><div class="button-row"><button class="btn small primary" data-import-draft="${esc(id)}">Importa come seduta</button><button class="btn small" data-drop-draft="${esc(id)}">Scarta</button></div></div></div>`;
    })
    .join("");
}

const elapsed = (iso) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}′` : `${m}′`;
};
/** Battito dal vivo dall'orologio (solo nell'app Android con Health Connect): ultimo valore, media e massimo. */
function liveHeartChip(session) {
  if (!canReadHealth()) return "";
  const v = heartLive.sessionId === session.id ? heartLive.value : null;
  if (!v) return `<span id="wk-heart" class="subtle">${icon("heart-pulse")}in attesa dell'orologio</span>`;
  const ago = Math.max(0, Math.round((Date.now() - new Date(v.at)) / 60000));
  const last = [...session.sets].filter((x) => x.completed && x.logged_at).sort((a, b) => a.logged_at.localeCompare(b.logged_at)).pop();
  const peak = last && setPeaks(v.curve, session.started_at, session.sets).get(`${last.exercise_id}:${last.set_index}`);
  return `<span id="wk-heart" title="Media ${esc(v.avg)}, massimo ${esc(v.max)} bpm su ${esc(v.samples)} misure">${icon("heart-pulse")}${esc(v.bpm)} bpm<small>${ago ? ` · ${ago}′ fa` : ""}${peak ? ` · picco ultima serie ${esc(peak)}` : ""} · media ${esc(v.avg)} · max ${esc(v.max)}</small></span>`;
}
// Il battito della seduta appena chiusa arriva dall'importazione partita a fine seduta: il riepilogo si aggiorna.
globalThis.addEventListener?.("fitweek:health-status", () => {
  const fresh = ui.summary && app.sessions.find((x) => x.id === ui.summary.id);
  if (!fresh || fresh.heart === ui.summary.heart) return;
  ui.summary = fresh;
  if (app.view === "training") app.render();
});
globalThis.addEventListener?.("fitweek:heart-live", () => {
  const el = document.getElementById("wk-heart");
  const s = active();
  if (el && s) el.outerHTML = liveHeartChip(s);
});

// Il cronometro della seduta si aggiorna da solo senza ridisegnare la pagina.
setInterval(() => {
  const el = document.getElementById("wk-elapsed");
  const s = active();
  if (el && s?.started_at) el.textContent = elapsed(s.started_at);
}, 30_000);

function renderStart() {
  const t = app.today;
  const routine = startRoutine();
  const week = ui.week || t.program_week;
  const info = ROUTINES[routine];
  const prev = lastDone(routine);
  const doneToday = t.done_today.find((s) => s.routine === routine);
  const exs = routineExercises(routine);
  const total = exs.reduce((n, ex) => n + plannedSets(ex, week), 0);
  const isToday = routine === t.routine;
  const fact = (ic, label, value) => `<div class="fact">${icon(ic, "sm")}<span>${label}</span><strong>${value}</strong></div>`;
  return `
  ${legacyDraftBanner()}
  <div class="train-start">
  <section class="hero train-hero">
    <div class="train-title">
      <span class="eyebrow">${isToday ? "Oggi" : "Seduta selezionata"} · settimana ${t.program_week} del programma</span>
      <h2>Giorno ${esc(routine)}<span class="muted"> · W${week}</span></h2>
      <p class="subtle">${esc(info?.focus || "")}</p>
    </div>
    <div class="facts">
      ${fact("list-checks", "Esercizi", exs.length)}
      ${fact("dumbbell", "Serie", total)}
      ${fact("timer", "Cardio", `${CARDIO_MIN}′`)}
      ${fact("clock", "Ultima volta", prev ? esc(fmtDate(prev.date).split(" ").slice(1).join(" ")) : "—")}
    </div>
  </section>
  ${doneToday ? `<div class="inline-note ok">${icon("circle-check")}<div>Giorno ${esc(routine)} già completato oggi (${doneToday.sets.filter((x) => x.completed).length} serie).</div></div>` : ""}
  ${!t.routine && !ui.routine ? `<div class="inline-note">${icon("info")}<div>Oggi è giorno di riposo: puoi comunque recuperare una seduta saltata.</div></div>` : ""}
  <div class="train-bar">
    ${choices(Object.keys(ROUTINES).map((r) => [r, `Giorno ${r}`, null, ROUTINES[r].day.slice(0, 3)]), routine, "Giornata", "pick-routine")}
    <div class="chips scroll week-chips" role="group" aria-label="Settimana">${Array.from({ length: PROGRAM_WEEKS }, (_, i) => i + 1)
      .map((w) => `<button class="chip ${w === week ? "active" : ""} ${w === t.program_week ? "current" : ""}" data-pick-week="${w}">W${w}</button>`)
      .join("")}</div>
    <div class="sticky-cta"><button class="btn primary xl full glow" data-start>${icon("play")}Inizia Giorno ${esc(routine)} · W${week}</button></div>
  </div>
  ${programPanel(routine, week, exs, prev, info)}
  </div>`;
}

/** La scheda della giornata. Ogni riga apre la scheda dell'esercizio; in modifica si riordina, si aggiunge e
 *  si ripristina la giornata del PDF. */
function programPanel(routine, week, exs, prev, info) {
  const pdf = originalProgram()?.[routine];
  const diff = pdf ? routineChanges(exs, pdf) : null;
  const mark = (ex) => ({ changed: "modificato", added: "aggiunto" }[diff?.status.get(ex.id)] || "");
  const lines = exs
    .map((ex, i) => {
      const p = setsOf(prev, ex.id).filter((x) => x.completed);
      return `<div class="ex-line">
        <span class="ex-idx">${i + 1}</span>
        <button type="button" class="ex-line-main" data-ex-page="${esc(ex.id)}"><span class="entry-title">${esc(ex.name)}${mark(ex) ? ` <span class="pill">${mark(ex)}</span>` : ""}</span><span class="entry-sub">${p.length ? `ultima ${esc(p.map(fmtSet).join(" · "))}` : "prima volta"}</span></button>
        ${ui.editing
          ? `<span class="ex-move"><button type="button" class="icon-btn" data-move-ex="${esc(ex.id)}" data-dir="-1" aria-label="Sposta su ${esc(ex.name)}" ${i ? "" : "disabled"}>${icon("arrow-up", "sm")}</button><button type="button" class="icon-btn" data-move-ex="${esc(ex.id)}" data-dir="1" aria-label="Sposta giù ${esc(ex.name)}" ${i < exs.length - 1 ? "" : "disabled"}>${icon("arrow-down", "sm")}</button><button type="button" class="icon-btn" data-edit-ex="${esc(ex.id)}" aria-label="Modifica ${esc(ex.name)}">${icon("pencil", "sm")}</button></span>`
          : `<span class="ex-plan">${plannedSets(ex, week)} × ${esc(ex.reps)}</span>`}
      </div>`;
    })
    .join("");
  return `<section class="panel" id="program-panel">
    <div class="panel-head"><h3>${icon("notebook-pen")}Programma</h3><div class="panel-actions">${!ui.editing && !standalone ? `<a class="btn small" href="/api/original-pdf" target="_blank" rel="noopener">PDF ${icon("arrow-right", "sm")}</a>` : ""}<button type="button" class="btn small ${ui.editing ? "primary" : ""}" data-edit-program aria-pressed="${ui.editing}">${ui.editing ? "Fine" : `${icon("pencil", "sm")}Modifica`}</button></div></div>
    ${diff?.modified ? `<p class="subtle">Scheda diversa da quella del PDF${diff.removed.length ? `: ${diff.removed.length === 1 ? "tolto" : "tolti"} ${esc(diff.removed.map((e) => e.name).join(", "))}` : ""}.</p>` : ""}
    <div class="ex-preview">
      ${lines || '<p class="subtle">Nessun esercizio in questa giornata.</p>'}
      ${ui.editing ? "" : `<div class="ex-line"><span class="ex-idx">${icon("timer", "sm")}</span><div class="ex-line-main"><div class="entry-title">${esc(info?.cardio || "Cardio")}</div><div class="entry-sub">riferimento PDF ${cardioBpm(week)} BPM, non un obiettivo personalizzato</div></div><span class="ex-plan">${CARDIO_MIN}′</span></div>`}
    </div>
    ${ui.editing ? `<div class="button-row"><button type="button" class="btn" data-add-ex>${icon("plus", "sm")}Aggiungi esercizio</button>${diff?.modified ? `<button type="button" class="btn ghost" data-restore-routine>${icon("rotate-ccw", "sm")}Ripristina il Giorno ${esc(routine)} dal PDF</button>` : ""}</div>` : ""}
  </section>`;
}

function setRow(session, ex, idx, prev, ed, bests) {
  const own = logged(session, ex.id, idx);
  const done = own?.completed;
  const kind = kindOf(session, ed, ex.id, idx);
  const records = done ? setRecords(bests, own) : [];
  const v = suggestion(session, ex, idx, prev, ed);
  const just = ui.justDone === `${ex.id}:${idx}` ? "just-done" : "";
  const label = `Serie ${idx}, ${KIND_NAME[kind]}${records.length ? `, record di ${records.map((r) => RECORD_LABEL[r]).join(" e ")}` : ""}: tocca per cambiare tipo`;
  return `<div class="set-row ${done ? "done" : ""} ${idx > ex.planned ? "extra" : ""} ${kind} ${just}" data-ex="${esc(ex.id)}" data-idx="${idx}">
    <button type="button" class="set-num ${records.length ? "pr" : ""}" data-kind aria-label="${esc(label)}" title="${esc(label)}">${records.length ? icon("trophy", "sm") : KIND_MARK[kind] || idx}</button>
    <div class="stepper"><button type="button" data-step="kg" data-dir="-1" aria-label="Meno peso">${icon("minus")}</button><input data-field="kg" type="text" inputmode="decimal" autocomplete="off" aria-label="Peso serie ${idx} ${esc(ex.name)}" placeholder="kg" value="${esc(v.kg == null ? "" : String(v.kg).replace(".", ","))}"><button type="button" data-step="kg" data-dir="1" aria-label="Più peso">${icon("plus")}</button></div>
    <div class="stepper"><button type="button" data-step="reps" data-dir="-1" aria-label="Meno ripetizioni">${icon("minus")}</button><input data-field="reps" type="text" inputmode="numeric" autocomplete="off" aria-label="Ripetizioni serie ${idx} ${esc(ex.name)}" placeholder="${esc(String(ex.reps).split(/[–-]/)[0])}" value="${esc(v.reps ?? "")}"><button type="button" data-step="reps" data-dir="1" aria-label="Più ripetizioni">${icon("plus")}</button></div>
    <button type="button" class="set-check" data-check aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Annulla serie" : "Serie fatta"} ${idx}">${icon("check")}</button>
  </div>`;
}

function renderActive(session) {
  const ed = edits(session.id);
  const exs = exercisesOf(session, ed);
  const { planned, done } = progressOf(session);
  const info = ROUTINES[session.routine];
  const nextEx = exs.find((ex) => !ed.closed[ex.id]);
  const skipped = (app.state.routines[session.routine] || []).filter((e) => ed.plan.skipped?.[e.id] && !exs.some((x) => x.id === e.id));
  const html = `
  <section class="wk-header">
    ${ring(planned ? done / planned : 0, { size: 62, stroke: 7, label: String(done), sub: `/${planned}` })}
    <div class="ex-main">
      <h2>Giorno ${esc(session.routine)} · W${esc(session.week)}</h2>
      <div class="wk-meta"><span>${icon("clock")}<span id="wk-elapsed">${session.started_at ? elapsed(session.started_at) : "—"}</span></span><span>${icon("dumbbell")}${done}/${planned} serie</span>${liveHeartChip(session)}${nextEx ? `<span>${icon("arrow-right")}${esc(nextEx.name)}</span>` : `<span>${icon("trophy")}Esercizi completati</span>`}</div>
    </div>
  </section>
  <div class="ex-grid">
  ${exs
    .map((ex, i) => {
      const p = ex.planned;
      const last = lastTime(session, ex.id);
      const prev = last?.sets || [];
      const bests = exerciseBests(app.sessions, ex.id, session.id);
      const loggedIdx = setsOf(session, ex.id).map((s) => s.set_index);
      const count = Math.max(1, p + num(ed.extra[ex.id]), ...loggedIdx);
      const canDrop = count > 1 && count > Math.max(0, ...loggedIdx); // si toglie solo una serie non registrata
      const completed = setsOf(session, ex.id).filter((s) => s.completed).length;
      const isDone = Boolean(ed.closed[ex.id]);
      const open = !isDone || ui.open.has(ex.id);
      const video = safeUrl(ex.video);
      const dots = Array.from({ length: Math.max(p, completed) }, (_, k) => `<i class="${k < completed ? "on" : ""}"></i>`).join("");
      const cls = [isDone ? "done" : "", open ? "open" : "", nextEx?.id === ex.id ? "next" : "", ui.justComplete === ex.id ? "just-complete" : ""].join(" ");
      return `<section class="ex-card ${cls}" id="ex-${esc(ex.id)}">
        <div class="ex-head">
          <button type="button" class="ex-toggle" ${isDone ? `data-toggle-ex="${esc(ex.id)}" aria-expanded="${open}"` : 'tabindex="-1"'}>
            <span class="ex-num">${isDone ? icon("check", "sm") : i + 1}</span>
            <span class="ex-main"><span class="ex-name">${esc(ex.name)}</span>
            <span class="ex-meta">${p} × ${esc(ex.reps)} rip. · ${esc(restLabel(ex))}${ex.swappedFor ? ` · al posto di ${esc(findExercise(app.state, ex.swappedFor)?.name || "")}, solo oggi` : ex.added ? " · aggiunto oggi" : ""}${isDone && !open ? ` · ${esc(setsOf(session, ex.id).filter((x) => x.completed).map(fmtSet).join(" · "))}` : ""}</span>
            <span class="ex-dots" aria-label="${completed} serie su ${p}">${dots}</span></span>
          </button>
          ${video ? `<a href="${esc(video)}" target="_blank" rel="noopener noreferrer" class="icon-link" aria-label="Video esecuzione">${icon("circle-play")}</a>` : ""}
          <button type="button" class="icon-btn" data-ex-menu="${esc(ex.id)}" aria-label="Azioni per ${esc(ex.name)}">${icon("ellipsis")}</button>
        </div>
        ${open ? `
        ${last ? `<div class="ex-last">Ultima volta (${esc(fmtDate(last.date))}, W${esc(last.week)}): ${esc(prev.map(fmtSet).join(" · "))}</div>` : '<div class="ex-last">Prima volta: scegli un carico con cui completi le ripetizioni con buona tecnica.</div>'}
        ${goalLine(session, ex, ed, last, count)}
        ${exerciseNote(ex)}
        <div class="set-legend" aria-hidden="true"><span>#</span><span>kg</span><span>rip.</span><span></span></div>
        ${Array.from({ length: count }, (_, k) => setRow(session, ex, k + 1, prev, ed, bests)).join("")}
        <div class="ex-foot">
          <button type="button" class="link-btn" data-add-set="${esc(ex.id)}">${icon("plus", "sm")}Serie extra</button>
          ${canDrop ? `<button type="button" class="link-btn" data-drop-set="${esc(ex.id)}">${icon("minus", "sm")}Togli serie</button>` : ""}
          ${isDone ? `<button type="button" class="link-btn" data-reopen-ex="${esc(ex.id)}">Riapri esercizio</button>` : ""}
        </div>
        ${isDone ? "" : `<button type="button" class="btn full" data-close-ex="${esc(ex.id)}">${icon("check")}Esercizio completato${completed ? ` · ${completed} serie` : ""}</button>`}` : ""}
        ${rirStrip(session, ex)}
      </section>`;
    })
    .join("")}
  <div class="ex-session-actions"><button type="button" class="btn" data-add-today>${icon("plus", "sm")}Aggiungi esercizio a questa seduta</button>
    ${skipped.map((e) => `<button type="button" class="link-btn" data-unskip="${esc(e.id)}">Riprendi ${esc(e.name)} (saltato oggi)</button>`).join("")}</div>
  <section class="ex-card ${session.cardio_min ? "done" : ""}">
    <div class="ex-head"><span class="ex-num">${icon("timer", "sm")}</span><div class="ex-main"><h3 class="ex-name">${esc(info?.cardio || "Cardio")}</h3><div class="ex-meta">${CARDIO_MIN} minuti · riferimento PDF ${cardioBpm(session.week)} BPM</div><div class="ex-last">Le BPM della scheda non sono un obiettivo personalizzato.</div></div>
    <button type="button" class="set-check" data-cardio aria-pressed="${session.cardio_min ? "true" : "false"}" aria-label="Cardio fatto">${icon("check")}</button></div>
  </section>
  </div>
  <section class="panel">
    <div class="field"><label for="wk-notes">Note della seduta</label><textarea id="wk-notes" data-session-notes rows="3" placeholder="Tecnica, fatica, fastidi…">${esc(session.notes || "")}</textarea></div>
    <button type="button" class="btn primary xl full" data-finish>${icon("trophy")}Termina allenamento</button>
    <button type="button" class="link-btn danger center" data-cancel-session>Annulla seduta</button>
  </section>`;
  ui.justDone = ui.justComplete = null;
  return html;
}

function heartSummaryBlock(s) {
  if (!s.heart) return canReadHealth() ? `<p class="subtle">${icon("heart-pulse", "sm")} Il battito arriva dall'orologio appena OHealth lo passa a Health Connect.</p>` : "";
  const nameOf = (id) => findExercise(app.state, id)?.name;
  const peaks = [...sessionPeaks(s)].sort((a, b) => b[1] - a[1]);
  const top = peaks[0] && `${nameOf(peaks[0][0].split(":")[0]) || peaks[0][0]} #${peaks[0][0].split(":")[1]}`;
  return `<div class="heart-sum">
    <div class="metric-label">${icon("heart-pulse", "sm")}Battito: media ${esc(s.heart.avg_bpm)}, massimo ${esc(s.heart.max_bpm)} bpm${top ? ` · picco più alto: ${esc(top)}` : ""}</div>
    ${heartChart(s, nameOf)}
  </div>`;
}

/** Il riepilogo in poche righe di testo, da mandare in una chat. */
function summaryText(s) {
  const { done } = progressOf(s);
  const rows = exercisesOf(s).map((ex) => ({ ex, sum: exerciseSummary(app.sessions, s, ex.id) })).filter((x) => x.sum);
  return [
    `FitWeek · Giorno ${s.routine} · W${s.week} · ${fmtDate(s.date)}`,
    `${done} serie${s.duration_min != null ? ` · ${Math.round(s.duration_min)}′` : ""} · volume ${fmtNum(volume(s), 0)} kg`,
    ...rows.map(({ ex, sum }) => `${ex.name}: ${fmtSet(sum.top)}${sum.records.length ? " · record" : ""}`),
    s.heart ? `Battito medio ${s.heart.avg_bpm}, massimo ${s.heart.max_bpm} bpm` : "",
  ].filter(Boolean).join("\n");
}

async function shareSummary(s) {
  const text = summaryText(s);
  try {
    if (navigator.share) return await navigator.share({ text });
    await navigator.clipboard.writeText(text);
    toast("Riepilogo copiato: incollalo dove vuoi");
  } catch (e) {
    if (e.name !== "AbortError") toast("Condivisione non riuscita");
  }
}

function renderSummary(summary) {
  const s = app.sessions.find((x) => x.id === summary.id) || summary; // con il battito arrivato dopo
  const { planned, done } = progressOf(s);
  const vol = volume(s);
  const prev = lastDone(s.routine, s.id);
  const prevVol = prev ? volume(prev) : null;
  const diff = prevVol ? Math.round(((vol - prevVol) / prevVol) * 100) : null;
  const rows = exercisesOf(s).map((ex) => ({ ex, sum: exerciseSummary(app.sessions, s, ex.id) })).filter((x) => x.sum);
  const records = rows.filter((x) => x.sum.records.length);
  const delta = (sum) => (sum.prev ? `${sum.volume >= sum.prev.volume ? "+" : "−"}${fmtNum(Math.abs(sum.volume - sum.prev.volume), 0)} kg` : "prima volta");
  return `<section class="hero finish">
    <div class="trophy">${icon("trophy")}</div>
    <div><span class="eyebrow">Seduta completata · ${esc(fmtDate(s.date))}</span><h2>Giorno ${esc(s.routine)} · W${esc(s.week)}</h2></div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Serie</div><div class="metric-value"><span data-count="${done}">${done}</span><small>/${planned}</small></div></div>
      <div class="metric"><div class="metric-label">Durata</div><div class="metric-value">${s.duration_min != null ? `<span data-count="${Math.round(s.duration_min)}">${esc(Math.round(s.duration_min))}</span><small>′</small>` : "—"}</div></div>
      <div class="metric"><div class="metric-label">Volume <span class="badge-calc">calc.</span></div><div class="metric-value"><span data-count="${Math.round(vol)}">${fmtNum(vol, 0)}</span><small> kg</small></div></div>
    </div>
    <p class="subtle">${diff == null ? "Volume = Σ kg × ripetizioni delle serie di lavoro." : `Volume ${diff >= 0 ? "+" : ""}${diff}% rispetto all'ultimo Giorno ${esc(s.routine)}${prev.duration_min && s.duration_min ? ` (durata ${esc(Math.round(s.duration_min))}′, l'ultima ${esc(Math.round(prev.duration_min))}′)` : ""}.`} ${done < planned ? `${planned - done} serie non segnate: va bene, conta la costanza.` : "Tutte le serie fatte."}${s.cardio_min ? " Cardio ✓." : ""}</p>
    ${heartSummaryBlock(s)}
    ${records.length ? `<div class="record-note">${icon("trophy", "sm")}<span>${records.length === 1 ? "Record" : `${records.length} record`}: ${esc(records.map((x) => `${x.ex.name} (${x.sum.records.map((k) => RECORD_LABEL[k]).join(", ")})`).join(" · "))}</span></div>` : ""}
    ${rows.length ? `<div class="table-scroll"><table class="sum-table"><thead><tr><th>Esercizio</th><th>Serie migliore</th><th>Volume vs ultima <span class="badge-calc">calc.</span></th></tr></thead><tbody>${rows
      .map(({ ex, sum }) => `<tr><td>${esc(ex.name)}</td><td>${esc(fmtSet(sum.top))}${sum.prev ? `<small>ultima ${esc(fmtSet(sum.prev.top))}</small>` : ""}</td><td>${delta(sum)}</td></tr>`)
      .join("")}</tbody></table></div>` : ""}
    <button class="btn primary xl full" data-close-summary>Fatto</button>
    <button class="btn ghost full" data-share-summary>${icon("arrow-up", "sm")}Condividi il riepilogo</button>
  </section>`;
}

// ---- orologio Wear OS (wear.js, D-044): lo stato che l'orologio mostra e i tocchi che rimanda ----------
/** Prossima serie da fare: primo esercizio non confermato, prima serie non segnata, con carico e ripetizioni proposti. */
function nextSet(s) {
  const ed = edits(s.id);
  for (const ex of exercisesOf(s, ed)) {
    if (ed.closed[ex.id]) continue;
    const count = Math.max(1, ex.planned + num(ed.extra[ex.id]), ...setsOf(s, ex.id).map((x) => x.set_index));
    for (let idx = 1; idx <= count; idx++) {
      if (logged(s, ex.id, idx)?.completed) continue;
      const v = suggestion(s, ex, idx, lastTime(s, ex.id)?.sets || [], ed);
      return { ex, idx, planned: count, kg: v.kg, reps: v.reps ?? num(String(ex.reps).split(/[–-]/)[0]) };
    }
  }
  return null;
}

/** Stato per l'orologio: seduta aperta, prossima serie, fine del recupero; senza seduta, la giornata di oggi. */
export function watchState() {
  const s = active();
  if (!s) return { active: false, routine: startRoutine() };
  const n = nextSet(s);
  return { active: true, routine: s.routine, exercise: n?.ex.name || "", exId: n?.ex.id || "", idx: n?.idx || 0, planned: n?.planned || 0, kg: n?.kg ?? null, reps: n?.reps ?? 0, restEnd: restEnd() };
}

/** Giornata e settimana che la schermata di avvio propone (scelta dell'utente, poi oggi, poi A). */
const startRoutine = () => ui.routine || app.today?.routine || "A";

/** "Inizia seduta" dall'orologio: la stessa seduta che propone la schermata di avvio della Palestra. */
export function startFromWatch() {
  if (active() || !app.today) return false;
  startSession(startRoutine(), ui.week || app.today.program_week);
  return true;
}

/** "Serie fatta" dall'orologio. Vale solo per una serie di un esercizio della seduta aperta, non già segnata. */
export function setFromWatch({ exId, idx, kg, reps }) {
  const s = active();
  if (!s || !exercisesOf(s).some((ex) => ex.id === exId) || !(idx >= 1) || logged(s, exId, idx)?.completed) return false;
  if (!(reps >= 0 && reps <= 500) || (kg != null && !(kg >= 0 && kg <= 1000))) return false;
  writeSet(s, exId, idx, { kg: kg ?? null, reps }, true);
  startRest(findExercise(app.state, exId)?.rest || undefined);
  ui.justDone = `${exId}:${idx}`;
  return true;
}

// ---- azioni -------------------------------------------------------------------------------
const sessionPath = (s) => `/api/v1/workout-sessions/${encodeURIComponent(s.id)}`;
const setPath = (s, ex, idx) => `${sessionPath(s)}/sets/${encodeURIComponent(ex)}/${idx}`;

function startSession(routine, week, date = isoDate()) {
  const s = {
    id: uid(), routine, week, date, status: "in_progress", started_at: new Date().toISOString(),
    ended_at: null, duration_min: null, cardio_min: null, notes: "", sets: [],
  };
  enqueue("POST", "/api/v1/workout-sessions", { id: s.id, routine, week, date }, `create:${s.id}`);
  app.today.active_session = s;
  ui.routine = ui.week = null;
  stopRest();
  return s;
}

/** Valori della riga. Ripetizioni lasciate vuote = quelle proposte (il segnaposto): la serie si segna con un tocco. */
function rowValues(row) {
  const reps = $("[data-field=reps]", row);
  return { kg: parseNum($("[data-field=kg]", row).value), reps: parseNum(reps.value) ?? parseNum(reps.placeholder) };
}

/** Registra o aggiorna una serie. RIR e tipo vanno rimandati a ogni modifica, altrimenti il server li azzera. */
function writeSet(session, exId, idx, values, completed, { rir = logged(session, exId, idx)?.rir ?? null, kind = kindOf(session, edits(session.id), exId, idx) } = {}) {
  const rest = session.sets.filter((x) => !(x.exercise_id === exId && x.set_index === idx));
  const item = { exercise_id: exId, set_index: idx, kg: values.kg, reps: values.reps, rir, completed, kind, logged_at: new Date().toISOString() };
  session.sets = [...rest, item];
  enqueue("PUT", setPath(session, exId, idx), { kg: values.kg, reps: values.reps, rir, completed, kind }, `set:${exId}:${idx}:${session.id}`);
}

function toggleSet(row) {
  const s = active();
  const exId = row.dataset.ex;
  const idx = num(row.dataset.idx);
  const own = logged(s, exId, idx);
  if (own?.completed) {
    s.sets = s.sets.filter((x) => !(x.exercise_id === exId && x.set_index === idx));
    enqueue("DELETE", setPath(s, exId, idx), undefined, `set:${exId}:${idx}:${s.id}`);
    stopRest();
    if (ui.rirFor?.ex === exId && ui.rirFor.idx === idx) ui.rirFor = null;
    return true;
  }
  const v = rowValues(row);
  if (v.reps == null || v.reps < 0) {
    toast("Inserisci le ripetizioni fatte");
    $("[data-field=reps]", row).focus();
    return false;
  }
  if (v.kg != null && (v.kg < 0 || v.kg > 1000)) {
    toast("Peso non valido");
    return false;
  }
  writeSet(s, exId, idx, v, true);
  const ed = edits(s.id);
  delete ed.values[`${exId}:${idx}`];
  saveEdits(ed);
  startRest(findExercise(app.state, exId)?.rest || undefined); // il recupero dell'esercizio, se ne ha uno suo
  haptic(setRecords(exerciseBests(app.sessions, exId, s.id), logged(s, exId, idx)).length ? [15, 40, 15, 40, 40] : 15);
  ui.justDone = `${exId}:${idx}`;
  ui.rirFor = { ex: exId, idx };
  return true;
}

/** Conferma manuale: l'esercizio si chiude e si passa al successivo. `closed: false` lo riapre. */
function setExerciseClosed(exId, closed) {
  const ed = edits(active().id);
  ed.closed = { ...ed.closed, [exId]: closed };
  saveEdits(ed);
  if (!closed) return ui.open.add(exId);
  ui.open.delete(exId);
  ui.justComplete = exId;
  if (ui.rirFor?.ex === exId) ui.rirFor = null;
  haptic([20, 60, 30]);
  requestAnimationFrame(() => {
    confetti(document.getElementById(`ex-${exId}`), 24);
    document.querySelector(".ex-card.next")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function step(btn) {
  const row = btn.closest(".set-row");
  const input = $(`[data-field=${btn.dataset.step}]`, row);
  const delta = btn.dataset.step === "kg" ? prefs().kgStep : 1;
  // Campo vuoto: parte dal valore suggerito (es. ripetizioni minime della scheda), non da zero.
  const current = parseNum(input.value) ?? (num(btn.dataset.dir) > 0 ? parseNum(input.placeholder) ?? 0 : 0);
  if (parseNum(input.value) == null && num(btn.dataset.dir) > 0 && parseNum(input.placeholder) != null) {
    input.value = String(parseNum(input.placeholder));
    rememberRow(row);
    return;
  }
  const next = Math.max(0, Math.round((current + delta * num(btn.dataset.dir)) * 100) / 100);
  input.value = String(next).replace(".", ",");
  bump(input, num(btn.dataset.dir));
  rememberRow(row);
}

/** Memorizza valori non ancora confermati; se la serie è già fatta, aggiorna il server. */
function rememberRow(row) {
  const s = active();
  const exId = row.dataset.ex;
  const idx = num(row.dataset.idx);
  const v = rowValues(row);
  if (logged(s, exId, idx)?.completed) {
    writeSet(s, exId, idx, v, true);
    return;
  }
  const ed = edits(s.id);
  ed.values[`${exId}:${idx}`] = v;
  saveEdits(ed);
}

function patchSession(fields, keySuffix) {
  const s = active();
  Object.assign(s, fields);
  enqueue("PATCH", sessionPath(s), fields, `patch:${keySuffix}:${s.id}`);
}

async function finish() {
  const s = active();
  const { planned, done } = progressOf(s);
  if (!done && !confirm("Nessuna serie segnata. Terminare comunque?")) return;
  if (done && done < planned && !confirm(`Hai segnato ${done} serie su ${planned}. Terminare l'allenamento?`)) return;
  const endedAt = new Date();
  const duration = s.started_at ? Math.max(0, Math.round((endedAt - new Date(s.started_at)) / 60000)) : null;
  enqueue("PATCH", sessionPath(s), { status: "done", ended_at: endedAt.toISOString(), duration_min: duration }, `finish:${s.id}`);
  Object.assign(s, { status: "done", ended_at: endedAt.toISOString(), duration_min: duration });
  stopRest();
  storage.remove(EDITS_KEY);
  app.today.active_session = null;
  app.sessions = [s, ...app.sessions.filter((x) => x.id !== s.id)];
  ui.summary = s;
  haptic([30, 80, 30, 80, 60]);
  setTimeout(() => confetti(null, 70), 250);
  await flush();
  // Ricarica dal server solo se tutto è stato inviato, altrimenti si perderebbero i dati locali.
  const refreshed = pendingCount() ? Promise.resolve() : refreshWorkouts().catch(() => {});
  // Battito della seduta appena chiusa (app Android): dopo la rilettura delle sedute, che altrimenti potrebbe
  // arrivare dopo e togliere dalla memoria il battito appena calcolato.
  refreshed.then(() => importHealth({ force: true }));
}

function editExerciseNote(exId) {
  const ex = findExercise(app.state, exId);
  openModal(
    `<div class="modal-ic">${icon("notebook-pen")}</div>
    <h2 id="modal-title">${esc(ex?.name || "Nota")}</h2>
    <p class="subtle">Resta qui anche nelle prossime sedute.</p>
    <div class="field"><label for="ex-note-text">Nota</label><textarea id="ex-note-text" rows="3" maxlength="500" autofocus placeholder="es. sedile 4, presa larga">${esc(app.exNotes[exId] || "")}</textarea></div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}Salva</button>
    <div class="modal-secondary"><button type="button" data-m="close">Annulla</button></div>`,
    (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.m !== "save") return false;
      const note = $("#ex-note-text").value.trim().slice(0, 500);
      if (note) app.exNotes[exId] = note;
      else delete app.exNotes[exId];
      enqueue("PUT", `/api/v1/exercise-notes/${encodeURIComponent(exId)}`, { note }, `exnote:${exId}`);
      app.render();
      return true;
    },
  );
}

function importLegacyDraft(id) {
  const drafts = storage.get(LEGACY_DRAFTS_KEY, {});
  const d = drafts[id];
  if (!d) return;
  if (active()) {
    toast("Termina prima la seduta in corso");
    return;
  }
  const [routine, w] = id.split("-W");
  const s = startSession(routine, num(w, 1), /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : isoDate());
  for (const key of Object.keys(d)) {
    const m = key.match(/^reps_(.+)_(\d+)$/);
    if (!m || d[key] === "") continue;
    const [, exId, j] = m;
    writeSet(s, exId, num(j) + 1, { kg: parseNum(d[`kg_${exId}_${j}`]), reps: parseNum(d[key]) }, true);
  }
  if (d.notes) patchSession({ notes: String(d.notes).slice(0, 5000) }, "notes");
  delete drafts[id];
  storage.set(LEGACY_DRAFTS_KEY, drafts);
  toast("Bozza importata: controlla i valori e termina la seduta.");
}

// ---- tipo di serie e scelte valide solo per la seduta di oggi ---------------------------------------
function cycleKind(row) {
  const s = active();
  const exId = row.dataset.ex, idx = num(row.dataset.idx);
  const ed = edits(s.id);
  const next = KINDS[(KINDS.indexOf(kindOf(s, ed, exId, idx)) + 1) % KINDS.length];
  const own = logged(s, exId, idx);
  if (own) return writeSet(s, exId, idx, { kg: own.kg, reps: own.reps }, own.completed, { kind: next });
  ed.kinds[`${exId}:${idx}`] = next;
  saveEdits(ed);
}

/** Cambia il piano della seduta (salta, sostituisci, aggiungi, ordine). Resta sul dispositivo, come le serie
 *  extra: la scheda non viene toccata. */
function changePlan(change) {
  const ed = edits(active().id);
  ed.plan = { skipped: {}, swapped: {}, added: [], order: [], ...ed.plan };
  change(ed.plan);
  saveEdits(ed);
}

/** Un esercizio scelto per oggi: se è nuovo entra tra "i tuoi esercizi", così lo storico avrà il suo nome. */
function useToday(picked, isNew, change) {
  if (isNew) {
    app.state = archiveExercise(app.state, picked);
    persistState();
  }
  changePlan(change);
  app.render();
  return false;
}

function addToday() {
  const s = active();
  openPicker({
    title: "Aggiungi a questa seduta", hint: "Solo per oggi: la scheda non cambia.", exclude: exercisesOf(s).map((e) => e.id),
    onPick: (picked, isNew) => useToday(picked, isNew, (plan) => plan.added.push(picked.id)),
  });
}

const REST_QUICK = [60, 90, 120, 180];
function openExerciseMenu(exId) {
  const s = active();
  const list = exercisesOf(s);
  const ex = list.find((e) => e.id === exId);
  const at = list.indexOf(ex);
  const base = ex.swappedFor || ex.id; // l'esercizio della scheda a cui si riferisce la scelta di oggi
  const started = setsOf(s, ex.id).length > 0;
  const item = (m, ic, label, sub = "") => `<button type="button" class="pick" data-m="${m}"><span>${icon(ic, "sm")} ${label}</span>${sub ? `<small>${sub}</small>` : ""}</button>`;
  openModal(
    `<h2 id="modal-title">${esc(ex.name)}</h2>
    <div class="pick-list">
      ${item("page", "chart-line", "Storia e record")}
      ${item("plates", "dumbbell", "Dischi da caricare", nextKg(ex.id) ? `${fmtNum(nextKg(ex.id))} kg` : "")}
      ${started ? "" : ex.added ? item("skip", "x", "Togli da questa seduta") : `${item("swap", "refresh-cw", "Sostituisci solo oggi", "macchina occupata")}${item("skip", "skip-forward", "Salta oggi")}`}
      ${at > 0 ? item("up", "arrow-up", "Sposta prima") : ""}${at < list.length - 1 ? item("down", "arrow-down", "Sposta dopo") : ""}
    </div>
    <div class="pick-group"><span class="eyebrow">Recupero di questo esercizio</span>
      <div class="chips" role="group" aria-label="Recupero">${[null, ...REST_QUICK].map((sec) => `<button type="button" class="chip ${(ex.rest || null) === sec ? "active" : ""}" aria-pressed="${(ex.rest || null) === sec}" data-rest="${sec ?? ""}">${sec ? fmtClock(sec) : `Predefinito ${fmtClock(prefs().restSeconds)}`}</button>`).join("")}</div></div>
    ${started ? '<p class="subtle">Ha già serie segnate: per saltarlo o sostituirlo togli prima le serie.</p>' : ""}
    <div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`,
    (t) => {
      const m = t.dataset.m;
      if (m === "close") return true;
      if (m === "page") return openExercisePage(ex.id), false;
      if (m === "plates") return openPlates(nextKg(ex.id) || 20), false;
      if (t.dataset.rest !== undefined) {
        app.state = patchExercise(app.state, ex.id, { rest: num(t.dataset.rest) || null });
        persistState();
      } else if (m === "skip") {
        changePlan((plan) => {
          if (ex.added) plan.added = plan.added.filter((id) => id !== ex.id);
          else [plan.skipped[base], plan.swapped[base]] = [true, undefined];
        });
      } else if (m === "up" || m === "down") {
        const ids = list.map((e) => e.id), to = at + (m === "up" ? -1 : 1);
        [ids[at], ids[to]] = [ids[to], ids[at]];
        changePlan((plan) => (plan.order = ids));
      } else if (m === "swap") {
        openPicker({
          title: `Sostituisci ${ex.name}`, hint: "Solo per oggi: la scheda non cambia.", exclude: list.map((e) => e.id),
          onPick: (picked, isNew) => useToday(picked, isNew, (plan) => (plan.swapped[base] = picked.id)),
        });
        return false;
      } else return false;
      app.render();
      return true;
    },
  );
}

/** Carico della prossima serie non ancora fatta, come è scritto nella riga (o null). */
const nextKg = (exId) => parseNum(document.querySelector(`.set-row[data-ex="${CSS.escape(exId)}"]:not(.done) [data-field=kg]`)?.value);

// ---- dischi da caricare sul bilanciere ---------------------------------------------------------
const BARS = [20, 15, 10];
function openPlates(total) {
  const state = { total, bar: 20 };
  const body = () => {
    const r = platesPerSide(state.total, state.bar);
    const text = !r ? `Sotto il bilanciere da ${fmtNum(state.bar)} kg.`
      : r.perSide.length ? `${r.perSide.map((p) => fmtNum(p)).join(" + ")} kg` : "Solo il bilanciere";
    return `<h2 id="modal-title">Dischi per lato</h2>
      <div class="plates-total"><button type="button" class="icon-btn" data-pl="-2.5" aria-label="Meno 2,5 kg">${icon("minus")}</button><strong>${esc(fmtNum(state.total))}<small> kg</small></strong><button type="button" class="icon-btn" data-pl="2.5" aria-label="Più 2,5 kg">${icon("plus")}</button></div>
      <div class="pick-group"><span class="eyebrow">Bilanciere</span>${choices(BARS.map((b) => [String(b), `${b} kg`]), String(state.bar), "Bilanciere", "bar")}</div>
      <p class="plates-result" aria-live="polite">${esc(text)}</p>
      ${r?.rest ? `<p class="subtle">${esc(fmtNum(r.rest))} kg per lato non si possono fare con dischi da ${esc(fmtNum(PLATES[PLATES.length - 1]))} kg.</p>` : ""}
      <div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`;
  };
  openModal(body(), (t) => {
    if (t.dataset.m === "close") return true;
    if (t.dataset.pl) state.total = Math.max(0, state.total + num(t.dataset.pl));
    else if (t.dataset.bar) state.bar = num(t.dataset.bar);
    else return false;
    $("#modal-body").innerHTML = body();
    return false;
  });
}

// ---- modifica della scheda (schermata di avvio) -------------------------------------------------
function editProgram(t) {
  const routine = ui.routine || app.today.routine || "A";
  const list = app.state.routines[routine] || [];
  if (t.dataset.editEx) return openExerciseEditor(routine, list.find((e) => e.id === t.dataset.editEx)), false;
  if (t.dataset.moveEx) {
    app.state = moveExercise(app.state, routine, t.dataset.moveEx, num(t.dataset.dir));
    persistState();
    return true;
  }
  if (t.matches("[data-add-ex]")) {
    openPicker({
      title: `Aggiungi al Giorno ${routine}`, exclude: list.map((e) => e.id),
      // sempre dall'editor: serie, ripetizioni e recupero si confermano prima di entrare in scheda
      onPick: (picked) => (openExerciseEditor(routine, picked), true),
    });
    return false;
  }
  if (!confirm(`Riportare il Giorno ${routine} alla scheda del PDF? Gli esercizi che hai aggiunto restano tra i tuoi esercizi e lo storico non cambia.`)) return false;
  app.state = restoreRoutine(app.state, routine, originalProgram()[routine]);
  persistState();
  toast(`Giorno ${routine} ripristinato dal PDF`);
  return true;
}

// ---- eventi (chiamati da main.js) --------------------------------------------------------
export async function onClick(t) {
  if (t.matches("[data-start]")) {
    const routine = ui.routine || app.today.routine || "A";
    startSession(routine, ui.week || app.today.program_week);
    return true;
  }
  if (t.dataset.pickRoutine) return (ui.routine = t.dataset.pickRoutine), true;
  if (t.dataset.pickWeek) return (ui.week = num(t.dataset.pickWeek)), true;
  if (t.matches("[data-step]")) {
    step(t);
    return false; // niente re-render: mantiene la tastiera e la posizione
  }
  if (t.matches("[data-check]")) {
    const row = t.closest(".set-row");
    return toggleSet(t.closest(".set-row"));
  }
  if (t.dataset.closeEx) return setExerciseClosed(t.dataset.closeEx, true), true;
  if (t.dataset.reopenEx) return setExerciseClosed(t.dataset.reopenEx, false), true;
  if (t.dataset.rir && ui.rirFor) {
    const s = active();
    const own = logged(s, ui.rirFor.ex, ui.rirFor.idx);
    if (!own) return false;
    const value = num(t.dataset.rir);
    writeSet(s, ui.rirFor.ex, ui.rirFor.idx, { kg: own.kg, reps: own.reps }, true, { rir: own.rir === value ? null : value });
    haptic(8);
    return true;
  }
  if (t.dataset.noteEx) return editExerciseNote(t.dataset.noteEx), false;
  if (t.dataset.goal) {
    const ed = edits(active().id);
    ed.values[t.dataset.goal] = { kg: num(t.dataset.kg), reps: num(t.dataset.reps) };
    saveEdits(ed);
    return true;
  }
  if (t.matches("[data-kind]")) return cycleKind(t.closest(".set-row")), true;
  if (t.dataset.exMenu) return openExerciseMenu(t.dataset.exMenu), false;
  if (t.matches("[data-add-today]")) return addToday(), false;
  if (t.dataset.unskip) return changePlan((plan) => delete plan.skipped[t.dataset.unskip]), true;
  if (t.dataset.exPage) return openExercisePage(t.dataset.exPage, ui.routine || app.today.routine || "A"), false;
  if (t.matches("[data-edit-program]")) return (ui.editing = !ui.editing), true;
  if (t.dataset.editEx || t.dataset.moveEx || t.matches("[data-add-ex], [data-restore-routine]")) return editProgram(t);
  if (t.dataset.toggleEx) {
    const id = t.dataset.toggleEx;
    if (ui.open.has(id)) ui.open.delete(id);
    else ui.open.add(id);
    return true;
  }
  if (t.dataset.addSet || t.dataset.dropSet) {
    const id = t.dataset.addSet || t.dataset.dropSet;
    const ed = edits(active().id);
    ed.extra[id] = num(ed.extra[id]) + (t.dataset.addSet ? 1 : -1);
    saveEdits(ed);
    return true;
  }
  if (t.matches("[data-cardio]")) {
    const on = !active().cardio_min;
    patchSession({ cardio_min: on ? CARDIO_MIN : null }, "cardio");
    if (on) {
      haptic(15);
      pop(t);
    }
    return true;
  }
  if (t.matches("[data-finish]")) {
    await finish();
    return true;
  }
  if (t.matches("[data-cancel-session]")) {
    const s = active();
    if (!confirm("Annullare questa seduta? Le serie segnate verranno rimosse dallo storico.")) return false;
    enqueue("DELETE", sessionPath(s), undefined, `delete:${s.id}`);
    app.today.active_session = null;
    storage.remove(EDITS_KEY);
    stopRest();
    return true;
  }
  if (t.matches("[data-share-summary]")) return shareSummary(app.sessions.find((x) => x.id === ui.summary.id) || ui.summary), false;
  if (t.matches("[data-close-summary]")) {
    ui.summary = null;
    location.hash = "#dashboard";
    return true;
  }
  if (t.dataset.importDraft) return importLegacyDraft(t.dataset.importDraft), true;
  if (t.dataset.dropDraft) {
    if (!confirm("Scartare questa bozza? I valori non salvati andranno persi.")) return false;
    const drafts = storage.get(LEGACY_DRAFTS_KEY, {});
    delete drafts[t.dataset.dropDraft];
    storage.set(LEGACY_DRAFTS_KEY, drafts);
    return true;
  }
  return false;
}

export function onChange(t) {
  if (t.matches("[data-session-notes]")) {
    patchSession({ notes: t.value.slice(0, 5000) }, "notes");
    return false;
  }
  if (t.matches(".set-row [data-field]")) {
    rememberRow(t.closest(".set-row"));
    return false;
  }
  return false;
}

export function onInput(t) {
  // Le serie già fatte si aggiornano sul server al "change" (fine modifica), non a ogni tasto.
  const row = t.closest(".set-row");
  if (row && !row.classList.contains("done") && t.matches("[data-field]")) rememberRow(row);
}

/** Per la dashboard: sintesi dello stato allenamento di oggi. */
export function todayStatus() {
  const t = app.today;
  const s = active();
  if (s) {
    const { planned, done } = progressOf(s);
    return { kind: "active", routine: s.routine, week: s.week, done, planned };
  }
  const doneToday = t.done_today[0] || app.sessions.find((x) => x.date === t.date && x.status === "done");
  if (doneToday) return { kind: "done", routine: doneToday.routine, week: doneToday.week };
  if (t.routine) return { kind: "planned", routine: t.routine, week: t.program_week };
  return { kind: "rest", week: t.program_week };
}

export const resetUi = () => {
  ui.summary = null;
  ui.rirFor = null;
  ui.editing = false;
  ui.open.clear();
};

