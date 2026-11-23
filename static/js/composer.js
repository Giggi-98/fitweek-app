// Editor del pasto composto ("vassoio" della mensa): primo, salsa, secondo, contorno…
// Stesso editor per creare e per modificare un pasto già registrato. Due zone distinte: "Nel piatto" (ciò che
// hai scelto, con calorie e proteine per voce) e "Aggiungi" (catalogo, ricerca online, codice a barre). Su
// schermo largo stanno affiancate, su telefono sono due schede; il totale e il salvataggio restano in basso.
// I totali si ricalcolano dal vivo (il server li ricalcola comunque dalle voci); le voci "porto a casa" non
// contano nel pasto corrente.
import { request } from "./api.js";
import { canScan, isBarcode, lookup, portion, scan } from "./barcode.js";
import { SLOTS, SOURCE_LABEL } from "./constants.js";
import { icon } from "./icons.js";
import { haptic } from "./motion.js";
import { app } from "./store.js";
import { dayOptions, openModal, tabId, tabs, toast } from "./ui.js";
import { $, esc, fmtDate, fmtNum, isoDate, num, uid } from "./util.js";
import { addDays } from "./stats.js";
import { commit, enqueue } from "./workout/queue.js";

export const CATEGORIES = [
  ["primo", "Primi"], ["salsa", "Salse"], ["secondo", "Secondi"], ["contorno", "Contorni"],
  ["piatto_unico", "Piatto unico"], ["frutta", "Frutta"], ["dessert", "Dessert"], ["pane", "Pane"], ["altro", "Altro"],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));
const FREQUENT = "frequenti"; // non è una categoria del catalogo: i piatti più usati, di qualunque categoria
const FREQUENT_MAX = 12;
const SAME_DAYS = 21; // fin dove cercare "l'ultimo pranzo/cena…"
/** Categoria proposta per un momento della giornata (e per un piatto scritto a mano dai Frequenti). */
const slotCat = (slot) => (slot === "lunch" ? "primo" : slot === "dinner" ? "secondo" : slot === "pre_workout" || slot === "snack" ? "frutta" : "altro");
const ownCat = () => (st.cat === FREQUENT ? slotCat(st.slot) : st.cat);
const SLOT_ORDER = ["lunch", "pre_workout", "snack", "dinner", "other"];
const ZONES = "Pasto in composizione"; // nome dell'elenco di schede (telefono)

let st = null; // stato dell'editor aperto
// Ricerca online: ultimo testo cercato, esito, prodotto scelto (in attesa della porzione in grammi).
const online = { q: "", status: "idle", items: [], pick: null, disabled: false, timer: null };

const workday = (iso) => new Date(iso + "T12:00:00").getDay() % 6 !== 0;
const approx = (source) => (source === "estimate" || !source ? "~" : "");
const comma = (n) => String(n).replace(".", ",");
const decimal = (text) => (String(text).trim() === "" ? null : num(String(text).replace(",", "."), null));

/** Totali di ciò che si mangia ora. `noProtein` = voci con calorie ma senza proteine: la somma è per difetto. */
export function totals(items) {
  const eaten = items.filter((i) => !i.takeaway);
  const known = eaten.filter((i) => i.kcal != null);
  return {
    kcal: known.length ? known.reduce((s, i) => s + i.kcal * i.qty, 0) : null,
    protein: known.length ? known.reduce((s, i) => s + (i.protein_g || 0) * i.qty, 0) : null,
    missing: eaten.length - known.length,
    noProtein: known.filter((i) => i.protein_g == null).length,
    home: items.filter((i) => i.takeaway),
    estimate: known.some((i) => (i.nutrition_source || "estimate") === "estimate"),
  };
}

/** Calorie e proteine di una voce o di un piatto del catalogo, per la quantità indicata. */
const valuesLine = (x, qty = 1) =>
  x.kcal == null
    ? "senza valori"
    : `${approx(x.nutrition_source)}${fmtNum(x.kcal * qty, 0)} kcal${x.protein_g != null ? ` · ${fmtNum(x.protein_g * qty)} g prot.` : ""}`;

