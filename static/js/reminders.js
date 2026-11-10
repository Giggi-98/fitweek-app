// Promemoria in app e inserimento rapido.
// Quando l'app è aperta controlla l'agenda ogni minuto: se un evento è scaduto e non ancora
// fatto, apre il popup giusto (pasto, pesata, palestra…). Le notifiche a schermo spento
// arriveranno con l'app per telefono (D-013), che userà gli stessi promemoria del server.
import { request } from "./api.js";
import { DAYS, PLAN_KEY, SLOTS, SOURCE_LABEL } from "./constants.js";
import { app, persistState, refreshDaily } from "./store.js";
import { closeModal, dayOptions, modalOpen, openModal, toast } from "./ui.js";
import { $, TIME24, esc, fmtDuration, fmtNum, isoDate, normalizeTime, num, uid } from "./util.js";
import { icon } from "./icons.js";
import { haptic } from "./motion.js";
import { enqueue, flush } from "./workout/queue.js";
import { openComposer } from "./composer.js";

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
export async function openMealLog({ slot = "other", date = todayIso(), reminderId = null, title = null } = {}) {
  // Cena: proponi il secondo portato a casa dalla mensa (e il pane dopo la palestra).
  let home = [];
  if (slot === "dinner") {
    try {
      home = (await request(`/api/v1/takeaway?date=${date}`)).items.map((i) => ({ ...i, takeaway: false }));
    } catch {
      /* offline */
    }
  }
  // Pasti già registrati per questo momento negli ultimi 14 giorni: si riselezionano con un tocco.
  let recent = [];
  try {
    const from = new Date(date + "T12:00:00");
    from.setDate(from.getDate() - 14);
    const logs = (await request(`/api/v1/meal-logs?from=${isoDate(from)}&to=${date}`)).items;
    const seen = new Set(app.templates.map((t) => t.name.trim().toLowerCase()));
    for (const m of logs.filter((x) => x.slot === slot && x.status === "eaten" && x.description).reverse()) {
      const key = m.description.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recent.push(m);
    }
    recent = recent.slice(0, 4);
  } catch {
    /* offline: restano piano e pasti abituali */
  }
  const pane = app.foods.find((f) => f.id === "f-pane");
  const gymDay = Boolean(app.today?.routine);
  const dayName = DAYS[(new Date(date + "T12:00:00").getDay() + 6) % 7];
  const planned = app.state.meals[dayName]?.[PLAN_KEY[slot]] || "";
  const templates = app.templates
    .filter((t) => t.slot === slot || (slot === "snack" && t.slot === "pre_workout") || (slot === "pre_workout" && t.slot === "snack"))
    .concat(app.templates.filter((t) => t.slot === "other" && slot !== "other"));
  const chip = (t) =>
    `<button type="button" class="pick" data-tpl="${esc(t.id)}"><span>${esc(t.name)}</span>${t.kcal != null ? `<small>${t.nutrition_source === "estimate" ? "~" : ""}${fmtNum(t.kcal, 0)} kcal · ${SOURCE_LABEL[t.nutrition_source] || "stima"}</small>` : "<small>senza valori</small>"}</button>`;
  openModal(
    `<div class="modal-ic">${icon({ lunch: "soup", pre_workout: "zap", snack: "apple", dinner: "utensils" }[slot] || "cookie")}</div>
    <h2 id="modal-title">${esc(title || SLOTS[slot] || "Pasto")}</h2>
    <p class="subtle">Cosa hai mangiato? Un tocco per registrare.</p>
    ${home.length ? `<button type="button" class="btn primary xl full" data-m="home">${icon("package")}Dal lavoro: ${esc(home.map((i) => i.name).join(", "))}</button>
      ${pane ? `<button type="button" class="btn ${gymDay ? "primary" : ""} full" data-m="home-pane">${icon("plus", "sm")}…con 2 pagnottine (~200 g)</button>` : ""}` : ""}
    <button type="button" class="btn ${home.length ? "" : "primary"} full" data-m="compose">${icon("utensils")}${slot === "lunch" ? "Componi il vassoio della mensa" : "Componi il piatto"}</button>
    ${planned ? `<button type="button" class="btn full" data-m="planned">${icon("check")}Come previsto: ${esc(planned)}</button>` : ""}
    ${recent.length ? `<div class="pick-group"><span class="eyebrow">Recenti</span><div class="pick-list">${recent.map((m, k) => `<button type="button" class="pick" data-recent="${k}"><span>${esc(m.description)}</span><small>${m.kcal != null ? `${m.nutrition_source === "estimate" ? "~" : ""}${fmtNum(m.kcal, 0)} kcal · ${SOURCE_LABEL[m.nutrition_source] || "stima"}` : "senza valori"}</small></button>`).join("")}</div></div>` : ""}
    ${templates.length ? `<div class="pick-group"><span class="eyebrow">Abituali</span><div class="pick-list">${templates.map(chip).join("")}</div></div>` : recent.length ? "" : '<p class="subtle">Nessun pasto abituale per questo momento: aggiungili da Pasti → Abituali.</p>'}
    <details class="free"><summary>${icon("pencil", "sm")}Altro / scrivi tu</summary>
      <div class="field"><label for="m-desc">Descrizione</label><input id="m-desc" maxlength="300" placeholder="es. piadina prosciutto e formaggio"></div>
      <div class="field"><label for="m-kcal">Calorie, se le conosci (facoltativo)</label><input id="m-kcal" inputmode="numeric" placeholder="es. 450"></div>
      <button type="button" class="btn full" data-m="free">Salva</button>
    </details>
    <button type="button" class="btn ghost full" data-m="skip">Saltato</button>
    ${laterButtons(reminderId)}`,
    async (t) => {
      const common = await handleCommon(t, reminderId);
      if (common !== null) return common;
      if (t.dataset.m === "compose") {
        openComposer({ slot, date, reminderId });
        return false; // la modale resta aperta: ora contiene l'editor
      }
      if (t.dataset.m === "home" || t.dataset.m === "home-pane") {
        const items = t.dataset.m === "home-pane" && pane
          ? [...home, { name: pane.name, category: "pane", qty: 2, kcal: pane.kcal, protein_g: pane.protein_g, nutrition_source: pane.nutrition_source, food_id: pane.id, takeaway: false }]
          : home;
        enqueue("PUT", `/api/v1/meal-logs/${uid()}`, { date, slot, status: "eaten", items, description: "", note: "" });
        haptic(12);
        toast("Cena registrata");
        afterChange();
        return true;
      }
      const base = { date, slot, status: "eaten", description: "", note: "" };
      let body = null;
      if (t.dataset.recent) {
        // Stesso pasto di un giorno recente: stesse voci (o stessa descrizione e valori).
        const m = recent[num(t.dataset.recent)];
        body = m.items?.length
          ? { ...base, items: m.items.map((i) => ({ ...i, takeaway: false })) }
          : { ...base, description: m.description, ...(m.template_id ? { template_id: m.template_id } : {}), ...(m.kcal != null ? { kcal: m.kcal, protein_g: m.protein_g, nutrition_source: m.nutrition_source } : {}) };
      } else if (t.dataset.tpl) {
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
        // Salvato come voce: entra nel catalogo e la prossima volta si riseleziona con i suoi valori.
        const value = kcal ? num(kcal.replace(",", ".")) : null;
        body = { ...base, items: [{ name: desc.slice(0, 120), category: "altro", qty: 1, kcal: value, protein_g: null, nutrition_source: value == null ? null : "manual", takeaway: false }] };
      } else if (t.dataset.m === "skip") {
        body = { ...base, status: "skipped" };
      }
      if (!body) return false;
      enqueue("PUT", `/api/v1/meal-logs/${uid()}`, body);
      haptic(12);
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
    `<div class="modal-ic">${icon("scale")}</div>
    <h2 id="modal-title">Pesata</h2>
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

// ---- sonno -------------------------------------------------------------------------------
/** Registra o modifica una notte. `date` è il giorno del risveglio. */
export function openSleepLog({ date = todayIso() } = {}) {
  const find = (d) => app.sleep.items.find((n) => n.date === d);
  const last = app.sleep.items[app.sleep.items.length - 1];
  const existing = find(date);
  const start = existing || { bed_time: last?.bed_time || "00:00", wake_time: last?.wake_time || "07:30" };
  const duration = () => {
    const bed = normalizeTime($("#sl-bed").value), wake = normalizeTime($("#sl-wake").value);
    if (!TIME24.test(bed) || !TIME24.test(wake)) return null;
    const mins = (h) => num(h.slice(0, 2)) * 60 + num(h.slice(3));
    return (mins(wake) - mins(bed) + 1440) % 1440;
  };
  openModal(
    `<div class="modal-ic">${icon("moon")}</div>
    <h2 id="modal-title">Sonno</h2>
    <p class="subtle">Orari indicativi vanno benissimo: serve a vedere l'andamento, non a dare un voto.</p>
    <div class="field"><label for="sl-date">Risveglio di</label><select id="sl-date">${dayOptions(date, 7)}</select></div>
    <div class="form-grid two">
      <div class="field"><label for="sl-bed">A letto alle</label><input id="sl-bed" class="time24" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="${esc(start.bed_time)}"></div>
      <div class="field"><label for="sl-wake">Sveglia alle</label><input id="sl-wake" class="time24" inputmode="numeric" maxlength="5" placeholder="HH:MM" value="${esc(start.wake_time)}"></div>
    </div>
    <div class="tray-total"><span>Durata</span><strong id="sl-dur">—</strong><small>calcolata dagli orari</small></div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}Salva</button>
    <div class="modal-secondary">${existing ? '<button type="button" data-m="delete">Elimina</button>' : ""}<button type="button" data-m="close">Annulla</button></div>`,
    async (t) => {
      if (t.dataset.m === "close") return true;
      const day = $("#sl-date").value;
      const path = `/api/v1/sleep/${day}`;
      if (t.dataset.m === "delete") {
        enqueue("DELETE", path, undefined, `sleep:${day}`);
        toast("Notte eliminata");
      } else if (t.dataset.m === "save") {
        if (duration() == null) return toast("Orari non validi: usa il formato 24 ore, es. 23:45"), false;
        enqueue("PUT", path, { bed_time: normalizeTime($("#sl-bed").value), wake_time: normalizeTime($("#sl-wake").value) }, `sleep:${day}`);
        haptic(12);
        toast("Sonno registrato");
      } else return false;
      afterChange();
      return true;
    },
  );
  const paint = () => ($("#sl-dur").textContent = duration() == null ? "—" : fmtDuration(duration()));
  // Ascolto sui due campi (non sul contenitore, che viene riusato dalle altre finestre).
  for (const id of ["#sl-bed", "#sl-wake"]) $(id).addEventListener("input", paint);
  $("#sl-date").addEventListener("change", () => {
    const n = find($("#sl-date").value);
    if (n) [$("#sl-bed").value, $("#sl-wake").value] = [n.bed_time, n.wake_time];
    paint();
  });
  paint();
}

// ---- altri promemoria --------------------------------------------------------------------
function openSimple(item) {
  const actions = {
    start_workout: ["Vai all'allenamento", "#training"],
    open_shopping: ["Apri la spesa", "#shopping"],
  };
  const [label, hash] = actions[item.action] || ["Ok, fatto", null];
  openModal(
    `<div class="modal-ic">${icon({ start_workout: "dumbbell", open_shopping: "shopping-cart" }[item.action] || (item.kind === "sleep" ? "moon" : "bell"))}</div>
    <h2 id="modal-title">${esc(item.title)}</h2>
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
