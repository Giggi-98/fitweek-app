// Impostazioni: profilo, programma, preferenze allenamento, tema, backup, sessione.
import { request } from "../api.js";
import { DAYS, PROGRAM_WEEKS, SLOTS } from "../constants.js";
import { app, loadAll, persistState } from "../store.js";
import { panel, sectionTitle, toast } from "../ui.js";
import { esc, num, storage, uid } from "../util.js";
import { prefs, setPrefs } from "../workout/timer.js";

export const THEME_KEY = "fitweek.theme.v1";

// Tipi di promemoria selezionabili → (kind, action)
const REMINDER_TYPES = {
  meal: ["meal", "log_meal", "Pasto (chiede cosa hai mangiato)"],
  weigh_in: ["weigh_in", "log_weight", "Pesata"],
  workout: ["workout", "start_workout", "Palestra"],
  shopping: ["shopping", "open_shopping", "Spesa"],
  sleep: ["sleep", "none", "Sonno"],
  custom: ["custom", "none", "Altro"],
};
const rem = { items: null, day: (new Date().getDay() + 6) % 7 };

async function loadReminders() {
  rem.items = (await request("/api/v1/reminders")).items;
}

function remindersPanel() {
  if (!rem.items) {
    loadReminders().then(() => app.render()).catch((e) => toast("Promemoria non disponibili: " + e.message));
    return panel("Promemoria", '<p class="subtle">Caricamento…</p>');
  }
  const list = rem.items.filter((r) => r.weekday === rem.day);
  return panel(
    "Promemoria",
    `<p class="subtle">Un promemoria per ogni momento della giornata. Con l'app aperta compare un popup all'orario; le notifiche a schermo spento arriveranno con l'app per telefono.</p>
    <div class="chips scroll" role="group" aria-label="Giorno">${DAYS.map((d, i) => `<button class="chip ${i === rem.day ? "active" : ""}" data-rem-day="${i}">${d.slice(0, 3)}</button>`).join("")}</div>
    ${list
      .map(
        (r) => `<form class="rem-row ${r.enabled ? "" : "off"}" data-rem-form="${esc(r.id)}">
        <input type="time" name="time" value="${esc(r.time)}" aria-label="Orario" required>
        <input name="title" value="${esc(r.title)}" maxlength="120" aria-label="Titolo" required>
        <label class="switch"><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}><span>Attivo</span></label>
        <button type="button" class="icon-btn" data-rem-del="${esc(r.id)}" aria-label="Elimina promemoria">×</button>
      </form>`,
      )
      .join("") || '<p class="subtle">Nessun promemoria in questo giorno.</p>'}
    <details class="free"><summary>+ Aggiungi promemoria a ${esc(DAYS[rem.day].toLowerCase())}</summary>
      <form id="rem-new" class="stack"><div class="form-grid">
        <div class="field"><label for="rn-time">Orario</label><input id="rn-time" type="time" name="time" required value="12:00"></div>
        <div class="field"><label for="rn-type">Tipo</label><select id="rn-type" name="type">${Object.entries(REMINDER_TYPES).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join("")}</select></div>
        <div class="field"><label for="rn-slot">Pasto (se tipo Pasto)</label><select id="rn-slot" name="slot">${Object.entries(SLOTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div class="field"><label for="rn-title">Titolo</label><input id="rn-title" name="title" required maxlength="120" placeholder="es. Prepara la borsa della palestra"></div>
      </div><button class="btn primary" type="submit">Aggiungi</button></form>
    </details>`,
  );
}

