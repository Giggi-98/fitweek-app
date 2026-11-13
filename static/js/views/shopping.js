// Spesa e dispensa: lista della settimana (blob), spesa reale per settimana (API v1), dispensa con scadenze.
import { request } from "../api.js";
import { icon } from "../icons.js";
import { dayNumber, formatQty, mondayOf, parseQty, planProposal } from "../stats.js";
import { app, persistState } from "../store.js";
import { empty, openModal, panel, removalToast, tabpanel, tabs, toast } from "../ui.js";
import { $, $$, esc, fmtDate, fmtNum, isoDate, money, num, putBack, storage, takeById, uid } from "../util.js";

const CATEGORIES = ["Spuntini", "Proteine", "Verdure e frutta", "Dispensa", "Altro"];
const UNITS = [
  ["", "Unità libera / auto"],
  ["g", "g (grammi)"],
  ["kg", "kg (chili)"],
  ["ml", "ml"],
  ["l", "l (litri)"],
  ["pz", "pz (pezzi)"],
  ["conf", "conf (confezioni)"],
];
const USER_PRICES_KEY = "fitweek.userPrices.v1"; // prezzi inseriti a mano dall'utente (mai inventati)
const WEEKS_SHOWN = 8;
const ui = { tab: "list" };
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
  const qtyText = (x) => formatQty(x.amount, x.unit, x.qty || "");
  const priceText = (x) => (x.price != null && Number(x.price) > 0 ? money(x.price) : "—");
  const row = (x) =>
    `<div class="shoprow"><label class="shopitem ${x.checked ? "done" : ""}"><input type="checkbox" data-check-item="${esc(x.id)}" ${x.checked ? "checked" : ""}><span class="cbox">${icon("check")}</span><span class="shop-main"><span class="shopname">${esc(x.name)}</span><span class="shopqty">${esc(qtyText(x))}${x.recurring ? " · ogni settimana" : ""}</span></span><span class="shopprice">${priceText(x)}</span></label><button type="button" class="icon-btn ${x.recurring ? "on" : ""}" data-recurring="${esc(x.id)}" aria-pressed="${Boolean(x.recurring)}" aria-label="${esc(x.name)}: compra ogni settimana" title="Compra ogni settimana">${icon("refresh-cw", "sm")}</button><button type="button" class="icon-btn" data-remove-shop="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">${icon("x", "sm")}</button></div>`;
  const anyChecked = g.some((x) => x.checked);
  const group = (cat) => {
    const items = g.filter((x) => (x.category || "Altro") === cat);
    return `<div class="shop-group"><div class="group-head"><span class="tiny-label">${esc(cat)}</span><span class="tiny-label num">${money(items.reduce((s, x) => s + num(x.price), 0))}</span></div>${items.map(row).join("")}</div>`;
  };
  const unitOpts = UNITS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  return panel(
    `${icon("shopping-cart")}Lista della spesa`,
    `${categories.length ? `<div class="shop-groups">${categories.map(group).join("")}</div>` : empty("Lista vuota", "Aggiungi i prodotti qui sotto o generala dal piano.")}
    ${anyChecked ? `<button type="button" class="btn primary full" data-arrived>${icon("package")}Spesa arrivata</button>` : ""}
    <details class="free"><summary>${icon("plus", "sm")}Aggiungi prodotto</summary>
      <form id="shopping-form" class="stack"><div class="form-grid four"><div class="field"><label for="sh-name">Prodotto</label><input id="sh-name" name="name" required maxlength="120" placeholder="es. Banane"></div><div class="field"><label for="sh-qty">Quantità</label><input id="sh-qty" name="qty" required maxlength="60" placeholder="es. 500 o 1 kg"></div><div class="field"><label for="sh-unit">Unità</label><select id="sh-unit" name="unit">${unitOpts}</select></div><div class="field"><label for="sh-price">Prezzo stimato (€)</label><input id="sh-price" name="price" inputmode="decimal" placeholder="facoltativo"></div><div class="field"><label for="sh-cat">Categoria</label><select id="sh-cat" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select></div></div><button class="btn primary" type="submit">${icon("plus", "sm")}Aggiungi</button></form>
    </details>
    <p class="subtle">Prezzi inseriti da te: se non l'hai mai inserito, il prezzo resta vuoto.</p>`,
    `<div class="panel-actions"><button class="btn small" data-generate-list>${icon("sparkles", "sm")}Genera dal piano</button>${anyChecked ? '<button class="btn small" data-clear-shopping>Deseleziona tutto</button>' : ""}<button class="btn small" data-copy-shopping>Copia lista</button></div>`,
    "", "shopping-list",
  );
}

