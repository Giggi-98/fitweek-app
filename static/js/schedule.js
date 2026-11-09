// Calcolo puro delle notifiche da programmare sul telefono (testato in tests/js/schedule.test.mjs).
// Notifiche "una tantum" per i prossimi `days` giorni invece di ripetizioni settimanali: così
// gli eventi di oggi già registrati non suonano, e ogni apertura dell'app riallinea tutto.

/** Id numerico stabile (31 bit) per promemoria + data: Android richiede interi. */
export function notificationId(reminderId, date) {
  let h = 2166136261;
  for (const ch of `${reminderId}|${date}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 1) || 1;
}

const pad = (n) => String(n).padStart(2, "0");
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param reminders  [{id, weekday 0=lun, time "HH:MM", title, action, slot, enabled}]
 * @param todayState Map id → stato di oggi ("done" | "skipped" | "snoozed" | "pending")
 * @param now        Date corrente (fuso del telefono = Europe/Rome)
 * @returns [{id, at: Date, title, body, extra}] ordinati per orario
 */
export function buildSchedule(reminders, todayState = new Map(), now = new Date(), days = 14) {
  const out = [];
  const todayIso = isoLocal(now);
  for (let k = 0; k < days; k++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k);
    const weekday = (day.getDay() + 6) % 7;
    const iso = isoLocal(day);
    for (const r of reminders) {
      if (!r.enabled || r.weekday !== weekday) continue;
      if (iso === todayIso && ["done", "skipped"].includes(todayState.get(r.id))) continue;
      const [h, m] = r.time.split(":").map(Number);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
      if (at <= now) continue;
      out.push({
        id: notificationId(r.id, iso),
        at,
        title: r.title,
        body: r.action === "log_meal" ? "Tocca per registrare cosa hai mangiato" : r.action === "log_weight" ? "Tocca per registrare il peso" : "Tocca per aprire FitWeek",
        extra: { reminderId: r.id, date: iso },
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
