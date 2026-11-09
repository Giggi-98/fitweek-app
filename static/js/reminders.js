// Promemoria in app e inserimento rapido.
// Quando l'app è aperta controlla l'agenda ogni minuto: se un evento è scaduto e non ancora
// fatto, apre il popup giusto (pasto, pesata, palestra…). Le notifiche a schermo spento
// arriveranno con l'app per telefono (D-013), che userà gli stessi promemoria del server.
import { request } from "./api.js";
import { DAYS, PLAN_KEY, SLOTS, SOURCE_LABEL } from "./constants.js";
import { app, persistState, refreshDaily } from "./store.js";
import { closeModal, modalOpen, openModal, toast } from "./ui.js";
import { $, esc, fmtNum, isoDate, num, uid } from "./util.js";
import { enqueue, flush } from "./workout/queue.js";

const SNOOZE_MIN = 15;
const shownThisSession = new Set(); // non riproporre lo stesso popup finché l'app resta aperta

const todayIso = () => app.today?.date || isoDate();

async function ack(reminderId, status, minutes) {
  if (!reminderId) return;
  enqueue("PUT", `/api/v1/reminders/${encodeURIComponent(reminderId)}/ack`,
    { date: todayIso(), status, ...(minutes ? { snooze_minutes: minutes } : {}) }, `ack:${reminderId}:${todayIso()}`);
}

async function afterChange() {
  await flush();
  window.dispatchEvent(new Event("fitweek:changed"));
  try {
    await refreshDaily();
  } catch {
    /* offline: l'agenda si aggiornerà al prossimo controllo */
  }
  app.render();
}

const laterButtons = (reminderId) =>
  reminderId
    ? `<div class="modal-secondary"><button type="button" data-m="later">Più tardi (${SNOOZE_MIN}′)</button><button type="button" data-m="dismiss">Non oggi</button></div>`
    : `<div class="modal-secondary"><button type="button" data-m="close">Chiudi</button></div>`;

async function handleCommon(t, reminderId) {
  if (t.dataset.m === "later") {
    await ack(reminderId, "snoozed", SNOOZE_MIN);
    toast(`Te lo ricordo tra ${SNOOZE_MIN} minuti`);
    afterChange();
    return true;
  }
  if (t.dataset.m === "dismiss") {
    await ack(reminderId, "dismissed");
    afterChange();
    return true;
  }
  if (t.dataset.m === "close") return true;
  return null;
}

/** Tipo di pasto più probabile in base all'ora (per l'inserimento manuale). */
export function guessSlot(now = new Date()) {
  const h = now.getHours();
  const gym = Boolean(app.today?.routine);
  if (h >= 11 && h < 15) return "lunch";
  if (h >= 15 && h < 19) return gym ? "pre_workout" : "snack";
  if (h >= 19 || h < 4) return "dinner";
  return "other";
}

// ---- pasto -------------------------------------------------------------------------------
export function openMealLog({ slot = "other", date = todayIso(), reminderId = null, title = null } = {}) {
  const dayName = DAYS[(new Date(date + "T12:00:00").getDay() + 6) % 7];
  const planned = app.state.meals[dayName]?.[PLAN_KEY[slot]] || "";
  const templates = app.templates
    .filter((t) => t.slot === slot || (slot === "snack" && t.slot === "pre_workout") || (slot === "pre_workout" && t.slot === "snack"))
    .concat(app.templates.filter((t) => t.slot === "other" && slot !== "other"));
  const chip = (t) =>
    `<button type="button" class="pick" data-tpl="${esc(t.id)}"><span>${esc(t.name)}</span>${t.kcal != null ? `<small>${t.nutrition_source === "estimate" ? "~" : ""}${fmtNum(t.kcal, 0)} kcal · ${SOURCE_LABEL[t.nutrition_source] || "stima"}</small>` : "<small>senza valori</small>"}</button>`;
  openModal(
    `<h2 id="modal-title">${esc(title || SLOTS[slot] || "Pasto")}</h2>
    <p class="subtle">Cosa hai mangiato? Un tocco per registrare.</p>
    ${planned ? `<button type="button" class="btn primary full" data-m="planned">✓ Come previsto: ${esc(planned)}</button>` : ""}
    <div class="pick-list">${templates.map(chip).join("") || '<p class="subtle">Nessun pasto abituale per questo momento: aggiungili da Pasti → Abituali.</p>'}</div>
    <details class="free"><summary>Altro / scrivi tu</summary>
      <div class="field"><label for="m-desc">Descrizione</label><input id="m-desc" maxlength="300" placeholder="es. piadina prosciutto e formaggio"></div>
      <div class="field"><label for="m-kcal">Calorie, se le conosci (facoltativo)</label><input id="m-kcal" inputmode="numeric" placeholder="es. 450"></div>
      <button type="button" class="btn full" data-m="free">Salva</button>
    </details>
    <button type="button" class="btn ghost full" data-m="skip">Saltato</button>
    ${laterButtons(reminderId)}`,
    async (t) => {
      const common = await handleCommon(t, reminderId);
      if (common !== null) return common;
      const base = { date, slot, status: "eaten", description: "", note: "" };
      let body = null;
      if (t.dataset.tpl) {
        const tpl = app.templates.find((x) => x.id === t.dataset.tpl);
        body = { ...base, description: tpl.name, template_id: tpl.id };
      } else if (t.dataset.m === "planned") {
        // Se il piano coincide con un pasto abituale, ne eredita la stima.
        const match = app.templates.find((x) => x.name.trim().toLowerCase() === planned.trim().toLowerCase());
        body = { ...base, description: planned.slice(0, 300), ...(match ? { template_id: match.id } : {}) };
      } else if (t.dataset.m === "free") {
        const desc = $("#m-desc").value.trim();
        const kcal = $("#m-kcal").value.trim();
        if (!desc) return toast("Scrivi cosa hai mangiato"), false;
        body = { ...base, description: desc, ...(kcal ? { kcal: num(kcal.replace(",", ".")), nutrition_source: "manual" } : {}) };
      } else if (t.dataset.m === "skip") {
        body = { ...base, status: "skipped" };
      }
      if (!body) return false;
      enqueue("PUT", `/api/v1/meal-logs/${uid()}`, body);
      toast(body.status === "skipped" ? "Segnato come saltato" : "Pasto registrato");
      afterChange();
      return true;
    },
  );
}

