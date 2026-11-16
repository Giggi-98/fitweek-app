// Finestre dell'esercizio: la sua scheda (storia, record, grafico), l'editor (nome, serie per settimana,
// ripetizioni, recupero, gruppo, video) e la scelta di un esercizio da aggiungere o sostituire.
// Le regole sono in program.js e calc.js; qui si salva lo stato e si disegna.
import { request } from "../api.js";
import { lineChart, mountCharts } from "../chart.js";
import { PROGRAM_WEEKS } from "../constants.js";
import { icon } from "../icons.js";
import { app, persistState } from "../store.js";
import { choices, openModal, removalToast, toast } from "../ui.js";
import { $, $$, esc, fmtClock, fmtDate, fmtNum, safeUrl, uid } from "../util.js";
import { exerciseSessions } from "./calc.js";
import { MUSCLES, findExercise, insertExercise, library, muscleOf, plannedSets, removeExercise, replaceExercise, sameExercise, saveExercise } from "./program.js";
import { prefs } from "./timer.js";

const REST_CHOICES = [45, 60, 75, 90, 120, 150, 180, 240];
const NEW_SETS = 3, NEW_REPS = "8–10"; // punto di partenza di un esercizio creato dall'utente: lo cambia nell'editor

let original = null; // scheda del PDF, giornata → esercizi
/** La scheda del PDF (per mostrare le modifiche e ripristinare). Si carica una volta; null finché non arriva
 *  o se il server non è raggiungibile e non c'è una copia: in quel caso il ripristino non viene proposto. */
export function originalProgram() {
  if (!original && !originalProgram.loading) {
    originalProgram.loading = request("/api/v1/program/original")
      .then((out) => ((original = out.routines), app.render()))
      .catch(() => {})
      .finally(() => (originalProgram.loading = null));
  }
  return original;
}

export const restLabel = (ex) => fmtClock(ex.rest || prefs().restSeconds);
export const routinesOf = (id) => Object.keys(app.state.routines).filter((r) => app.state.routines[r].some((e) => e.id === id));
const fmtSet = (s) => `${fmtNum(s.kg)}×${s.reps}`;

async function commit(state, message) {
  app.state = state;
  if (await persistState()) toast(message);
  app.render();
}

// ---- scheda dell'esercizio -------------------------------------------------------------------
const METRICS = {
  kg: { label: "Carico", unit: "kg", value: (h) => h.top.kg, tip: (h) => `× ${h.top.reps} rip.` },
  e1rm: { label: "Massimale", unit: "kg", value: (h) => h.e1rm, tip: (h) => `stimato da ${fmtSet(h.top)}` },
  volume: { label: "Volume", unit: "kg", value: (h) => h.volume, tip: (h) => `${h.sets.length} serie` },
};

