// Rimozione con annullo della spesa mentre il salvataggio è in volo (verifica richiesta dalla review
// e014e0d, in coordinamento con FW-UX-001/FW-REV-008): i PUT restano in serie, la fusione a tre vie
// sull'errore 409 non crea doppioni, l'annullo non cancella le modifiche arrivate da un altro dispositivo
// e una doppia rimozione non ne fa perdere nessuna. I meccanismi veri: persistState/store.js, mergeState/sync.js,
// takeById/putBack/util.js (la stessa sequenza di removeWithUndo in views/shopping.js).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser, deferredFetch, settle } from "./helpers.mjs";

fakeBrowser();
const toasts = [];
const toastEl = {
  replaceChildren: (n) => toasts.push(n?.text ?? ""),
  append() {},
  classList: { add() {}, remove() {} },
};
globalThis.document.querySelector = (sel) => (sel === "#toast" ? toastEl : null);
globalThis.document.createTextNode = (t) => ({ text: t });
globalThis.document.createElement = () => ({ className: "", textContent: "", addEventListener() {} });

const net = deferredFetch();
const { app, persistState } = await import("../../static/js/store.js");
const { takeById, putBack } = await import("../../static/js/util.js");
const { toast } = await import("../../static/js/ui.js");

const X = { id: "x", name: "Pane", qty: "1" };
const Y = { id: "y", name: "Latte", qty: "2" };
const Z = { id: "z", name: "Mele", qty: "3" };
const groceriesOf = (call) => call.body.data.groceries.map((g) => g.id);

/** Stato iniziale già sul server (versione 1): un PUT di bootstrap conferma baseState e versione. */
async function bootstrap(items) {
  app.state = { groceries: items.map((i) => ({ ...i })), inventory: [] };
  app.version = 0;
  const done = persistState();
  await settle();
  net.reply(net.calls.length - 1, 200, { version: 1 });
  assert.equal(await done, true);
}

test("rimozione e annullo durante il salvataggio in volo: i PUT restano in serie, la voce torna una volta sola", async () => {
  await bootstrap([X, Y]);
  const { list, item, index } = takeById(app.state.groceries, "x");
  app.state.groceries = list;
  const p1 = persistState();
  await settle(); // il PUT della rimozione parte davvero, con la voce già tolta
  assert.deepEqual(groceriesOf(net.calls.at(-1)), ["y"]);
  app.state.groceries = putBack(app.state.groceries, item, index); // "Annulla" mentre il PUT è in volo
  const p2 = persistState();
  net.reply(net.calls.length - 1, 200, { version: 2 });
  assert.equal(await p1, true);
  await settle();
  assert.deepEqual(groceriesOf(net.calls.at(-1)), ["x", "y"], "il secondo PUT porta la voce ripristinata");
  net.reply(net.calls.length - 1, 200, { version: 3 });
  assert.equal(await p2, true);
  assert.equal(app.version, 3);
  assert.deepEqual(app.state.groceries, [X, Y]);
});

test("annullo in volo e 409 con modifica remota: niente doppioni e la modifica del server resta", async () => {
  await bootstrap([X, Y]);
  const { list, item, index } = takeById(app.state.groceries, "x");
  app.state.groceries = list;
  const p1 = persistState();
  await settle();
  app.state.groceries = putBack(app.state.groceries, item, index);
  const p2 = persistState();
  net.reply(net.calls.length - 1, 409, { detail: "versione obsoleta" }); // intanto un altro dispositivo ha salvato
  await settle();
  net.reply(net.calls.length - 1, 200, {
    version: 2,
    data: { groceries: [{ ...X, name: "Pane integrale" }, { ...Y }], inventory: [] },
  });
  await settle();
  net.reply(net.calls.length - 1, 200, { version: 3 }); // PUT dello stato fuso
  assert.equal(await p1, true);
  await settle();
  net.reply(net.calls.length - 1, 200, { version: 4 }); // PUT dell'annullo, sopra il risultato della fusione
  assert.equal(await p2, true);
  assert.equal(app.version, 4);
  assert.deepEqual(app.state.groceries.map((g) => g.id), ["x", "y"], "nessun doppione");
  assert.equal(app.state.groceries[0].name, "Pane integrale", "la modifica arrivata dal server non si perde");
});

test("eliminata qui ma modificata altrove: resta una voce sola e l'annullo successivo non la duplica", async () => {
  await bootstrap([X, Y]);
  const { list, item, index } = takeById(app.state.groceries, "x");
  app.state.groceries = list;
  const p1 = persistState();
  await settle();
  net.reply(net.calls.length - 1, 409, { detail: "versione obsoleta" });
  await settle();
  net.reply(net.calls.length - 1, 200, {
    version: 2,
    data: { groceries: [{ ...X, name: "Pane integrale" }, { ...Y }], inventory: [] },
  });
  await settle();
  net.reply(net.calls.length - 1, 200, { version: 3 });
  assert.equal(await p1, true);
  assert.equal(app.state.groceries.filter((g) => g.id === "x").length, 1, "la fusione la tiene (FW-REV-008)");
  assert.equal(app.state.groceries[0].name, "Pane integrale");
  assert.ok(toasts.some((t) => /Pane integrale/.test(t) && /rimasto/.test(t)), "l'avviso dice che la voce è rimasta");
  app.state.groceries = putBack(app.state.groceries, item, index); // "Annulla" sul toast ancora visibile
  assert.equal(app.state.groceries.filter((g) => g.id === "x").length, 1, "putBack non duplica una voce già presente");
  const p2 = persistState();
  await settle();
  net.reply(net.calls.length - 1, 200, { version: 4 });
  assert.equal(await p2, true);
  assert.equal(net.calls.at(-1).body.data.groceries.filter((g) => g.id === "x").length, 1);
  clearTimeout(toast.timer);
});

test("due rimozioni ravvicinate: due salvataggi in serie, nessuna voce persa", async () => {
  await bootstrap([X, Y, Z]);
  app.state.groceries = takeById(app.state.groceries, "x").list;
  const p1 = persistState();
  await settle();
  assert.deepEqual(groceriesOf(net.calls.at(-1)), ["y", "z"]);
  app.state.groceries = takeById(app.state.groceries, "y").list;
  const p2 = persistState();
  net.reply(net.calls.length - 1, 200, { version: 2 });
  assert.equal(await p1, true);
  await settle();
  assert.deepEqual(groceriesOf(net.calls.at(-1)), ["z"]);
  net.reply(net.calls.length - 1, 200, { version: 3 });
  assert.equal(await p2, true);
  assert.equal(app.version, 3);
  assert.deepEqual(app.state.groceries, [Z]);
});
