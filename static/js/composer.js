// Editor del pasto composto ("vassoio" della mensa): primo, salsa, secondo, contorno…
// Stesso editor per creare e per modificare un pasto già registrato; i totali si ricalcolano dal vivo
// (e il server li ricalcola comunque dalle voci). Le voci "porto a casa" non contano nel pasto corrente.
import { request } from "./api.js";
import { SLOTS, SOURCE_LABEL } from "./constants.js";
import { icon } from "./icons.js";
import { haptic, pop } from "./motion.js";
import { app, refreshDaily } from "./store.js";
import { dayOptions, openModal, toast } from "./ui.js";
import { $, esc, fmtNum, isoDate, num, uid } from "./util.js";
import { enqueue, flush } from "./workout/queue.js";

export const CATEGORIES = [
  ["primo", "Primi"], ["salsa", "Salse"], ["secondo", "Secondi"], ["contorno", "Contorni"],
  ["piatto_unico", "Piatto unico"], ["frutta", "Frutta"], ["dessert", "Dessert"], ["pane", "Pane"], ["altro", "Altro"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));
const SLOT_ORDER = ["lunch", "pre_workout", "snack", "dinner", "other"];

let st = null; // stato dell'editor aperto
// Ricerca online: ultimo testo cercato, esito, prodotto scelto (in attesa della porzione in grammi).
const online = { q: "", status: "idle", items: [], pick: null, disabled: false, timer: null };

const workday = (iso) => new Date(iso + "T12:00:00").getDay() % 6 !== 0;
const itemKcal = (i) => (i.kcal == null ? null : i.kcal * i.qty);

export function totals(items) {
  const eaten = items.filter((i) => !i.takeaway);
  const known = eaten.filter((i) => i.kcal != null);
  return {
    kcal: known.length ? known.reduce((s, i) => s + i.kcal * i.qty, 0) : null,
    protein: known.length ? known.reduce((s, i) => s + (i.protein_g || 0) * i.qty, 0) : null,
    missing: eaten.length - known.length,
    home: items.filter((i) => i.takeaway),
    estimate: known.some((i) => (i.nutrition_source || "estimate") === "estimate"),
  };
}

function trayRow(i, idx) {
  const k = itemKcal(i);
  const homeable = st.slot === "lunch";
  return `<div class="tray-row ${i.takeaway ? "home" : ""}" data-idx="${idx}">
    <div class="tray-name"><strong>${esc(i.name)}</strong><small>${esc(CAT_LABEL[i.category] || "")}${k != null ? ` · ${i.nutrition_source === "estimate" || !i.nutrition_source ? "~" : ""}${fmtNum(k, 0)} kcal` : " · senza valori"}${i.takeaway ? " · a casa, non conta ora" : ""}</small></div>
    <div class="qty"><button type="button" data-qty="-1" aria-label="Meno">${icon("minus", "sm")}</button><span>${String(i.qty).replace(".", ",")}×</span><button type="button" data-qty="1" aria-label="Più">${icon("plus", "sm")}</button></div>
    ${homeable ? `<button type="button" class="icon-btn ${i.takeaway ? "on" : ""}" data-home aria-pressed="${i.takeaway}" title="Lo porto a casa (per cena)">${icon("package")}</button>` : ""}
    <button type="button" class="icon-btn" data-remove aria-label="Togli ${esc(i.name)}">${icon("x", "sm")}</button>
  </div>`;
}

const foodPick = (f) =>
  `<button type="button" class="pick" data-food="${esc(f.id)}"><span>${esc(f.name)}</span><small>${f.kcal != null ? `${f.nutrition_source === "estimate" ? "~" : ""}${fmtNum(f.kcal, 0)} kcal · ${SOURCE_LABEL[f.nutrition_source] || "stima"}` : "senza valori"}</small></button>`;

const portion = (p, grams) => ({
  kcal: Math.round((p.kcal_100g * grams) / 100),
  protein: p.protein_100g == null ? null : Math.round((p.protein_100g * grams) / 10) / 10,
});