/** Colonne delle ultime settimane rispetto al budget (linea di riferimento). Valori anche in elenco. */
function spendPanel(budget) {
  const weeks = [...app.spend].slice(0, WEEKS_SHOWN).reverse();
  const add = `<button class="btn small" data-spend="${thisWeek()}">${icon("plus", "sm")}Totale</button>`;
  if (!weeks.length) {
    return panel(`${icon("chart-line")}Spese settimanali`, empty("Nessuna spesa registrata", "Quando arriva la spesa inserisci il totale pagato: qui vedrai l'andamento rispetto al budget."), add);
  }
  const max = Math.max(budget, ...weeks.map((w) => w.amount)) * 1.12;
  const avg = weeks.reduce((s, w) => s + w.amount, 0) / weeks.length;
  const cols = weeks
    .map((w) => `<button type="button" class="wk-col ${w.amount > budget ? "over" : ""}" data-spend="${esc(w.week_start)}" aria-label="Settimana del ${esc(fmtDate(w.week_start))}: ${money(w.amount)}">
      <span class="wk-tip">${money(w.amount)}<small>${w.amount > budget ? "sopra il budget" : "nel budget"}</small></span>
      <span class="wk-stack" data-pct-h="${Math.max(3, Math.round((w.amount / max) * 100))}"><em class="wk-val">${fmtNum(w.amount, 0)} €</em><span class="wk-fill"></span></span>
    </button>`)
    .join("");
  return `<div class="split wide-left">${panel(
    `${icon("chart-line")}Spese settimanali`,
    `<div class="chart-caption"><p class="cons-head"><strong>${money(avg)}</strong> in media a settimana <span class="badge-calc">calcolata</span></p>${budget ? `<span class="chart-legend"><span><i class="key ref"></i>budget ${money(budget)}</span><span><i class="key over"></i>sopra il budget</span></span>` : ""}</div>
    <div class="wk-chart spend tall" data-vars="cols:${weeks.length}">${cols}${budget ? `<span class="wk-ref" data-vars="ref:${(budget / max).toFixed(3)}"></span>` : ""}</div>
    <div class="wk-days" data-vars="cols:${weeks.length}">${weeks.map((w) => `<span>${esc(shortDate(w.week_start))}</span>`).join("")}</div>`,
    add,
  )}${panel(
    `${icon("list-checks")}Settimana per settimana`,
    `<div class="table-scroll"><table><thead><tr><th>Settimana dal</th><th>Pagato</th><th>Rispetto al budget</th></tr></thead><tbody>${[...weeks].reverse().map((w) => `<tr class="clickable" role="button" tabindex="0" data-spend="${esc(w.week_start)}" aria-label="Correggi il totale del ${esc(fmtDate(w.week_start))}"><td>${esc(fmtDate(w.week_start))}</td><td>${money(w.amount)}</td><td>${budget ? `${w.amount > budget ? "+" : "−"}${money(Math.abs(w.amount - budget))}` : "—"}</td></tr>`).join("")}</tbody></table></div>
    <p class="subtle">Tocca una riga o una colonna per correggere il totale.</p>`,
  )}</div>`;
}

function pantryPanel() {
  const items = [...app.state.inventory].sort(byExpiry);
  const qtyText = (x) => formatQty(x.amount, x.unit, x.qty || "");
  const unitOpts = UNITS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  return panel(
    `${icon("package")}Dispensa`,
    `${items.length ? `<div class="card-grid">${items.map((x) => `<div class="mini-card"><div><div class="entry-title">${esc(x.name)}</div><div class="entry-sub">${esc(qtyText(x))}${expiryLabel(x.expiry)}</div></div><button type="button" class="icon-btn" data-remove-inv="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">${icon("x", "sm")}</button></div>`).join("")}</div>` : empty("Dispensa non ancora censita", "Comincia da 3–4 alimenti già in casa.")}
    <details class="free"><summary>${icon("plus", "sm")}Aggiungi in dispensa</summary>
      <form id="inventory-form" class="stack"><div class="form-grid four"><div class="field"><label for="in-name">Alimento</label><input id="in-name" name="name" required maxlength="120" placeholder="es. Riso"></div><div class="field"><label for="in-qty">Quantità</label><input id="in-qty" name="qty" required maxlength="60" placeholder="es. 300 o 300 g"></div><div class="field"><label for="in-unit">Unità</label><select id="in-unit" name="unit">${unitOpts}</select></div><div class="field"><label for="in-exp">Scadenza (facoltativa)</label><input id="in-exp" name="expiry" type="date"></div></div><button class="btn primary" type="submit">${icon("plus", "sm")}Aggiungi</button></form>
    </details>
    <p class="subtle">Sottovuoto non significa senza scadenza: vale l'etichetta.</p>`,
  );
}

