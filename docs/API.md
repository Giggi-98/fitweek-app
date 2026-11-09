# API

Base: stessa origine della SPA. Formato JSON. Errori: `{"detail": "messaggio"}`. OpenAPI/Swagger disabilitati in produzione (`docs_url=None`).

## Endpoint attuali (verificati 2026-11-09)

| Metodo | Path | Auth | Origin check | Descrizione |
|---|---|---|---|---|
| GET | `/api/health` | no | — | `{"ok": true}`; usato dall'healthcheck Docker |
| POST | `/api/login` | no | sì | body `{password}` → 200 + cookie `fitweek_session`; 401 se errata |
| POST | `/api/logout` | no | sì | cancella il cookie (il token resta valido, vedi audit) |
| GET | `/api/state` | sì | — | `{version, data}` |
| PUT | `/api/state` | sì | sì | body `{version, data}`; 409 se versione obsoleta; 400 se mancano chiavi; 413 se > 2 MB → `{ok, version}` |
| GET | `/api/backup` | sì | — | `{format: "fitweek-backup-v1", version, data}` come allegato |
| GET | `/api/original-pdf` | sì | — | PDF della scheda |
| GET | `/`, `/static/*` | no | — | SPA |

Comportamenti difettosi noti: corpo non JSON o JSON non-oggetto → **500** (deve essere 400); `data` non validato nei tipi.

## Convenzioni per i nuovi endpoint

- Prefisso versionato: `/api/v1/...`. `/api/state` resta come compatibilità finché esistono domini nel blob.
- Risorse al plurale, verbi HTTP standard: `GET /api/v1/sessions?from=&to=`, `POST /api/v1/sessions`, `PATCH /api/v1/sessions/{id}`.
- **Idempotenza**: le creazioni accettano `id` UUID dal client; ripetere la stessa richiesta non duplica (`PUT /api/v1/set-logs/{id}` = upsert).
- Validazione Pydantic: 422 con dettaglio campo per campo; mai 500 per input dell'utente.
- Concorrenza: per risorse modificabili `updated_at` o `ETag` + `If-Match` → 412 su conflitto, limitato alla singola risorsa.
- Date ISO-8601; numeri in unità SI nel nome campo (`weight_kg`, `price_eur`).
- Scritture: auth + controllo `Origin`; cookie SameSite=Lax.
- Paginazione per liste lunghe: `?limit=&cursor=`.

## Endpoint pianificati (sintesi)

| Milestone | Endpoint |
|---|---|
| M1 | `GET /api/v1/meta` (versione app/schema), backup server-side `POST /api/v1/backups` |
| M2 | `GET /api/v1/today` (giorno, sessione prevista, settimana programma), `programs`, `sessions`, `set-logs`, `exercises/{id}/history` |
| M3 | `body-measurements`, `stats/weekly` |
| M4 | `meal-plan`, `meal-templates`, `foods` |
| M5 | `shopping-lists`, `shopping-items`, `inventory` |
| M8 | `assistant/suggestions` (solo proposte; applicazione esplicita) |

## API v1 implementate (M2, 2026-11-09)

Tutte richiedono login; le scritture verificano `Origin`. Errori di validazione: 422 `{detail, errors:[{field, error}]}`.

| Metodo | Path | Note |
|---|---|---|
| GET | `/api/v1/today` | `{date, weekday, routine, program_week, program_weeks, active_session, done_today[]}` (fuso Europe/Rome) |
| PUT | `/api/v1/program-week` | `{week}` → sposta `profile.startDate` (lunedì) e incrementa la versione del blob |
| GET | `/api/v1/workout-sessions?routine=&status=&limit=` | sedute non eliminate, più recenti prima, con `sets[]` |
| GET | `/api/v1/workout-sessions/{id}` | 404 se assente/eliminata |
| POST | `/api/v1/workout-sessions` | `{id, routine, week, date}`; idempotente (stesso id → stessa seduta), `status=in_progress`, `started_at` dal server |
| PATCH | `/api/v1/workout-sessions/{id}` | campi parziali: `status, routine, week, date, ended_at, duration_min, cardio_min, notes`; `status=done` calcola `ended_at`/durata se mancanti |
| DELETE | `/api/v1/workout-sessions/{id}` | eliminazione logica (`deleted_at`) |
| PUT | `/api/v1/workout-sessions/{id}/sets/{exercise_id}/{set_index}` | `{kg, reps, rir, completed}`; upsert sulla chiave naturale |
| DELETE | `/api/v1/workout-sessions/{id}/sets/{exercise_id}/{set_index}` | rimuove la serie |
| POST | `/api/v1/restore` | backup `fitweek-backup-v1` o `v2`; sostituisce stato e sedute dopo un backup SQLite `pre-restore-*` |

`GET /api/backup` ora produce `fitweek-backup-v2`: `{format, version, data, workout_sessions[]}`.

## API v1 giornata (M4, 2026-11-09)

| Metodo | Path | Note |
|---|---|---|
| GET | `/api/v1/meal-templates` | pasti abituali attivi |
| PUT/DELETE | `/api/v1/meal-templates/{id}` | upsert `{slot, name, kcal?, protein_g?, nutrition_source?, nutrition_note, position}`; senza fonte ma con kcal → `estimate` |
| GET | `/api/v1/meal-logs?from=&to=` | diario |
| PUT/DELETE | `/api/v1/meal-logs/{id}` | upsert `{date, slot, status eaten\|skipped, description, template_id?, kcal?, protein_g?, nutrition_source?, note}`; con `template_id` e senza kcal eredita i valori del pasto abituale |
| GET | `/api/v1/reminders` | tutti |
| PUT/DELETE | `/api/v1/reminders/{id}` | `{weekday 0-6, time HH:MM, kind, slot?, title, action, enabled}`; `log_meal` richiede `slot` |
| PUT | `/api/v1/reminders/{id}/ack` | `{date, status done\|dismissed\|snoozed, snooze_minutes?}` |
| GET | `/api/v1/agenda?date=` | promemoria del giorno con `state` (done/skipped/snoozed/pending), `due`, `due_at`, `detail` |
| GET | `/api/v1/weekly-summary?week_start=` | giorni + totali teorici (vedi `app/daily.py`) |

Slot pasto: `lunch, snack, pre_workout, dinner, other`. Backup: `fitweek-backup-v3` aggiunge `meal_templates`, `meal_logs`, `reminders`; il ripristino di v1/v2 non tocca queste tabelle.

## App Android (M6)

| Metodo | Path | Note |
|---|---|---|
| GET | `/api/v1/app/android` | `{available, version, version_code, size, sha256, built_at, server_url, app_id}` |
| GET | `/api/v1/app/android/download` | APK (`application/vnd.android.package-archive`), 404 se non compilato |