/** Risultati online: elenco dei prodotti, oppure la riga della porzione per quello scelto. */
function onlineBlock(q) {
  if (online.disabled || q.length < 3) return "";
  if (online.q !== q || online.status === "loading") return '<p class="subtle off-status">Cerco su Open Food Facts…</p>';
  if (online.status === "error") return `<p class="subtle off-status">${esc(online.error)}</p>`;
  if (!online.items.length) return '<p class="subtle off-status">Nessun prodotto trovato online: puoi aggiungerlo a mano con il +.</p>';
  if (online.pick != null) {
    const p = online.items[online.pick];
    const grams = p.serving_g || 100;
    const v = portion(p, grams);
    return `<div class="off-portion">
      <strong>${esc(p.name)}</strong><small>${esc(p.brand)}${p.brand ? " · " : ""}${fmtNum(p.kcal_100g, 0)} kcal per 100 g</small>
      <div class="off-row"><label for="c-off-g">Porzione (g)</label><input id="c-off-g" inputmode="numeric" value="${grams}"><span id="c-off-kcal">${v.kcal} kcal</span></div>
      <div class="button-row"><button type="button" class="btn primary" data-off-add>${icon("plus", "sm")}Aggiungi al piatto</button><button type="button" class="btn ghost" data-off-back>Indietro</button></div>
    </div>`;
  }
  return `<span class="eyebrow">Da Open Food Facts</span>
    <div class="pick-list">${online.items.map((p, k) => `<button type="button" class="pick" data-off="${k}"><span>${esc(p.name)}${p.brand ? `<em>${esc(p.brand)}</em>` : ""}</span><small>${fmtNum(p.kcal_100g, 0)} kcal/100 g</small></button>`).join("")}</div>
    <p class="subtle off-status">Valori inseriti dagli utenti di Open Food Facts (ODbL): se hai la confezione, controlla l'etichetta.</p>`;
}

/** Senza testo: piatti della categoria scelta. Con testo: catalogo (tutte le categorie) + ricerca online. */
function browse() {
  const q = (st.newName || "").trim().toLowerCase();
  if (q.length < 2) {
    const foods = app.foods.filter((f) => f.category === st.cat);
    return `<div class="pick-list">${foods.map(foodPick).join("") || '<p class="subtle">Nessun piatto in questa categoria: scrivilo qui sopra e premi +.</p>'}</div>`;
  }
  const local = app.foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6);
  return `${local.length ? `<span class="eyebrow">Nel tuo catalogo</span><div class="pick-list">${local.map(foodPick).join("")}</div>` : ""}${onlineBlock(q)}${!local.length && (online.disabled || q.length < 3) ? '<p class="subtle">Non è nel catalogo: premi + per aggiungerlo (le calorie sono facoltative).</p>' : ""}`;
}

const paintBrowse = () => {
  const box = $("#c-browse");
  if (box) box.innerHTML = browse();
};

async function searchOnline(q) {
  Object.assign(online, { q, status: "loading", items: [], pick: null });
  paintBrowse();
  try {
    const out = await request(`/api/v1/food-search?q=${encodeURIComponent(q)}`);
    if (online.q !== q) return; // nel frattempo l'utente ha scritto altro
    if (!out.enabled) online.disabled = true;
    Object.assign(online, { status: "done", items: out.items });
  } catch (e) {
    if (online.q !== q) return;
    Object.assign(online, { status: "error", error: e.status === 0 ? "Ricerca online non raggiungibile: resta il tuo catalogo." : e.message });
  }
  paintBrowse();
}

// La ricerca aggiorna solo l'elenco (non tutta la modale: il campo non perde il cursore).
document.addEventListener("input", (e) => {
  if (!st) return;
  if (e.target.id === "c-new-name") {
    st.newName = e.target.value;
    const q = st.newName.trim().toLowerCase();
    clearTimeout(online.timer);
    if (q.length >= 3 && !online.disabled && q !== online.q) online.timer = setTimeout(() => searchOnline(q), 600);
    paintBrowse();
  }
  if (e.target.id === "c-off-g" && online.pick != null) {
    const grams = num(e.target.value.replace(",", "."));
    $("#c-off-kcal").textContent = grams > 0 ? `${portion(online.items[online.pick], grams).kcal} kcal` : "—";
  }
});

/** Prima di ridisegnare conserva ciò che l'utente ha scritto nei campi. */
function capture() {
  if ($("#c-date")) st.date = $("#c-date").value;
  if ($("#c-desc")) st.description = $("#c-desc").value;
  if ($("#c-kcal")) st.kcal = $("#c-kcal").value;
  st.newName = $("#c-new-name")?.value || "";
  st.newKcal = $("#c-new-kcal")?.value || "";
}

