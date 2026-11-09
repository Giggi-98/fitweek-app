// Impostazioni: profilo, programma, preferenze allenamento, tema, backup, sessione.
import { request } from "../api.js";
import { PROGRAM_WEEKS } from "../constants.js";
import { app, loadAll, persistState } from "../store.js";
import { panel, sectionTitle, toast } from "../ui.js";
import { esc, num, storage } from "../util.js";
import { prefs, setPrefs } from "../workout/timer.js";

export const THEME_KEY = "fitweek.theme.v1";
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
    `<div class="twocol"><div class="stack">${panel(
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
      `<div class="summary-list"><div class="summary-row"><i>◈</i><div><strong>Dati solo sul tuo server</strong><small>SQLite in un volume Docker, nessun servizio esterno.</small></div></div><div class="summary-row"><i>🔒</i><div><strong>Accesso protetto</strong><small>Sessioni revocabili, tentativi di accesso limitati.</small></div></div></div><p class="subtle">FitWeek 1.2 · uso personale. Le indicazioni alimentari sono orientative, non prescrizioni mediche.</p>`,
    )}</div></div>`
  );
}

export async function onClick(t) {
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
    if (!/^fitweek-backup-v[12]$/.test(obj?.format || "")) return toast("Non è un backup FitWeek"), false;
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

export async function onSubmit(form, data) {
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
