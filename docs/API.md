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

## API 1.8 (2026-11-10)

Tutte sotto `/api/v1`, con autenticazione; le scritture hanno il controllo `Origin`.

| Metodo | Path | Descrizione |
|---|---|---|
| GET | `/sleep?from=&to=` | Notti registrate (default: ultimi 60 giorni) → `{items: [{date, bed_time, wake_time, duration_min, source, note}], summary: {nights, duration_avg_min, bedtime_avg}}`. `date` è il giorno del risveglio. |
| PUT | `/sleep/{date}` | `{bed_time "HH:MM", wake_time "HH:MM", source?: manual\|health_connect, note?}` → upsert. |
| DELETE | `/sleep/{date}` | Eliminazione logica. |
| GET | `/exercise-notes` | `{items: [{exercise_id, note, updated_at}]}` (solo note non vuote). |
| PUT | `/exercise-notes/{exercise_id}` | `{note}`; nota vuota = rimossa dall'elenco. |
| GET | `/grocery-spend?limit=` | Spesa reale per settimana, più recenti prima → `{items: [{week_start, amount, note}]}`. |
| PUT | `/grocery-spend/{date}` | `{amount, note?}`; qualsiasi giorno viene riportato al lunedì della sua settimana. |
| DELETE | `/grocery-spend/{week_start}` | Rimuove il totale di quella settimana. |
| GET | `/food-search?q=` | Ricerca prodotti su Open Food Facts (D-018) → `{enabled, source, items: [{code, name, brand, kcal_100g, protein_100g, serving_g}]}`. 3–60 caratteri; cache in memoria; 429 oltre 10 ricerche al minuto; 502 se il servizio non risponde; `enabled: false` con `FOOD_SEARCH=off`. |

Modifiche a endpoint esistenti:
- `GET /weekly-summary`: `days[].sleep` (notte con risveglio in quel giorno o `null`), `totals.sleep`, `targets: {protein_g, kcal}` (riferimenti scelti dall'utente nel profilo, `null` se assenti).
- `PUT /workout-sessions/{id}/sets/...`: `rir` (0–4, dove 4 = "4 o più") ora è usato dall'interfaccia; va rimandato a ogni modifica della serie, altrimenti viene azzerato.
- `GET /api/backup` → `fitweek-backup-v4` (aggiunge `sleep_logs`, `exercise_notes`, `grocery_spend`); il ripristino accetta v1–v4 e non tocca le tabelle assenti dal file.
- Blob (`/api/state`): `profile.proteinTarget`, `profile.kcalTarget` (facoltativi), `groceries[].recurring`.
- `nutrition_source` ammette anche `off` (valore da Open Food Facts).

## API 1.9 (2026-11-10) — app autonoma

- `POST /api/login` accetta `client: "web" | "app"` (predefinito `web`). Con `app` risponde `{ok, token, max_age_s}` senza cookie; con `web` imposta il cookie e non restituisce mai il token.
- Tutte le rotte autenticate accettano il token sia dal cookie sia da `Authorization: Bearer <token>`; `POST /api/logout` revoca la sessione in entrambi i casi.
- CORS: solo per le origini in `APP_ORIGINS` (predefinite `http://localhost`, `https://localhost`, `capacitor://localhost`), senza credenziali, intestazioni `Authorization` e `Content-Type`. Le stesse origini sono ammesse dal controllo `Origin` delle scritture.
- `GET /api/v1/app/android` aggiunge `next` (metadati dell'APK di prova o `null`); `GET /api/v1/app/android/download?channel=stable|next`.

## API 1.10.1 (2026-11-12) — orario della modifica

Le scritture che passano dalla coda offline dichiarano quando sono state fatte con l'intestazione `X-Edited-At` (ISO 8601, es. `2026-11-12T17:05:00.000Z`). Vale per `PUT`/`DELETE` di `/api/v1/workout-sessions/{id}/sets/{exercise}/{n}`, `/api/v1/meal-logs/{id}`, `/api/v1/sleep/{giorno}` e per `PUT /api/v1/exercise-notes/{exercise}`.

- Se il dato salvato è stato modificato **dopo** quell'orario, la scrittura non viene applicata e la risposta è `200 {"ok": true, "stale": true}` (non è un errore: il client non deve ritentare).
- Altrimenti la scrittura è applicata e l'orario salvato (`logged_at` per le serie, `updated_at` per gli altri) è quello dichiarato, mai nel futuro.
- Senza intestazione, o con un valore non valido, vale l'orario del server (comportamento precedente).
- CORS: l'intestazione è ammessa per le origini dell'app autonoma (`APP_ORIGINS`).
- Non coperti: `PATCH`/`DELETE` delle sedute, promemoria, pasti abituali, catalogo, spesa settimanale (scritture fatte solo in linea).

## API 1.10.2 (2026-11-12) — sessioni, rinnovo scorrevole e quantità con unità

- `GET /api/v1/sessions`: restituisce l'elenco dei dispositivi attivi `{"items": [{"id", "created_at", "last_seen_at", "user_agent", "current"}]}` ordinato per `last_seen_at` decrescente.
- `DELETE /api/v1/sessions/{id}` (con controllo `Origin`): revoca il singolo dispositivo indicato (`404` se inesistente); se coincide con la sessione corrente rimuove anche il cookie.
- **Rinnovo scorrevole**: ogni richiesta autenticata aggiorna `last_seen_at` sul server (la scadenza di `SESSION_MAX_AGE_S` scorre in avanti a ogni uso); quando la firma del token ha più di 24 ore il server emette un nuovo token nell'intestazione `X-Renewed-Token` (esposta via CORS per l'app autonoma) o aggiorna il cookie `fitweek_session`.
- Blob (`/api/state`):
  - `groceries[]` e `inventory[]` accettano `amount` (numero ≥ 0, facoltativo) e `unit` (`g`, `kg`, `ml`, `l`, `pz`, `conf`, o stringa vuota), oltre a `qty` testuale; `groceries[].price` può essere `null` o `0` quando non inserito dall'utente.
  - `meals[Giorno].items` contiene gli ingredienti strutturati del piano `[{name, amount, unit, category, slot}]` usati da `Genera dal piano` (`fabbisogno − dispensa`, escludendo i secondi delle cene lun–ven).
