// Impostazioni: profilo, programma, preferenze allenamento, tema, backup, sessione.
import { request } from "../api.js";
import { DAYS, PROGRAM_WEEKS, SLOTS } from "../constants.js";
import { app, dropRejectedState, loadAll, persistState, refreshDaily, rejectedState, retryRejectedState } from "../store.js";
import { choices, panel, tabpanel, tabs, toast } from "../ui.js";
import { icon } from "../icons.js";
import { TIME24, esc, num, storage, uid } from "../util.js";
import { dropRejected, enqueue, flush, rejected, retryRejected } from "../workout/queue.js";
import { isBackup, restoreConfirmText, restoreDoneText } from "../backup.js";
import { signOut } from "../logout.js";
import { prefs, setPrefs } from "../workout/timer.js";
import { isNative, nativeStatus, openExactAlarmSettings, startUpdate, syncNotifications, testNotification } from "../native.js";
import { checkForUpdate, updateStatus } from "../update.js";
import { serverUrl, standalone } from "../platform.js";
import { canScan, isBarcode, lookup, portion, scan } from "../barcode.js";

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
const ui = { tab: "general" };
const rem = { items: null, day: (new Date().getDay() + 6) % 7 };

async function loadReminders() {
  rem.items = (await request("/api/v1/reminders")).items;
}

