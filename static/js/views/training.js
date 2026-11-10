// Schermata allenamento: avvio seduta, registrazione serie con un tocco, recupero, riepilogo.
import { CARDIO_MIN, PROGRAM_WEEKS, ROUTINES, cardioBpm } from "../constants.js";
import { icon } from "../icons.js";
import { bump, confetti, haptic, pop, ring } from "../motion.js";
import { standalone } from "../platform.js";
import { bestLoads, isRecord } from "../stats.js";
import { app, refreshWorkouts } from "../store.js";
import { openModal, tabs, toast } from "../ui.js";
import { $, clamp, esc, fmtDate, fmtNum, isoDate, num, safeUrl, storage, uid } from "../util.js";
import { enqueue, flush, pendingCount } from "../workout/queue.js";
import { prefs, startRest, stopRest } from "../workout/timer.js";

const EDITS_KEY = "fitweek.workoutEdits.v1";
const LEGACY_DRAFTS_KEY = "fitweek.workoutDrafts.v1";

// Selezione quando non c'è una seduta attiva.
// justDone/justComplete: animazioni da eseguire una sola volta al prossimo render.
// rirFor: ultima serie segnata, per cui si può indicare lo sforzo (RIR) con un tocco facoltativo.
const ui = { routine: null, week: null, summary: null, justDone: null, justComplete: null, rirFor: null, open: new Set() };

// ---- dati derivati ------------------------------------------------------------------------
const active = () => app.today?.active_session || null;
const routineExercises = (r) => app.state.routines[r] || [];
const plannedSets = (ex, week) => num(ex.sets[clamp(week, 1, ex.sets.length) - 1]);
const lastDone = (routine, exceptId) =>
  app.sessions.find((s) => s.routine === routine && s.status === "done" && s.id !== exceptId) || null;
const setsOf = (session, exId) =>
  (session?.sets || []).filter((s) => s.exercise_id === exId).sort((a, b) => a.set_index - b.set_index);
const logged = (session, exId, idx) => (session?.sets || []).find((s) => s.exercise_id === exId && s.set_index === idx);
const parseNum = (v) => (String(v ?? "").trim() === "" ? null : num(String(v).replace(",", "."), null));
const fmtSet = (s) => `${s.kg == null ? "—" : fmtNum(s.kg)}×${s.reps ?? "—"}`;

function edits(sessionId) {
  const e = storage.get(EDITS_KEY, null);
  return e && e.sessionId === sessionId ? e : { sessionId, values: {}, extra: {} };
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
  const exs = routineExercises(session.routine);
  const planned = exs.reduce((n, ex) => n + plannedSets(ex, session.week), 0);
  const done = session.sets.filter((s) => s.completed).length;
  return { planned, done };
}
const volume = (session) =>
  session.sets.filter((s) => s.completed && s.kg != null && s.reps != null).reduce((v, s) => v + s.kg * s.reps, 0);

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

const repRange = (ex) => String(ex.reps).split(/[–-]/).map((x) => num(x.trim(), 0));
/** La volta scorsa tutte le serie previste hanno raggiunto il massimo delle ripetizioni con lo stesso carico. */
function completedTopRange(ex, prev, planned) {
  const top = repRange(ex).pop();
  if (!top || prev.length < planned || prev[0].kg == null) return false;
  return prev.slice(0, planned).every((s) => s.kg === prev[0].kg && (s.reps ?? 0) >= top);
}

