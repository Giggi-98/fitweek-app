// Progressi: peso e girovita (registrati), medie settimanali (calcolate), storico e carichi.
import { request } from "../api.js";
import { app, persistState, recordWeight, refreshDaily, refreshWorkouts } from "../store.js";
import { lineChart } from "../chart.js";
import { DAYS, GYM, PROGRAM_WEEKS, ROUTINES } from "../constants.js";
import { consistency, exerciseHistory, mondayOf, movingAverage } from "../stats.js";
import { openSleepLog } from "../reminders.js";
import { closeModal, dayOptions, empty, openModal, panel, stat, tabs, toast } from "../ui.js";
import { enqueue, flush } from "../workout/queue.js";
import { icon } from "../icons.js";
import { esc, fmtDate, fmtDuration, fmtNum, isoDate, num } from "../util.js";

const ui = { exercise: null, tab: "weight", list: "readings", loads: "trend" };
const SCHEDULE = Object.fromEntries(DAYS.map((d, i) => [i, GYM[d]]).filter(([, r]) => r));

const readings = () =>
  [...app.state.weights].filter((a) => num(a.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));

function weeklyAverages() {
  const groups = new Map();
  for (const w of app.state.weights) {
    const k = mondayOf(w.date);
    groups.set(k, [...(groups.get(k) || []), num(w.weight)]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([week, vals]) => ({ week, avg: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length }));
}

const signed = (n, digits = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmtNum(Math.abs(n), digits)}`;

function weightTiles(arr) {
  const avg = movingAverage(arr);
  const last = arr[arr.length - 1];
  const nowAvg = avg[avg.length - 1];
  const change = nowAvg.value - avg[0].value;
  return `<div class="tiles three">
      ${stat(`${icon("scale", "sm")}Ultima pesata`, `${fmtNum(last.weight)}<small> kg</small>`, esc(fmtDate(last.date)))}
      ${stat(`${icon("chart-line", "sm")}Media 7 giorni`, `${fmtNum(nowAvg.value)}<small> kg</small>`, `su ${nowAvg.n} ${nowAvg.n === 1 ? "pesata" : "pesate"}`, { calc: true })}
      ${stat(`${icon("trending-up", "sm")}Dall'inizio`, arr.length > 1 ? `${signed(change)}<small> kg</small>` : "—", arr.length > 1 ? `media, dal ${esc(fmtDate(arr[0].date))}` : "serve una seconda pesata", { calc: true })}
    </div>`;
}

function weightPanel(arr) {
  if (!arr.length) return empty("Ancora nessuna pesata", "Inserisci il primo peso per vedere l'andamento.");
  const avg = movingAverage(arr);
  const withAvg = arr.length >= 3; // con una o due pesate la media coincide con i punti: non aggiunge nulla
  const last = arr[arr.length - 1];
  return `${lineChart({
      points: arr.map((a) => ({ date: a.date, value: num(a.weight), tip: a.note || "" })),
      overlay: withAvg ? { name: "media 7 gg", points: avg } : null,
      dots: withAvg ? "raw" : "series",
      unit: "kg",
      label: `Peso da ${fmtNum(arr[0].weight)} a ${fmtNum(last.weight)} kg in ${arr.length} pesate. Valori nella tabella accanto.`,
      legend: withAvg ? [["raw", "Pesata"], ["line", 'Media mobile 7 giorni <span class="badge-calc">calcolata</span>']] : [],
    })}
    <p class="subtle">Le oscillazioni da un giorno all'altro sono normali (acqua, sale, orario): guarda la media.</p>`;
}

