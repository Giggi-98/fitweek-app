import { icon } from "./icons.js";
import { $, esc, fmtDate, isoDate, num } from "./util.js";

export function toast(message, { action, onAction, timeout = 4000 } = {}) {
  const node = $("#toast");
  node.replaceChildren(document.createTextNode(message));
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action;
    b.addEventListener("click", () => {
      node.classList.add("hidden");
      onAction?.();
    });
    node.append(b);
  }
  node.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.add("hidden"), timeout);
}

// I parametri title/desc sono testo dell'app (costanti); i dati utente vanno passati già escapati.
export const panel = (title, body, action = "", cls = "", id = "") =>
  `<section class="panel ${cls}"${id ? ` id="${id}"` : ""}><div class="panel-head"><h3>${title}</h3>${action}</div>${body}</section>`;
export const stat = (label, value, sub, { calc = false } = {}) =>
  `<div class="metric"><div class="metric-label">${label}${calc ? ' <span class="badge-calc" title="Valore calcolato">calcolato</span>' : ""}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div>`;
export const empty = (title, text) => `<div class="data-empty"><strong>${title}</strong>${text}</div>`;
/**
 * Schede orizzontali, uguali in tutte le viste. `items` = [[chiave, etichetta, icona?, conteggio?]].
 * La vista riceve il click su `data-tab` (o sull'attributo indicato in `attr`).
 * Da tastiera: Tab si ferma solo sulla scheda attiva; frecce, Inizio e Fine scelgono le altre (`tabKey`).
 * `panel` (id condiviso, o mappa chiave → id) collega ogni scheda al suo pannello con `aria-controls`:
 * il contenuto va avvolto da `tabpanel()` (FW-UX-002). Ogni elenco di schede ha il suo pannello: per una
 * scelta che non apre un pannello (tema, giornata della scheda) si usa `choices()`.
 */
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const tabId = (label, key) => `tab-${slug(label)}-${slug(key)}`;
const strip = (role, label, items, active, attr, attrs) =>
  `<div class="tabs" role="${role}" aria-label="${esc(label)}">${items
    .map(([key, text, ic, count]) => `<button type="button" class="tab ${key === active ? "active" : ""}" ${attrs(key)} tabindex="${key === active ? 0 : -1}" data-${attr}="${esc(key)}">${ic ? icon(ic, "sm") : ""}<span>${esc(text)}</span>${count == null ? "" : `<small>${esc(count)}</small>`}</button>`)
    .join("")}</div>`;
export const tabs = (items, active, label, attr = "tab", panel = null) => {
  const controls = (key) => {
    const id = typeof panel === "string" ? panel : panel?.[key];
    return id ? ` aria-controls="${esc(id)}"` : "";
  };
  return strip("tablist", label, items, active, attr, (key) => `role="tab" id="${tabId(label, key)}"${controls(key)} aria-selected="${key === active}"`);
};
/** Scelta di un valore tra pochi (tema, giornata della scheda): stesso aspetto e stessi tasti delle schede,
 *  ma non comanda un pannello, quindi è un gruppo di opzioni (`radiogroup`) e non un elenco di schede. */
export const choices = (items, active, label, attr) =>
  strip("radiogroup", label, items, active, attr, (key) => `role="radio" aria-checked="${key === active}"`);
/** Il contenuto comandato dalle schede: un solo pannello, etichettato dalla scheda attiva. */
export const tabpanel = (id, label, activeKey, body) =>
  `<div class="tabpanel" role="tabpanel" id="${esc(id)}" aria-labelledby="${tabId(label, activeKey)}" tabindex="0">${body}</div>`;
export const TAB_LISTS = "[role=tablist], [role=radiogroup]";
export const TAB_ITEMS = "[role=tab], [role=radio]";
/** Tasti di un elenco di schede o di opzioni (`tabs()`, `choices()`): frecce, Inizio, Fine. Le voci
 *  disattivate si saltano. @returns la voce da attivare, o null se il tasto non riguarda le schede */
export function tabKey(tab, key) {
  const all = [...(tab.closest(TAB_LISTS)?.querySelectorAll(":is([role=tab], [role=radio]):not([disabled])") || [])];
  const i = all.indexOf(tab);
  if (i < 0) return null;
  const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[key];
  return to === undefined ? null : all[(to + all.length) % all.length];
}
export const pill = (text, kind = "") => `<span class="pill ${kind}">${esc(text)}</span>`;

/** La CSP vieta gli attributi style: dimensioni e variabili dinamiche viaggiano in data-* e
 *  vengono applicate qui via CSSOM dopo ogni inserimento di HTML (data-pct-h/-w in %, data-vars "nome:valore;…"). */
export function applyDynamicStyles(root) {
  root.querySelectorAll("[data-pct-h]").forEach((el) => (el.style.height = `${num(el.dataset.pctH)}%`));
  root.querySelectorAll("[data-pct-w]").forEach((el) => (el.style.width = `${num(el.dataset.pctW)}%`));
  root.querySelectorAll("[data-vars]").forEach((el) => {
    for (const pair of el.dataset.vars.split(";")) {
      const [name, value] = pair.split(":");
      if (name && value) el.style.setProperty(`--${name.trim()}`, value.trim());
    }
  });
}

/** <option> degli ultimi `n` giorni (Oggi, Ieri, poi la data); `selected` è sempre presente. */
export function dayOptions(selected = isoDate(), n = 14) {
  const days = [];
  for (let k = 0; k < n; k++) {
    const d = new Date();
    d.setDate(d.getDate() - k);
    days.push(isoDate(d));
  }
  if (!days.includes(selected)) days.push(selected);
  return days
    .map((iso, k) => `<option value="${iso}" ${iso === selected ? "selected" : ""}>${k === 0 ? "Oggi" : k === 1 ? "Ieri" : esc(fmtDate(iso))}</option>`)
    .join("");
}

// ---- finestra modale (una alla volta) ------------------------------------------------------
let modalHandler = null;
/** Apre la modale con `html`; `handler(target)` riceve i click e restituisce true per chiudere. */
export function openModal(html, handler) {
  const dlg = $("#modal");
  $("#modal-body").innerHTML = html;
  applyDynamicStyles($("#modal-body"));
  modalHandler = handler;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector("[autofocus]")?.focus();
}
export function closeModal() {
  const dlg = $("#modal");
  modalHandler = null;
  if (dlg.open) dlg.close();
}
export const modalOpen = () => $("#modal").open;
export function initModal() {
  const dlg = $("#modal");
  dlg.addEventListener("click", async (e) => {
    if (e.target === dlg) return closeModal(); // tocco sullo sfondo
    const t = e.target.closest("button");
    if (!t || !modalHandler) return;
    e.preventDefault();
    if (await modalHandler(t)) closeModal();
  });
  dlg.addEventListener("cancel", () => (modalHandler = null));
}
