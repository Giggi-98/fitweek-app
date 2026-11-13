// Uscita dall'app autonoma quando qualcosa va storto (static/js/logout.js, FW-REV-010): server che non
// risponde e Keystore che non cancella il token. L'uscita non deve sembrare riuscita se non lo è.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

const stored = fakeBrowser();
globalThis.FITWEEK_APP = { server: "http://192.168.1.10:8088" };
const keystore = { value: "tok-attivo", clearFails: false };
globalThis.Capacitor = { Plugins: { SecureToken: {
  set: async ({ value }) => { keystore.value = value; },
  get: async () => ({ value: keystore.value }),
  clear: async () => { if (keystore.clearFails) throw new Error("Keystore non disponibile"); keystore.value = null; },
} } };
const server = { up: true, calls: [] };
globalThis.fetch = async (url, options = {}) => {
  server.calls.push(`${options.method || "GET"} ${new URL(url).pathname}`);
  if (!server.up) throw new TypeError("rete assente");
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
};
const ui = { confirms: [], alerts: [], reloads: 0, answer: true };
globalThis.confirm = (text) => { ui.confirms.push(text); return ui.answer; };
globalThis.alert = (text) => void ui.alerts.push(text);
globalThis.location = { reload: () => void ui.reloads++, origin: "https://localhost" };

const { initToken, token } = await import("../../static/js/platform.js");
const { signOut } = await import("../../static/js/logout.js");
const reset = async ({ up = true, clearFails = false, answer = true } = {}) => {
  Object.assign(keystore, { value: "tok-attivo", clearFails: false });
  stored.clear();
  await initToken();
  Object.assign(keystore, { clearFails });
  Object.assign(server, { up, calls: [] });
  Object.assign(ui, { confirms: [], alerts: [], reloads: 0, answer });
};
/** Riavvio dell'app: il modulo riparte e rilegge il token come farebbe a un nuovo avvio. */
const restart = async () => {
  keystore.clearFails = false;
  return initToken();
};

test("uscita normale: sessione revocata, token eliminato, nessuna domanda", async () => {
  await reset();
  assert.equal(await signOut(), true);
  assert.deepEqual(server.calls, ["POST /api/logout"]);
  assert.deepEqual([ui.confirms.length, ui.alerts.length, ui.reloads], [0, 0, 1]);
  assert.equal(keystore.value, null);
  assert.equal(await restart(), null);
});

test("FW-REV-010: server irraggiungibile → l'utente viene avvisato che la sessione resta valida, e può rinunciare", async () => {
  await reset({ up: false, answer: false });
  assert.equal(await signOut(), false);
  assert.equal(ui.confirms.length, 1);
  assert.match(ui.confirms[0], /resta valida sul server/);
  assert.equal(ui.reloads, 0);
  assert.equal(token(), "tok-attivo", "rinuncia: nulla è cambiato");
  assert.equal(keystore.value, "tok-attivo");
});

test("FW-REV-010: server irraggiungibile e Keystore che non cancella → avviso esplicito e nessun rientro al riavvio", async () => {
  await reset({ up: false, clearFails: true, answer: true });
  assert.equal(await signOut(), true);
  assert.equal(ui.confirms.length, 1, "prima la conferma: la sessione non è stata revocata");
  assert.equal(ui.alerts.length, 1, "poi l'avviso: il token non è stato eliminato dal Keystore");
  assert.match(ui.alerts[0], /non è stato eliminato/);
  assert.equal(keystore.value, "tok-attivo", "premessa del finding: il token è ancora nel Keystore");
  assert.equal(token(), null);
  assert.equal(await restart(), null, "al riavvio l'app NON rientra con il token rimasto");
  assert.equal(keystore.value, null, "e lo elimina appena il Keystore torna a funzionare");
});

test("FW-REV-010: Keystore che non cancella ma server raggiungibile → sessione revocata, avviso, nessun rientro", async () => {
  await reset({ clearFails: true });
  assert.equal(await signOut(), true);
  assert.deepEqual([ui.confirms.length, ui.alerts.length, ui.reloads], [0, 1, 1]);
  assert.equal(await restart(), null);
});
