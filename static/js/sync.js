// Regole pure per l'uso senza rete (testate in tests/js/sync.test.mjs): fusione delle modifiche fatte
// offline con ciò che nel frattempo è cambiato sul server, e "oggi" ricostruito sul telefono.
// Il server resta la fonte di verità: qui si decide solo come riportargli le modifiche locali senza perderne.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Elenchi con `id` (si fondono voce per voce), oggetti da fondere campo per campo, e la scheda: un elenco
// di esercizi per ogni giornata (si fonde esercizio per esercizio).
const LISTS = new Set(["weights", "groceries", "inventory", "workouts"]);
const OBJECTS = new Set(["profile"]);
const LISTS_BY_KEY = new Set(["routines"]);
const label = (item) => item.name || item.date || item.id;
const byId = (item) => item.id;

/**
 * Voce per voce: le modifiche locali valgono; ciò che è nuovo sul server resta; un'eliminazione vale se
 * l'altra parte non ha toccato la voce. Se la stessa voce è cambiata da entrambe le parti vale quella locale
 * e il caso finisce in `conflicts`. Una voce modificata da una parte ed eliminata dall'altra viene TENUTA,
 * in entrambi i versi (meglio una voce in più che una modifica persa in silenzio): quando l'eliminazione
 * era locale il conflitto porta `kind: "kept"`, così l'avviso può dire che la voce è rimasta.
 * @param keyOf identità della voce (default `id`); @param labelOf nome mostrato nell'avviso
 */
function mergeList(base, local, server, conflicts, section, keyOf = byId, labelOf = label) {
  const baseByKey = new Map(base.map((x) => [keyOf(x), x]));
  const localByKey = new Map(local.map((x) => [keyOf(x), x]));
  const out = [];
  for (const item of server) {
    const mine = localByKey.get(keyOf(item));
    const before = baseByKey.get(keyOf(item));
    if (!mine) {
      if (!before) out.push(item); // aggiunta sul server mentre ero offline
      else if (!same(item, before)) {
        conflicts.push({ section, what: labelOf(item), kind: "kept" }); // eliminata da me, modificata dall'altro
        out.push(item);
      }
      continue; // c'era, nessuno l'ha cambiata e in locale non c'è più: eliminata da me
    }
    if (before && same(mine, before)) out.push(item); // non toccata da me → versione del server
    else {
      if (!same(mine, item) && !(before && same(item, before))) conflicts.push({ section, what: labelOf(mine) });
      out.push(mine);
    }
  }
  const onServer = new Set(server.map(keyOf));
  for (const item of local) {
    if (onServer.has(keyOf(item))) continue;
    const before = baseByKey.get(keyOf(item));
    if (!before) out.push(item); // nuova in locale
    else if (!same(item, before)) {
      conflicts.push({ section, what: labelOf(item) }); // modificata da me, eliminata dall'altro dispositivo
      out.push(item);
    }
  }
  return out;
}

// ---- piano pasti: un giorno = { lunch, pre, dinner, items: [ingredienti senza id] } --------------------
const SLOT_NAMES = { lunch: "pranzo", pre: "spuntino", dinner: "cena" };
const ingredientKey = (i) => `${i.slot}|${String(i.name).trim().toLowerCase()}`;
const distinct = (list) => new Set(list.map(ingredientKey)).size === list.length;

/** Ingredienti del giorno voce per voce (identità: pasto + nome). Se un elenco ha due voci con lo stesso
 *  nome nello stesso pasto l'identità non basta: vale l'elenco locale intero, segnalato come conflitto. */
function mergeIngredients(day, base, local, server, conflicts) {
  if (same(server, base)) return local;
  if (same(server, local)) return server;
  if (![base, local, server].every(distinct)) {
    conflicts.push({ section: "meals", what: `${day} · ingredienti` });
    return local;
  }
  return mergeList(base, local, server, conflicts, "meals", ingredientKey, (i) => `${day} · ${i.name}`);
}

/** Un giorno del piano: ogni pasto (pranzo, spuntino, cena) e gli ingredienti si fondono per conto loro,
 *  così il pranzo cambiato su un dispositivo e la cena cambiata sull'altro restano entrambi. */
function mergeDay(day, base, local, server, conflicts) {
  const out = { ...server };
  for (const key of Object.keys(local)) {
    if (same(local[key], base[key])) continue;
    if (key === "items") {
      out.items = mergeIngredients(day, base.items || [], local.items, server.items || [], conflicts);
      continue;
    }
    if (!same(server[key], base[key]) && !same(server[key], local[key])) {
      conflicts.push({ section: "meals", what: `${day} · ${SLOT_NAMES[key] || key}` });
    }
    out[key] = local[key];
  }
  return out;
}

function mergeMeals(base, local, server, conflicts) {
  const out = { ...server };
  for (const day of Object.keys(local)) {
    if (same(local[day], base?.[day])) continue;
    out[day] = server?.[day] ? mergeDay(day, base?.[day] || {}, local[day], server[day], conflicts) : local[day];
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
 * per campo, scheda per esercizio, piano pasti per giorno → pasto → ingrediente; per il resto vale la modifica
 * locale, che è la più recente fatta dall'utente).
 * @param conflicts elenco da riempire con i casi in cui la stessa cosa era cambiata da entrambe le parti:
 *                  [{section, what}] = ha prevalso la versione locale; con `kind: "kept"` = voce eliminata
 *                  qui ma modificata altrove, rimasta nell'elenco
 */
export function mergeState(base, local, server, conflicts = []) {
  const out = clone(server);
  for (const key of Object.keys(local)) {
    if (same(local[key], base[key])) continue;
    if (same(server[key], base[key])) out[key] = clone(local[key]);
    else if (LISTS.has(key)) out[key] = mergeList(base[key] || [], local[key], server[key] || [], conflicts, key);
    else if (OBJECTS.has(key)) out[key] = mergeObject(base[key], local[key], server[key], conflicts, key);
    else if (key === "meals") out[key] = mergeMeals(base[key], local[key], server[key], conflicts);
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