function render() {
  if (st.rendered) capture();
  const t = totals(st.items);
  const legacy = !st.items.length && (st.description || st.log);
  const body = `
    <h2 id="modal-title">${st.log ? "Modifica pasto" : "Componi il pasto"}</h2>
    <div class="composer-top">
      <div class="chips scroll" role="group" aria-label="Pasto">${SLOT_ORDER.map((s) => `<button type="button" class="chip ${s === st.slot ? "active" : ""}" data-slot="${s}">${SLOTS[s]}</button>`).join("")}</div>
      <select id="c-date" aria-label="Giorno">${dayOptions(st.date)}</select>
    </div>
    <div class="tray">
      ${st.items.length ? st.items.map(trayRow).join("") : `<p class="subtle tray-empty">Aggiungi le voci del vassoio qui sotto: primo, salsa, secondo, contorno…</p>`}
      <div class="tray-total">
        <span>Totale ${st.items.length ? "" : "pasto"}</span>
        <strong>${t.kcal != null ? `${t.estimate ? "~" : ""}${fmtNum(t.kcal, 0)} kcal` : "—"}</strong>
        <small>${t.protein != null ? `${fmtNum(t.protein, 0)} g proteine · ` : ""}${t.estimate ? "stima" : t.kcal != null ? "valori dichiarati" : "nessun valore"}${t.missing ? ` · ${t.missing} senza valori` : ""}${t.home.length ? ` · a casa: ${esc(t.home.map((i) => i.name).join(", "))}` : ""}</small>
      </div>
    </div>
    ${legacy ? `<div class="field"><label for="c-desc">Descrizione (pasto registrato senza voci)</label><input id="c-desc" maxlength="300" value="${esc(st.description || "")}"></div>
      <div class="field"><label for="c-kcal">Calorie (facoltativo)</label><input id="c-kcal" inputmode="numeric" value="${esc(st.kcal ?? "")}"></div>` : ""}
    <div class="chips scroll cat-tabs" role="tablist" aria-label="Categoria">${CATEGORIES.map(([k, l]) => `<button type="button" class="chip ${k === st.cat ? "active" : ""}" data-cat="${k}">${l}</button>`).join("")}</div>
    <div class="new-food">
      <input id="c-new-name" maxlength="120" value="${esc(st.newName || "")}" placeholder="Cerca o scrivi un piatto…" aria-label="Cerca nel catalogo o scrivi un piatto nuovo" autocomplete="off">
      <input id="c-new-kcal" inputmode="numeric" value="${esc(st.newKcal || "")}" placeholder="kcal" aria-label="Calorie per porzione (facoltativo)">
      <button type="button" class="btn" data-new aria-label="Aggiungi come piatto nuovo">${icon("plus", "sm")}</button>
    </div>
    <div id="c-browse">${browse()}</div>
    <div class="composer-actions">
      ${st.items.length ? `<div class="mini-total"><span>${st.items.length} ${st.items.length === 1 ? "voce" : "voci"}${t.home.length ? ` · ${t.home.length} a casa` : ""}</span><strong>${t.kcal != null ? `${t.estimate ? "~" : ""}${fmtNum(t.kcal, 0)} kcal` : "—"}</strong></div>` : ""}
      <button type="button" class="btn primary xl full" data-save>${icon("check")}${st.log ? "Salva modifiche" : `Registra · ${esc(SLOTS[st.slot])}`}</button>
      <div class="modal-secondary">
        ${st.log ? '<button type="button" data-delete>Elimina</button>' : '<button type="button" data-skip>Saltato</button>'}
        <button type="button" data-close>Annulla</button>
      </div>
    </div>`;
  const scroller = $("#modal-body");
  const y = scroller?.scrollTop || 0;
  openModal(body, handle);
  $("#modal-body").dataset.static = st.rendered ? "1" : "";
  st.rendered = true;
  $("#modal-body").scrollTop = y;
}

function addFood(f) {
  const takeaway = st.slot === "lunch" && workday(st.date) && (f.category === "secondo");
  st.items.push({ name: f.name, category: f.category, qty: 1, kcal: f.kcal, protein_g: f.protein_g, nutrition_source: f.nutrition_source, food_id: f.id, takeaway });
  haptic(10);
}

async function save(status = "eaten") {
  const legacyDesc = $("#c-desc")?.value.trim();
  const legacyKcal = $("#c-kcal")?.value.trim();
  if (status === "eaten" && !st.items.length && !legacyDesc) return toast("Aggiungi almeno una voce"), false;
  const body = {
    date: $("#c-date").value, slot: st.slot, status, note: st.note || "",
    items: status === "eaten" ? st.items : [],
    description: st.items.length || status === "skipped" ? "" : legacyDesc,
    ...(status === "eaten" && !st.items.length && legacyKcal ? { kcal: num(legacyKcal.replace(",", ".")), nutrition_source: "manual" } : {}),
  };
  enqueue("PUT", `/api/v1/meal-logs/${encodeURIComponent(st.id)}`, body, `meal:${st.id}`);
  if (st.reminderId) {
    enqueue("PUT", `/api/v1/reminders/${encodeURIComponent(st.reminderId)}/ack`, { date: body.date, status: "done" }, `ack:${st.reminderId}:${body.date}`);
  }
  toast(status === "skipped" ? "Segnato come saltato" : st.log ? "Pasto aggiornato" : "Pasto registrato");
  await done();
  return true;
}

