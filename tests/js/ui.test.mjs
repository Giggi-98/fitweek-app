// Componenti condivisi (static/js/ui.js, static/js/util.js): schede da tastiera (FW-UX-002) e
// rimozione annullabile di una voce d'elenco (FW-UX-001).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

fakeBrowser();
const { choices, removalToast, tabs, tabKey, tabpanel, toast } = await import("../../static/js/ui.js");
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

test("FW-UX-002: una scelta senza pannello (tema, giornata) è un gruppo di opzioni, non un elenco di schede", () => {
  const html = choices([["auto", "Automatico"], ["dark", "Scuro"]], "dark", "Tema", "theme-set");
  assert.match(html, /role="radiogroup" aria-label="Tema"/);
  assert.doesNotMatch(html, /role="tab"|aria-selected|aria-controls/);
  const stops = [...html.matchAll(/role="radio" aria-checked="(true|false)" tabindex="(-?\d)" data-theme-set="(\w+)"/g)].map((m) => m.slice(1));
  assert.deepEqual(stops, [["false", "-1", "auto"], ["true", "0", "dark"]]);
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

/** #toast finto: tiene il testo mostrato e il pulsante, che il test può "toccare". */
function fakeToast() {
  const node = {
    kids: [],
    hidden: true,
    replaceChildren(n) { this.kids = [n]; },
    append(b) { this.kids.push(b); },
    classList: { add: () => (node.hidden = true), remove: () => (node.hidden = false) },
    get text() { return this.kids[0]?.text; },
    get button() { return this.kids[1] || null; },
  };
  globalThis.document.querySelector = (sel) => (sel === "#toast" ? node : null);
  globalThis.document.createTextNode = (t) => ({ text: t });
  globalThis.document.createElement = () => ({ className: "", textContent: "", addEventListener(_, fn) { this.click = fn; } });
  return node;
}
const realNow = Date.now;
const at = (ms) => (Date.now = () => ms);

test("FW-UX-001: due rimozioni ravvicinate si annullano entrambe, con un solo tocco e nell'ordine giusto", () => {
  const node = fakeToast();
  at(1_000_000);
  let list = [{ id: "pane" }, { id: "latte" }, { id: "uova" }];
  let saves = 0;
  const remove = (id) => {
    const out = takeById(list, id);
    list = out.list;
    removalToast(`${id} rimosso dalla lista`, () => (list = putBack(list, out.item, out.index)), () => saves++);
  };
  remove("pane");
  assert.equal(node.text, "pane rimosso dalla lista");
  assert.equal(node.button.textContent, "Annulla");
  at(1_003_000); // 3 secondi dopo: la prima rimozione è ancora annullabile
  remove("latte");
  assert.equal(node.text, "2 voci rimosse");
  assert.equal(node.button.textContent, "Annulla tutte");
  node.button.click();
  assert.deepEqual(list.map((x) => x.id), ["pane", "latte", "uova"], "tornano tutte e due, al loro posto");
  assert.equal(saves, 1, "un solo salvataggio per il ripristino");
  assert.equal(node.hidden, true);
  clearTimeout(toast.timer);
  Date.now = realNow;
});

test("FW-UX-001: una rimozione fatta dopo che l'annullo precedente è scaduto non riporta indietro la vecchia", () => {
  const node = fakeToast();
  at(2_000_000);
  const back = [];
  removalToast("pane rimosso dalla lista", () => back.push("pane"), () => {});
  at(2_007_001); // la finestra di 7 secondi è passata
  removalToast("latte rimosso dalla lista", () => back.push("latte"), () => {});
  assert.equal(node.text, "latte rimosso dalla lista");
  node.button.click();
  assert.deepEqual(back, ["latte"]);
  clearTimeout(toast.timer);
  Date.now = realNow;
});

test("FW-UX-001: un avviso arrivato nel frattempo (rete, salvataggio) non porta via l'Annulla ancora valido", () => {
  const node = fakeToast();
  at(3_000_000);
  const back = [];
  removalToast("pane rimosso dalla lista", () => back.push("pane"), () => {});
  at(3_002_000);
  toast("Server non raggiungibile: le modifiche restano su questo dispositivo");
  assert.match(node.text, /Server non raggiungibile/);
  assert.match(node.text, /pane rimosso dalla lista/, "resta scritto a cosa si riferisce l'Annulla");
  assert.equal(node.button?.textContent, "Annulla");
  node.button.click();
  assert.deepEqual(back, ["pane"]);
  at(3_020_000); // molto dopo: un avviso semplice non mostra più nessun annullo
  toast("Profilo aggiornato");
  assert.equal(node.text, "Profilo aggiornato");
  assert.equal(node.button, null);
  clearTimeout(toast.timer);
  Date.now = realNow;
});

test("FW-UX-001: annullo scaduto → l'avviso successivo non lo ripropone", () => {
  const node = fakeToast();
  at(4_000_000);
  removalToast("pane rimosso dalla lista", () => {}, () => {});
  at(4_007_001);
  toast("Profilo aggiornato");
  assert.equal(node.button, null);
  clearTimeout(toast.timer);
  Date.now = realNow;
});
