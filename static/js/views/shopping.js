// Spesa e dispensa: lista della settimana (blob), spesa reale per settimana (API v1), dispensa con scadenze.
import { request } from "../api.js";
import { icon } from "../icons.js";
import { dayNumber, mondayOf } from "../stats.js";
import { app, persistState } from "../store.js";
import { empty, openModal, panel, toast } from "../ui.js";
import { $, esc, fmtDate, isoDate, money, num, uid } from "../util.js";

const CATEGORIES = ["Spuntini", "Proteine", "Verdure e frutta", "Dispensa", "Altro"];
const WEEKS_SHOWN = 8;
const parseAmount = (v) => (String(v ?? "").trim() === "" ? null : num(String(v).replace(",", "."), null));
const thisWeek = () => mondayOf(app.today?.date || isoDate());
const shortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "short" });

/** Scadenza in parole, con evidenza (non allarme) per ciò che scade entro 3 giorni. */
function expiryLabel(iso) {
  if (!iso) return "";
  const days = dayNumber(iso) - dayNumber(isoDate());
  const when = days < 0 ? `scaduto il ${fmtDate(iso)}` : days === 0 ? "scade oggi" : days === 1 ? "scade domani" : days <= 3 ? `scade tra ${days} giorni` : `scade ${fmtDate(iso)}`;
  return ` · <span class="${days <= 3 ? "pantry-soon" : ""}">${esc(when)}</span>`;
}
const byExpiry = (a, b) => (a.expiry || "9999").localeCompare(b.expiry || "9999");

function tiles(g, budget) {
  const total = g.reduce((s, x) => s + num(x.price), 0);
  const open = g.filter((x) => !x.checked);
  const ratio = budget ? Math.min(100, Math.round((total / budget) * 100)) : 0;
  const spent = app.spend.find((s) => s.week_start === thisWeek());
  return `<div class="tiles three">
    <div class="metric tile"><div class="metric-label">${icon("list-checks", "sm")}Da prendere</div><div class="metric-value">${open.length}<small> ${open.length === 1 ? "articolo" : "articoli"}</small></div><div class="metric-sub">${money(open.reduce((s, x) => s + num(x.price), 0))} stimati</div></div>
    <div class="metric tile"><div class="metric-label">${icon("shopping-cart", "sm")}Lista <span class="badge-calc">stima</span></div><div class="metric-value">${money(total)}<small> / ${money(budget)}</small></div><div class="bar ${total > budget ? "over" : ""}" role="img" aria-label="${ratio}% del budget"><div data-pct-w="${ratio}"></div></div><div class="metric-sub">${total > budget ? "sopra il budget stimato" : "nel budget, consegna esclusa"}</div></div>
    <button type="button" class="metric tile" data-spend="${thisWeek()}"><div class="metric-label">${icon("check", "sm")}Pagato questa settimana</div><div class="metric-value">${spent ? money(spent.amount) : "—"}</div><div class="metric-sub">${spent ? (spent.amount > budget ? `${money(spent.amount - budget)} sopra il budget` : `${money(budget - spent.amount)} sotto il budget`) : "tocca per inserire il totale"}</div></button>
  </div>`;
}

function listPanel(g) {
  const categories = [...new Set([...CATEGORIES, ...g.map((x) => x.category || "Altro")])].filter((c) => g.some((x) => (x.category || "Altro") === c));
  const row = (x) =>
    `<label class="shopitem ${x.checked ? "done" : ""}"><input type="checkbox" data-check-item="${esc(x.id)}" ${x.checked ? "checked" : ""}><span class="cbox">${icon("check")}</span><span class="shop-main"><span class="shopname">${esc(x.name)}</span><span class="shopqty">${esc(x.qty)}${x.recurring ? " · ogni settimana" : ""}</span></span><span class="shopprice">${money(x.price)}</span><button type="button" class="icon-btn ${x.recurring ? "on" : ""}" data-recurring="${esc(x.id)}" aria-pressed="${Boolean(x.recurring)}" aria-label="${esc(x.name)}: compra ogni settimana" title="Compra ogni settimana">${icon("refresh-cw", "sm")}</button><button type="button" class="icon-btn" data-remove-shop="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">${icon("x", "sm")}</button></label>`;
  const anyChecked = g.some((x) => x.checked);
  return panel(
    `${icon("shopping-cart")}Lista della spesa`,
    `${categories.map((cat) => `<div class="tiny-label group-label">${esc(cat)}</div>${g.filter((x) => (x.category || "Altro") === cat).map(row).join("")}`).join("") || empty("Lista vuota", "Aggiungi i prodotti qui sotto.")}
    ${anyChecked ? `<button type="button" class="btn primary full" data-arrived>${icon("package")}Spesa arrivata</button>` : ""}
    <div class="button-row"><button class="btn small" data-copy-shopping>Copia lista</button>${anyChecked ? '<button class="btn small" data-clear-shopping>Deseleziona tutto</button>' : ""}</div>
    <details class="free"><summary>${icon("plus", "sm")}Aggiungi prodotto</summary>
      <form id="shopping-form" class="stack"><div class="form-grid"><div class="field"><label for="sh-name">Prodotto</label><input id="sh-name" name="name" required maxlength="120" placeholder="es. Banane"></div><div class="field"><label for="sh-qty">Quantità</label><input id="sh-qty" name="qty" required maxlength="60" placeholder="es. 1 kg"></div><div class="field"><label for="sh-price">Prezzo stimato (€)</label><input id="sh-price" name="price" inputmode="decimal" placeholder="0,00"></div><div class="field"><label for="sh-cat">Categoria</label><select id="sh-cat" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div></div><button class="btn primary" type="submit">${icon("plus", "sm")}Aggiungi</button></form>
    </details>
    <p class="subtle">Prezzi stimati a mano: verifica disponibilità e totale su Esselunga.</p>`,
    "", "", "shopping-list",
  );
}

