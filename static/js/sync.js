// Regole pure per l'uso senza rete (testate in tests/js/sync.test.mjs): fusione delle modifiche fatte
// offline con ciò che nel frattempo è cambiato sul server, e "oggi" ricostruito sul telefono.
// Il server resta la fonte di verità: qui si decide solo come riportargli le modifiche locali senza perderne.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Elenchi con `id` (si fondono voce per voce), oggetti da fondere campo per campo, e la scheda: un elenco
// di esercizi per ogni giornata (si fonde esercizio per esercizio).
const LISTS = new Set(["weights", "groceries", "inventory", "workouts"]);
const OBJECTS = new Set(["profile", "meals"]);
const LISTS_BY_KEY = new Set(["routines"]);
const label = (item) => item.name || item.date || item.id;

/**
 * Voce per voce: le modifiche e le eliminazioni locali valgono; ciò che è nuovo sul server resta.
 * Se la stessa voce è cambiata da entrambe le parti vale quella locale e il caso finisce in `conflicts`;
 * una voce modificata in locale ma eliminata sul server viene tenuta (meglio una voce in più che un dato perso).
 */
function mergeList(base, local, server, conflicts, section) {
  const baseById = new Map(base.map((x) => [x.id, x]));
  const localById = new Map(local.map((x) => [x.id, x]));
  const out = [];
  for (const item of server) {
    const mine = localById.get(item.id);
    const before = baseById.get(item.id);
    if (!mine) {
      if (!before) out.push(item); // aggiunta sul server mentre ero offline
      continue; // c'era e in locale non c'è più: eliminata da me
    }
    if (before && same(mine, before)) out.push(item); // non toccata da me → versione del server
    else {
      if (!same(mine, item) && !(before && same(item, before))) conflicts.push({ section, what: label(mine) });
      out.push(mine);
    }
  }
  const onServer = new Set(server.map((x) => x.id));
  for (const item of local) {
    if (onServer.has(item.id)) continue;
    const before = baseById.get(item.id);
    if (!before) out.push(item); // nuova in locale
    else if (!same(item, before)) {
      conflicts.push({ section, what: label(item) }); // modificata da me, eliminata dall'altro dispositivo
      out.push(item);
    }
  }
  return out;
}

function mergeObject(base, local, server, conflicts, section) {
  const out = { ...server };
  for (const key of Object.keys(local)) {
    if (same(local[key], base?.[key])) continue;
    if (!same(server?.[key], base?.[key]) && !same(server?.[key], local[key])) conflicts.push({ section, what: key });
    out[key] = local[key];
  }
  return out;
}

/** Una sola pesata per giorno: se i due dispositivi ne hanno aggiunta una ciascuno, resta quella locale. */
function onePerDay(weights, local) {
  const mine = new Set(local.map((w) => w.id));
  const byDate = new Map();
  for (const w of weights) {
    const kept = byDate.get(w.date);
    if (!kept || (mine.has(w.id) && !mine.has(kept.id))) byDate.set(w.date, w);
  }
  return weights.filter((w) => byDate.get(w.date) === w);
}

/**
 * Fusione a tre vie dello stato (blob): `base` = ultimo stato confermato dal server, `local` = stato con le
 * modifiche fatte sul telefono, `server` = stato attuale sul server. Per ogni sezione: se l'ho toccata solo
 * io vale la mia, se è cambiata solo sul server vale la sua, se entrambe si fonde (elenchi per id, oggetti
 * per campo, scheda per esercizio; per il resto vale la modifica locale, che è la più recente fatta dall'utente).
 * @param conflicts elenco da riempire con i casi in cui la stessa cosa era cambiata da entrambe le parti
 *                  e ha prevalso la versione locale: [{section, what}]
 */
export function mergeState(base, local, server, conflicts = []) {
  const out = clone(server);
  for (const key of Object.keys(local)) {
    if (same(local[key], base[key])) continue;
    if (same(server[key], base[key])) out[key] = clone(local[key]);
    else if (LISTS.has(key)) out[key] = mergeList(base[key] || [], local[key], server[key] || [], conflicts, key);
    else if (OBJECTS.has(key)) out[key] = mergeObject(base[key], local[key], server[key], conflicts, key);
    else if (LISTS_BY_KEY.has(key)) {
      out[key] = { ...server[key] };
      for (const k of Object.keys(local[key])) {
        out[key][k] = mergeList(base[key]?.[k] || [], local[key][k], server[key]?.[k] || [], conflicts, key);
      }
    } else {
      if (!same(server[key], local[key])) conflicts.push({ section: key, what: key });
      out[key] = clone(local[key]);
    }
  }
  if (out.weights && local.weights) out.weights = onePerDay(out.weights, local.weights);
  return out;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);
const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

/** Settimana del programma (1..weeks) a blocchi di 7 giorni dall'inizio: come app/domain.py program_week. */
export function programWeek(startIso, todayIso, weeks = 8) {
  return Math.min(weeks, Math.max(1, Math.floor((dayNumber(todayIso) - dayNumber(startIso)) / 7) + 1));
}

/**
 * "Oggi" quando il server non risponde: se la copia in memoria è di un altro giorno, data, giornata della
 * scheda e settimana del programma vengono ricalcolate sul telefono. La seduta in corso resta.
 * @param schedule {weekday(0=lun): "A"|"B"|"C"}
 */
export function localToday(cached, startIso, todayIso, schedule) {
  if (cached.date === todayIso) return cached;
  const weekday = weekdayOf(todayIso);
  return {
    ...cached, date: todayIso, weekday, routine: schedule[weekday] ?? null,
    program_week: programWeek(startIso, todayIso, cached.program_weeks || 8), done_today: [],
  };
}

/** Agenda del giorno dai promemoria in memoria (tutti "da fare": lo stato vero arriva dal server). */
export function localAgenda(reminders, todayIso, nowHM) {
  const weekday = weekdayOf(todayIso);
  return reminders
    .filter((r) => r.enabled && r.weekday === weekday)
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
    .map((r) => ({ ...r, state: "pending", detail: "", due_at: `${todayIso}T${r.time}`, due: r.time <= nowHM }));
}