// Orari serali contati dalle 18:00, così mezzanotte non spezza l'asse (23:30 < 00:30).
const EVENING = 18 * 60;
const eveningMinutes = (hhmm) => (num(hhmm.slice(0, 2)) * 60 + num(hhmm.slice(3)) - EVENING + 1440) % 1440;
const eveningClock = (v) => {
  const m = (Math.round(v) + EVENING) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

function sleepTab() {
  const add = `<button class="btn small" data-add-sleep>${icon("plus", "sm")}Notte</button>`;
  const nights = app.sleep.items;
  if (!nights.length) return panel(`${icon("moon")}Sonno`, empty("Nessuna notte registrata", "Aggiungi quando sei andato a letto e quando ti sei svegliato: bastano orari indicativi."), add);
  const sum = app.sleep.summary;
  const values = nights.map((n) => eveningMinutes(n.bed_time));
  const lo = Math.floor(Math.min(...values) / 60) * 60;
  const hi = Math.max(lo + 120, Math.ceil(Math.max(...values) / 60) * 60);
  const ticks = [];
  for (let v = lo; v <= hi; v += hi - lo > 240 ? 120 : 60) ticks.push(v);
  const last = nights[nights.length - 1];
  return `<div class="tiles three">
      ${stat(`${icon("clock", "sm")}Durata media`, esc(fmtDuration(sum.duration_avg_min)), `${sum.nights} ${sum.nights === 1 ? "notte" : "notti"}`, { calc: true })}
      ${stat(`${icon("moon", "sm")}A letto in media`, esc(sum.bedtime_avg), "ultimi 60 giorni", { calc: true })}
      ${stat(`${icon("bed-double", "sm")}Ultima notte`, esc(fmtDuration(last.duration_min)), esc(fmtDate(last.date)))}
    </div>
    <div class="split wide-left">${panel(
      `${icon("moon")}Orario in cui vai a letto`,
      nights.length > 1
        ? lineChart({
            points: nights.map((n, i) => ({ date: n.date, value: values[i], tip: `sveglia ${n.wake_time} · ${fmtDuration(n.duration_min)}` })),
            ticks, format: eveningClock, area: false, // un orario non è una quantità: niente area sotto la linea
            label: `Orario in cui sei andato a letto in ${nights.length} notti, in media alle ${sum.bedtime_avg}. Valori nell'elenco accanto.`,
          })
        : empty("Serve una seconda notte", "Il grafico compare con almeno due notti registrate."),
      add,
    )}${panel(
      `${icon("list-checks")}Ultime notti`,
      `<div class="table-scroll"><table><thead><tr><th>Risveglio</th><th>A letto</th><th>Sveglia</th><th>Durata</th></tr></thead><tbody>${[...nights].reverse().slice(0, 7).map((n) => `<tr class="clickable" role="button" tabindex="0" data-edit-sleep="${esc(n.date)}" aria-label="Modifica la notte del ${esc(fmtDate(n.date))}"><td>${esc(fmtDate(n.date))}</td><td>${esc(n.bed_time)}</td><td>${esc(n.wake_time)}</td><td>${esc(fmtDuration(n.duration_min))}</td></tr>`).join("")}</tbody></table></div>`,
    )}</div>`;
}

function consistencyPanel() {
  const weeks = app.today.program_weeks || PROGRAM_WEEKS;
  const c = consistency(app.sessions, app.state.profile.startDate, app.today.date, weeks, SCHEDULE);
  const LABEL = { done: "fatta", missed: "non fatta", today: "oggi", upcoming: "in programma" };
  const cell = (x) =>
    `<td class="${x.state}${x.week === app.today.program_week ? " current" : ""}" aria-label="Settimana ${x.week}, giorno ${esc(x.routine)}: ${LABEL[x.state]}" title="${esc(fmtDate(x.date))} · ${LABEL[x.state]}">${x.state === "done" ? icon("check", "sm") : ""}</td>`;
  const routines = Object.values(SCHEDULE);
  return `<p class="cons-head"><strong>${c.done}</strong> ${c.done === 1 ? "seduta fatta" : "sedute fatte"} su ${c.due} in programma finora</p>
    <div class="table-scroll"><table class="cons"><thead><tr><th scope="col"><span class="sr-only">Giorno</span></th>${Array.from({ length: weeks }, (_, i) => `<th scope="col" class="${i + 1 === app.today.program_week ? "current" : ""}">W${i + 1}</th>`).join("")}</tr></thead>
    <tbody>${routines.map((r) => `<tr><th scope="row">${esc(r)}<small>${esc(ROUTINES[r]?.day.slice(0, 3) || "")}</small></th>${c.cells.filter((x) => x.routine === r).map(cell).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="subtle">Una seduta recuperata in un altro giorno vale per la sua settimana. Conta la continuità nel tempo, non la settimana perfetta.</p>`;
}

function exercisePanel() {
  const all = Object.entries(app.state.routines).flatMap(([routine, exs]) => exs.map((ex) => ({ ...ex, routine })));
  const withData = all.filter((ex) => exerciseHistory(app.sessions, ex.id).length);
  if (!withData.length) return empty("Nessun carico registrato", "Il grafico compare dopo la prima seduta conclusa.");
  const ex = withData.find((e) => e.id === ui.exercise) || withData[0];
  const hist = exerciseHistory(app.sessions, ex.id);
  const best = hist.reduce((a, b) => (b.kg > a.kg ? b : a));
  const last = hist[hist.length - 1];
  const options = Object.keys(app.state.routines)
    .map((r) => {
      const items = withData.filter((e) => e.routine === r);
      return items.length ? `<optgroup label="Giorno ${esc(r)}">${items.map((e) => `<option value="${esc(e.id)}" ${e.id === ex.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</optgroup>` : "";
    })
    .join("");
  return `<div class="field"><label for="ex-pick">Esercizio</label><select id="ex-pick" data-ex-pick>${options}</select></div>
    <div class="metrics three">
      ${stat("Ultima", `${fmtNum(last.kg)}<small> kg</small>`, `× ${esc(last.reps ?? "—")} rip. · ${esc(fmtDate(last.date))}`)}
      ${stat("Carico massimo", `${fmtNum(best.kg)}<small> kg</small>`, esc(fmtDate(best.date)))}
      ${stat("Dalla prima", hist.length > 1 ? `${signed(last.kg - hist[0].kg)}<small> kg</small>` : "—", `${hist.length} ${hist.length === 1 ? "seduta" : "sedute"}`, { calc: true })}
    </div>
    ${hist.length > 1
      ? lineChart({
          points: hist.map((h) => ({ date: h.date, value: h.kg, tip: `× ${h.reps ?? "—"} rip. · W${h.week}` })),
          unit: "kg",
          label: `${ex.name}: serie più pesante per seduta, da ${fmtNum(hist[0].kg)} a ${fmtNum(last.kg)} kg in ${hist.length} sedute. Valori nella tabella sotto.`,
        })
      : '<p class="subtle">Il grafico dell\'andamento compare dalla seconda seduta.</p>'}
    <p class="subtle">Serie più pesante di ogni seduta. Il carico sale quando completi le ripetizioni con buona tecnica.</p>
    <div class="table-scroll"><table><thead><tr><th>Seduta</th><th>Serie più pesante</th><th>Volume <span class="badge-calc">calc.</span></th></tr></thead><tbody>${[...hist].reverse().slice(0, 4).map((h) => `<tr><td>${esc(fmtDate(h.date))}<small>W${esc(h.week)} · ${h.sets} serie</small></td><td>${fmtNum(h.kg)} kg × ${esc(h.reps ?? "—")}</td><td>${fmtNum(h.volume, 0)} kg</td></tr>`).join("")}</tbody></table></div>`;
}

function loadsTable() {
  const rows = [];
  for (const [routine, exs] of Object.entries(app.state.routines)) {
    for (const ex of exs) {
      const hist = exerciseHistory(app.sessions, ex.id);
      if (!hist.length) continue;
      const last = hist[hist.length - 1];
      const prev = hist[hist.length - 2];
      const delta = prev ? last.kg - prev.kg : null;
      rows.push(`<tr><td>${esc(ex.name)}<small>Giorno ${esc(routine)}</small></td><td>${fmtNum(last.kg)} kg<small>${esc(fmtDate(last.date))}</small></td><td>${delta == null ? "—" : `${signed(delta)} kg`}</td></tr>`);
    }
  }
  return rows.length
    ? `<div class="table-scroll"><table><thead><tr><th>Esercizio</th><th>Carico max ultima</th><th>vs precedente</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : empty("Nessun carico registrato", "I confronti compaiono dopo le prime sedute.");
}

function weightTab() {
  const arr = readings();
  const weigh = [...app.state.weights].sort((a, b) => b.date.localeCompare(a.date));
  const weekly = weeklyAverages();
  return `${arr.length ? weightTiles(arr) : ""}
  <div class="split wide-left">${panel(`${icon("scale")}Andamento del peso`, weightPanel(arr), "", "chart-panel")}
  ${panel(
    `${icon("pencil")}Pesate`,
    `${tabs([["readings", "Misurazioni", null, weigh.length], ["weekly", "Medie settimanali"]], ui.list, "Elenco", "list")}
    ${ui.list === "weekly"
      ? weekly.length
        ? `<div class="table-scroll"><table><thead><tr><th>Settimana dal</th><th>Media <span class="badge-calc">calc.</span></th><th>Pesate</th></tr></thead><tbody>${weekly.slice(0, 8).map((w) => `<tr><td>${esc(fmtDate(w.week))}</td><td>${fmtNum(w.avg)} kg</td><td>${w.n}</td></tr>`).join("")}</tbody></table></div>`
        : empty("Nessuna media", "Servono alcune pesate.")
      : weigh.length
        ? `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Peso</th><th>Vita</th><th></th></tr></thead><tbody>${weigh.slice(0, 7).map((a) => `<tr class="clickable" role="button" tabindex="0" data-edit-weight="${esc(a.id)}" aria-label="Modifica pesata del ${esc(fmtDate(a.date))}"><td>${esc(fmtDate(a.date))}</td><td>${fmtNum(a.weight)} kg</td><td>${a.waist ? fmtNum(a.waist) + " cm" : "—"}</td><td class="cell-action"><button type="button" class="icon-btn" data-del-weight="${esc(a.id)}" aria-label="Elimina misurazione">${icon("trash-2", "sm")}</button></td></tr>`).join("")}</tbody></table></div>${weigh.length > 7 ? `<p class="subtle">Ultime 7 di ${weigh.length} misurazioni.</p>` : ""}`
        : empty("Ancora nessuna pesata", "Registra la prima qui sotto.")}
    <details class="free"><summary>${icon("plus", "sm")}Registra peso e girovita</summary><form id="weight-form" class="stack"><div class="form-grid"><div class="field"><label for="w-date">Giorno</label><select id="w-date" name="date">${dayOptions()}</select></div><div class="field"><label for="w-kg">Peso (kg)</label><input id="w-kg" type="number" name="weight" min="20" max="500" step="0.1" required inputmode="decimal" placeholder="es. 89,4"></div><div class="field"><label for="w-waist">Girovita (cm) · facoltativo</label><input id="w-waist" type="number" name="waist" min="20" max="250" step="0.1" inputmode="decimal"></div><div class="field"><label for="w-note">Nota · facoltativa</label><input id="w-note" name="note" maxlength="500" placeholder="es. mattina a digiuno"></div></div><button class="btn primary" type="submit">${icon("scale", "sm")}Registra misurazione</button></form></details>`,
  )}</div>`;
}

function historyPanel() {
  const sessions = app.sessions.filter((s) => s.status === "done");
  return panel(
    `${icon("calendar")}Storico allenamenti`,
    sessions.length
      ? sessions
          .map((s) => {
            const names = Object.fromEntries((app.state.routines[s.routine] || []).map((e) => [e.id, e.name]));
            const done = s.sets.filter((x) => x.completed);
            return `<div class="entry"><div><div class="entry-title">${esc(fmtDate(s.date))} · Giorno ${esc(s.routine)} · W${esc(s.week)}</div><div class="entry-sub">${done.length} serie${s.duration_min ? ` · ${esc(Math.round(s.duration_min))} min` : ""}${s.cardio_min ? " · cardio fatto" : ""}${s.notes ? " · " + esc(s.notes) : ""}</div><details><summary>Dettaglio</summary><div class="subtle">${done.map((x) => `${esc(names[x.exercise_id] || x.exercise_id)} #${x.set_index}: ${x.kg == null ? "—" : esc(fmtNum(x.kg))} kg × ${esc(x.reps)}${x.rir == null ? "" : ` · RIR ${x.rir === 4 ? "4+" : esc(x.rir)}`}`).join("<br>")}</div></details></div><div class="row-actions"><button type="button" class="icon-btn" data-edit-session="${esc(s.id)}" aria-label="Modifica seduta">${icon("pencil", "sm")}</button><button type="button" class="icon-btn" data-del-session="${esc(s.id)}" aria-label="Elimina seduta">${icon("trash-2", "sm")}</button></div></div>`;
          })
          .join("")
      : empty("Nessun allenamento registrato", "Inizia dalla schermata Palestra."),
  );
}

const trainingTab = () =>
  `<div class="split"><div class="stack">${panel(`${icon("list-checks")}Costanza`, consistencyPanel())}${historyPanel()}</div>
  ${panel(
    `${icon("trending-up")}Carichi`,
    `${tabs([["trend", "Per esercizio"], ["recent", "Ultimi carichi"]], ui.loads, "Carichi", "loads")}${ui.loads === "recent" ? loadsTable() : exercisePanel()}`,
    "", "", "ex-panel",
  )}</div>`;

export function render() {
  const body = ui.tab === "training" ? trainingTab() : ui.tab === "sleep" ? sleepTab() : weightTab();
  return `${tabs([["weight", "Peso", "scale"], ["training", "Allenamento", "dumbbell"], ["sleep", "Sonno", "moon"]], ui.tab, "Progressi")}${body}`;
}

// ---- modifica successiva -------------------------------------------------------------------
const parse = (v) => (String(v ?? "").trim() === "" ? null : num(String(v).replace(",", "."), null));

function editWeight(w) {
  openModal(
    `<div class="modal-ic">${icon("scale")}</div><h2 id="modal-title">Modifica pesata</h2>
    <div class="form-grid">
      <div class="field"><label for="ew-date">Giorno</label><select id="ew-date">${dayOptions(w.date, 60)}</select></div>
      <div class="field"><label for="ew-kg">Peso (kg)</label><input id="ew-kg" inputmode="decimal" value="${esc(String(w.weight).replace(".", ","))}"></div>
      <div class="field"><label for="ew-waist">Girovita (cm)</label><input id="ew-waist" inputmode="decimal" value="${esc(w.waist == null ? "" : String(w.waist).replace(".", ","))}"></div>
      <div class="field"><label for="ew-note">Nota</label><input id="ew-note" maxlength="500" value="${esc(w.note || "")}"></div>
    </div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}Salva</button>
    <div class="modal-secondary"><button type="button" data-m="delete">Elimina</button><button type="button" data-m="close">Annulla</button></div>`,
    async (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.m === "delete") {
        if (!confirm("Eliminare questa pesata?")) return false;
        app.state.weights = app.state.weights.filter((x) => x.id !== w.id);
      } else if (t.dataset.m === "save") {
        const kg = parse(document.getElementById("ew-kg").value);
        if (!kg || kg < 20 || kg > 500) return toast("Peso non valido"), false;
        Object.assign(w, {
          date: document.getElementById("ew-date").value, weight: kg,
          waist: parse(document.getElementById("ew-waist").value), note: document.getElementById("ew-note").value,
        });
      } else return false;
      if (await persistState()) toast("Pesata aggiornata");
      refreshDaily().then(() => app.render()).catch(() => {});
      app.render();
      return true;
    },
  );
}

function editSession(s) {
  const names = Object.fromEntries((app.state.routines[s.routine] || []).map((e) => [e.id, e.name]));
  const sets = [...s.sets].sort((a, b) => a.exercise_id.localeCompare(b.exercise_id) || a.set_index - b.set_index);
  const volume = () =>
    [...document.querySelectorAll(".es-row:not(.removed)")].reduce((v, r) => {
      const kg = parse(r.querySelector("[name=kg]").value);
      const reps = parse(r.querySelector("[name=reps]").value);
      return v + (kg != null && reps != null ? kg * reps : 0);
    }, 0);
  openModal(
    `<div class="modal-ic">${icon("dumbbell")}</div><h2 id="modal-title">Giorno ${esc(s.routine)} · W${esc(s.week)}</h2>
    <div class="form-grid">
      <div class="field"><label for="es-date">Giorno</label><select id="es-date">${dayOptions(s.date, 60)}</select></div>
      <div class="field"><label for="es-dur">Durata (min)</label><input id="es-dur" inputmode="numeric" value="${esc(s.duration_min == null ? "" : Math.round(s.duration_min))}"></div>
    </div>
    <div class="es-list">${sets.map((x) => `<div class="es-row" data-ex="${esc(x.exercise_id)}" data-idx="${x.set_index}" data-rir="${x.rir ?? ""}">
      <span class="es-name">${esc(names[x.exercise_id] || x.exercise_id)} <small>#${x.set_index}</small></span>
      <input name="kg" inputmode="decimal" aria-label="kg" value="${esc(x.kg == null ? "" : String(x.kg).replace(".", ","))}"><span class="es-x">kg ×</span>
      <input name="reps" inputmode="numeric" aria-label="ripetizioni" value="${esc(x.reps ?? "")}">
      <button type="button" class="icon-btn" data-m="remove" aria-label="Togli serie">${icon("x", "sm")}</button>
    </div>`).join("") || '<p class="subtle">Nessuna serie registrata.</p>'}</div>
    <div class="tray-total"><span>Volume</span><strong id="es-vol">${fmtNum(volume() || s.sets.reduce((v, x) => v + (x.kg ?? 0) * (x.reps ?? 0), 0), 0)} kg</strong><small>calcolato · Σ kg × ripetizioni</small></div>
    <div class="field"><label for="es-notes">Note</label><textarea id="es-notes" rows="2" maxlength="5000">${esc(s.notes || "")}</textarea></div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}Salva modifiche</button>
    <div class="modal-secondary"><button type="button" data-m="close">Annulla</button></div>`,
    async (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.m === "remove") {
        const row = t.closest(".es-row");
        row.classList.toggle("removed");
        document.getElementById("es-vol").textContent = `${fmtNum(volume(), 0)} kg`;
        return false;
      }
      if (t.dataset.m !== "save") return false;
      const base = `/api/v1/workout-sessions/${encodeURIComponent(s.id)}`;
      for (const row of document.querySelectorAll(".es-row")) {
        const path = `${base}/sets/${encodeURIComponent(row.dataset.ex)}/${row.dataset.idx}`;
        if (row.classList.contains("removed")) enqueue("DELETE", path, undefined, `set:${row.dataset.ex}:${row.dataset.idx}:${s.id}`);
        else {
          const reps = parse(row.querySelector("[name=reps]").value);
          if (reps == null) return toast("Ogni serie ha bisogno delle ripetizioni"), false;
          enqueue("PUT", path, { kg: parse(row.querySelector("[name=kg]").value), reps, rir: parse(row.dataset.rir), completed: true }, `set:${row.dataset.ex}:${row.dataset.idx}:${s.id}`);
        }
      }
      const dur = parse(document.getElementById("es-dur").value);
      enqueue("PATCH", base, { date: document.getElementById("es-date").value, notes: document.getElementById("es-notes").value.slice(0, 5000), ...(dur != null ? { duration_min: dur } : {}) }, `patch:edit:${s.id}`);
      await flush();
      try {
        await Promise.all([refreshWorkouts(), refreshDaily()]);
      } catch {
        /* offline: verrà inviato più tardi */
      }
      toast("Seduta aggiornata");
      app.render();
      return true;
    },
  );
  // ricalcolo dal vivo del volume mentre si scrive
  document.querySelector(".es-list")?.addEventListener("input", () => {
    document.getElementById("es-vol").textContent = `${fmtNum(volume(), 0)} kg`;
  });
}

export async function onClick(t) {
  if (t.dataset.tab) return (ui.tab = t.dataset.tab), true;
  if (t.dataset.list) return (ui.list = t.dataset.list), true;
  if (t.dataset.loads) return (ui.loads = t.dataset.loads), true;
  if (t.matches("[data-add-sleep]")) return openSleepLog({ date: app.today.date }), false;
  if (t.dataset.editSleep) return openSleepLog({ date: t.dataset.editSleep }), false;
  if (t.dataset.editWeight) {
    const w = app.state.weights.find((x) => x.id === t.dataset.editWeight);
    if (w) editWeight(w);
    return false;
  }
  if (t.dataset.editSession) {
    const s = app.sessions.find((x) => x.id === t.dataset.editSession);
    if (s) editSession(s);
    return false;
  }
  if (t.dataset.delWeight) {
    if (!confirm("Eliminare questa misurazione?")) return false;
    closeModal();
    app.state.weights = app.state.weights.filter((w) => w.id !== t.dataset.delWeight);
    persistState();
    return true;
  }
  if (t.dataset.delSession) {
    if (!confirm("Eliminare questa seduta dallo storico?")) return false;
    try {
      await request(`/api/v1/workout-sessions/${encodeURIComponent(t.dataset.delSession)}`, { method: "DELETE" });
      await refreshWorkouts();
      toast("Seduta eliminata");
    } catch (e) {
      toast("Eliminazione non riuscita: " + e.message);
    }
    return true;
  }
  return false;
}

export function onChange(t) {
  if (!t.matches("[data-ex-pick]")) return false;
  ui.exercise = t.value;
  return true;
}

export async function onSubmit(form, data) {
  if (form.id !== "weight-form") return false;
  const weight = num(String(data.weight).replace(",", "."));
  if (weight <= 0) {
    toast("Inserisci un peso valido");
    return false;
  }
  const updated = recordWeight({ date: data.date || isoDate(), weight, waist: data.waist ? num(data.waist) : null, note: data.note || "" });
  if (await persistState()) toast(updated ? "Pesata di quel giorno aggiornata" : "Misurazione salvata");
  return true;
}