/** Colonne delle ultime settimane rispetto al budget (linea di riferimento). Valori anche in elenco. */
function spendPanel(budget) {
  const weeks = [...app.spend].slice(0, WEEKS_SHOWN).reverse();
  if (!weeks.length) {
    return panel(`${icon("chart-line")}Spese settimanali`, empty("Nessuna spesa registrata", "Quando arriva la spesa inserisci il totale pagato: qui vedrai l'andamento rispetto al budget."), `<button class="btn small" data-spend="${thisWeek()}">${icon("plus", "sm")}Totale</button>`);
  }
  const max = Math.max(budget, ...weeks.map((w) => w.amount)) * 1.1;
  const avg = weeks.reduce((s, w) => s + w.amount, 0) / weeks.length;
  const cols = weeks
    .map((w) => `<button type="button" class="wk-col ${w.amount > budget ? "over" : ""}" data-spend="${esc(w.week_start)}" aria-label="Settimana del ${esc(fmtDate(w.week_start))}: ${money(w.amount)}">
      <span class="wk-tip">${money(w.amount)}<small>${w.amount > budget ? "sopra il budget" : "nel budget"}</small></span>
      <span class="wk-fill" data-pct-h="${Math.max(3, Math.round((w.amount / max) * 100))}"></span>
    </button>`)
    .join("");
  return panel(
    `${icon("chart-line")}Spese settimanali`,
    `<p class="cons-head"><strong>${money(avg)}</strong> in media a settimana <span class="badge-calc">calcolata</span></p>
    <div class="wk-chart spend" data-vars="cols:${weeks.length}">${cols}${budget ? `<span class="wk-ref" data-vars="ref:${Math.round((budget / max) * 100)}%"><i>budget ${money(budget)}</i></span>` : ""}</div>
    <div class="wk-days" data-vars="cols:${weeks.length}">${weeks.map((w) => `<span>${esc(shortDate(w.week_start))}</span>`).join("")}</div>
    <p class="subtle">Tocca una colonna per correggere il totale di quella settimana.</p>`,
    `<button class="btn small" data-spend="${thisWeek()}">${icon("plus", "sm")}Totale</button>`,
  );
}

function pantryPanel() {
  const items = [...app.state.inventory].sort(byExpiry);
  return panel(
    `${icon("package")}Dispensa`,
    `${items.length ? items.map((x) => `<div class="entry"><div><div class="entry-title">${esc(x.name)}</div><div class="entry-sub">${esc(x.qty)}${expiryLabel(x.expiry)}</div></div><button type="button" class="icon-btn" data-remove-inv="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">${icon("x", "sm")}</button></div>`).join("") : empty("Dispensa non ancora censita", "Comincia da 3–4 alimenti già in casa.")}
    <details class="free"><summary>${icon("plus", "sm")}Aggiungi in dispensa</summary>
      <form id="inventory-form" class="stack"><div class="field"><label for="in-name">Alimento</label><input id="in-name" name="name" required maxlength="120" placeholder="es. Riso"></div><div class="form-grid"><div class="field"><label for="in-qty">Quantità</label><input id="in-qty" name="qty" required maxlength="60" placeholder="es. 300 g"></div><div class="field"><label for="in-exp">Scadenza (facoltativa)</label><input id="in-exp" name="expiry" type="date"></div></div><button class="btn primary" type="submit">${icon("plus", "sm")}Aggiungi</button></form>
    </details>
    <p class="subtle">Sottovuoto non significa senza scadenza: vale l'etichetta.</p>`,
  );
}

export function render() {
  const g = app.state.groceries;
  const budget = num(app.state.profile.budget);
  return `${tiles(g, budget)}<div class="twocol"><div class="stack">${listPanel(g)}</div><div class="stack">${spendPanel(budget)}${pantryPanel()}</div></div>`;
}

// ---- spesa reale ------------------------------------------------------------------------------
async function reloadSpend() {
  app.spend = (await request("/api/v1/grocery-spend")).items;
}

async function saveSpend(week, amount) {
  if (amount == null) await request(`/api/v1/grocery-spend/${week}`, { method: "DELETE" });
  else await request(`/api/v1/grocery-spend/${week}`, { method: "PUT", body: { amount } });
  await reloadSpend();
}