/** @param routine giornata da cui è stato aperto (per "Modifica"); null = sola lettura (es. durante la seduta) */
export function openExercisePage(id, routine = null) {
  let metric = "kg";
  const paint = () => {
    const ex = findExercise(app.state, id);
    if (!ex) return;
    const hist = exerciseSessions(app.sessions, id);
    const best = (pick) => hist.reduce((m, h) => Math.max(m, pick(h) ?? 0), 0);
    const days = routinesOf(id);
    const m = METRICS[metric];
    const points = hist.filter((h) => m.value(h) != null).map((h) => ({ date: h.date, value: m.value(h), tip: `${m.tip(h)} · W${h.week}` }));
    const note = app.exNotes[id];
    const video = safeUrl(ex.video);
    const tile = (label, value, sub, badge = "") => `<div class="metric"><div class="metric-label">${label}${badge}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div>`;
    openModal(
      `<h2 id="modal-title">${esc(ex.name)}</h2>
      <p class="subtle">${[days.length ? `Giorno ${days.join(", ")}` : "Non in scheda", `${plannedSets(ex, app.today.program_week)} × ${ex.reps || "—"}`, `recupero ${restLabel(ex)}`, muscleOf(ex)].filter(Boolean).map(esc).join(" · ")}</p>
      ${hist.length
        ? `<div class="metrics three">
            ${tile("Carico massimo", `${fmtNum(best((h) => h.top.kg))}<small> kg</small>`, `${hist.length} ${hist.length === 1 ? "seduta" : "sedute"}`)}
            ${tile("Massimale", best((h) => h.e1rm) ? `~${fmtNum(best((h) => h.e1rm))}<small> kg</small>` : "—", "su una ripetizione", ' <span class="badge-calc">stima</span>')}
            ${tile("Miglior volume", `${fmtNum(best((h) => h.volume), 0)}<small> kg</small>`, "in una seduta", ' <span class="badge-calc">calc.</span>')}
          </div>
          ${choices(Object.entries(METRICS).map(([k, v]) => [k, v.label]), metric, "Grafico", "metric")}
          ${points.length > 1
            ? lineChart({ points, unit: m.unit, label: `${ex.name}, ${m.label.toLowerCase()} per seduta: da ${fmtNum(points[0].value)} a ${fmtNum(points[points.length - 1].value)} ${m.unit} in ${points.length} sedute.` })
            : '<p class="subtle">Il grafico compare dalla seconda seduta.</p>'}
          <ul class="ex-history">${[...hist].reverse().slice(0, 5).map((h) => `<li><span>${esc(fmtDate(h.date))}<small>W${esc(h.week)}</small></span><strong>${esc(h.sets.map(fmtSet).join(" · "))}</strong></li>`).join("")}</ul>
          <p class="subtle">Serie di lavoro (senza riscaldamento). Il massimale è stimato con la formula di Epley fino a 12 ripetizioni: serve a confrontare serie diverse, non è una prova.</p>`
        : '<p class="subtle">Ancora nessuna serie registrata: storia, record e grafico compaiono dopo la prima seduta conclusa.</p>'}
      ${note ? `<div class="inline-note">${icon("notebook-pen")}<div>${esc(note)}</div></div>` : ""}
      <div class="button-row">${routine ? `<button type="button" class="btn" data-m="edit">${icon("pencil", "sm")}Modifica esercizio</button>` : ""}${video ? `<a class="btn" href="${esc(video)}" target="_blank" rel="noopener noreferrer">${icon("circle-play", "sm")}Video</a>` : ""}</div>
      <div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`,
      (t) => {
        if (t.dataset.m === "close") return true;
        if (t.dataset.m === "edit") return openExerciseEditor(routine, ex), false;
        if (t.dataset.metric) return (metric = t.dataset.metric), paint(), false;
        return false;
      },
    );
    mountCharts($("#modal-body"));
  };
  paint();
}

