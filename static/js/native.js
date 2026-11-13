// Integrazione con l'app Android (Capacitor). Nel browser non fa nulla.
// Il bridge Capacitor è iniettato dall'app nella pagina caricata dal server: nessuna dipendenza
// nel codice web, nessun build step.
import { request } from "./api.js";
import { buildSchedule } from "./schedule.js";
import { app } from "./store.js";
import { closeModal, modalOpen, toast } from "./ui.js";
import { checkForUpdate, installUpdate, updateStatus } from "./update.js";

const cap = () => globalThis.Capacitor;
export const isNative = () => Boolean(cap()?.isNativePlatform?.());
const LN = () => cap()?.Plugins?.LocalNotifications;
const AppPlugin = () => cap()?.Plugins?.App;
const CHANNEL = "promemoria";

export const nativeStatus = { permission: "unknown", exact: "unknown", scheduled: 0, lastSync: null, error: null };

async function ensurePermission(ask) {
  const ln = LN();
  let { display } = await ln.checkPermissions();
  if (display !== "granted" && ask) ({ display } = await ln.requestPermissions());
  nativeStatus.permission = display;
  try {
    nativeStatus.exact = (await ln.checkExactNotificationSetting()).exact_alarm;
  } catch {
    nativeStatus.exact = "n/d";
  }
  return display === "granted";
}

let syncing = null;
const TEST_ID = 999999;
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Riallinea le notifiche dei prossimi 14 giorni ai promemoria. Prima programma le nuove (stesso id = sostituita),
 *  poi toglie solo quelle non più previste: se la programmazione fallisce restano quelle di prima. */
export function syncNotifications({ ask = false } = {}) {
  if (!isNative() || !LN()) return Promise.resolve();
  syncing ??= (async () => {
    try {
      if (!(await ensurePermission(ask))) return;
      const ln = LN();
      await ln.createChannel({ id: CHANNEL, name: "Promemoria", description: "Pasti, palestra, pesata, spesa", importance: 5, vibration: true, visibility: 1 });
      const [{ items }, agenda] = await Promise.all([request("/api/v1/reminders"), request("/api/v1/agenda")]);
      const now = new Date();
      // Senza rete l'agenda in memoria può essere di un altro giorno: il suo stato non vale per oggi.
      const todays = agenda.date === isoLocal(now) ? agenda.items : [];
      const state = new Map(todays.map((i) => [i.id, i.state]));
      const snoozed = new Map(todays.filter((i) => i.state === "snoozed").map((i) => [i.id, new Date(i.due_at)]));
      const plan = buildSchedule(items, state, now, 14, snoozed);
      const pending = await ln.getPending();
      if (plan.length) {
        await ln.schedule({
          notifications: plan.map((n) => ({
            id: n.id, title: n.title, body: n.body, extra: n.extra, channelId: CHANNEL,
            schedule: { at: n.at, allowWhileIdle: true },
          })),
        });
      }
      const wanted = new Set(plan.map((n) => n.id));
      const obsolete = pending.notifications.filter((n) => !wanted.has(n.id) && n.id !== TEST_ID);
      if (obsolete.length) await ln.cancel({ notifications: obsolete.map((n) => ({ id: n.id })) });
      Object.assign(nativeStatus, { scheduled: plan.length, lastSync: new Date(), error: null });
    } catch (e) {
      nativeStatus.error = e.message || String(e);
    } finally {
      syncing = null;
      window.dispatchEvent(new Event("fitweek:native-synced"));
    }
  })();
  return syncing;
}

export async function testNotification() {
  if (!(await ensurePermission(true))) return toast("Notifiche non consentite: abilitale nelle impostazioni del telefono");
  await LN().schedule({ notifications: [{ id: TEST_ID, title: "FitWeek", body: "Notifica di prova: funziona!", channelId: CHANNEL, schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
  toast("Notifica di prova tra 5 secondi: puoi chiudere l'app");
}

export async function openExactAlarmSettings() {
  try {
    await LN().changeExactNotificationSetting();
  } catch {
    toast("Impostazione non disponibile su questo telefono");
  }
}

/** Scarica l'aggiornamento e apre l'installatore di Android, dicendo all'utente cosa succede. */
export async function startUpdate() {
  toast("Scarico l'aggiornamento…", { timeout: 60000 });
  if (await installUpdate()) toast("Aggiornamento scaricato: conferma l'installazione nella finestra di Android", { timeout: 8000 });
  else toast(`Aggiornamento non riuscito: ${updateStatus.error || "riprova"}`, { timeout: 8000 });
}

let announced = 0; // version_code già annunciato in questa apertura dell'app: un avviso per versione, non uno a ogni ritorno
/** Controlla se il server ha una versione più recente dell'app e lo dice una volta, con il pulsante per installarla. */
async function announceUpdate(force) {
  const up = await checkForUpdate({ force });
  if (!up || announced === up.version_code) return;
  announced = up.version_code;
  if (updateStatus.canInstall) toast(`FitWeek ${up.version} è disponibile`, { action: "Aggiorna", timeout: 12000, onAction: startUpdate });
  else toast(`FitWeek ${up.version} è disponibile: vedi Impostazioni → App Android`, { timeout: 8000 });
}

/** Da chiamare all'avvio: listener per tocco sulle notifiche, tasto indietro, riallineamento. */
export function initNative({ openReminderById }) {
  if (!isNative()) return;
  document.documentElement.classList.add("native");
  LN()?.addListener("localNotificationActionPerformed", ({ notification }) => {
    const { reminderId, date } = notification.extra || {};
    if (reminderId && date === app.today?.date) openReminderById(reminderId);
  });
  AppPlugin()?.addListener("backButton", ({ canGoBack }) => {
    if (modalOpen()) return closeModal();
    if (location.hash && location.hash !== "#dashboard") return history.back();
    if (canGoBack) return history.back();
    AppPlugin().minimizeApp();
  });
  AppPlugin()?.addListener("resume", () => {
    syncNotifications();
    announceUpdate(false);
  });
  window.addEventListener("fitweek:changed", () => syncNotifications());
  window.addEventListener("fitweek:reminders-changed", () => syncNotifications());
  syncNotifications({ ask: true });
  announceUpdate(true);
}