function trayRow(i, idx) {
  const editing = st.edit === idx;
  return `<div class="tray-row ${i.takeaway ? "home" : ""}" data-idx="${idx}">
    <button type="button" class="tray-name" data-edit aria-expanded="${editing}" aria-label="${esc(i.name)}: correggi calorie e proteine"><strong>${esc(i.name)}</strong><small>${valuesLine(i, i.qty)}${i.takeaway ? " · a casa" : ""}</small></button>
    <div class="qty"><button type="button" data-qty="-1" aria-label="Meno">${icon("minus", "sm")}</button><span>${comma(i.qty)}×</span><button type="button" data-qty="1" aria-label="Più">${icon("plus", "sm")}</button></div>
    ${st.slot === "lunch" ? `<button type="button" class="icon-btn ${i.takeaway ? "on" : ""}" data-home aria-pressed="${i.takeaway}" title="Lo porto a casa (per cena)">${icon("package")}</button>` : ""}
    <button type="button" class="icon-btn" data-remove aria-label="Togli ${esc(i.name)}">${icon("x", "sm")}</button>
    ${editing ? `<div class="tray-edit"><div class="field"><label for="c-edit-kcal">kcal a porzione</label><input id="c-edit-kcal" inputmode="decimal" value="${esc(i.kcal == null ? "" : comma(i.kcal))}"></div><div class="field"><label for="c-edit-prot">Proteine (g)</label><input id="c-edit-prot" inputmode="decimal" value="${esc(i.protein_g == null ? "" : comma(i.protein_g))}"></div><button type="button" class="btn" data-edit-ok>Fatto</button></div>` : ""}
  </div>`;
}

/** Valori corretti a mano nella voce aperta: da quel momento la fonte è "inserito". */
function applyEdit() {
  const i = st.items[st.edit];
  const kcalField = $("#c-edit-kcal");
  st.edit = null;
  if (!i || !kcalField) return;
  const kcal = decimal(kcalField.value), protein = decimal($("#c-edit-prot").value);
  if (kcal === i.kcal && protein === (i.protein_g ?? null)) return;
  Object.assign(i, { kcal, protein_g: kcal == null ? null : protein, nutrition_source: kcal == null ? null : "manual" });
}

const foodPick = (f) =>
  `<button type="button" class="pick" data-food="${esc(f.id)}"><span>${esc(f.name)}</span><small>${valuesLine(f)}${f.kcal != null ? ` · ${SOURCE_LABEL[f.nutrition_source] || "stima"}` : ""}</small></button>`;

const offValues = (v) => `${v.kcal} kcal${v.protein != null ? ` · ${fmtNum(v.protein)} g prot.` : ""}`;

/** Risultati online: elenco dei prodotti, oppure la riga della porzione per quello scelto. */
function onlineBlock(q) {
  if (online.disabled || q.length < 3) return "";
  if (online.q !== q || online.status === "loading") return '<p class="subtle off-status">Cerco su Open Food Facts…</p>';
  if (online.status === "error") return `<p class="subtle off-status">${esc(online.error)}</p>`;
  if (!online.items.length) return `<p class="subtle off-status">${isBarcode(q) ? "Codice non trovato su Open Food Facts: scrivi il nome e aggiungilo a mano con i valori dell'etichetta." : "Nessun prodotto trovato online: puoi aggiungerlo a mano qui sotto."}</p>`;
  if (online.pick != null) {
    const p = online.items[online.pick];
    const grams = p.serving_g || 100;
    const v = portion(p, grams);
    return `<div class="off-portion">
      <strong>${esc(p.name)}</strong><small>${esc(p.brand)}${p.brand ? " · " : ""}${fmtNum(p.kcal_100g, 0)} kcal${p.protein_100g != null ? ` e ${fmtNum(p.protein_100g)} g di proteine` : ""} per 100 g</small>
      <div class="off-row"><label for="c-off-g">Porzione (g)</label><input id="c-off-g" inputmode="numeric" value="${grams}"><span id="c-off-kcal">${offValues(v)}</span></div>
      <div class="button-row"><button type="button" class="btn primary" data-off-add>${icon("plus", "sm")}Aggiungi al piatto</button><button type="button" class="btn ghost" data-off-back>Indietro</button></div>
    </div>`;
  }
  return `<span class="eyebrow">Da Open Food Facts</span>
    <div class="pick-list">${online.items.map((p, k) => `<button type="button" class="pick" data-off="${k}"><span>${esc(p.name)}${p.brand ? `<em>${esc(p.brand)}</em>` : ""}</span><small>${fmtNum(p.kcal_100g, 0)} kcal${p.protein_100g != null ? ` · ${fmtNum(p.protein_100g)} g prot.` : ""} /100 g</small></button>`).join("")}</div>
    <p class="subtle off-status">Valori inseriti dagli utenti di Open Food Facts (ODbL): se hai la confezione, controlla l'etichetta.</p>`;
}