function exerciseExtras(session, ex, prev, planned, ed) {
  const note = app.exNotes[ex.id];
  const untouched = !setsOf(session, ex.id).length && !ed.bumped?.[ex.id];
  const step = prefs().kgStep;
  return `${untouched && completedTopRange(ex, prev, planned) ? `<div class="ex-hint">${icon("trending-up", "sm")}<span>L'ultima volta hai chiuso tutte le serie a ${repRange(ex).pop()} ripetizioni.</span><button type="button" class="btn small" data-bump-ex="${esc(ex.id)}">Prova +${esc(String(step).replace(".", ","))} kg</button></div>` : ""}
  <button type="button" class="ex-note ${note ? "has" : ""}" data-note-ex="${esc(ex.id)}">${icon("notebook-pen", "sm")}<span>${note ? esc(note) : "Aggiungi una nota (sedile, presa, fastidi…)"}</span></button>`;
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
// Il cronometro della seduta si aggiorna da solo senza ridisegnare la pagina.
setInterval(() => {
  const el = document.getElementById("wk-elapsed");
  const s = active();
  if (el && s?.started_at) el.textContent = elapsed(s.started_at);
}, 30_000);

function renderStart() {
  const t = app.today;
  const routine = ui.routine || t.routine || "A";
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
    ${tabs(Object.keys(ROUTINES).map((r) => [r, `Giorno ${r}`, null, ROUTINES[r].day.slice(0, 3)]), routine, "Giornata", "pick-routine")}
    <div class="chips scroll week-chips" role="group" aria-label="Settimana">${Array.from({ length: PROGRAM_WEEKS }, (_, i) => i + 1)
      .map((w) => `<button class="chip ${w === week ? "active" : ""} ${w === t.program_week ? "current" : ""}" data-pick-week="${w}">W${w}</button>`)
      .join("")}</div>
    <div class="sticky-cta"><button class="btn primary xl full glow" data-start>${icon("play")}Inizia Giorno ${esc(routine)} · W${week}</button></div>
  </div>
  <section class="panel">
    <div class="panel-head"><h3>${icon("notebook-pen")}Programma</h3>${standalone ? "" : `<a class="btn small" href="/api/original-pdf" target="_blank" rel="noopener">PDF ${icon("arrow-right", "sm")}</a>`}</div>
    <div class="ex-preview">
    ${exs
      .map((ex, i) => {
        const p = setsOf(prev, ex.id).filter((x) => x.completed);
        return `<div class="ex-line"><span class="ex-idx">${i + 1}</span><div class="ex-line-main"><div class="entry-title">${esc(ex.name)}</div><div class="entry-sub">${p.length ? `ultima ${esc(p.map(fmtSet).join(" · "))}` : "prima volta"}</div></div><span class="ex-plan">${plannedSets(ex, week)} × ${esc(ex.reps)}</span></div>`;
      })
      .join("")}
      <div class="ex-line"><span class="ex-idx">${icon("timer", "sm")}</span><div class="ex-line-main"><div class="entry-title">${esc(info?.cardio || "Cardio")}</div><div class="entry-sub">riferimento PDF ${cardioBpm(week)} BPM, non un obiettivo personalizzato</div></div><span class="ex-plan">${CARDIO_MIN}′</span></div>
    </div>
  </section>
  </div>`;
}

function setRow(session, ex, idx, prev, ed, planned, best) {
  const own = logged(session, ex.id, idx);
  const done = own?.completed;
  const record = done && isRecord(best, ex.id, own.kg);
  const v = suggestion(session, ex, idx, prev, ed);
  const extra = idx > planned;
  const just = ui.justDone === `${ex.id}:${idx}` ? "just-done" : "";
  return `<div class="set-row ${done ? "done" : ""} ${extra ? "extra" : ""} ${just}" data-ex="${esc(ex.id)}" data-idx="${idx}">
    <span class="set-num ${record ? "pr" : ""}" aria-label="Serie ${idx}${record ? ", record di carico" : ""}"${record ? ' title="Record di carico"' : ""}>${record ? icon("trophy", "sm") : idx}</span>
    <div class="stepper"><button type="button" data-step="kg" data-dir="-1" aria-label="Meno peso">${icon("minus")}</button><input data-field="kg" type="text" inputmode="decimal" autocomplete="off" aria-label="Peso serie ${idx} ${esc(ex.name)}" placeholder="kg" value="${esc(v.kg == null ? "" : String(v.kg).replace(".", ","))}"><button type="button" data-step="kg" data-dir="1" aria-label="Più peso">${icon("plus")}</button></div>
    <div class="stepper"><button type="button" data-step="reps" data-dir="-1" aria-label="Meno ripetizioni">${icon("minus")}</button><input data-field="reps" type="text" inputmode="numeric" autocomplete="off" aria-label="Ripetizioni serie ${idx} ${esc(ex.name)}" placeholder="${esc(String(ex.reps).split(/[–-]/)[0])}" value="${esc(v.reps ?? "")}"><button type="button" data-step="reps" data-dir="1" aria-label="Più ripetizioni">${icon("plus")}</button></div>
    <button type="button" class="set-check" data-check aria-pressed="${done ? "true" : "false"}" aria-label="${done ? "Annulla serie" : "Serie fatta"} ${idx}">${icon("check")}</button>
  </div>`;
}

