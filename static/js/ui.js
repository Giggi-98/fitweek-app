import { $, esc } from "./util.js";

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
export const sectionTitle = (title, desc, right = "") =>
  `<div class="intro"><div><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ""}</div>${right}</div>`;
export const stat = (label, value, sub, { calc = false } = {}) =>
  `<div class="metric"><div class="metric-label">${label}${calc ? ' <span class="badge-calc" title="Valore calcolato">calcolato</span>' : ""}</div><div class="metric-value">${value}</div><div class="metric-sub">${sub}</div></div>`;
export const empty = (title, text) => `<div class="data-empty"><strong>${title}</strong>${text}</div>`;
export const pill = (text, kind = "") => `<span class="pill ${kind}">${esc(text)}</span>`;

// ---- finestra modale (una alla volta) ------------------------------------------------------
let modalHandler = null;
/** Apre la modale con `html`; `handler(target)` riceve i click e restituisce true per chiudere. */
export function openModal(html, handler) {
  const dlg = $("#modal");
  $("#modal-body").innerHTML = html;
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