/** Senza testo: piatti della categoria scelta. Con testo: catalogo (tutte le categorie) + ricerca online. */
function browse() {
  const q = (st.newName || "").trim().toLowerCase();
  if (q.length < 2 && st.cat === FREQUENT) {
    const foods = app.foods.filter((f) => f.use_count > 0).sort((a, b) => b.use_count - a.use_count).slice(0, FREQUENT_MAX);
    return `<div class="pick-list">${foods.map(foodPick).join("") || '<p class="subtle">Qui compaiono i piatti che registri più spesso. Per ora scegli da una categoria.</p>'}</div>`;
  }
  if (q.length < 2) {
    const foods = app.foods.filter((f) => f.category === st.cat);
    return `<div class="pick-list">${foods.map(foodPick).join("") || '<p class="subtle">Nessun piatto in questa categoria: scrivilo qui sopra.</p>'}</div>`;
  }
  const local = app.foods.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 6);
  return `${local.length ? `<span class="eyebrow">Nel tuo catalogo</span><div class="pick-list">${local.map(foodPick).join("")}</div>` : ""}${onlineBlock(q)}${!local.length && (online.disabled || q.length < 3) ? '<p class="subtle">Non è nel catalogo: aggiungilo a mano qui sotto.</p>' : ""}`;
}

const paintBrowse = () => {
  const box = $("#c-browse");
  if (box) box.innerHTML = browse();
};

/** La riga "aggiungi a mano" compare solo quando c'è un nome scritto (resta fuori dall'elenco, che si ridisegna
 *  mentre arrivano i risultati: così i campi non perdono il cursore). */
function paintManual() {
  const row = $("#c-manual");
  if (row) row.hidden = !$("#c-new-name").value.trim() || isBarcode($("#c-new-name").value);
}

async function searchOnline(q) {
  Object.assign(online, { q, status: "loading", items: [], pick: null });
  paintBrowse();
  try {
    // Un codice a barre porta dritto al prodotto e alla sua porzione; un testo all'elenco dei risultati.
    const code = isBarcode(q);
    const out = code ? await lookup(q) : await request(`/api/v1/food-search?q=${encodeURIComponent(q)}`, { timeout: 12000 });
    if (online.q !== q) return; // nel frattempo l'utente ha scritto altro
    if (!out.enabled) online.disabled = true;
    const items = code ? (out.item ? [out.item] : []) : out.items;
    Object.assign(online, { status: "done", items, pick: code && items.length ? 0 : null });
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
    paintManual();
  }
  if (e.target.id === "c-off-g" && online.pick != null) {
    const grams = num(e.target.value.replace(",", "."));
    $("#c-off-kcal").textContent = grams > 0 ? offValues(portion(online.items[online.pick], grams)) : "—";
  }
});

/** Prima di ridisegnare conserva ciò che l'utente ha scritto nei campi. */
function capture() {
  if (st.edit != null) applyEdit();
  st.date = $("#c-date").value;
  if ($("#c-desc")) st.description = $("#c-desc").value;
  if ($("#c-kcal")) st.kcal = $("#c-kcal").value;
  st.newName = $("#c-new-name").value;
  st.newKcal = $("#c-new-kcal").value;
  st.newProt = $("#c-new-prot").value;
}

function sumLine(t) {
  const notes = [
    t.kcal == null ? "nessun valore" : t.estimate ? "stima" : "valori dichiarati",
    t.missing ? `${t.missing} senza valori` : "",
    t.noProtein ? `proteine non indicate per ${t.noProtein}` : "",
    t.home.length ? `a casa: ${esc(t.home.map((i) => i.name).join(", "))}` : "",
  ];
  return `<div class="composer-sum">
    <strong>${t.kcal != null ? `${t.estimate ? "~" : ""}${fmtNum(t.kcal, 0)} kcal` : "— kcal"}</strong>
    <span>${t.protein != null ? `${t.noProtein ? "almeno " : ""}${fmtNum(t.protein, 0)} g proteine` : "— g proteine"}</span>
    <small>${notes.filter(Boolean).join(" · ")}</small>
  </div>`;
}

/** Ridisegna tenendo ciò che è scritto nei campi (e applicando la correzione di una voce, se aperta). */
function render() {
  capture();
  paint();
}