async function done() {
  await flush();
  window.dispatchEvent(new Event("fitweek:changed"));
  try {
    await refreshDaily();
  } catch {
    /* offline */
  }
  app.render();
}

async function handle(t) {
  const row = t.closest(".tray-row");
  if (t.dataset.slot) {
    st.slot = t.dataset.slot;
    if (st.slot !== "lunch") st.items.forEach((i) => (i.takeaway = false));
    render();
    return false;
  }
  if (t.dataset.cat) return (st.cat = t.dataset.cat), render(), false;
  if (t.dataset.food) {
    addFood(app.foods.find((f) => f.id === t.dataset.food));
    if ($("#c-new-name")) $("#c-new-name").value = ""; // scelta fatta: si torna all'elenco per categoria
    render();
    pop([...document.querySelectorAll(".tray-row")].pop(), 1.04);
    return false;
  }
  if (t.dataset.off) return (online.pick = num(t.dataset.off)), paintBrowse(), false;
  if (t.matches("[data-off-back]")) return (online.pick = null), paintBrowse(), false;
  if (t.matches("[data-off-add]")) {
    const p = online.items[online.pick];
    const grams = num($("#c-off-g").value.replace(",", "."));
    if (!(grams > 0 && grams <= 2000)) return toast("Indica la porzione in grammi"), false;
    const v = portion(p, grams);
    const brand = p.brand.split(",")[0].trim();
    st.items.push({
      name: `${p.name}${brand ? ` ${brand}` : ""} (${fmtNum(grams, 0)} g)`.slice(0, 120), category: st.cat, qty: 1,
      kcal: v.kcal, protein_g: v.protein, nutrition_source: "off", food_id: null, takeaway: false,
    });
    haptic(10);
    online.pick = null;
    st.newName = "";
    if ($("#c-new-name")) $("#c-new-name").value = "";
    render();
    return false;
  }
  if (row && t.dataset.qty) {
    const i = st.items[num(row.dataset.idx)];
    i.qty = Math.max(0.5, Math.min(20, i.qty + 0.5 * num(t.dataset.qty)));
    render();
    return false;
  }
  if (row && t.matches("[data-home]")) {
    const i = st.items[num(row.dataset.idx)];
    i.takeaway = !i.takeaway;
    render();
    return false;
  }
  if (row && t.matches("[data-remove]")) {
    st.items.splice(num(row.dataset.idx), 1);
    render();
    return false;
  }
  if (t.matches("[data-new]")) {
    const name = $("#c-new-name").value.trim();
    const kcal = $("#c-new-kcal").value.trim();
    if (!name) return toast("Scrivi il nome del piatto"), false;
    const existing = app.foods.find((f) => f.name.toLowerCase() === name.toLowerCase());
    addFood(existing || { id: null, name, category: st.cat, kcal: kcal ? num(kcal.replace(",", ".")) : null, protein_g: null, nutrition_source: kcal ? "manual" : null });
    $("#c-new-name").value = $("#c-new-kcal").value = "";
    st.newName = "";
    render();
    return false;
  }
  if (t.matches("[data-save]")) return save("eaten");
  if (t.matches("[data-skip]")) return save("skipped");
  if (t.matches("[data-delete]")) {
    if (!confirm("Eliminare questo pasto dal diario?")) return false;
    enqueue("DELETE", `/api/v1/meal-logs/${encodeURIComponent(st.id)}`, undefined, `meal:${st.id}`);
    toast("Pasto eliminato");
    await done();
    return true;
  }
  if (t.matches("[data-close]")) return true;
  return false;
}

/** Apre l'editor. log: pasto esistente da modificare; items: voci iniziali (es. secondo portato a casa). */
export async function openComposer({ slot = "lunch", date = app.today?.date || isoDate(), log = null, items = [], reminderId = null } = {}) {
  if (!app.foods.length) {
    try {
      app.foods = (await request("/api/v1/foods")).items;
    } catch {
      /* offline: catalogo vuoto, si possono comunque scrivere piatti nuovi */
    }
  }
  st = {
    id: log?.id || uid(),
    log,
    slot: log?.slot || slot,
    date: log?.date || date,
    items: (log?.items?.length ? log.items : items).map((i) => ({ ...i })),
    description: log && !log.items?.length ? log.description : "",
    kcal: log && !log.items?.length ? log.kcal : null,
    note: log?.note || "",
    cat: (log?.slot || slot) === "lunch" ? "primo" : (log?.slot || slot) === "dinner" ? "secondo" : (log?.slot || slot) === "pre_workout" || (log?.slot || slot) === "snack" ? "frutta" : "altro",
    reminderId,
    rendered: false,
  };
  online.pick = null;
  render();
}