function remindersPanel() {
  if (!rem.items) {
    loadReminders()
      .then(() => refreshPanel("reminders-panel", remindersPanel()))
      .catch((e) => toast("Promemoria non disponibili: " + e.message));
    return panel(`${icon("bell")}Promemoria`, '<p class="subtle">Caricamento…</p>', "", "", "reminders-panel");
  }
  const list = rem.items.filter((r) => r.weekday === rem.day);
  return panel(
    `${icon("bell")}Promemoria`,
    `<p class="subtle">Con l'app aperta compare un popup all'orario; con l'app Android arriva anche la notifica.</p>
    ${tabs(DAYS.map((d, i) => [String(i), d.slice(0, 3), null, rem.items.filter((r) => r.weekday === i && r.enabled).length]), String(rem.day), "Giorno", "rem-day", "rem-day-panel")}
    ${tabpanel("rem-day-panel", "Giorno", String(rem.day), `<div class="rem-list">${list
      .map(
        (r) => `<form class="rem-row ${r.enabled ? "" : "off"}" data-rem-form="${esc(r.id)}">
        <input class="time24" name="time" inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" value="${esc(r.time)}" aria-label="Orario (24 ore)" required>
        <input name="title" value="${esc(r.title)}" maxlength="120" aria-label="Titolo" required>
        <label class="switch"><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""}><span>Attivo</span></label>
        <button type="button" class="icon-btn" data-rem-del="${esc(r.id)}" aria-label="Elimina promemoria">${icon("trash-2", "sm")}</button>
      </form>`,
      )
      .join("") || '<p class="subtle">Nessun promemoria in questo giorno.</p>'}</div>
    <details class="free"><summary>${icon("plus", "sm")}Aggiungi promemoria a ${esc(DAYS[rem.day].toLowerCase())}</summary>
      <form id="rem-new" class="stack"><div class="form-grid">
        <div class="field"><label for="rn-time">Orario</label><input id="rn-time" class="time24" name="time" inputmode="numeric" maxlength="5" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" required value="12:00"></div>
        <div class="field"><label for="rn-type">Tipo</label><select id="rn-type" name="type">${Object.entries(REMINDER_TYPES).map(([k, v]) => `<option value="${k}">${v[2]}</option>`).join("")}</select></div>
        <div class="field"><label for="rn-slot">Pasto (se tipo Pasto)</label><select id="rn-slot" name="slot">${Object.entries(SLOTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
        <div class="field"><label for="rn-title">Titolo</label><input id="rn-title" name="title" required maxlength="120" placeholder="es. Prepara la borsa della palestra"></div>
      </div><button class="btn primary" type="submit">Aggiungi</button></form>
    </details>`)}`,
    "", "", "reminders-panel",
  );
}

const android = { info: null };
globalThis.addEventListener?.("fitweek:update-status", () => document.getElementById("android-panel") && refreshPanel("android-panel", androidPanel()));
/** Aggiorna solo il pannello `id` (dati arrivati in ritardo) senza ridisegnare la pagina. */
function refreshPanel(id, html) {
  const el = document.getElementById(id);
  if (el) el.outerHTML = html;
}
window.addEventListener("fitweek:native-synced", () => refreshPanel("android-panel", androidPanel()));
const mb = (n) => `${(n / 1048576).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB`;
const PERM = { granted: "consentite ✓", denied: "bloccate ✗", prompt: "da consentire", "prompt-with-rationale": "da consentire", unknown: "…" };

/** Versione installata e, se il server ne ha una più recente, il pulsante per installarla (static/js/update.js). */
function updateRow() {
  const u = updateStatus;
  if (!u.installed) return "";
  const up = u.available;
  const head = `<div class="summary-row"><i>${icon("download", "sm")}</i><div><strong>${up ? `Versione ${esc(up.version)} disponibile` : "App aggiornata"}</strong><small>Installata: ${esc(u.installed.version)}${up ? ` · download ${mb(up.size)}` : ""}</small></div></div>`;
  if (!up) return head;
  const action = u.canInstall
    ? `<button class="btn primary full" data-native="update" ${u.busy ? "disabled" : ""}>${icon("download")}${u.busy ? "Scarico…" : `Aggiorna alla ${esc(up.version)}`}</button><p class="subtle">L'app scarica il file dal server, lo verifica e apre l'installatore di Android: conferma lì. La prima volta Android chiede di consentire a FitWeek di installare app. I tuoi dati e l'accesso restano.</p>`
    : `<div class="inline-note">${icon("info")}<div>Questa versione dell'app non sa ancora aggiornarsi da sola: per questa volta apri FitWeek dal browser del telefono, vai in Impostazioni → App Android e scarica l'APK. Dalla prossima basterà un tocco qui.</div></div>`;
  return `${head}${action}${u.error ? `<div class="inline-note warn">${esc(u.error)}</div>` : ""}`;
}

function androidPanel() {
  if (isNative()) {
    const st = nativeStatus;
    return panel(
      `${icon("smartphone")}App Android`,
      `<div class="summary-list">${updateRow()}
        <div class="summary-row"><i>${icon("bell", "sm")}</i><div><strong>Notifiche: ${esc(PERM[st.permission] || st.permission)}</strong><small>${st.permission === "denied" ? "Abilitale da Impostazioni del telefono → App → FitWeek → Notifiche." : "Arrivano anche ad app chiusa."}</small></div></div>
        <div class="summary-row"><i>${icon("clock", "sm")}</i><div><strong>Orari esatti: ${st.exact === "granted" ? "consentiti ✓" : st.exact === "n/d" ? "non necessari" : "non consentiti"}</strong><small>Senza, Android può ritardare un promemoria di qualche minuto.</small></div></div>
        <div class="summary-row"><i>${icon("calendar", "sm")}</i><div><strong>${st.scheduled} notifiche programmate</strong><small>Prossimi 14 giorni${st.lastSync ? ` · aggiornate alle ${st.lastSync.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}` : ""}. Si riallineano a ogni apertura.</small></div></div>
      </div>
      ${st.error ? `<div class="inline-note warn">Errore: ${esc(st.error)}</div>` : ""}
      <div class="button-row"><button class="btn" data-native="test">Notifica di prova</button><button class="btn" data-native="sync">Riprogramma</button><button class="btn" data-native="check">Cerca aggiornamenti</button>${st.exact !== "granted" && st.exact !== "n/d" ? '<button class="btn" data-native="exact">Consenti orari esatti</button>' : ""}</div>
      <p class="subtle">Samsung: Impostazioni → App → FitWeek → Batteria → <strong>Senza restrizioni</strong>, altrimenti le notifiche possono arrivare in ritardo.</p>`,
      "", "", "android-panel",
    );
  }
  if (!android.info) {
    request("/api/v1/app/android")
      .then((i) => ((android.info = i), refreshPanel("android-panel", androidPanel())))
      .catch(() => {});
    return panel(`${icon("smartphone")}App Android`, '<p class="subtle">Caricamento…</p>', "", "", "android-panel");
  }
  // Un solo APK: l'app autonoma (canale `next`). Il vecchio guscio (`stable`) si scarica solo se è l'unico presente.
  const apk = android.info.next ? { ...android.info.next, channel: "next" } : android.info.available ? { ...android.info, channel: "stable" } : null;
  if (!apk) return panel(`${icon("smartphone")}App Android`, '<p class="subtle">L\'APK non è ancora stato compilato sul server (scripts/build-apk.sh).</p>', "", "", "android-panel");
  return panel(
    `${icon("smartphone")}App Android`,
    `<div class="app-cols"><div class="stack">
      <p class="subtle">${apk.channel === "next" ? "L'app tiene i dati sul telefono: si apre e registra <strong>anche senza rete</strong>, poi si allinea al server appena lo raggiunge." : "L'app mostra FitWeek a schermo intero."} Invia le <strong>notifiche dei promemoria anche ad app chiusa</strong>. Versione ${esc(apk.version)} · ${mb(apk.size)}.</p>
      <a class="btn primary full" href="/api/v1/app/android/download?channel=${apk.channel}" download>${icon("download")}Scarica APK</a>
      <p class="subtle">L'app si collega a ${esc(apk.server_url || "")}: per allinearsi serve la Wi-Fi di casa o la VPN. Le notifiche arrivano ovunque.</p>
      <details><summary class="subtle">Verifica del file</summary><p class="subtle mono">SHA-256 ${esc(apk.sha256 || "")}</p></details>
    </div>
    <ol class="steps">
      <li>Scarica e apri il file. Il browser avvisa che è un'app esterna al Play Store: conferma <em>Scarica comunque</em>.</li>
      <li>Alla richiesta, consenti al browser di <em>installare app sconosciute</em>, poi <em>Installa</em>.</li>
      <li>Apri FitWeek, accedi e consenti le notifiche.</li>
      <li>Impostazioni → App → FitWeek → Batteria → <em>Senza restrizioni</em>; se richiesto consenti <em>Sveglie e promemoria</em>.</li>
    </ol></div>`,
    "", "", "android-panel",
  );
}

// ---- proteine in polvere: valori per misurino, dall'etichetta o dal codice a barre -----------------
let scanned = null; // prodotto trovato dal codice a barre (valori per 100 g), finché il modulo resta aperto
const field = (id, name, label, value, attrs = "") =>
  `<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" value="${esc(value ?? "")}" ${attrs}></div>`;

function powderPanel(powder) {
  const dec = 'inputmode="decimal" autocomplete="off"';
  return panel(
    `${icon("beef")}Proteine in polvere`,
    `<form id="powder-form" class="stack">
      <p class="subtle">Valori per un misurino, copiati dall'etichetta. Servono per registrare lo shaker; quando prenderlo lo vedi in Oggi, toccando Proteine.</p>
      <div class="field-row"><div class="field"><label for="pw-code">Codice a barre (facoltativo)</label><input id="pw-code" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="es. 8001234567890"></div>
        ${canScan() ? `<button type="button" class="btn" data-powder="scan" aria-label="Leggi il codice a barre con la fotocamera">${icon("scan-barcode")}</button>` : ""}
        <button type="button" class="btn" data-powder="find">Cerca</button></div>
      ${field("pw-name", "name", "Nome", powder?.name, 'maxlength="80" required')}
      <div class="form-grid three">
        ${field("pw-scoop", "scoopG", "Misurino (g)", powder?.scoopG, dec)}
        ${field("pw-protein", "proteinG", "Proteine (g)", powder?.proteinG, `${dec} required`)}
        ${field("pw-kcal", "kcal", "Calorie (kcal)", powder?.kcal, dec)}
      </div>
      <input type="hidden" id="pw-source" name="source" value="${esc(powder?.source || "label")}">
      <div class="button-row"><button class="btn primary" type="submit">Salva</button>${powder ? '<button type="button" class="btn ghost" data-powder="remove">Rimuovi</button>' : ""}</div>
    </form>`,
  );
}

const byId = (id) => document.getElementById(id);
/** Riempie proteine e calorie del misurino dai valori per 100 g del prodotto trovato. */
function fillFromScan() {
  const grams = optTarget(byId("pw-scoop").value);
  if (!scanned || !grams) return;
  const v = portion(scanned, grams);
  byId("pw-protein").value = v.protein ?? "";
  byId("pw-kcal").value = v.kcal;
  byId("pw-source").value = "off";
}

async function findPowder(code) {
  if (!isBarcode(code)) return toast("Il codice a barre ha da 8 a 14 cifre");
  try {
    const out = await lookup(code.trim());
    if (!out.enabled) return toast("La ricerca online è disattivata sul server: copia i valori dall'etichetta.");
    if (!out.item) return toast("Prodotto non trovato su Open Food Facts: copia i valori dall'etichetta.");
    scanned = out.item;
    byId("pw-code").value = code;
    byId("pw-name").value = `${scanned.name}${scanned.brand ? ` ${scanned.brand.split(",")[0].trim()}` : ""}`.slice(0, 80);
    if (scanned.serving_g) byId("pw-scoop").value = scanned.serving_g;
    fillFromScan();
    toast(byId("pw-scoop").value ? "Valori da Open Food Facts: confrontali con l'etichetta, poi salva." : "Prodotto trovato: scrivi i grammi del misurino e calcolo i valori.");
  } catch (e) {
    toast(e.status === 0 ? "Per cercare un codice a barre serve la rete." : e.message);
  }
}

async function saveReminder(id, base, changes) {
  const r = { ...base, ...changes };
  const body = { weekday: r.weekday, time: r.time, kind: r.kind, slot: r.slot, title: r.title, action: r.action, enabled: r.enabled };
  enqueue("PUT", `/api/v1/reminders/${encodeURIComponent(id)}`, body, `rem:${id}`);
  toast("Promemoria salvato");
  await remindersChanged();
}

/** Invia la modifica se c'è rete, poi rilegge i promemoria (dal server o dalla copia sul telefono). */
async function remindersChanged() {
  await flush();
  await loadReminders().catch(() => {}); // webapp senza rete: resta l'elenco a schermo, la coda invierà
  window.dispatchEvent(new Event("fitweek:reminders-changed"));
}
export function applyTheme(theme = storage.get(THEME_KEY, "auto")) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

const sess = { items: null };
async function loadSessions() {
  sess.items = (await request("/api/v1/sessions")).items;
}
function deviceLabel(ua = "") {
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iPhone / iPad";
  if (/Linux|Windows|Macintosh/i.test(ua)) return "Computer";
  return ua ? ua.slice(0, 40) : "Dispositivo";
}
function sessionPanel() {
  if (!sess.items) {
    loadSessions()
      .then(() => refreshPanel("session-panel", sessionPanel()))
      .catch(() => {});
  }
  const when = (iso) => new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const list = sess.items?.length
    ? `<div class="stack">${sess.items
        .map(
          (s) => `<div class="mini-card" data-session-row="${esc(s.id)}"><div><div class="entry-title">${esc(deviceLabel(s.user_agent))}${s.current ? ' <span class="pill accent">Questo dispositivo</span>' : ""}</div><div class="entry-sub">Attivo ${esc(when(s.last_seen_at || s.created_at))}</div></div>${s.current ? "" : `<button type="button" class="btn small danger" data-revoke-session="${esc(s.id)}">Revoca</button>`}</div>`,
        )
        .join("")}</div>`
    : "";
  return panel(
    `${icon("log-out")}Sessione`,
    `<p class="subtle">Esci da questo dispositivo, revoca un singolo accesso o esci da tutti (es. telefono perso).</p>
    ${list}
    <div class="button-row"><button class="btn" data-action="logout">Esci</button><button class="btn danger" data-action="logout-all">Esci da tutti i dispositivi</button></div>`,
    "", "", "session-panel",
  );
}

/** Modifiche che il server ha rifiutato: non si perdono, restano qui finché l'utente non decide. */
function notSentPanel() {
  const ops = rejected();
  const state = rejectedState();
  if (!ops.length && !state) return "";
  const when = (iso) => new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const row = (title, sub, attrs) =>
    `<div class="mini-card"><div><div class="entry-title">${esc(title)}</div><div class="entry-sub">${esc(sub)}</div></div><div class="button-row"><button type="button" class="btn small" ${attrs}="retry">Riprova</button><button type="button" class="btn small danger" ${attrs}="drop">Scarta</button></div></div>`;
  return panel(
    `${icon("hourglass")}Modifiche non inviate`,
    `<p class="subtle">Il server non le ha accettate. Restano su questo dispositivo finché non le riprovi o le scarti.</p>
    <div class="stack">${state ? row("Pesate, spesa, dispensa, profilo o piano", `${when(state.at)} · dati non validi${state.field ? ` (${state.field})` : ""}`, "data-rejected-state") : ""}${ops
      .map((op, i) => row(`${op.method} ${op.path.replace("/api/v1/", "")}`, `${when(op.at)} · ${op.message}`, `data-rejected-index="${i}" data-rejected-op`))
      .join("")}</div>`,
    "", "", "not-sent",
  );
}

export function render() {
  const p = app.state.profile;
  const pr = prefs();
  const theme = storage.get(THEME_KEY, "auto");
  const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${label}</option>`;
  const general = () =>
    `<div class="split wide-left">${panel(
      `${icon("user")}Profilo`,
      `<form id="profile-form" class="stack"><div class="form-grid three"><div class="field"><label for="pf-name">Nome (facoltativo)</label><input id="pf-name" name="name" maxlength="100" value="${esc(p.name)}"></div><div class="field"><label for="pf-age">Età</label><input id="pf-age" name="age" type="number" min="0" max="120" value="${esc(p.age)}"></div><div class="field"><label for="pf-h">Altezza (cm)</label><input id="pf-h" name="height" type="number" min="0" max="260" value="${esc(p.height)}"></div><div class="field"><label for="pf-w">Peso iniziale (kg)</label><input id="pf-w" name="startingWeight" type="number" min="0" max="500" step="0.1" value="${esc(p.startingWeight)}"></div><div class="field"><label for="pf-b">Budget spesa (€ a settimana)</label><input id="pf-b" name="budget" type="number" min="0" max="100000" step="1" value="${esc(p.budget)}"></div><div class="field"><label for="pf-prot">Riferimento proteine (g al giorno)</label><input id="pf-prot" name="proteinTarget" inputmode="numeric" placeholder="nessuno" value="${esc(p.proteinTarget ?? "")}"></div><div class="field"><label for="pf-kcal">Riferimento calorie (kcal al giorno)</label><input id="pf-kcal" name="kcalTarget" inputmode="numeric" placeholder="nessuno" value="${esc(p.kcalTarget ?? "")}"></div></div><p class="subtle">I riferimenti li scegli tu: l'app non li calcola né li consiglia, mostra solo quanto manca nella giornata.</p><div class="field"><label for="pf-n">La tua routine</label><textarea id="pf-n" name="notes" rows="4" maxlength="5000">${esc(p.notes)}</textarea></div><button class="btn primary" type="submit">Salva profilo</button></form>`,
    )}<div class="stack">${powderPanel(p.proteinPowder)}${panel(
      `${icon("calendar")}Programma`,
      `<form id="program-form" class="stack"><div class="field-row"><div class="field"><label for="prog-week">Settimana attuale</label><select id="prog-week" name="week">${Array.from({ length: PROGRAM_WEEKS }, (_, i) => opt(i + 1, app.today.program_week, `Settimana ${i + 1}`)).join("")}</select></div><button class="btn" type="submit">Aggiorna</button></div><p class="subtle">Avanza da sola ogni lunedì (inizio programma: ${esc(p.startDate)}). Cambiarla qui sposta la data di inizio.</p></form>`,
      standalone ? "" : `<a class="btn small" href="/api/original-pdf" target="_blank" rel="noopener">Scheda PDF${icon("arrow-right", "sm")}</a>`,
    )}${panel(
      `${icon("timer")}Allenamento`,
      `<form id="prefs-form" class="stack"><div class="form-grid two"><div class="field"><label for="rest">Recupero predefinito</label><select id="rest" name="restSeconds">${[60, 75, 90, 120, 150, 180].map((s) => opt(s, pr.restSeconds, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min`)).join("")}</select></div><div class="field"><label for="kgstep">Incremento peso (+/−)</label><select id="kgstep" name="kgStep">${[0.5, 1, 1.25, 2, 2.5, 5].map((s) => opt(s, pr.kgStep, `${String(s).replace(".", ",")} kg`)).join("")}</select></div></div><label class="check"><input type="checkbox" name="sound" ${pr.sound ? "checked" : ""}> Suono a fine recupero (oltre alla vibrazione)</label><div class="field-row"><p class="subtle">Preferenze salvate su questo dispositivo.</p><button class="btn" type="submit">Salva preferenze</button></div></form>`,
    )}${panel(
      `${icon("sun-moon")}Aspetto`,
      choices([["auto", "Automatico", "sun-moon"], ["light", "Chiaro", "sun"], ["dark", "Scuro", "moon"]], theme, "Tema", "theme-set"),
    )}</div></div>`;
  const data = () =>
    `<div class="grid3 even">${panel(
      `${icon("download")}Backup`,
      standalone
        ? `<p class="subtle">Backup automatico ogni notte sul server (${esc(serverUrl())}). Per scaricare o ripristinare una copia apri FitWeek dal browser.</p>`
        : `<p class="subtle">Backup automatico ogni notte sul server. Qui scarichi una copia dei tuoi dati in JSON.</p><a class="btn primary" href="/api/backup" download>${icon("download")}Scarica backup</a><hr class="separator"><div class="field"><label for="import-file">Ripristina da file</label><input id="import-file" type="file" accept="application/json,.json"></div><button class="btn danger" data-import-backup>Ripristina (sostituisce i dati attuali)</button>`,
    )}${notSentPanel()}${sessionPanel()}${panel(
      `${icon("info")}Privacy`,
      `<div class="summary-list"><div class="summary-row"><i>${icon("package", "sm")}</i><div><strong>Dati solo sul tuo server</strong><small>SQLite in un volume Docker.</small></div></div><div class="summary-row"><i>${icon("utensils", "sm")}</i><div><strong>Ricerca prodotti</strong><small>Quando cerchi un alimento, il solo testo cercato va a Open Food Facts. Nient'altro esce dal server.</small></div></div><div class="summary-row"><i>${icon("user", "sm")}</i><div><strong>Accesso protetto</strong><small>Sessioni revocabili, tentativi di accesso limitati.</small></div></div></div><p class="subtle">Uso personale. Le indicazioni alimentari sono orientative, non prescrizioni mediche.</p>`,
    )}</div>`;
  const body = ui.tab === "reminders" ? remindersPanel() : ui.tab === "app" ? androidPanel() : ui.tab === "data" ? data() : general();
  return `${tabs([["general", "Generale", "user"], ["reminders", "Promemoria", "bell"], ["app", "App Android", "smartphone"], ["data", "Dati e accesso", "download"]], ui.tab, "Impostazioni", "tab", "settings-panel")}${tabpanel("settings-panel", "Impostazioni", ui.tab, body)}`;
}

export async function onClick(t) {
  if (t.dataset.tab) return (ui.tab = t.dataset.tab), true;
  if (t.dataset.rejectedOp) {
    const index = Number(t.dataset.rejectedIndex);
    if (t.dataset.rejectedOp === "retry") retryRejected(index);
    else if (confirm("Scartare questa modifica? Non sarà più recuperabile.")) dropRejected(index);
    return true;
  }
  if (t.dataset.rejectedState) {
    if (t.dataset.rejectedState === "retry") await retryRejectedState();
    else if (confirm("Scartare queste modifiche? Non saranno più recuperabili.")) dropRejectedState();
    return true;
  }
  if (t.dataset.native === "test") return testNotification(), false;
  if (t.dataset.native === "sync") {
    await syncNotifications({ ask: true });
    toast(nativeStatus.error ? "Errore: " + nativeStatus.error : `${nativeStatus.scheduled} notifiche programmate`);
    return true;
  }
  if (t.dataset.native === "exact") return openExactAlarmSettings(), false;
  if (t.dataset.native === "update") return startUpdate(), false;
  if (t.dataset.native === "check") {
    const up = await checkForUpdate();
    toast(updateStatus.error ? `Controllo non riuscito: ${updateStatus.error}` : up ? `FitWeek ${up.version} è disponibile` : "L'app è aggiornata");
    return false; // il riquadro si ridisegna da solo quando cambia lo stato dell'aggiornamento
  }
  if (t.dataset.powder === "find") return await findPowder(byId("pw-code").value), false;
  if (t.dataset.powder === "scan") {
    const code = await scan().catch((e) => (toast(e.message), null));
    if (code) await findPowder(code);
    return false;
  }
  if (t.dataset.powder === "remove") {
    app.state.profile.proteinPowder = null;
    scanned = null;
    if (await persistState()) toast("Polvere rimossa");
    return true;
  }
  if (t.dataset.remDay) return (rem.day = num(t.dataset.remDay)), true;
  if (t.dataset.remDel) {
    if (!confirm("Eliminare questo promemoria?")) return false;
    enqueue("DELETE", `/api/v1/reminders/${encodeURIComponent(t.dataset.remDel)}`, undefined, `rem:${t.dataset.remDel}`);
    await remindersChanged();
    return true;
  }
  if (t.dataset.themeSet) {
    storage.set(THEME_KEY, t.dataset.themeSet);
    applyTheme(t.dataset.themeSet);
    return true;
  }
  if (t.dataset.revokeSession) {
    try {
      await request(`/api/v1/sessions/${encodeURIComponent(t.dataset.revokeSession)}`, { method: "DELETE" });
      await loadSessions();
      toast("Accesso revocato");
    } catch (e) {
      toast("Non riuscito: " + e.message);
    }
    return true;
  }
  if (t.dataset.action === "logout" || t.dataset.action === "logout-all") {
    const all = t.dataset.action === "logout-all";
    if (all && !confirm("Uscire da tutti i dispositivi?")) return false;
    await signOut({ all });
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
    if (!isBackup(obj)) return toast("Non è un backup FitWeek"), false;
    if (!confirm(restoreConfirmText(obj))) return false;
    try {
      const out = await request("/api/v1/restore", { method: "POST", body: obj });
      await loadAll();
      toast(restoreDoneText(out), { timeout: 7000 });
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
  if (!TIME24.test(f.time)) return toast("Orario non valido: usa il formato 24 ore, es. 18:30"), false;
  if (!f.title.trim()) return false;
  await saveReminder(base.id, base, { time: f.time, title: f.title.trim(), enabled: f.enabled === "on" });
  return true;
}

/** Modulo della polvere: i grammi del misurino ricalcolano i valori trovati dal codice a barre; un valore
 *  corretto a mano torna a essere "etichetta". */
export function onInput(t) {
  if (t.id === "pw-scoop") fillFromScan();
  else if (t.id === "pw-protein" || t.id === "pw-kcal") byId("pw-source").value = "label";
}

/** Campo vuoto o zero = nessun riferimento. */
const optTarget = (v) => {
  const n = num(String(v ?? "").replace(",", "."), 0);
  return n > 0 ? n : null;
};

export async function onSubmit(form, data) {
  if (form.dataset.remForm) return onChange(form.querySelector("input"));
  if (form.id === "rem-new") {
    if (!TIME24.test(data.time)) return toast("Orario non valido: usa il formato 24 ore, es. 18:30"), false;
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
  if (form.id === "powder-form") {
    const proteinG = optTarget(data.proteinG);
    if (!data.name.trim() || proteinG == null) return toast("Servono il nome e le proteine per misurino"), false;
    app.state.profile.proteinPowder = { name: data.name.trim(), scoopG: optTarget(data.scoopG), proteinG, kcal: optTarget(data.kcal), source: data.source === "off" ? "off" : "label" };
    scanned = null;
    if (await persistState()) toast("Polvere salvata");
    return true;
  }
  if (form.id === "profile-form") {
    Object.assign(app.state.profile, {
      name: data.name.trim(), age: num(data.age), height: num(data.height),
      startingWeight: num(data.startingWeight), budget: num(data.budget), notes: data.notes || "",
      proteinTarget: optTarget(data.proteinTarget), kcalTarget: optTarget(data.kcalTarget),
    });
    if (await persistState()) {
      await refreshDaily().catch(() => {}); // i riferimenti compaiono subito in Oggi
      toast("Profilo aggiornato");
    }
    return true;
  }
  return false;
}