// ---- pesata ------------------------------------------------------------------------------
export function openWeighIn({ reminderId = null } = {}) {
  const last = [...app.state.weights].sort((a, b) => b.date.localeCompare(a.date))[0];
  openModal(
    `<h2 id="modal-title">Pesata</h2>
    <p class="subtle">Stesse condizioni ogni volta: al mattino, a digiuno, dopo il bagno.${last ? ` Ultima: ${esc(fmtNum(last.weight))} kg.` : ""}</p>
    <div class="field"><label for="m-weight">Peso (kg)</label><input id="m-weight" inputmode="decimal" autofocus placeholder="${last ? esc(String(last.weight).replace(".", ",")) : "es. 89,4"}"></div>
    <button type="button" class="btn primary full" data-m="save">Salva</button>
    ${laterButtons(reminderId)}`,
    async (t) => {
      const common = await handleCommon(t, reminderId);
      if (common !== null) return common;
      if (t.dataset.m !== "save") return false;
      const w = num($("#m-weight").value.replace(",", "."));
      if (w < 20 || w > 500) return toast("Inserisci un peso valido"), false;
      app.state.weights.push({ id: uid(), date: todayIso(), weight: w, waist: null, note: "" });
      if (await persistState()) toast("Peso registrato");
      afterChange();
      return true;
    },
  );
}

// ---- altri promemoria --------------------------------------------------------------------
function openSimple(item) {
  const actions = {
    start_workout: ["▶ Vai all'allenamento", "#training"],
    open_shopping: ["Apri la spesa", "#shopping"],
  };
  const [label, hash] = actions[item.action] || ["Ok, fatto", null];
  openModal(
    `<h2 id="modal-title">${esc(item.title)}</h2>
    <p class="subtle">${esc(item.time)}</p>
    <button type="button" class="btn primary full" data-m="go" autofocus>${label}</button>
    ${laterButtons(item.id)}`,
    async (t) => {
      const common = await handleCommon(t, item.id);
      if (common !== null) return common;
      if (t.dataset.m !== "go") return false;
      if (item.action !== "start_workout") await ack(item.id, "done");
      if (hash) location.hash = hash;
      afterChange();
      return true;
    },
  );
}

/** Apre il flusso giusto per un elemento dell'agenda (anche a mano, dalla dashboard). */
export function openReminder(item) {
  shownThisSession.add(item.id);
  if (item.action === "log_meal") return openMealLog({ slot: item.slot, reminderId: item.id, title: item.title });
  if (item.action === "log_weight") return openWeighIn({ reminderId: item.id });
  return openSimple(item);
}

// ---- motore ------------------------------------------------------------------------------
async function tick() {
  if (!app.state || document.visibilityState !== "visible") return;
  try {
    const ag = await request("/api/v1/agenda");
    app.agenda = ag.items;
  } catch {
    return; // offline o sessione scaduta: riprova al prossimo giro
  }
  if (modalOpen() || app.today?.active_session) return; // non disturbare durante l'allenamento
  // Solo l'evento scaduto più recente e non più vecchio di 3 ore: gli arretrati restano
  // nell'agenda della dashboard, senza una raffica di popup all'apertura dell'app.
  const horizon = Date.now() - 3 * 3600_000;
  const due = app.agenda
    .filter((i) => i.due && !shownThisSession.has(i.id) && new Date(i.due_at).getTime() >= horizon)
    .pop();
  if (due) {
    navigator.vibrate?.(200);
    openReminder(due);
  }
}

export function startReminders() {
  setInterval(tick, 60_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && tick());
  setTimeout(tick, 1500);
}

export { closeModal };