function renderActive(session) {
  const ed = edits(session.id);
  const prevSession = lastDone(session.routine, session.id);
  const exs = routineExercises(session.routine);
  const { planned, done } = progressOf(session);
  const info = ROUTINES[session.routine];
  const best = bestLoads(app.sessions, session.id);
  const nextEx = exs.find((ex) => setsOf(session, ex.id).filter((s) => s.completed).length < plannedSets(ex, session.week));
  const html = `
  <section class="wk-header">
    ${ring(planned ? done / planned : 0, { size: 62, stroke: 7, label: String(done), sub: `/${planned}` })}
    <div class="ex-main">
      <h2>Giorno ${esc(session.routine)} · W${esc(session.week)}</h2>
      <div class="wk-meta"><span>${icon("clock")}<span id="wk-elapsed">${session.started_at ? elapsed(session.started_at) : "—"}</span></span><span>${icon("dumbbell")}${done}/${planned} serie</span>${nextEx ? `<span>${icon("arrow-right")}${esc(nextEx.name)}</span>` : `<span>${icon("trophy")}Serie completate</span>`}</div>
    </div>
  </section>
  <div class="ex-grid">
  ${exs
    .map((ex, i) => {
      const p = plannedSets(ex, session.week);
      const prev = setsOf(prevSession, ex.id).filter((x) => x.completed);
      const loggedIdx = setsOf(session, ex.id).map((s) => s.set_index);
      const count = Math.max(p + num(ed.extra[ex.id]), ...loggedIdx, p);
      const completed = setsOf(session, ex.id).filter((s) => s.completed).length;
      const isDone = completed >= p;
      const open = !isDone || ui.open.has(ex.id);
      const video = safeUrl(ex.video);
      const dots = Array.from({ length: Math.max(p, completed) }, (_, k) => `<i class="${k < completed ? "on" : ""}"></i>`).join("");
      const cls = [isDone ? "done" : "", open ? "open" : "", nextEx?.id === ex.id ? "next" : "", ui.justComplete === ex.id ? "just-complete" : ""].join(" ");
      return `<section class="ex-card ${cls}" id="ex-${esc(ex.id)}">
        <div class="ex-head">
          <button type="button" class="ex-toggle" ${isDone ? `data-toggle-ex="${esc(ex.id)}" aria-expanded="${open}"` : 'tabindex="-1"'}>
            <span class="ex-num">${isDone ? icon("check", "sm") : i + 1}</span>
            <span class="ex-main"><span class="ex-name">${esc(ex.name)}</span>
            <span class="ex-meta">${p} × ${esc(ex.reps)} rip.${isDone && !open ? ` · ${esc(setsOf(session, ex.id).filter((x) => x.completed).map(fmtSet).join(" · "))}` : ""}</span>
            <span class="ex-dots" aria-label="${completed} serie su ${p}">${dots}</span></span>
          </button>
          ${video ? `<a href="${esc(video)}" target="_blank" rel="noopener noreferrer" class="icon-link" aria-label="Video esecuzione">${icon("circle-play")}</a>` : ""}
        </div>
        ${open ? `
        ${prev.length ? `<div class="ex-last">Ultima volta${prevSession ? ` (${esc(fmtDate(prevSession.date))}, W${esc(prevSession.week)})` : ""}: ${esc(prev.map(fmtSet).join(" · "))}</div>` : '<div class="ex-last">Prima volta: scegli un carico con cui completi le ripetizioni con buona tecnica.</div>'}
        ${exerciseExtras(session, ex, prev, p, ed)}
        <div class="set-legend" aria-hidden="true"><span>#</span><span>kg</span><span>rip.</span><span></span></div>
        ${Array.from({ length: count }, (_, k) => setRow(session, ex, k + 1, prev, ed, p, best)).join("")}
        <button type="button" class="link-btn" data-add-set="${esc(ex.id)}">${icon("plus", "sm")}Serie extra</button>` : ""}
        ${rirStrip(session, ex)}
      </section>`;
    })
    .join("")}
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

function renderSummary(s) {
  const { planned, done } = progressOf(s);
  const vol = volume(s);
  const prev = lastDone(s.routine, s.id);
  const prevVol = prev ? volume(prev) : null;
  const diff = prevVol ? Math.round(((vol - prevVol) / prevVol) * 100) : null;
  const records = recordsOf(s);
  return `<section class="hero finish">
    <div class="trophy">${icon("trophy")}</div>
    <div><span class="eyebrow">Seduta completata · ${esc(fmtDate(s.date))}</span><h2>Giorno ${esc(s.routine)} · W${esc(s.week)}</h2></div>
    <div class="metrics">
      <div class="metric"><div class="metric-label">Serie</div><div class="metric-value"><span data-count="${done}">${done}</span><small>/${planned}</small></div></div>
      <div class="metric"><div class="metric-label">Durata</div><div class="metric-value">${s.duration_min != null ? `<span data-count="${Math.round(s.duration_min)}">${esc(Math.round(s.duration_min))}</span><small>′</small>` : "—"}</div></div>
      <div class="metric"><div class="metric-label">Volume <span class="badge-calc">calc.</span></div><div class="metric-value"><span data-count="${Math.round(vol)}">${fmtNum(vol, 0)}</span><small> kg</small></div></div>
    </div>
    <p class="subtle">${diff == null ? "Volume = Σ kg × ripetizioni." : `Volume ${diff >= 0 ? "+" : ""}${diff}% rispetto all'ultimo Giorno ${esc(s.routine)}.`} ${done < planned ? `${planned - done} serie non segnate: va bene, conta la costanza.` : "Tutte le serie fatte."}${s.cardio_min ? " Cardio ✓." : ""}</p>
    ${records.length ? `<div class="record-note">${icon("trophy", "sm")}<span>${records.length === 1 ? "Record di carico" : `${records.length} record di carico`}: ${esc(records.map((r) => `${r.name} ${fmtNum(r.kg)} kg`).join(" · "))}</span></div>` : ""}
    <button class="btn primary xl full" data-close-summary>Fatto</button>
  </section>`;
}

/** Esercizi in cui la seduta ha superato il carico massimo precedente (uno per esercizio). */
function recordsOf(session) {
  const best = bestLoads(app.sessions, session.id);
  return routineExercises(session.routine)
    .map((ex) => {
      const loads = setsOf(session, ex.id).filter((x) => x.completed && x.kg != null).map((x) => x.kg);
      return { id: ex.id, name: ex.name, kg: loads.length ? Math.max(...loads) : null };
    })
    .filter((r) => isRecord(best, r.id, r.kg));
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

function rowValues(row) {
  return { kg: parseNum($("[data-field=kg]", row).value), reps: parseNum($("[data-field=reps]", row).value) };
}

function writeSet(session, exId, idx, values, completed, rir = logged(session, exId, idx)?.rir ?? null) {
  const rest = session.sets.filter((x) => !(x.exercise_id === exId && x.set_index === idx));
  const item = { exercise_id: exId, set_index: idx, kg: values.kg, reps: values.reps, rir, completed, logged_at: new Date().toISOString() };
  session.sets = [...rest, item];
  enqueue("PUT", setPath(session, exId, idx), { kg: values.kg, reps: values.reps, rir, completed }, `set:${exId}:${idx}:${session.id}`);
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
  startRest();
  haptic(isRecord(bestLoads(app.sessions, s.id), exId, v.kg) ? [15, 40, 15, 40, 40] : 15);
  ui.justDone = `${exId}:${idx}`;
  ui.rirFor = { ex: exId, idx };
  const ex = routineExercises(s.routine).find((e) => e.id === exId);
  if (ex && setsOf(s, exId).filter((x) => x.completed).length === plannedSets(ex, s.week)) {
    ui.justComplete = exId;
    ui.open.delete(exId);
    haptic([20, 60, 30]);
    requestAnimationFrame(() => confetti(document.getElementById(`ex-${exId}`), 24));
  }
  return true;
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
  if (!pendingCount()) refreshWorkouts().catch(() => {});
}

function editExerciseNote(exId) {
  const ex = Object.values(app.state.routines).flat().find((e) => e.id === exId);
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
    if (!toggleSet(row)) return false;
    const card = row.closest(".ex-card");
    requestAnimationFrame(() => {
      const next = card && document.getElementById(card.id)?.querySelector(".set-row:not(.done)");
      if (!next) document.querySelector(".ex-card.next")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return true;
  }
  if (t.dataset.rir && ui.rirFor) {
    const s = active();
    const own = logged(s, ui.rirFor.ex, ui.rirFor.idx);
    if (!own) return false;
    const value = num(t.dataset.rir);
    writeSet(s, ui.rirFor.ex, ui.rirFor.idx, { kg: own.kg, reps: own.reps }, true, own.rir === value ? null : value);
    haptic(8);
    return true;
  }
  if (t.dataset.noteEx) return editExerciseNote(t.dataset.noteEx), false;
  if (t.dataset.bumpEx) {
    // Proposta, non regola: precompila le serie con il carico dell'ultima volta + un passo.
    const s = active();
    const ex = routineExercises(s.routine).find((e) => e.id === t.dataset.bumpEx);
    const prev = setsOf(lastDone(s.routine, s.id), ex.id).filter((x) => x.completed);
    const ed = edits(s.id);
    for (let idx = 1; idx <= plannedSets(ex, s.week); idx++) {
      ed.values[`${ex.id}:${idx}`] = { kg: Math.round((prev[0].kg + prefs().kgStep) * 100) / 100, reps: repRange(ex)[0] };
    }
    ed.bumped = { ...ed.bumped, [ex.id]: true };
    saveEdits(ed);
    return true;
  }
  if (t.dataset.toggleEx) {
    const id = t.dataset.toggleEx;
    if (ui.open.has(id)) ui.open.delete(id);
    else ui.open.add(id);
    return true;
  }
  if (t.dataset.addSet) {
    const s = active();
    const ed = edits(s.id);
    ed.extra[t.dataset.addSet] = num(ed.extra[t.dataset.addSet]) + 1;
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
  ui.open.clear();
};