async function saveReminder(id, base, changes) {
  const r = { ...base, ...changes };
  const body = { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: r.enabled };
  try {
    await request(`/api/v1/reminders/${encodeURIComponent(id)}`, { method: "PUT", body });
    await loadReminders();
    toast("Promemoria salvato");
  } catch (e) {
    toast("Non salvato: " + e.message + (e.field ? ` (${e.field})` : ""));
  }
}
export function applyTheme(theme = storage.get(THEME_KEY, "auto")) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function render() {
  const p = app.state.profile;
  const pr = prefs();
  const theme = storage.get(THEME_KEY, "auto");
  const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${label}</option>`;
  return (
    sectionTitle("Impostazioni", "Profilo, programma, preferenze e dati.") +
    `<div class="twocol"><div class="stack">${remindersPanel()}${panel(
      "Programma",
      `<form id="program-form" class="stack"><div class="field"><label for="prog-week">Settimana attuale</label><select id="prog-week" name="week">${Array.from({ length: PROGRAM_WEEKS }, (_, i) => opt(i + 1, app.today.program_week, `Settimana ${i + 1}`)).join("")}</select></div><p class="subtle">La settimana avanza da sola ogni lunedì (inizio programma: ${esc(p.startDate)}). Cambiarla qui sposta la data di inizio.</p><button class="btn" type="submit">Aggiorna settimana</button></form>
      <div class="spacer12"></div><a class="btn small" href="/api/original-pdf" target="_blank" rel="noopener">Scheda originale (PDF) ↗</a>`,
    )}${panel(
      "Allenamento",
      `<form id="prefs-form" class="stack"><div class="form-grid"><div class="field"><label for="rest">Recupero predefinito</label><select id="rest" name="restSeconds">${[60, 75, 90, 120, 150, 180].map((s) => opt(s, pr.restSeconds, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min`)).join("")}</select></div><div class="field"><label for="kgstep">Incremento peso (+/−)</label><select id="kgstep" name="kgStep">${[0.5, 1, 1.25, 2, 2.5, 5].map((s) => opt(s, pr.kgStep, `${String(s).replace(".", ",")} kg`)).join("")}</select></div></div><label class="check"><input type="checkbox" name="sound" ${pr.sound ? "checked" : ""}> Suono a fine recupero (oltre alla vibrazione)</label><button class="btn" type="submit">Salva preferenze</button></form><p class="subtle">Preferenze salvate su questo dispositivo.</p>`,
    )}${panel(
      "Aspetto",
      `<div class="chips" role="group" aria-label="Tema">${[["auto", "Automatico"], ["light", "Chiaro"], ["dark", "Scuro"]].map(([v, l]) => `<button class="chip ${theme === v ? "active" : ""}" data-theme-set="${v}">${l}</button>`).join("")}</div>`,
    )}${panel(
      "Profilo",
      `<form id="profile-form" class="stack"><div class="form-grid"><div class="field"><label for="pf-name">Nome (facoltativo)</label><input id="pf-name" name="name" maxlength="100" value="${esc(p.name)}"></div><div class="field"><label for="pf-age">Età</label><input id="pf-age" name="age" type="number" min="0" max="120" value="${esc(p.age)}"></div><div class="field"><label for="pf-h">Altezza (cm)</label><input id="pf-h" name="height" type="number" min="0" max="260" value="${esc(p.height)}"></div><div class="field"><label for="pf-w">Peso iniziale (kg)</label><input id="pf-w" name="startingWeight" type="number" min="0" max="500" step="0.1" value="${esc(p.startingWeight)}"></div><div class="field"><label for="pf-b">Budget spesa settimanale (€)</label><input id="pf-b" name="budget" type="number" min="0" max="100000" step="1" value="${esc(p.budget)}"></div></div><div class="field"><label for="pf-n">La tua routine</label><textarea id="pf-n" name="notes" rows="4" maxlength="5000">${esc(p.notes)}</textarea></div><button class="btn primary" type="submit">Salva profilo</button></form>`,
    )}</div><div class="stack">${panel(
      "Backup",
      `<p class="subtle">Il server fa un backup automatico ogni notte. Qui puoi scaricare una copia completa (pasti, spesa, pesate e allenamenti) in JSON.</p><a class="btn primary" href="/api/backup" download>↓ Scarica backup</a><hr class="separator"><div class="field"><label for="import-file">Ripristina da file</label><input id="import-file" type="file" accept="application/json,.json"></div><button class="btn danger" data-import-backup>Ripristina (sostituisce i dati attuali)</button>`,
    )}${panel(
      "Sessione",
      `<p class="subtle">Esci da questo dispositivo, oppure da tutti (es. telefono perso).</p><div class="button-row"><button class="btn" data-action="logout">Esci</button><button class="btn danger" data-action="logout-all">Esci da tutti i dispositivi</button></div>`,
    )}${panel(
      "Privacy",
      `<div class="summary-list"><div class="summary-row"><i>◈</i><div><strong>Dati solo sul tuo server</strong><small>SQLite in un volume Docker, nessun servizio esterno.</small></div></div><div class="summary-row"><i>🔒</i><div><strong>Accesso protetto</strong><small>Sessioni revocabili, tentativi di accesso limitati.</small></div></div></div><p class="subtle">FitWeek 1.3 · uso personale. Le indicazioni alimentari sono orientative, non prescrizioni mediche.</p>`,
    )}</div></div>`
  );
}

