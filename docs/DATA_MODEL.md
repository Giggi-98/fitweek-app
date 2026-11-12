# Modello dati

## Attuale

Tabella unica:

```sql
CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version INTEGER NOT NULL,   -- incrementato a ogni PUT, usato per il controllo 409
  json TEXT NOT NULL          -- intero stato applicativo
);
```

Struttura del JSON (da `seed.py` e `app.js`). Nessuna validazione server oltre la presenza delle chiavi principali.

| Chiave | Tipo | Contenuto |
|---|---|---|
| `profile` | object | `name, age, height, startingWeight, budget, week (1–8), startDate (ISO), gymDays[], notes` |
| `routines` | `{A\|B\|C: Exercise[]}` | `Exercise = {id, name, reps: "8–10", sets: int[8], video}` — `sets[i]` = serie previste in W(i+1) |
| `workouts` | `Workout[]` | `{id, routine, week, date, duration\|null, notes, sets: [{exerciseId, set, kg, reps}]}` |
| `weights` | `Reading[]` | `{id, date, weight, waist\|null, note}` |
| `meals` | `{Lunedì…Domenica: {lunch, pre, dinner}}` | testo libero, piano settimanale ricorrente (non per data) |
| `groceries` | `Item[]` | `{id, name, qty (testo), price (stima), checked, category}` |
| `inventory` | `Item[]` | `{id, name, qty (testo), expiry}` |
| `habits`, `notes` | object / array | non usati dalla UI |
| `appVersion` | int | 1 |

Osservazioni: `profile.startingWeight` duplica il primo dato di peso; `profile.week` è manuale; le quantità sono stringhe; nessuna distinzione stima/dato reale oltre ai testi della UI.

## Obiettivo (migrazione progressiva)

Convenzioni: `id TEXT` UUID generato dal client (idempotenza), date `TEXT` ISO-8601 (`YYYY-MM-DD`, timestamp in UTC con offset), `created_at/updated_at`, soft delete (`deleted_at`) sui dati registrati dall'utente, `source` (`manual|label|estimate|import`) su ogni valore nutrizionale o prezzo.

### Infrastruttura
```sql
schema_migrations(version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)
settings(key TEXT PRIMARY KEY, value TEXT)          -- incl. session_epoch, ai_enabled
```

### Palestra (M2)
```sql
programs(id, name, weeks INT, start_date, active BOOL, source_pdf)
program_days(id, program_id, code 'A'|'B'|'C', weekday INT, title, position)
exercises(id, name, video_url, notes)                         -- catalogo
program_exercises(id, program_day_id, exercise_id, position, rep_min, rep_max,
                  kind 'strength'|'cardio', duration_min, sets_by_week JSON)  -- [3,3,3,3,4,4,4,4]
sessions(id, program_id, program_day_id, program_week INT, date, started_at, ended_at,
         status 'planned'|'in_progress'|'done'|'skipped'|'rescheduled', rescheduled_from, notes)
set_logs(id, session_id, program_exercise_id, set_index, kg REAL, reps INT,
         rir INT NULL, rpe REAL NULL, completed BOOL, logged_at, note)
```
Migrazione: `routines` → `programs/…`; ogni `workouts[]` → `sessions` + `set_logs` (`completed=1`, `logged_at=date`). Gli ID esistenti vengono preservati.

### Corpo (M3)
```sql
body_measurements(id, date, weight_kg, waist_cm, extra JSON, note, created_at)
profile_history(id, effective_date, height_cm, goal, ...)     -- storico, mai sovrascritto
```
Medie settimanali e trend sono **calcolati** e mostrati come tali, mai salvati come misure.

### Alimentazione (M4)
```sql
meal_templates(id, name, slot 'lunch'|'snack'|'pre_workout'|'dinner', notes, is_work_secondo BOOL)
meal_plan(id, date, slot, template_id NULL, free_text, status 'planned'|'eaten'|'skipped'|'changed')
foods(id, name, unit, kcal, protein_g, carbs_g, fat_g, source, source_ref)
template_ingredients(template_id, food_id, qty, unit)
```

### Spesa e inventario (M5)
```sql
shopping_lists(id, week_start, budget_eur, actual_total_eur, status, delivered_on)
shopping_items(id, list_id, food_id NULL, name, qty REAL, unit, category,
               est_price_eur, price_source, actual_price_eur, purchased BOOL)
inventory_items(id, food_id NULL, name, qty REAL, unit, location 'pantry'|'fridge'|'freezer',
                expires_on, opened_on, updated_at)
```

## Regole di migrazione

