// Integrazione con l'app Android (Capacitor). Nel browser non fa nulla.
// Il bridge Capacitor è iniettato dall'app nella pagina caricata dal server: nessuna dipendenza
// nel codice web, nessun build step.
import { request } from "./api.js";
import { buildSchedule } from "./schedule.js";
import { app } from "./store.js";
import { closeModal, modalOpen, toast } from "./ui.js";

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
/** Cancella e riprogramma le notifiche dei prossimi 14 giorni dai promemoria del server. */
export function syncNotifications({ ask = false } = {}) {
  if (!isNative() || !LN()) return Promise.resolve();
  syncing ??= (async () => {
    try {
      if (!(await ensurePermission(ask))) return;
      const ln = LN();
      await ln.createChannel({ id: CHANNEL, name: "Promemoria", description: "Pasti, palestra, pesata, spesa", importance: 5, vibration: true, visibility: 1 });
      const [{ items }, agenda] = await Promise.all([request("/api/v1/reminders"), request("/api/v1/agenda")]);
      const state = new Map(agenda.items.map((i) => [i.id, i.state]));
      const plan = buildSchedule(items, state, new Date());
      const pending = await ln.getPending();
      if (pending.notifications.length) await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      if (plan.length) {
        await ln.schedule({
          notifications: plan.map((n) => ({
            id: n.id, title: n.title, body: n.body, extra: n.extra, channelId: CHANNEL,
            schedule: { at: n.at, allowWhileIdle: true },
          })),
        });
      }
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
  await LN().schedule({ notifications: [{ id: 999999, title: "FitWeek", body: "Notifica di prova: funziona!", channelId: CHANNEL, schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true } }] });
  toast("Notifica di prova tra 5 secondi: puoi chiudere l'app");
}

export async function openExactAlarmSettings() {
  try {
    await LN().changeExactNotificationSetting();
  } catch {
    toast("Impostazione non disponibile su questo telefono");
  }
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
  AppPlugin()?.addListener("resume", () => syncNotifications());
  window.addEventListener("fitweek:changed", () => syncNotifications());
  window.addEventListener("fitweek:reminders-changed", () => syncNotifications());
  syncNotifications({ ask: true });
}