/** L'ultimo pasto registrato per questo momento della giornata (con le voci), se c'è e se il piatto è vuoto. */
function lastSame() {
  if (st.items.length) return null;
  return (st.recent || []).filter((m) => m.slot === st.slot && m.status === "eaten" && m.items?.length && m.id !== st.id)
    .sort((a, b) => `${b.date}${b.logged_at || ""}`.localeCompare(`${a.date}${a.logged_at || ""}`))[0] || null;
}
function sameAsLast() {
  const m = lastSame();
  return m ? `<button type="button" class="pick same-last" data-same><span>${icon("rotate-ccw", "sm")} Come l'ultimo ${esc(SLOTS[st.slot].toLowerCase())}</span><small>${esc(m.items.map((i) => i.name).join(" + "))} · ${esc(fmtDate(m.date))}</small></button>` : "";
}

function paint() {
  const t = totals(st.items);
  const legacy = !st.items.length && (st.description || st.log);
  const panelAttrs = (zone) => `role="tabpanel" id="c-zone-${zone}" aria-labelledby="${tabId(ZONES, zone)}" tabindex="0"`;
  const body = `<div class="composer" data-zone="${st.zone}">
    <div class="composer-head">
      <h2 id="modal-title">${st.log ? "Modifica pasto" : "Componi il pasto"}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Chiudi senza salvare">${icon("x")}</button>
      <div class="chips scroll" role="group" aria-label="Pasto">${SLOT_ORDER.map((s) => `<button type="button" class="chip ${s === st.slot ? "active" : ""}" aria-pressed="${s === st.slot}" data-slot="${s}">${SLOTS[s]}</button>`).join("")}</div>
      <select id="c-date" aria-label="Giorno">${dayOptions(st.date)}</select>
    </div>
    <div class="composer-tabs">${tabs([["tray", "Nel piatto", null, st.items.length || null], ["add", "Aggiungi"]], st.zone, ZONES, "zone", { tray: "c-zone-tray", add: "c-zone-add" })}</div>
    <div class="composer-zones">
      <section class="composer-zone tray" ${panelAttrs("tray")}>
        <h3>Nel piatto</h3>
        ${st.items.length ? st.items.map(trayRow).join("") : '<p class="subtle tray-empty">Ancora vuoto. Scegli le voci da Aggiungi: primo, salsa, secondo, contorno…</p>'}
        ${legacy ? `<div class="field"><label for="c-desc">Descrizione (pasto registrato senza voci)</label><input id="c-desc" maxlength="300" value="${esc(st.description || "")}"></div>
          <div class="field"><label for="c-kcal">Calorie (facoltativo)</label><input id="c-kcal" inputmode="numeric" value="${esc(st.kcal ?? "")}"></div>` : ""}
      </section>
      <section class="composer-zone add" ${panelAttrs("add")}>
        <h3>Aggiungi</h3>
        ${sameAsLast()}
        <div class="composer-search">
          <input id="c-new-name" maxlength="120" value="${esc(st.newName || "")}" placeholder="Cerca un piatto o un codice a barre" aria-label="Cerca nel catalogo, online o per codice a barre" autocomplete="off">
          ${canScan() ? `<button type="button" class="btn" data-scan aria-label="Leggi il codice a barre con la fotocamera">${icon("scan-barcode")}</button>` : ""}
        </div>
        <div class="chips scroll cat-tabs" role="group" aria-label="Categoria">${[[FREQUENT, "Frequenti"], ...CATEGORIES].map(([k, l]) => `<button type="button" class="chip ${k === st.cat ? "active" : ""}" aria-pressed="${k === st.cat}" data-cat="${k}">${l}</button>`).join("")}</div>
        <div id="c-browse">${browse()}</div>
        <div class="new-food" id="c-manual" ${(st.newName || "").trim() ? "" : "hidden"}>
          <span class="eyebrow">A mano, in ${esc(CAT_LABEL[ownCat()])}</span>
          <input id="c-new-kcal" inputmode="decimal" value="${esc(st.newKcal || "")}" placeholder="kcal" aria-label="Calorie per porzione (facoltativo)">
          <input id="c-new-prot" inputmode="decimal" value="${esc(st.newProt || "")}" placeholder="proteine g" aria-label="Proteine per porzione in grammi (facoltativo)">
          <button type="button" class="btn" data-new>${icon("plus", "sm")}Aggiungi</button>
        </div>
      </section>
    </div>
    <div class="composer-foot">
      ${sumLine(t)}
      <button type="button" class="btn primary xl" data-save>${icon("check")}${st.log ? "Salva modifiche" : `Registra · ${esc(SLOTS[st.slot])}`}</button>
      <button type="button" class="link-btn" ${st.log ? "data-delete>Elimina" : "data-skip>Saltato"}</button>
    </div>
  </div>`;
  const scroll = Object.fromEntries(["tray", "add"].map((z) => [z, $(`#c-zone-${z}`)?.scrollTop || 0]));
  openModal(body, handle, { layout: "composer" });
  $("#modal-body").dataset.static = st.rendered ? "1" : "";
  st.rendered = true;
  for (const z of ["tray", "add"]) $(`#c-zone-${z}`).scrollTop = scroll[z];
}