// ---- editor dell'esercizio -------------------------------------------------------------------
/** @param ex esercizio da modificare, oppure uno nuovo non ancora in scheda (verrà aggiunto in fondo) */
export function openExerciseEditor(routine, ex) {
  const list = app.state.routines[routine];
  const inRoutine = list.some((e) => e.id === ex.id);
  const fromPdf = originalProgram()?.[routine]?.find((e) => e.id === ex.id) || null;
  const sets = Array.from({ length: PROGRAM_WEEKS }, (_, w) => plannedSets(ex, w + 1));
  const field = (id, label, input) => `<div class="field"><label for="${id}">${label}</label>${input}</div>`;
  const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`;
  openModal(
    `<h2 id="modal-title">${inRoutine ? "Modifica esercizio" : "Nuovo esercizio"}</h2>
    <p class="subtle">Giorno ${esc(routine)}. Vale dalle prossime sedute: quelle già fatte non cambiano.</p>
    ${field("xe-name", "Nome", `<input id="xe-name" maxlength="120" value="${esc(ex.name)}">`)}
    <div class="form-grid two">
      ${field("xe-reps", "Ripetizioni", `<input id="xe-reps" maxlength="20" value="${esc(ex.reps)}" placeholder="es. 8–10">`)}
      ${field("xe-rest", "Recupero", `<select id="xe-rest">${option("", `Predefinito (${fmtClock(prefs().restSeconds)})`, !ex.rest)}${REST_CHOICES.map((s) => option(s, fmtClock(s), ex.rest === s)).join("")}</select>`)}
    </div>
    <fieldset class="week-sets"><legend>Serie per settimana</legend>
      ${sets.map((n, w) => `<label><span>W${w + 1}</span><input data-week="${w}" inputmode="numeric" maxlength="2" value="${n}" aria-label="Serie nella settimana ${w + 1}"></label>`).join("")}
    </fieldset>
    <div class="form-grid two">
      ${field("xe-muscle", "Gruppo muscolare", `<select id="xe-muscle">${option("", muscleOf({ id: ex.id }) ? `${muscleOf({ id: ex.id })} (predefinito)` : "Non indicato", !ex.muscle)}${MUSCLES.map((m) => option(m, m, ex.muscle === m)).join("")}</select>`)}
      ${field("xe-video", "Video (link https)", `<input id="xe-video" inputmode="url" maxlength="300" value="${esc(ex.video || "")}" placeholder="https://…">`)}
    </div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}${inRoutine ? "Salva" : `Aggiungi al Giorno ${esc(routine)}`}</button>
    <div class="modal-secondary">
      ${inRoutine ? '<button type="button" data-m="replace">Sostituisci</button><button type="button" data-m="remove">Rimuovi</button>' : ""}
      ${fromPdf && !sameExercise(ex, fromPdf) ? '<button type="button" data-m="restore">Come nel PDF</button>' : ""}
      <button type="button" data-m="close">Annulla</button>
    </div>`,
    (t) => {
      const m = t.dataset.m;
      if (m === "close") return true;
      if (m === "restore") return commit(saveExercise(app.state, routine, { ...fromPdf }), "Esercizio riportato a quello del PDF"), true;
      if (m === "remove") {
        const index = list.findIndex((e) => e.id === ex.id);
        app.state = removeExercise(app.state, routine, ex.id);
        persistState();
        app.render();
        removalToast(`${ex.name} tolto dal Giorno ${routine}`, () => (app.state = insertExercise(app.state, routine, ex, index)), () => (persistState(), app.render()));
        return true;
      }
      if (m === "replace") {
        openPicker({
          title: `Sostituisci ${ex.name}`, hint: `Prende il suo posto nel Giorno ${routine}. ${ex.name} resta nello storico e si può riprendere.`,
          exclude: list.map((e) => e.id),
          onPick: (picked, isNew) => (isNew ? (openExerciseEditor(routine, { ...picked, replaces: ex.id }), true) : (commit(replaceExercise(app.state, routine, ex.id, picked), `${picked.name} al posto di ${ex.name}`), false)),
        });
        return false;
      }
      if (m !== "save") return false;
      const name = $("#xe-name").value.trim();
      const weeks = $$("[data-week]").map((i) => Number.parseInt(i.value, 10));
      const video = $("#xe-video").value.trim();
      if (!name) return toast("Scrivi il nome dell'esercizio"), false;
      if (weeks.some((n) => !(n >= 0 && n <= 20))) return toast("Le serie per settimana vanno da 0 a 20"), false;
      if (video && !safeUrl(video)) return toast("Il video deve essere un link https://"), false;
      const { replaces, ...rest } = ex;
      const saved = { ...rest, name, reps: $("#xe-reps").value.trim(), sets: weeks, video, rest: Number($("#xe-rest").value) || null, muscle: $("#xe-muscle").value };
      commit(replaces ? replaceExercise(app.state, routine, replaces, saved) : saveExercise(app.state, routine, saved), inRoutine ? "Esercizio aggiornato" : `${name} aggiunto al Giorno ${routine}`);
      return true;
    },
  );
}

// ---- scelta di un esercizio ------------------------------------------------------------------
/** Elenco degli esercizi disponibili (altre giornate e archivio) più "crea nuovo".
 *  @param onPick (esercizio, isNew) → chiamata alla scelta; con isNew l'esercizio non è ancora nello stato.
 *                Restituisce true se ha aperto un'altra finestra (questa non va chiusa). */
export function openPicker({ title, hint = "", exclude = [], onPick }) {
  const items = library(app.state, exclude);
  const where = (e) => (routinesOf(e.id).length ? `Giorno ${routinesOf(e.id).join(", ")}` : "già usato");
  openModal(
    `<h2 id="modal-title">${esc(title)}</h2>
    ${hint ? `<p class="subtle">${esc(hint)}</p>` : ""}
    <div class="new-ex"><input id="xp-name" maxlength="120" placeholder="Nuovo esercizio: scrivi il nome" aria-label="Nome del nuovo esercizio"><button type="button" class="btn" data-m="new">${icon("plus", "sm")}Crea</button></div>
    ${items.length ? `<div class="pick-group"><span class="eyebrow">Dai tuoi esercizi</span><div class="pick-list">${items.map((e) => `<button type="button" class="pick" data-pick="${esc(e.id)}"><span>${esc(e.name)}</span><small>${esc(where(e))}${e.reps ? ` · ${esc(e.reps)}` : ""}</small></button>`).join("")}</div></div>` : ""}
    <div class="modal-secondary"><button type="button" data-m="close">Annulla</button></div>`,
    (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.pick) return !onPick({ ...items.find((e) => e.id === t.dataset.pick) }, false);
      if (t.dataset.m !== "new") return false;
      const name = $("#xp-name").value.trim();
      if (!name) return toast("Scrivi il nome dell'esercizio"), false;
      return !onPick({ id: `x-${uid().replace(/[^A-Za-z0-9]/g, "").slice(0, 10)}`, name, reps: NEW_REPS, sets: Array(PROGRAM_WEEKS).fill(NEW_SETS), video: "" }, true);
    },
  );
}
