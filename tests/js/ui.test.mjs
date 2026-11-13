// Componenti condivisi (static/js/ui.js, static/js/util.js): schede da tastiera (FW-UX-002) e
// rimozione annullabile di una voce d'elenco (FW-UX-001).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

fakeBrowser();
const { tabs, tabKey, tabpanel } = await import("../../static/js/ui.js");
const { takeById, putBack } = await import("../../static/js/util.js");

test("FW-UX-002: una sola scheda raggiungibile con Tab, quella attiva", () => {
  const html = tabs([["list", "Lista"], ["pantry", "Dispensa"], ["spend", "Spese"]], "pantry", "Spesa e dispensa");
  const stops = [...html.matchAll(/aria-selected="(true|false)" tabindex="(-?\d)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(stops, [["false", "-1"], ["true", "0"], ["false", "-1"]]);
  assert.match(html, /role="tablist" aria-label="Spesa e dispensa"/);
});

test("FW-UX-002: ogni scheda punta al pannello che comanda; il pannello è etichettato dalla scheda attiva", () => {
  const html = tabs([["list", "Lista"], ["pantry", "Dispensa"]], "pantry", "Spesa e dispensa", "tab", "shopping-panel");
  assert.match(html, /id="tab-spesa-e-dispensa-list" aria-controls="shopping-panel"/);
  assert.match(html, /id="tab-spesa-e-dispensa-pantry" aria-controls="shopping-panel"/);
  const body = tabpanel("shopping-panel", "Spesa e dispensa", "pantry", "<p>corpo</p>");
  assert.match(body, /^<div class="tabpanel" role="tabpanel" id="shopping-panel" aria-labelledby="tab-spesa-e-dispensa-pantry" tabindex="0">/);
});

test("FW-UX-002: pannello diverso per scheda (dashboard): mappa chiave → pannello", () => {
  const html = tabs([["day", "Giornata"], ["week", "Settimana"]], "day", "Oggi", "tab", { day: "dash-agenda", week: "dash-week" });
  assert.match(html, /id="tab-oggi-day" aria-controls="dash-agenda"/);
  assert.match(html, /id="tab-oggi-week" aria-controls="dash-week"/);
});

test("FW-UX-002: senza pannello (selettore del tema) nessun aria-controls, ma la scheda ha un id", () => {
  const html = tabs([["auto", "Automatico"], ["dark", "Scuro"]], "auto", "Tema", "theme-set");
  assert.match(html, /id="tab-tema-auto"/);
  assert.doesNotMatch(html, /aria-controls/);
});

/** Elenco di schede finto, quanto basta a `tabKey` (closest + querySelectorAll). */
function fakeTabs(n, disabled = []) {
  const list = { getAttribute: () => "Prova" };
  const all = Array.from({ length: n }, (_, i) => ({ i, disabled: disabled.includes(i), closest: () => list }));
  list.querySelectorAll = () => all.filter((t) => !t.disabled);
  return all;
}

test("FW-UX-002: frecce, Inizio e Fine scelgono la scheda, con giro completo", () => {
  const t = fakeTabs(4);
  assert.equal(tabKey(t[0], "ArrowRight"), t[1]);
  assert.equal(tabKey(t[3], "ArrowRight"), t[0], "dall'ultima si torna alla prima");
  assert.equal(tabKey(t[0], "ArrowLeft"), t[3], "dalla prima si va all'ultima");
  assert.equal(tabKey(t[2], "Home"), t[0]);
  assert.equal(tabKey(t[1], "End"), t[3]);
  assert.equal(tabKey(t[1], "Enter"), null, "gli altri tasti non riguardano le schede");
  assert.equal(tabKey(t[1], "a"), null);
});

test("FW-UX-002: le schede disattivate (giorni futuri del diario) si saltano", () => {
  const t = fakeTabs(4, [2, 3]);
  assert.equal(tabKey(t[1], "ArrowRight"), t[0]);
  assert.equal(tabKey(t[0], "End"), t[1]);
});

test("FW-UX-001: rimozione e ripristino riportano l'elenco com'era, nella stessa posizione", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const out = takeById(list, "b");
  assert.deepEqual(out.list.map((x) => x.id), ["a", "c"]);
  assert.deepEqual([out.item.id, out.index], ["b", 1]);
  assert.deepEqual(putBack(out.list, out.item, out.index).map((x) => x.id), ["a", "b", "c"]);
  assert.deepEqual(list.map((x) => x.id), ["a", "b", "c"], "l'elenco di partenza non viene modificato");
});

test("FW-UX-001: annullare due volte, o dopo che la voce è tornata da un altro dispositivo, non crea doppioni", () => {
  const { list, item, index } = takeById([{ id: "a" }, { id: "b" }], "b");
  const once = putBack(list, item, index);
  assert.equal(putBack(once, item, index), once);
  assert.deepEqual(putBack([{ id: "b", name: "modificata altrove" }], item, index), [{ id: "b", name: "modificata altrove" }]);
});

test("FW-UX-001: elenco cambiato nel frattempo → la voce torna comunque, in fondo se la posizione non esiste più", () => {
  const { item, index } = takeById([{ id: "a" }, { id: "b" }, { id: "c" }], "c");
  assert.deepEqual(putBack([], item, index).map((x) => x.id), ["c"]);
  assert.deepEqual(takeById([{ id: "a" }], "zzz"), { list: [{ id: "a" }], item: null, index: -1 });
});

test("FW-UX-001: un toast successivo sostituisce il precedente (resta un solo annullo, nessun dato perso)", async () => {
  const { toast } = await import("../../static/js/ui.js");
  const node = {
    kids: [],
    replaceChildren(n) { this.kids = [n]; },
    append(b) { this.kids.push(b); },
    classList: { add() {}, remove() {} },
  };
  globalThis.document.querySelector = (sel) => (sel === "#toast" ? node : null);
  globalThis.document.createTextNode = (t) => ({ text: t });
  globalThis.document.createElement = () => ({ className: "", textContent: "Annulla", addEventListener() {} });
  toast("Pane rimosso dalla lista", { action: "Annulla", onAction: () => {}, timeout: 7000 });
  toast("Latte rimosso dalla lista", { action: "Annulla", onAction: () => {}, timeout: 7000 });
  assert.equal(node.kids.length, 2, "nel toast restano solo il testo e l'annullo dell'ultima rimozione");
  assert.equal(node.kids[1].textContent, "Annulla");
  clearTimeout(toast.timer);
});