function addFood(f) {
  const takeaway = st.slot === "lunch" && workday(st.date) && (f.category === "secondo");
  st.items.push({ name: f.name, category: f.category, qty: 1, kcal: f.kcal, protein_g: f.protein_g, nutrition_source: f.nutrition_source, food_id: f.id, takeaway });
  haptic(10);
}

async function save(status = "eaten") {
  capture();
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
  await commit();
  return true;
}

async function handle(t) {
  const row = t.closest(".tray-row");
  if (t.dataset.zone) {
    st.zone = t.dataset.zone;
    render();
    $(`#${tabId(ZONES, st.zone)}`).focus();
    return false;
  }
  if (t.matches("[data-scan]")) {
    const code = await scan().catch((e) => (toast(e.message), null));
    if (!code) return false;
    $("#c-new-name").value = st.newName = code;
    paintManual();
    searchOnline(code);
    return false;
  }
  if (row && t.matches("[data-edit]")) {
    const idx = num(row.dataset.idx);
    const open = st.edit === idx;
    capture(); // applica e chiude la voce eventualmente aperta
    st.edit = open ? null : idx;
    paint();
    return false;
  }
  if (t.matches("[data-edit-ok]")) return render(), false;
  if (t.dataset.slot) {
    st.slot = t.dataset.slot;
    if (st.slot !== "lunch") st.items.forEach((i) => (i.takeaway = false));
    render();
    return false;
  }
  if (t.dataset.cat) return (st.cat = t.dataset.cat), render(), false;
  if (t.matches("[data-same]")) {
    st.items = lastSame().items.map(({ ...i }) => i);
    st.zone = "tray";
    return render(), false;
  }
  if (t.dataset.food) {
    addFood(app.foods.find((f) => f.id === t.dataset.food));
    if ($("#c-new-name")) $("#c-new-name").value = ""; // scelta fatta: si torna all'elenco per categoria
    render();
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
      name: `${p.name}${brand ? ` ${brand}` : ""} (${fmtNum(grams, 0)} g)`.slice(0, 120), category: ownCat(), qty: 1,
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
    const kcal = decimal($("#c-new-kcal").value);
    if (!name) return toast("Scrivi il nome del piatto"), false;
    const existing = app.foods.find((f) => f.name.toLowerCase() === name.toLowerCase());
    addFood(existing || { id: null, name, category: ownCat(), kcal, protein_g: kcal == null ? null : decimal($("#c-new-prot").value), nutrition_source: kcal == null ? null : "manual" });
    $("#c-new-name").value = $("#c-new-kcal").value = $("#c-new-prot").value = "";
    render();
    return false;
  }
  if (t.matches("[data-save]")) return save("eaten");
  if (t.matches("[data-skip]")) return save("skipped");
  if (t.matches("[data-delete]")) {
    if (!confirm("Eliminare questo pasto dal diario?")) return false;
    enqueue("DELETE", `/api/v1/meal-logs/${encodeURIComponent(st.id)}`, undefined, `meal:${st.id}`);
    toast("Pasto eliminato");
    await commit();
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
  const recent = log ? [] : await request(`/api/v1/meal-logs?from=${addDays(date, -SAME_DAYS)}&to=${date}`).then((r) => r.items, () => []);
  st = {
    recent,
    id: log?.id || uid(),
    log,
    slot: log?.slot || slot,
    date: log?.date || date,
    items: (log?.items?.length ? log.items : items).map((i) => ({ ...i })),
    description: log && !log.items?.length ? log.description : "",
    kcal: log && !log.items?.length ? log.kcal : null,
    note: log?.note || "",
    zone: log || items.length ? "tray" : "add",
    edit: null, // indice della voce di cui si stanno correggendo i valori
    cat: !log && !items.length && app.foods.some((f) => f.use_count > 0) ? FREQUENT : slotCat(log?.slot || slot),
    reminderId,
    rendered: false,
  };
  online.pick = null;
  paint();
}