export async function onClick(t) {
  if (t.dataset.remDay) return (rem.day = num(t.dataset.remDay)), true;
  if (t.dataset.remDel) {
    if (!confirm("Eliminare questo promemoria?")) return false;
    await request(`/api/v1/reminders/${encodeURIComponent(t.dataset.remDel)}`, { method: "DELETE" }).catch((e) => toast(e.message));
    await loadReminders();
    return true;
  }
  if (t.dataset.themeSet) {
    storage.set(THEME_KEY, t.dataset.themeSet);
    applyTheme(t.dataset.themeSet);
    return true;
  }
  if (t.dataset.action === "logout" || t.dataset.action === "logout-all") {
    const all = t.dataset.action === "logout-all";
    if (all && !confirm("Uscire da tutti i dispositivi?")) return false;
    await request(all ? "/api/logout-all" : "/api/logout", { method: "POST" }).catch(() => {});
    location.reload();
    return false;
  }
  if (t.matches("[data-import-backup]")) {
    const file = document.getElementById("import-file").files[0];
    if (!file) return toast("Seleziona un file di backup"), false;
    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      return toast("File non leggibile"), false;
    }
    if (!/^fitweek-backup-v[123]$/.test(obj?.format || "")) return toast("Non è un backup FitWeek"), false;
    if (!confirm("Il ripristino sostituisce tutti i dati attuali (il server ne conserva una copia). Continuare?")) return false;
    try {
      const out = await request("/api/v1/restore", { method: "POST", body: obj });
      await loadAll();
      toast(`Backup ripristinato (${out.sessions} sedute)`);
    } catch (e) {
      toast(`Ripristino rifiutato: ${e.message}${e.field ? ` (${e.field})` : ""}`, { timeout: 7000 });
    }
    return true;
  }
  return false;
}

export async function onChange(t) {
  const form = t.closest("[data-rem-form]");
  if (!form) return false;
  const base = rem.items.find((r) => r.id === form.dataset.remForm);
  const f = Object.fromEntries(new FormData(form));
  if (!f.time || !f.title.trim()) return false;
  await saveReminder(base.id, base, { time: f.time, title: f.title.trim(), enabled: f.enabled === "on" });
  return true;
}

export async function onSubmit(form, data) {
  if (form.dataset.remForm) return onChange(form.querySelector("input"));
  if (form.id === "rem-new") {
    const [kind, action] = REMINDER_TYPES[data.type] || REMINDER_TYPES.custom;
    await saveReminder(`u-${uid().slice(0, 12)}`, {}, {
      weekday: rem.day, time: data.time, kind, action, slot: kind === "meal" ? data.slot : null,
      title: data.title.trim(), enabled: true,
    });
    return true;
  }
  if (form.id === "program-form") {
    try {
      await request("/api/v1/program-week", { method: "PUT", body: { week: num(data.week, 1) } });
      await loadAll();
      toast(`Settimana ${num(data.week)} impostata`);
    } catch (e) {
      toast("Non riuscito: " + e.message);
    }
    return true;
  }
  if (form.id === "prefs-form") {
    setPrefs({ restSeconds: num(data.restSeconds, 90), kgStep: num(data.kgStep, 2.5), sound: data.sound === "on" });
    toast("Preferenze salvate");
    return true;
  }
  if (form.id === "profile-form") {
    Object.assign(app.state.profile, {
      name: data.name.trim(), age: num(data.age), height: num(data.height),
      startingWeight: num(data.startingWeight), budget: num(data.budget), notes: data.notes || "",
    });
    if (await persistState()) toast("Profilo aggiornato");
    return true;
  }
  return false;
}