1. Backup coerente automatico prima di ogni migrazione (`sqlite3` backup API → `/data/backups/pre-migration-<ver>-<ts>.sqlite`).
2. Solo operazioni additive (`CREATE TABLE`, `ADD COLUMN`); il blob `app_state` resta intatto finché il dominio migrato non è stabile da almeno una release.
3. Migrazioni idempotenti, in transazione, registrate in `schema_migrations`.
4. Test di migrazione su copia del DB reale prima del deploy.

## Stato dopo M2 (schema 4, 2026-11-09)

Tabelle reali: `app_state` (blob), `sessions` (login), `schema_migrations`, `workout_sessions`, `set_logs`.

```sql
workout_sessions(id TEXT PK, routine, week, date, status CHECK IN ('in_progress','done','skipped'),
                 started_at, ended_at, duration_min, cardio_min, notes, source ('app'|'v1-blob'|'v1-backup'),
                 created_at, updated_at, deleted_at)
set_logs(session_id → workout_sessions ON DELETE CASCADE, exercise_id, set_index, kg, reps, rir,
         completed, logged_at, PRIMARY KEY(session_id, exercise_id, set_index))
```

Differenze rispetto al modello obiettivo: la scheda (`programs/program_days/...`) è ancora `routines` nel blob; `exercise_id` fa riferimento agli id della scheda (`a1`…`c5`). Il campo `workouts` del blob è congelato dopo la migrazione 4.

## Stato dopo M4 (schema 5, 2026-11-09)

```sql
meal_templates(id PK, slot, name, kcal, protein_g, nutrition_source, nutrition_note, position, created_at, updated_at, deleted_at)
meal_logs(id PK, date, slot, status CHECK IN ('eaten','skipped'), description, template_id, kcal, protein_g,
          nutrition_source, note, logged_at, updated_at, deleted_at)          -- indice su date
reminders(id PK, weekday 0-6, time 'HH:MM', kind, slot, title, action, enabled, created_at, updated_at)
reminder_acks(reminder_id, date, status CHECK IN ('done','dismissed','snoozed'), snooze_until, at,
              PRIMARY KEY(reminder_id, date))
```

I valori nutrizionali del diario sono copiati dal pasto abituale al momento della registrazione: correggere un pasto abituale non riscrive lo storico.

## Stato dopo 1.6 (schema 6, 2026-11-09)

```sql
ALTER TABLE meal_logs ADD COLUMN items TEXT;  -- JSON [{name, category, qty, kcal, protein_g, nutrition_source, food_id, takeaway}]
foods(id PK, category, name, kcal, protein_g, nutrition_source, note, use_count, last_used, created_at, updated_at, deleted_at)
      -- indice unico su lower(name) per i piatti attivi
```
kcal/protein_g delle voci sono per porzione; il pasto memorizza i totali calcolati (qty × porzione, escluse le voci `takeaway`).

## Stato dopo 1.8 (schema 7, 2026-11-10)

```sql
sleep_logs(date PK,            -- giorno del RISVEGLIO
           bed_time 'HH:MM', wake_time 'HH:MM', source DEFAULT 'manual', note, updated_at, deleted_at)
exercise_notes(exercise_id PK, note, updated_at)        -- nota che resta tra una seduta e l'altra
grocery_spend(week_start PK,   -- lunedì della settimana
              amount REAL CHECK(amount >= 0), note, updated_at)
```
La durata del sonno non è memorizzata: si calcola dagli orari (se la sveglia è "prima" dell'ora di letto si intende il giorno dopo). L'orario medio di letto è una media circolare contata da mezzogiorno (23:30 e 00:30 → 00:00).

Blob: `profile.proteinTarget`, `profile.kcalTarget` (numeri facoltativi scelti dall'utente), `groceries[].recurring` (resta in lista dopo "Spesa arrivata").
`set_logs.rir`: 0–3 = ripetizioni di riserva, 4 = "4 o più".

## Stato dopo 1.10.2 (schema 8, 2026-11-12)

```sql
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;  -- rinnovo scorrevole delle sessioni attive
```

Nel blob `app_state` (migrazione 8, additiva e idempotente):
- `groceries[]` e `inventory[]` portano `amount` (REAL, convertito in unità base `g`/`ml`/`pz`/`conf`) e `unit` (TEXT), popolati automaticamente da `qty` per le voci già esistenti.
- `meals[Giorno].items` contiene l'elenco di ingredienti strutturati `[{name, amount, unit, category, slot}]` per calcolare la proposta di lista della spesa (`fabbisogno − dispensa`).
