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