/** Totale pagato in una settimana. Con `arrived` sposta anche gli articoli spuntati in dispensa. */
function openSpend(week, { arrived = false } = {}) {
  const existing = app.spend.find((s) => s.week_start === week);
  const checked = app.state.groceries.filter((x) => x.checked);
  const estimate = checked.reduce((s, x) => s + num(x.price), 0);
  const prefill = existing ? existing.amount : arrived && estimate ? estimate : "";
  openModal(
    `<div class="modal-ic">${icon(arrived ? "package" : "shopping-cart")}</div>
    <h2 id="modal-title">${arrived ? "Spesa arrivata" : "Totale pagato"}</h2>
    <p class="subtle">Settimana del ${esc(fmtDate(week))}.${arrived ? ` ${checked.length} ${checked.length === 1 ? "articolo spuntato va" : "articoli spuntati vanno"} in dispensa; quelli "ogni settimana" restano in lista per la prossima.` : ""}</p>
    <div class="field"><label for="sp-amount">Totale pagato (€)${arrived ? " · facoltativo" : ""}</label><input id="sp-amount" inputmode="decimal" autofocus placeholder="es. 42,50" value="${esc(String(prefill).replace(".", ","))}"></div>
    <button type="button" class="btn primary xl full" data-m="save">${icon("check")}${arrived ? "Conferma" : "Salva"}</button>
    <div class="modal-secondary">${existing && !arrived ? '<button type="button" data-m="delete">Elimina</button>' : ""}<button type="button" data-m="close">Annulla</button></div>`,
    async (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.m !== "save" && t.dataset.m !== "delete") return false;
      const amount = t.dataset.m === "delete" ? null : parseAmount($("#sp-amount").value);
      if (amount != null && (amount < 0 || amount > 10000)) return toast("Importo non valido"), false;
      if (amount == null && !arrived && t.dataset.m === "save") return toast("Inserisci il totale pagato"), false;
      try {
        if (amount != null || t.dataset.m === "delete") await saveSpend(week, amount);
      } catch (e) {
        return toast("Totale non salvato: " + e.message), false;
      }
      if (arrived) await moveToPantry();
      else toast(amount == null ? "Totale eliminato" : "Totale salvato");
      app.render();
      return true;
    },
  );
}

/** Gli articoli spuntati entrano in dispensa (senza doppioni); i ricorrenti restano in lista, da spuntare di nuovo. */
async function moveToPantry() {
  const bought = app.state.groceries.filter((x) => x.checked);
  const have = new Set(app.state.inventory.map((x) => x.name.trim().toLowerCase()));
  for (const x of bought) {
    if (!have.has(x.name.trim().toLowerCase())) app.state.inventory.push({ id: uid(), name: x.name, qty: x.qty, expiry: "" });
  }
  app.state.groceries = app.state.groceries.filter((x) => !x.checked || x.recurring);
  app.state.groceries.forEach((x) => (x.checked = false));
  if (await persistState()) toast(`${bought.length} ${bought.length === 1 ? "prodotto" : "prodotti"} in dispensa`);
}

export async function onClick(t) {
  if (t.dataset.spend) return openSpend(t.dataset.spend), false;
  if (t.matches("[data-arrived]")) return openSpend(thisWeek(), { arrived: true }), false;
  if (t.dataset.recurring) {
    const item = app.state.groceries.find((x) => x.id === t.dataset.recurring);
    if (item) item.recurring = !item.recurring;
    persistState();
    return true;
  }
  if (t.dataset.removeShop) {
    app.state.groceries = app.state.groceries.filter((x) => x.id !== t.dataset.removeShop);
    persistState();
    return true;
  }
  if (t.dataset.removeInv) {
    app.state.inventory = app.state.inventory.filter((x) => x.id !== t.dataset.removeInv);
    persistState();
    return true;
  }
  if (t.matches("[data-clear-shopping]")) {
    app.state.groceries.forEach((x) => (x.checked = false));
    persistState();
    return true;
  }
  if (t.matches("[data-copy-shopping]")) {
    const text = app.state.groceries.filter((x) => !x.checked).map((x) => `${x.name} — ${x.qty}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Lista copiata");
    } catch {
      prompt("Copia la lista:", text); // fallback su HTTP, dove la Clipboard API non è disponibile
    }
    return false;
  }
  return false;
}

export function onChange(t) {
  if (!t.dataset.checkItem) return false;
  const item = app.state.groceries.find((x) => x.id === t.dataset.checkItem);
  if (item) {
    item.checked = t.checked;
    persistState();
  }
  return true;
}

export async function onSubmit(form, data) {
  if (form.id === "shopping-form") {
    app.state.groceries.push({ id: uid(), name: data.name.trim(), qty: data.qty.trim(), price: Math.max(0, parseAmount(data.price) ?? 0), category: data.category, checked: false, recurring: false });
    if (await persistState()) toast("Prodotto aggiunto");
    return true;
  }
  if (form.id === "inventory-form") {
    app.state.inventory.push({ id: uid(), name: data.name.trim(), qty: data.qty.trim(), expiry: data.expiry || "" });
    if (await persistState()) toast("Alimento aggiunto");
    return true;
  }
  return false;
}