export function render() {
  const g = app.state.groceries;
  const budget = num(app.state.profile.budget);
  const body = ui.tab === "pantry" ? pantryPanel() : ui.tab === "spend" ? spendPanel(budget) : listPanel(g);
  return `${tiles(g, budget)}${tabs([["list", "Lista", "shopping-cart", g.filter((x) => !x.checked).length], ["pantry", "Dispensa", "package", app.state.inventory.length], ["spend", "Spese", "chart-line"]], ui.tab, "Spesa e dispensa", "tab", "shopping-panel")}${tabpanel("shopping-panel", "Spesa e dispensa", ui.tab, body)}`;
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

/** Gli articoli spuntati entrano in dispensa (sommando le quantità compatibili); i ricorrenti restano in lista. */
async function moveToPantry() {
  const bought = app.state.groceries.filter((x) => x.checked);
  for (const x of bought) {
    const parsed = x.amount != null ? parseQty(x.amount, x.unit) : parseQty(x.qty, x.unit);
    const key = x.name.trim().toLowerCase();
    const existing = app.state.inventory.find((i) => i.name.trim().toLowerCase() === key && (!parsed.unit || !i.unit || i.unit === parsed.unit));
    if (existing && parsed.amount && existing.amount != null) {
      existing.amount = Math.round((existing.amount + parsed.amount) * 100) / 100;
      existing.unit = existing.unit || parsed.unit;
      existing.qty = formatQty(existing.amount, existing.unit, existing.qty);
    } else if (!existing) {
      app.state.inventory.push({
        id: uid(), name: x.name, amount: parsed.amount, unit: parsed.unit,
        qty: formatQty(parsed.amount, parsed.unit, x.qty), expiry: "",
      });
    }
  }
  app.state.groceries = app.state.groceries.filter((x) => !x.checked || x.recurring);
  app.state.groceries.forEach((x) => (x.checked = false));
  if (await persistState()) toast(`${bought.length} ${bought.length === 1 ? "prodotto" : "prodotti"} in dispensa`);
}

/** Apre la proposta di lista generata da `fabbisogno del piano − dispensa`: non modifica la lista senza conferma. */
export function openPlanProposal() {
  const userPrices = storage.get(USER_PRICES_KEY, {});
  const { toBuy, covered } = planProposal(app.state.meals, app.state.inventory, userPrices, app.today?.date || isoDate());
  openModal(
    `<div class="modal-ic">${icon("sparkles")}</div>
    <h2 id="modal-title">Proposta dal piano</h2>
    <p class="subtle">Fabbisogno della settimana meno ciò che hai già in dispensa. Per le cene lun–ven il secondo arriva dal lavoro e non viene aggiunto. I prezzi restano vuoti finché non li inserisci tu.</p>
    ${toBuy.length
      ? `<div class="stack">${toBuy
          .map(
            (x, i) => `<label class="shopitem"><input type="checkbox" data-prop-idx="${i}" checked><span class="cbox">${icon("check")}</span><span class="shop-main"><span class="shopname">${esc(x.name)}</span><span class="shopqty">${esc(x.qty)}${x.inPantry ? ` (in dispensa: ${esc(formatQty(x.inPantry, x.unit))})` : ""}</span></span><span class="shopprice">${x.price != null ? money(x.price) : "—"}</span></label>`,
          )
          .join("")}</div>`
      : empty("Tutto già in dispensa", "La dispensa copre tutti gli ingredienti previsti dal piano.")}
    ${covered.length ? `<p class="subtle">Già coperti dalla dispensa: ${esc(covered.map((c) => c.name).join(", "))}.</p>` : ""}
    ${toBuy.length ? `<button type="button" class="btn primary xl full" data-m="apply-plan">${icon("check")}Conferma e aggiungi alla lista</button>` : ""}
    <div class="modal-secondary"><button type="button" data-m="close">Annulla</button></div>`,
    async (t) => {
      if (t.dataset.m === "close") return true;
      if (t.dataset.m !== "apply-plan") return false;
      const picked = $$("[data-prop-idx]:checked", $("#modal")).map((el) => toBuy[num(el.dataset.propIdx)]).filter(Boolean);
      for (const item of picked) {
        const key = item.name.trim().toLowerCase();
        const existing = app.state.groceries.find((g) => g.name.trim().toLowerCase() === key && !g.checked);
        if (existing) {
          existing.amount = item.amount;
          existing.unit = item.unit;
          existing.qty = item.qty;
          if (item.price != null) existing.price = item.price;
        } else {
          app.state.groceries.push({
            id: uid(), name: item.name, qty: item.qty, amount: item.amount, unit: item.unit,
            price: item.price ?? 0, category: item.category || "Altro", checked: false, recurring: false,
          });
        }
      }
      if (await persistState()) toast(`${picked.length} ${picked.length === 1 ? "articolo confermato" : "articoli confermati"} in lista`);
      app.render();
      return true;
    },
  );
}

/** Rimuove subito la voce (nessuna conferma a ogni tocco) e offre "Annulla" per qualche secondo: un tocco
 *  sbagliato sulla piccola ✕ si recupera, anche dopo più rimozioni di fila (`removalToast`). La rimozione e
 *  l'eventuale ripristino sono salvataggi normali, in coda uno dopo l'altro: funzionano anche offline e non
 *  creano doppioni (la voce torna con il suo id). */
function removeWithUndo(section, id, where) {
  const { list, item, index } = takeById(app.state[section], id);
  if (!item) return false;
  app.state[section] = list;
  persistState();
  removalToast(
    `${item.name} rimosso ${where}`,
    () => (app.state[section] = putBack(app.state[section], item, index)),
    () => {
      persistState();
      app.render();
    },
  );
  return true;
}

export async function onClick(t) {
  if (t.dataset.tab) return (ui.tab = t.dataset.tab), true;
  if (t.dataset.spend) return openSpend(t.dataset.spend), false;
  if (t.matches("[data-arrived]")) return openSpend(thisWeek(), { arrived: true }), false;
  if (t.matches("[data-generate-list]")) return openPlanProposal(), false;
  if (t.dataset.recurring) {
    const item = app.state.groceries.find((x) => x.id === t.dataset.recurring);
    if (item) item.recurring = !item.recurring;
    persistState();
    return true;
  }
  if (t.dataset.removeShop) return removeWithUndo("groceries", t.dataset.removeShop, "dalla lista");
  if (t.dataset.removeInv) return removeWithUndo("inventory", t.dataset.removeInv, "dalla dispensa");
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
    const parsed = parseQty(data.qty, data.unit);
    const qty = parsed.amount ? formatQty(parsed.amount, parsed.unit, data.qty.trim()) : data.qty.trim();
    const rawPrice = parseAmount(data.price);
    const price = rawPrice != null && rawPrice > 0 ? Math.max(0, rawPrice) : 0;
    if (price > 0) {
      const known = storage.get(USER_PRICES_KEY, {});
      known[data.name.trim().toLowerCase()] = price;
      storage.set(USER_PRICES_KEY, known);
    }
    app.state.groceries.push({
      id: uid(), name: data.name.trim(), qty, amount: parsed.amount, unit: parsed.unit,
      price, category: data.category, checked: false, recurring: false,
    });
    if (await persistState()) toast("Prodotto aggiunto");
    return true;
  }
  if (form.id === "inventory-form") {
    const parsed = parseQty(data.qty, data.unit);
    const qty = parsed.amount ? formatQty(parsed.amount, parsed.unit, data.qty.trim()) : data.qty.trim();
    app.state.inventory.push({
      id: uid(), name: data.name.trim(), qty, amount: parsed.amount, unit: parsed.unit, expiry: data.expiry || "",
    });
    if (await persistState()) toast("Alimento aggiunto");
    return true;
  }
  return false;
}
