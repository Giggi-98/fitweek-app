// Token dell'app autonoma (static/js/platform.js): migrazione da localStorage al Keystore Android.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

const stored = fakeBrowser();
const TOKEN = "fitweek.token.v1";
globalThis.FITWEEK_APP = { server: "http://192.168.1.10:8088" };
// Il cookie della WebView è il secondo canale per il marcatore di uscita (indipendente da localStorage e Keystore)
const jar = new Set();
let cookieFail = false;
Object.defineProperty(globalThis.document, "cookie", {
  get: () => [...jar].join("; "),
  set: (str) => {
    if (cookieFail) return; // la WebView rifiuta i cookie
    const [pair, ...attrs] = String(str).split(";");
    if (attrs.some((a) => /^\s*max-age\s*=\s*0/i.test(a))) jar.delete(pair.trim());
    else jar.add(pair.trim());
  },
});
// localStorage che non scrive più (quota piena, modalità privata): get/remove funzionano, set lancia
let writesFail = false;
const realSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
globalThis.localStorage.setItem = (k, v) => {
  if (writesFail) throw new Error("QuotaExceededError");
  realSetItem(k, v);
};
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
  assert.equal(await setToken(null), "marked", "eliminazione non confermata, ma l'uscita resta registrata");
  keystore.broken = false; // riavvio: il Keystore risponde di nuovo e ha ancora il vecchio token
  assert.equal(await initToken(), null, "nessun rientro silenzioso con il token rimasto");
  assert.equal(keystore.value, null, "all'avvio l'eliminazione viene ritentata");
  assert.equal(await initToken(), null);
});

test("FW-REV-010: clear() che non cancella viene neutralizzato sovrascrivendo il token", async () => {
  keystore.broken = false;
  await setToken("tok-attivo");
  const plugin = globalThis.Capacitor.Plugins.SecureToken;
  const realClear = plugin.clear;
  plugin.clear = async () => {}; // risponde bene ma non cancella
  assert.equal(await setToken(null), true, "la sovrascrittura con valore vuoto conferma l'eliminazione");
  assert.equal(await initToken(), null);
  plugin.clear = realClear;
  assert.equal(await initToken(), null);
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

test("FW-REV-010: Keystore guasto e localStorage che non scrive al logout → al riavvio nessun rientro silenzioso", async () => {
  keystore.broken = false;
  jar.clear();
  await setToken("tok-attivo");
  keystore.broken = true; // clear() e get() falliscono…
  writesFail = true; // …e la memoria del dispositivo non registra l'uscita (quota piena)
  assert.equal(await setToken(null), "marked", "eliminazione non confermata, ma l'uscita resta registrata sul cookie");
  writesFail = false;
  keystore.broken = false; // riavvio: Keystore leggibile con dentro il token, localStorage senza il flag
  assert.equal(stored.has("fitweek.signedOut.v1"), false, "premessa: la scrittura del flag era fallita");
  assert.equal(await initToken(), null, "il token rimasto nel Keystore non viene riusato per rientrare da soli");
  assert.equal(keystore.value, null, "l'eliminazione viene ritentata all'avvio");
});

test("FW-REV-010: falliscono Keystore, localStorage e cookie → all'avvio l'app resta fuori (fail-closed)", async () => {
  keystore.broken = false;
  jar.clear();
  await setToken("tok-attivo");
  keystore.broken = true;
  writesFail = true;
  cookieFail = true; // nessun canale registra l'uscita
  assert.equal(await setToken(null), false);
  keystore.broken = false; // riavvio: Keystore di nuovo funzionante, memoria del dispositivo ancora piena
  assert.equal(await initToken(), null, "senza poter verificare l'uscita, il token rimasto non viene usato");
  assert.equal(keystore.value, null, "e viene eliminato appena il Keystore torna disponibile");
  cookieFail = false;
  writesFail = false;
  assert.equal(await initToken(), null, "ai riavvii successivi non resta più nulla da riusare");
});
