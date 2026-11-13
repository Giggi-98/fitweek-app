// Aggiornamento dell'app Android (static/js/update.js): quale APK del server aggiorna quello installato,
// controllo con il bridge Capacitor finto e chiamata al plugin nativo di installazione.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeBrowser } from "./helpers.mjs";

fakeBrowser();
globalThis.location = { origin: "http://192.168.1.10:8088" };
const SHA = "a".repeat(64);
const stable = { available: true, version: "1.11.0", version_code: 11100, size: 2900000, sha256: SHA, app_id: "app.fitweek.personal", channel: "stable" };
const next = { version: "1.11.0", version_code: 11100, size: 3100000, sha256: "b".repeat(64), app_id: "app.fitweek.personal.next", channel: "next" };
const server = { info: { ...stable, next }, fail: false, calls: [] };
globalThis.fetch = async (url) => {
  server.calls.push(String(url));
  if (server.fail) throw new TypeError("rete assente");
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => server.info };
};
const installs = [];
const native = { info: { id: "app.fitweek.personal", version: "1.10.2", build: "11002" }, installFails: null };
const updater = { install: async (args) => { if (native.installFails) throw new Error(native.installFails); installs.push(args); return { started: true }; } };
globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { App: { getInfo: async () => native.info }, AppUpdate: updater } };

const { pickUpdate, checkForUpdate, installUpdate, updateStatus } = await import("../../static/js/update.js");

test("versione più recente sul server, stesso canale → aggiornamento disponibile", () => {
  const up = pickUpdate({ id: "app.fitweek.personal", build: "11002" }, { ...stable, next });
  assert.deepEqual(up, { version: "1.11.0", version_code: 11100, size: 2900000, sha256: SHA, channel: "stable" });
  assert.equal(pickUpdate({ id: "app.fitweek.personal.next", build: "11006" }, { ...stable, next }).channel, "next");
});

test("stessa versione o più vecchia sul server → niente (mai un ritorno indietro)", () => {
  assert.equal(pickUpdate({ id: "app.fitweek.personal", build: "11100" }, stable), null);
  assert.equal(pickUpdate({ id: "app.fitweek.personal", build: "11200" }, stable), null);
});

test("la versione di prova non aggiorna la stabile, e viceversa", () => {
  assert.equal(pickUpdate({ id: "app.fitweek.personal", build: "11002" }, { available: false, next }), null);
  assert.equal(pickUpdate({ id: "app.fitweek.personal.next", build: "11006" }, { ...stable, next: null }), null);
  assert.equal(pickUpdate({ id: "altra.app", build: "1" }, { ...stable, next }), null);
});

test("metadati incompleti o strani → niente aggiornamento", () => {
  const me = { id: "app.fitweek.personal", build: "11002" };
  assert.equal(pickUpdate(me, { ...stable, sha256: "" }), null, "senza impronta non si installa");
  assert.equal(pickUpdate(me, { ...stable, sha256: "zz" }), null);
  assert.equal(pickUpdate(me, { ...stable, version_code: "11100" }), null);
  assert.equal(pickUpdate({ id: "app.fitweek.personal", build: "boh" }, stable), null);
  assert.equal(pickUpdate(null, stable), null);
  assert.equal(pickUpdate(me, null), null);
  assert.equal(pickUpdate(me, { available: false, next: null }), null);
});

test("APK stabile compilato prima che i metadati avessero app_id: vale per l'app stabile", () => {
  const { app_id, ...old } = stable;
  assert.equal(pickUpdate({ id: "app.fitweek.personal", build: "11002" }, old)?.version, "1.11.0");
});

test("controllo: legge la versione installata e quella del server, senza copia locale", async () => {
  const up = await checkForUpdate();
  assert.equal(up.version, "1.11.0");
  assert.deepEqual(updateStatus.installed, { id: "app.fitweek.personal", version: "1.10.2", build: "11002" });
  assert.equal(updateStatus.canInstall, true);
  assert.match(server.calls.at(-1), /\/api\/v1\/app\/android$/);
});

test("controllo non forzato: non richiede di nuovo entro l'ora", async () => {
  const n = server.calls.length;
  await checkForUpdate({ force: false });
  assert.equal(server.calls.length, n);
});

test("senza rete: resta lo stato di prima e l'errore è registrato, nessuna eccezione", async () => {
  server.fail = true;
  const up = await checkForUpdate();
  server.fail = false;
  assert.equal(up.version, "1.11.0");
  assert.ok(updateStatus.error);
});

test("installazione: al plugin vanno indirizzo assoluto del server, impronta attesa e nessun token nel guscio", async () => {
  await checkForUpdate();
  assert.equal(await installUpdate(), true);
  assert.deepEqual(installs.at(-1), { url: "http://192.168.1.10:8088/api/v1/app/android/download?channel=stable", authorization: "", sha256: SHA });
  assert.equal(updateStatus.busy, false);
});

test("installazione rifiutata dal plugin (impronta diversa, download fallito): errore mostrabile, nessuna eccezione", async () => {
  native.installFails = "Il file scaricato non corrisponde all'impronta attesa";
  assert.equal(await installUpdate(), false);
  native.installFails = null;
  assert.match(updateStatus.error, /impronta/);
  assert.equal(updateStatus.busy, false);
});

test("app senza il plugin (versioni fino alla 1.10): l'aggiornamento si vede ma non si installa da sé", async () => {
  delete globalThis.Capacitor.Plugins.AppUpdate;
  const n = installs.length;
  assert.equal((await checkForUpdate()).version, "1.11.0");
  assert.equal(updateStatus.canInstall, false);
  assert.equal(await installUpdate(), false);
  assert.equal(installs.length, n);
  globalThis.Capacitor.Plugins.AppUpdate = updater;
});

test("app già aggiornata: nessun aggiornamento e niente da installare", async () => {
  native.info = { id: "app.fitweek.personal", version: "1.11.0", build: "11100" };
  assert.equal(await checkForUpdate(), null);
  assert.equal(await installUpdate(), false);
});

test("nel browser (nessun bridge nativo) non parte nessuna richiesta", async () => {
  const saved = globalThis.Capacitor;
  delete globalThis.Capacitor;
  const n = server.calls.length;
  assert.equal(await checkForUpdate(), null);
  assert.equal(server.calls.length, n);
  globalThis.Capacitor = saved;
});
