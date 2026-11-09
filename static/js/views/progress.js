// Progressi: peso e girovita (registrati), medie settimanali (calcolate), storico e carichi.
import { request } from "../api.js";
import { app, persistState, refreshWorkouts } from "../store.js";
import { empty, panel, sectionTitle, toast } from "../ui.js";
import { esc, fmtDate, fmtNum, isoDate, num, uid } from "../util.js";

const mondayOf = (iso) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
};

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

function chart() {
  const arr = [...app.state.weights].filter((a) => num(a.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (!arr.length) return empty("Ancora nessuna pesata", "Inserisci il primo peso per vedere l'andamento.");
  const vals = arr.map((x) => num(x.weight));
  let lo = Math.min(...vals) - 1;
  let hi = Math.max(...vals) + 1;
  const W = 640, H = 220, L = 44, R = 12, T = 14, B = 30;
  const x = (i) => L + (arr.length === 1 ? 0.5 : i / (arr.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = arr.map((a, i) => `${x(i).toFixed(1)},${y(num(a.weight)).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Andamento del peso: da ${fmtNum(vals[0])} a ${fmtNum(vals[vals.length - 1])} kg">
    ${[hi, (hi + lo) / 2, lo].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`).join("")}
    <polyline class="line" points="${pts}"/>
    ${arr.map((a, i) => `<circle class="dot" cx="${x(i)}" cy="${y(num(a.weight))}" r="4"><title>${esc(a.date)}: ${esc(a.weight)} kg</title></circle>`).join("")}
    <text class="axis" x="${L}" y="${H - 8}">${esc(fmtDate(arr[0].date))}</text><text class="axis" x="${W - R}" y="${H - 8}" text-anchor="end">${esc(fmtDate(arr[arr.length - 1].date))}</text>
  </svg>`;
}

function loadsTable() {
  const done = app.sessions.filter((s) => s.status === "done");
  const rows = [];
  for (const [routine, exs] of Object.entries(app.state.routines)) {
    for (const ex of exs) {
      const hist = done
        .filter((s) => s.routine === routine)
        .map((s) => ({ s, sets: s.sets.filter((x) => x.exercise_id === ex.id && x.completed && x.kg != null) }))
        .filter((h) => h.sets.length)
        .slice(0, 2);
      if (!hist.length) continue;
      const top = (h) => Math.max(...h.sets.map((x) => x.kg));
      const delta = hist[1] ? top(hist[0]) - top(hist[1]) : null;
      rows.push(`<tr><td>${esc(ex.name)}<small>Giorno ${esc(routine)}</small></td><td>${fmtNum(top(hist[0]))} kg<small>${esc(fmtDate(hist[0].s.date))}</small></td><td>${delta == null ? "—" : `${delta > 0 ? "+" : ""}${fmtNum(delta)} kg`}</td></tr>`);
    }
  }
  return rows.length
    ? `<div class="table-scroll"><table><thead><tr><th>Esercizio</th><th>Carico max ultima</th><th>vs precedente</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`
    : empty("Nessun carico registrato", "I confronti compaiono dopo le prime sedute.");
}

export function render() {
  const sessions = app.sessions.filter((s) => s.status === "done");
  const weigh = [...app.state.weights].sort((a, b) => b.date.localeCompare(a.date));
  const weekly = weeklyAverages();
  return (
    sectionTitle("I numeri che contano.", "Valori registrati da te e medie calcolate, sempre distinti.") +
    `<div class="twocol"><div class="stack">${panel("Andamento del peso", chart())}${panel(
      "Registra peso e girovita",
      `<form id="weight-form" class="stack"><div class="form-grid"><div class="field"><label for="w-date">Data</label><input id="w-date" type="date" name="date" value="${isoDate()}" required></div><div class="field"><label for="w-kg">Peso (kg)</label><input id="w-kg" type="number" name="weight" min="20" max="500" step="0.1" required inputmode="decimal" placeholder="es. 89,4"></div><div class="field"><label for="w-waist">Girovita (cm) · facoltativo</label><input id="w-waist" type="number" name="waist" min="20" max="250" step="0.1" inputmode="decimal"></div><div class="field"><label for="w-note">Nota · facoltativa</label><input id="w-note" name="note" maxlength="500" placeholder="es. mattina a digiuno"></div></div><button class="btn primary" type="submit">+ Registra misurazione</button></form>
      ${weigh.length ? `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Peso</th><th>Vita</th><th></th></tr></thead><tbody>${weigh.slice(0, 20).map((a) => `<tr><td>${esc(fmtDate(a.date))}</td><td>${esc(a.weight)} kg</td><td>${a.waist ? esc(a.waist) + " cm" : "—"}</td><td><button type="button" class="icon-btn" data-del-weight="${esc(a.id)}" aria-label="Elimina misurazione">×</button></td></tr>`).join("")}</tbody></table></div>` : ""}`,
    )}${panel(
      'Medie settimanali <span class="badge-calc">calcolate</span>',
      weekly.length ? `<div class="table-scroll"><table><thead><tr><th>Settimana dal</th><th>Media</th><th>Pesate</th></tr></thead><tbody>${weekly.slice(0, 12).map((w) => `<tr><td>${esc(fmtDate(w.week))}</td><td>${fmtNum(w.avg)} kg</td><td>${w.n}</td></tr>`).join("")}</tbody></table></div><p class="subtle">Le oscillazioni giornaliere sono normali: confronta le medie, non le singole pesate.</p>` : empty("Nessuna media", "Servono alcune pesate."),
    )}</div><div class="stack">${panel("Carichi recenti", loadsTable())}${panel(
      "Storico allenamenti",
      sessions.length
        ? sessions
            .map((s) => {
              const names = Object.fromEntries((app.state.routines[s.routine] || []).map((e) => [e.id, e.name]));
              const done = s.sets.filter((x) => x.completed);
              return `<div class="entry"><div><div class="entry-title">${esc(fmtDate(s.date))} · Giorno ${esc(s.routine)} · W${esc(s.week)}</div><div class="entry-sub">${done.length} serie${s.duration_min ? ` · ${esc(Math.round(s.duration_min))} min` : ""}${s.cardio_min ? " · cardio ✓" : ""}${s.notes ? " · " + esc(s.notes) : ""}</div><details><summary>Dettaglio</summary><div class="subtle">${done.map((x) => `${esc(names[x.exercise_id] || x.exercise_id)} #${x.set_index}: ${x.kg == null ? "—" : esc(fmtNum(x.kg))} kg × ${esc(x.reps)}`).join("<br>")}</div></details></div><button type="button" class="icon-btn" data-del-session="${esc(s.id)}" aria-label="Elimina seduta">×</button></div>`;
            })
            .join("")
        : empty("Nessun allenamento registrato", "Inizia dalla schermata Palestra."),
    )}</div></div>`
  );
}

export async function onClick(t) {
  if (t.dataset.delWeight) {
    if (!confirm("Eliminare questa misurazione?")) return false;
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

export async function onSubmit(form, data) {
  if (form.id !== "weight-form") return false;
  const weight = num(String(data.weight).replace(",", "."));
  if (weight <= 0) {
    toast("Inserisci un peso valido");
    return false;
  }
  app.state.weights.push({ id: uid(), date: data.date || isoDate(), weight, waist: data.waist ? num(data.waist) : null, note: data.note || "" });
  if (await persistState()) toast("Misurazione salvata");
  return true;
}
