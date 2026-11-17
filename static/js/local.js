// La stessa API del server, sul telefono (solo app autonoma). Funzioni pure, testate in tests/js/local.test.mjs.
// `db` è la copia delle righe (`GET /api/v1/sync/snapshot`) con sopra le modifiche ancora in coda:
// `applyWrite` riproduce ciò che il server farà di ogni scrittura, `readLocal` risponde alle letture quando il
// server non è raggiungibile. Le regole sono le stesse di app/daily.py, app/tracking.py e app/domain.py: se
// cambiano lì cambiano qui (tests/e2e/localfirst.e2e.js confronta le due risposte sugli stessi dati).
import { DAYS, GYM } from "./constants.js";
import { addDays, mondayOf } from "./stats.js";
import { programWeek } from "./sync.js";

const SCHEDULE = Object.fromEntries(DAYS.map((d, i) => [i, GYM[d]]).filter(([, r]) => r));
// `sleep_owned`: giorni delle notti scritte o eliminate dall'utente, che un'importazione dall'orologio non tocca.
const TABLES = ["meal_logs", "meal_templates", "foods", "reminders", "reminder_acks", "sleep_logs", "sleep_owned", "exercise_notes", "grocery_spend", "health_days"];
const STAGES = ["deep_min", "light_min", "rem_min", "awake_min"];
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekdayOf = (iso) => (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const by = (...keys) => (a, b) => {
  for (const k of keys) {
    const x = typeof k === "function" ? k(a, b) : String(a[k] ?? "").localeCompare(String(b[k] ?? ""));
    if (x) return x;
  }
  return 0;
};
/** Come `round()` di Python (metà verso il pari), per dare gli stessi numeri del server. */
function round(value, digits = 0) {
  const f = 10 ** digits, x = value * f, r = Math.round(x);
  return (Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r) / f;
}

/** Copia vuota o incompleta → tutte le tabelle presenti. */
export const normalizeDb = (db = {}) => ({ ...db, ...Object.fromEntries(TABLES.map((t) => [t, db[t] || []])) });

// ---- regole di calcolo (come il server) -------------------------------------------------------
/** Totali di un pasto composto: escluse le voci portate a casa; fonte "estimate" se almeno una è stimata. */
export function mealTotals(items) {
  const known = items.filter((i) => i.kcal != null && !i.takeaway);
  if (!known.length) return { kcal: null, protein_g: null, nutrition_source: null };
  const sources = new Set(known.map((i) => i.nutrition_source || "estimate"));
  const only = (...allowed) => [...sources].every((s) => allowed.includes(s));
  return {
    kcal: round(known.reduce((s, i) => s + i.kcal * i.qty, 0), 1),
    protein_g: round(known.reduce((s, i) => s + (i.protein_g || 0) * i.qty, 0), 1),
    nutrition_source: sources.has("estimate") ? "estimate" : only("label") ? "label" : only("label", "off") ? "off" : "manual",
  };
}

const itemLabel = (i) => (i.qty !== 1 ? `${i.qty}× ` : "") + i.name;
function describe(items) {
  const eaten = items.filter((i) => !i.takeaway).map(itemLabel);
  const home = items.filter((i) => i.takeaway).map(itemLabel);
  return (eaten.join(" + ") + (home.length ? ` · a casa: ${home.join(", ")}` : "")).slice(0, 300);
}

export const sleepMinutes = (bed, wake) => (minutes(wake) - minutes(bed) + 1440) % 1440;
function averageClock(times) {
  if (!times.length) return null;
  const avg = (round(times.reduce((s, t) => s + ((minutes(t) - 720 + 1440) % 1440), 0) / times.length) + 720) % 1440;
  return `${pad(Math.floor(avg / 60))}:${pad(avg % 60)}`;
}
function sleepSummary(rows) {
  if (!rows.length) return { nights: 0, duration_avg_min: null, bedtime_avg: null };
  return {
    nights: rows.length,
    duration_avg_min: round(rows.reduce((s, r) => s + r.duration_min, 0) / rows.length),
    bedtime_avg: averageClock(rows.map((r) => r.bed_time)),
  };
}
const sleepRows = (db, first, last) =>
  db.sleep_logs
    .filter((n) => n.date >= first && n.date <= last)
    .sort(by("date"))
    .map((n) => ({ date: n.date, bed_time: n.bed_time, wake_time: n.wake_time, source: n.source, note: n.note,
      ...Object.fromEntries(STAGES.map((k) => [k, n[k] ?? null])), duration_min: sleepMinutes(n.bed_time, n.wake_time) }));

// ---- letture ----------------------------------------------------------------------------------
function agenda(db, ctx, day) {
  const now = ctx.now;
  const acks = new Map(db.reminder_acks.filter((a) => a.date === day).map((a) => [a.reminder_id, a]));
  const meals = new Map();
  for (const m of db.meal_logs.filter((x) => x.date === day).sort(by("logged_at"))) if (!meals.has(m.slot)) meals.set(m.slot, m);
  const weighed = ctx.state.weights.some((w) => w.date === day);
  const trained = ctx.sessions.some((s) => s.date === day && (s.status === "done" || s.status === "in_progress"));
  return db.reminders
    .filter((r) => r.weekday === weekdayOf(day) && r.enabled)
    .sort(by("time", "id"))
    .map((r) => {
      let state = "pending", detail = "", meal_id = null;
      const meal = r.action === "log_meal" ? meals.get(r.slot) : null;
      if (meal) [state, detail, meal_id] = [meal.status === "eaten" ? "done" : "skipped", meal.description, meal.id];
      else if ((r.action === "log_weight" && weighed) || (r.action === "start_workout" && trained)) state = "done";
      const ack = acks.get(r.id);
      let due = new Date(`${day}T${r.time}:00`);
      if (state === "pending" && ack) {
        if (ack.status === "done") state = "done";
        else if (ack.status === "dismissed") state = "skipped";
        else if (ack.snooze_until && new Date(ack.snooze_until) > now) [state, due] = ["snoozed", new Date(ack.snooze_until)];
      }
      return { ...r, state, detail, meal_id, due_at: `${isoOf(due)}T${pad(due.getHours())}:${pad(due.getMinutes())}`, due: state === "pending" && due <= now };
    });
}

function weeklySummary(db, ctx, weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [first, last] = [days[0], days[6]];
  const inWeek = (d) => d >= first && d <= last;
  const profile = ctx.state.profile;
  const expected = {};
  for (const r of db.reminders) if (r.enabled && r.action === "log_meal") expected[r.weekday] = (expected[r.weekday] || 0) + 1;
  const sessions = ctx.sessions.filter((s) => s.status === "done" && inWeek(s.date));
  const setsDone = (s) => s.sets.filter((x) => x.completed).length;
  const week = programWeek(profile.startDate, weekStart);
  const planned = Object.fromEntries(
    Object.entries(ctx.state.routines).map(([r, exs]) => [r, exs.reduce((n, ex) => n + (ex.sets.length ? ex.sets[Math.min(week, ex.sets.length) - 1] : 0), 0)]),
  );
  const nights = sleepRows(db, first, last);
  const outDays = days.map((iso) => {
    const logs = db.meal_logs.filter((m) => m.date === iso);
    const eaten = logs.filter((m) => m.status === "eaten");
    const valued = eaten.filter((m) => m.kcal != null);
    return {
      date: iso,
      meals_eaten: eaten.length,
      meals_skipped: logs.length - eaten.length,
      meals_expected: expected[weekdayOf(iso)] || 0,
      meals_without_values: eaten.length - valued.length,
      kcal_estimate: valued.length ? round(valued.reduce((s, m) => s + m.kcal, 0)) : null,
      protein_estimate_g: valued.length ? round(valued.reduce((s, m) => s + (m.protein_g || 0), 0)) : null,
      workouts: sessions.filter((s) => s.date === iso).map((s) => ({ routine: s.routine, sets_done: setsDone(s), sets_planned: planned[s.routine] || 0 })),
      sleep: nights.find((n) => n.date === iso) ?? null,
    };
  });
  const weights = ctx.state.weights.filter((w) => inWeek(w.date || "")).map((w) => w.weight);
  const logged = outDays.filter((x) => x.kcal_estimate != null);
  const scheduled = Object.values(SCHEDULE).filter((r) => r in planned);
  const avg = (key) => (logged.length ? round(logged.reduce((s, x) => s + x[key], 0) / logged.length) : null);
  const total = (key) => outDays.reduce((s, x) => s + x[key], 0);
  return {
    week_start: first,
    program_week: week,
    days: outDays,
    totals: {
      kcal_estimate_avg: avg("kcal_estimate"),
      protein_estimate_avg_g: avg("protein_estimate_g"),
      days_with_values: logged.length,
      meals_eaten: total("meals_eaten"),
      meals_expected: total("meals_expected"),
      meals_without_values: total("meals_without_values"),
      workouts_done: sessions.length,
      workouts_planned: scheduled.length,
      sets_done: sessions.reduce((n, s) => n + setsDone(s), 0),
      sets_planned: scheduled.reduce((n, r) => n + planned[r], 0),
      weight_avg: weights.length ? round(weights.reduce((s, w) => s + w, 0) / weights.length, 1) : null,
      weigh_ins: weights.length,
      sleep: sleepSummary(nights),
    },
    targets: { protein_g: profile.proteinTarget ?? null, kcal: profile.kcalTarget ?? null },
    estimate_note: "Calorie e proteine sono stime teoriche dai pasti registrati, non misure.",
  };
}

/**
 * Risposta locale a una GET dell'API, o `undefined` se il percorso non è tra quelli ricostruibili sul telefono.
 * @param ctx {state, sessions, now} stato a blob, sedute e orologio del dispositivo
 */
export function readLocal(path, db, ctx) {
  const url = new URL(path, "http://local");
  const q = (name) => url.searchParams.get(name);
  const today = isoOf(ctx.now);
  switch (url.pathname) {
    case "/api/v1/meal-logs":
      return { items: db.meal_logs.filter((m) => m.date >= q("from") && m.date <= q("to")).sort(by("date", "logged_at")) };
    case "/api/v1/meal-templates":
      return { items: [...db.meal_templates].sort(by((a, b) => a.position - b.position, "name")) };
    case "/api/v1/foods":
      return { items: [...db.foods].sort(by("category", (a, b) => (b.use_count || 0) - (a.use_count || 0), "name")) };
    case "/api/v1/reminders":
      return { items: [...db.reminders].sort(by((a, b) => a.weekday - b.weekday, "time", "id")) };
    case "/api/v1/exercise-notes":
      return { items: db.exercise_notes.filter((n) => n.note) };
    case "/api/v1/grocery-spend":
      return { items: [...db.grocery_spend].sort((a, b) => b.week_start.localeCompare(a.week_start)).slice(0, Number(q("limit")) || 12) };
    case "/api/v1/takeaway": {
      const date = q("date") || today;
      return { date, items: db.meal_logs.filter((m) => m.date === date).flatMap((m) => m.items || []).filter((i) => i.takeaway) };
    }
    case "/api/v1/sleep": {
      const last = q("to") || today;
      const items = sleepRows(db, q("from") || addDays(last, -59), last);
      return { items, summary: sleepSummary(items) };
    }
    case "/api/v1/health-days": {
      const last = q("to") || today, first = q("from") || addDays(last, -59);
      return { items: db.health_days.filter((d) => d.date >= first && d.date <= last).sort(by("date")).map(({ date, steps, resting_hr }) => ({ date, steps, resting_hr })) };
    }
    case "/api/v1/agenda": {
      const date = q("date") || today;
      return { date, items: agenda(db, ctx, date) };
    }
    case "/api/v1/weekly-summary":
      return weeklySummary(db, ctx, mondayOf(q("week_start") || today));
    default:
      return undefined;
  }
}

// ---- scritture --------------------------------------------------------------------------------
const without = (list, key, value) => list.filter((x) => x[key] !== value);
/** Inserisce o sostituisce la riga con quella chiave, tenendo i campi che la scrittura non porta. */
function upsert(list, key, row) {
  const old = list.find((x) => x[key] === row[key]);
  return old ? list.map((x) => (x === old ? { ...old, ...row } : x)) : [...list, row];
}

function learnFoods(foods, items, at) {
  let out = foods;
  for (const i of items) {
    const known = out.find((f) => f.name.toLowerCase() === i.name.toLowerCase());
    out = known
      ? out.map((f) => (f === known ? { ...f, use_count: (f.use_count || 0) + 1, last_used: at } : f))
      // l'id definitivo lo assegna il server: questo vale finché la copia non viene riallineata
      : [...out, { id: `local-${i.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40)}`, category: i.category || "altro", name: i.name,
          kcal: i.kcal ?? null, protein_g: i.protein_g ?? null, nutrition_source: i.kcal != null ? i.nutrition_source || "manual" : null, note: "", use_count: 1, last_used: at }];
  }
  return out;
}

function putMeal(db, id, body, at) {
  const items = (body.status === "skipped" ? [] : body.items || []).map((i) => ({ category: "altro", qty: 1, kcal: null, protein_g: null, nutrition_source: null, food_id: null, takeaway: false, ...i }));
  let values = { kcal: body.kcal ?? null, protein_g: body.protein_g ?? null, nutrition_source: body.nutrition_source ?? null };
  let description = body.description || "";
  if (items.length) {
    values = mealTotals(items);
    description ||= describe(items);
  } else if (body.template_id && values.kcal == null) {
    const t = db.meal_templates.find((x) => x.id === body.template_id);
    if (t) values = { kcal: t.kcal, protein_g: t.protein_g, nutrition_source: t.nutrition_source };
  }
  if (body.status === "skipped") values = { kcal: null, protein_g: null, nutrition_source: null };
  if (values.kcal != null) values.nutrition_source ||= "estimate";
  const old = db.meal_logs.find((m) => m.id === id);
  const row = { id, date: body.date, slot: body.slot, status: body.status || "eaten", description, template_id: body.template_id ?? null, ...values,
    note: body.note || "", logged_at: old?.logged_at || at, updated_at: at, items, deleted_at: null };
  return { ...db, meal_logs: upsert(db.meal_logs, "id", row), foods: learnFoods(db.foods, items, at) };
}

/**
 * Applica alla copia una scrittura della coda, come farà il server quando la riceverà.
 * @param op {method, path, body, at} @returns la nuova copia (la stessa, se il percorso non riguarda queste tabelle)
 */
export function applyWrite(db, { method, path, body = {}, at }) {
  const m = /^\/api\/v1\/([a-z-]+)\/([^/?]+)(\/ack)?$/.exec(path);
  if (!m || !["PUT", "DELETE"].includes(method)) return db;
  const [, domain, raw, ack] = m;
  const id = decodeURIComponent(raw);
  const del = method === "DELETE";
  if (ack) {
    if (domain !== "reminders" || del) return db;
    const until = body.status === "snoozed" ? new Date(new Date(at).getTime() + (body.snooze_minutes || 15) * 60_000).toISOString() : null;
    return { ...db, reminder_acks: [...db.reminder_acks.filter((a) => !(a.reminder_id === id && a.date === body.date)), { reminder_id: id, date: body.date, status: body.status, snooze_until: until, at }] };
  }
  switch (domain) {
    case "meal-logs":
      return del ? { ...db, meal_logs: without(db.meal_logs, "id", id) } : putMeal(db, id, body, at);
    case "meal-templates":
      return { ...db, meal_templates: del ? without(db.meal_templates, "id", id) : upsert(db.meal_templates, "id", { nutrition_note: "", position: 0, ...body, id, nutrition_source: body.kcal == null ? null : body.nutrition_source || "estimate", updated_at: at }) };
    case "foods":
      return { ...db, foods: del ? without(db.foods, "id", id) : upsert(db.foods, "id", { note: "", ...body, id, nutrition_source: body.kcal == null ? null : body.nutrition_source || "estimate", updated_at: at }) };
    case "reminders":
      return del
        ? { ...db, reminders: without(db.reminders, "id", id), reminder_acks: without(db.reminder_acks, "reminder_id", id) }
        : { ...db, reminders: upsert(db.reminders, "id", { slot: null, action: "none", enabled: true, ...body, id, updated_at: at }) };
    case "sleep": {
      const imported = !del && body.source === "health_connect";
      if (imported && db.sleep_owned.includes(id)) return db; // come il server: la notte l'ha decisa l'utente
      const owned = imported ? db.sleep_owned : [...new Set([...db.sleep_owned, id])].sort();
      return { ...db, sleep_owned: owned, sleep_logs: del ? without(db.sleep_logs, "date", id)
        : upsert(db.sleep_logs, "date", { source: "manual", note: "", ...Object.fromEntries(STAGES.map((k) => [k, null])), ...body, date: id }) };
    }
    case "health-days":
      return del ? db : { ...db, health_days: upsert(db.health_days, "date", { steps: null, resting_hr: null, ...body, date: id }) };
    case "exercise-notes":
      return del ? db : { ...db, exercise_notes: upsert(db.exercise_notes, "exercise_id", { exercise_id: id, note: (body.note || "").trim(), updated_at: at }) };
    case "grocery-spend": {
      const week = mondayOf(id);
      return { ...db, grocery_spend: del ? without(db.grocery_spend, "week_start", id) : upsert(db.grocery_spend, "week_start", { note: "", ...body, week_start: week }) };
    }
    default:
      return db;
  }
}

/** La copia del server con sopra, in ordine, tutte le scritture ancora in coda. */
export const withPending = (snapshot, ops) => ops.reduce(applyWrite, normalizeDb(snapshot));
