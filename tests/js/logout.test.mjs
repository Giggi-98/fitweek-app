// Uscita dall'app autonoma quando qualcosa va storto (static/js/logout.js, FW-REV-010): server che non
// risponde e Keystore che non cancella il token. L'uscita non deve sembrare riuscita se non lo è.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

const stored = fakeBrowser();
globalThis.FITWEEK_APP = { server: "http://192.168.1.10:8088" };
// Il cookie della WebView è il secondo canale per il marcatore di uscita: qui ha la stessa semantica di un browser
const jar = new Set();
let cookieFail = false;
Object.defineProperty(globalThis.document, "cookie", {
  configurable: true,
  get: () => [...jar].join("; "),
  set: (str) => {
    if (cookieFail) return; // la WebView rifiuta i cookie
    const [pair, ...attrs] = String(str).split(";");
    if (attrs.some((a) => /^\s*max-age\s*=\s*0/i.test(a))) jar.delete(pair.trim());
    else jar.add(pair.trim());
  },
});
const keystore = { value: "tok-attivo", broken: false };
globalThis.Capacitor = { Plugins: { SecureToken: {
  set: async ({ value }) => { if (keystore.broken) throw new Error("Keystore non disponibile"); keystore.value = value; },
  get: async () => { if (keystore.broken) throw new Error("Keystore non disponibile"); return { value: keystore.value }; },
  clear: async () => { if (keystore.broken) throw new Error("Keystore non disponibile"); keystore.value = null; },
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
const reset = async ({ up = true, broken = false, answer = true } = {}) => {
  Object.assign(keystore, { value: "tok-attivo", broken: false });
  stored.clear();
  jar.clear();
  cookieFail = false;
  await initToken();
  Object.assign(keystore, { broken });
  Object.assign(server, { up, calls: [] });
  Object.assign(ui, { confirms: [], alerts: [], reloads: 0, answer });
};
/** Riavvio dell'app: il modulo riparte e rilegge il token come farebbe a un nuovo avvio. */
const restart = async () => {
  keystore.broken = false;
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
  await reset({ up: false, broken: true, answer: true });
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
  await reset({ broken: true });
  assert.equal(await signOut(), true);
  assert.deepEqual([ui.confirms.length, ui.alerts.length, ui.reloads], [0, 1, 1]);
  assert.equal(await restart(), null);
});

test("FW-REV-010: clear() silenzioso viene neutralizzato dalla sovrascrittura → uscita pulita, nessun avviso", async () => {
  await reset();
  const plugin = globalThis.Capacitor.Plugins.SecureToken;
  const realClear = plugin.clear;
  plugin.clear = async () => {}; // risponde bene ma non cancella: la sovrascrittura a valore vuoto copre
  assert.equal(await signOut(), true);
  plugin.clear = realClear;
  assert.deepEqual([ui.confirms.length, ui.alerts.length, ui.reloads], [0, 0, 1]);
  assert.equal(await restart(), null);
});

test("FW-REV-010: Keystore guasto e memoria del dispositivo piena, sessione revocata → avviso, e nessun rientro al riavvio", async () => {
  await reset({ broken: true });
  cookieFail = true; // la WebView non memorizza i cookie
  const realSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(await signOut(), true);
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /memoria piena/);
  assert.equal(await restart(), null, "all'avvio niente rientro mentre la memoria resta piena");
  globalThis.localStorage.setItem = realSetItem;
  cookieFail = false;
  assert.equal(await restart(), null, "il token è stato eliminato all'avvio fail-closed: non torna nemmeno a memoria ripristinata");
});

test("FW-REV-010: niente revoca, niente eliminazione, nessun canale registra l'uscita → l'uscita NON si conclude e l'utente resta collegato", async () => {
  await reset({ up: false, broken: true, answer: true });
  stored.set("fitweek.workoutQueue.sentinel", "1"); // dati locali: non vanno toccati se l'uscita non si conclude
  cookieFail = true;
  const realSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(await signOut(), false, "l'uscita non è riuscita e non viene presentata come tale");
  assert.equal(ui.reloads, 0, "nessun ritorno alla schermata di accesso");
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /Uscita non riuscita/);
  assert.match(ui.alerts[0], /ancora collegato/);
  assert.equal(token(), "tok-attivo", "la sessione locale resta in uso: nulla è cambiato");
  assert.equal(stored.has("fitweek.workoutQueue.sentinel"), true);
  // la memoria torna scrivibile PRIMA del riavvio: l'app riparte collegata, come è stato detto all'utente,
  // e non dopo un'uscita creduta completata
  globalThis.localStorage.setItem = realSetItem;
  cookieFail = false;
  assert.equal(await restart(), "tok-attivo");
  // adesso l'uscita si può rifare e riesce davvero
  Object.assign(server, { up: true });
  Object.assign(ui, { alerts: [], confirms: [] });
  assert.equal(await signOut(), true);
  assert.equal(ui.reloads, 1);
  assert.equal(await restart(), null);
});

test("FW-REV-010: sessione revocata ma token non eliminato e uscita non registrata → l'avviso non promette ciò che non è avvenuto; il token rimasto non vale più", async () => {
  await reset({ broken: true });
  cookieFail = true;
  const realSetItem = globalThis.localStorage.setItem.bind(globalThis.localStorage);
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(await signOut(), true);
  assert.deepEqual(server.calls, ["POST /api/logout"], "premessa: il server ha revocato la sessione");
  assert.equal(ui.alerts.length, 1);
  assert.match(ui.alerts[0], /ha revocato la sessione/);
  assert.doesNotMatch(ui.alerts[0], /ancora valida/);
  assert.equal(token(), null);
  globalThis.localStorage.setItem = realSetItem;
  cookieFail = false;
});
