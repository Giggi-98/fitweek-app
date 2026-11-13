// Token dell'app autonoma (static/js/platform.js): migrazione da localStorage al Keystore Android.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

const stored = fakeBrowser();
const TOKEN = "fitweek.token.v1";
globalThis.FITWEEK_APP = { server: "http://192.168.1.10:8088" };
const keystore = { value: null, broken: true };
globalThis.Capacitor = { Plugins: { SecureToken: {
  set: async ({ value }) => { if (keystore.broken) throw new Error("Keystore non disponibile"); keystore.value = value; },
  get: async () => { if (keystore.broken) throw new Error("Keystore non disponibile"); return { value: keystore.value }; },
  clear: async () => { if (keystore.broken) throw new Error("Keystore non disponibile"); keystore.value = null; },
} } };
const { initToken, setToken, token } = await import("../../static/js/platform.js");

test("FW-REV-005: se il Keystore fallisce il token vecchio resta, e la migrazione riesce al riavvio successivo", async () => {
  stored.set(TOKEN, JSON.stringify("tok-legacy"));
  assert.equal(await initToken(), "tok-legacy");
  assert.equal(JSON.parse(stored.get(TOKEN)), "tok-legacy", "l'unica copia persistente non va cancellata");
  assert.equal(await initToken(), "tok-legacy", "riavvio con Keystore ancora guasto: sessione ancora valida");

  keystore.broken = false;
  assert.equal(await initToken(), "tok-legacy");
  assert.equal(keystore.value, "tok-legacy");
  assert.equal(stored.has(TOKEN), false, "migrazione confermata: il token in chiaro viene rimosso");
  assert.equal(await initToken(), "tok-legacy", "riavvio: letto dal Keystore");
});

test("FW-REV-005: un token rinnovato non cancella la copia vecchia se il Keystore non lo ha salvato", async () => {
  keystore.broken = true;
  keystore.value = null;
  stored.set(TOKEN, JSON.stringify("tok-legacy"));
  await setToken("tok-nuovo");
  assert.equal(token(), "tok-nuovo", "in uso per questa sessione");
  assert.equal(JSON.parse(stored.get(TOKEN)), "tok-legacy");
  keystore.broken = false;
  await setToken("tok-nuovo");
  assert.equal(keystore.value, "tok-nuovo");
  assert.equal(stored.has(TOKEN), false);
});

test("FW-REV-005: l'uscita toglie sempre il token in chiaro, anche con il Keystore guasto", async () => {
  keystore.broken = true;
  stored.set(TOKEN, JSON.stringify("tok-legacy"));
  await setToken(null);
  assert.equal(token(), null);
  assert.equal(stored.has(TOKEN), false);
});

test("FW-REV-010: se il Keystore non cancella il token, al riavvio l'app non rientra da sola", async () => {
  keystore.broken = false;
  await setToken("tok-attivo");
  assert.equal(keystore.value, "tok-attivo");
  keystore.broken = true; // clear() e get() falliscono: il token resta nel Keystore
  assert.equal(await setToken(null), false, "l'eliminazione non è confermata e chi chiama lo deve sapere");
  keystore.broken = false; // riavvio: il Keystore risponde di nuovo e ha ancora il vecchio token
  assert.equal(await initToken(), null, "nessun rientro silenzioso con il token rimasto");
  assert.equal(keystore.value, null, "all'avvio l'eliminazione viene ritentata");
  assert.equal(await initToken(), null);
});

test("FW-REV-010: clear() che fallisce in silenzio (token ancora leggibile) non vale come eliminazione", async () => {
  keystore.broken = false;
  await setToken("tok-attivo");
  const plugin = globalThis.Capacitor.Plugins.SecureToken;
  const realClear = plugin.clear;
  plugin.clear = async () => {}; // risponde bene ma non cancella
  assert.equal(await setToken(null), false);
  assert.equal(await initToken(), null);
  plugin.clear = realClear;
  assert.equal(await initToken(), null);
  assert.equal(keystore.value, null);
});

test("FW-REV-010: uscita riuscita e nuovo accesso funzionano come prima", async () => {
  keystore.broken = false;
  await setToken("tok-1");
  assert.equal(await setToken(null), true);
  assert.equal(keystore.value, null);
  assert.equal(await initToken(), null);
  await setToken("tok-2");
  assert.equal(await initToken(), "tok-2", "il nuovo accesso sopravvive al riavvio");
});

test("FW-REV-010: dopo un'uscita non confermata, un nuovo accesso salvato nel Keystore vale al riavvio", async () => {
  keystore.broken = false;
  await setToken("tok-vecchio");
  keystore.broken = true;
  await setToken(null);
  keystore.broken = false;
  await setToken("tok-nuovo");
  assert.equal(await initToken(), "tok-nuovo");
});
