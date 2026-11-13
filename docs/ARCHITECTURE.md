# Architettura

## Attuale (1.10.5, verificata sul codice il 2026-11-13)

Ogni componente, endpoint e tabella citato qui esiste nel repository. Ciò che non esiste ancora è solo nella sezione "Non implementato". Dettagli: `docs/API.md` (rotte), `docs/DATA_MODEL.md` (schema), `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/DECISIONS.md` (perché).

```
 Browser (webapp)             Android "stable" (M6)            Android "next" (1.9, IN PROVA)
 pagine servite dal server    shell Capacitor: WebView che     pagine DENTRO l'APK (scripts/bundle-www.sh),
 stessa origine               carica la webapp da server.url   origine http(s)://localhost
 cookie HttpOnly              cookie HttpOnly                  token Bearer nel Keystore (plugin SecureToken)
 nessuna copia offline        pagina offline.html + notifiche  copia locale delle GET, coda, "Lavora offline",
                              locali dei promemoria            notifiche locali dei promemoria
        │ stessa origine              │ stessa origine                 │ CORS solo per APP_ORIGINS
        └──────────────┬──────────────┴────────────────────────────────┘
                       ▼
 uvicorn :8080 ─ FastAPI `app.main:create_app` (container `fitweek`, utente non root, healthcheck /api/health)
   middleware: header di sicurezza, CSP sulle pagine HTML, rinnovo del token, log JSON
   app/main.py       login/logout, sessioni, /api/state, backup/restore, download APK, file statici
   app/workouts.py   /api/v1: today, workout-sessions, serie, program-week
   app/daily.py      /api/v1: meal-logs, meal-templates, foods, takeaway, reminders, agenda, weekly-summary
   app/tracking.py   /api/v1: sleep, exercise-notes, grocery-spend
   app/foodsearch.py /api/v1/food-search → Open Food Facts (unica chiamata verso l'esterno, FOOD_SEARCH=off la spegne)
   app/domain.py     regole pure (settimana del programma, giorno A/B/C, serie previste)
   app/schemas.py    modelli Pydantic · app/security.py sessioni, limite ai tentativi, Origin, CSP
   app/migrations.py migrazioni versionate con backup prima di ognuna · app/db.py connessione, transazioni, snapshot
                       ▼
 SQLite (WAL) /data/fitweek.sqlite — volume Docker esterno `fitweek_data`, schema 9
   app_state (blob JSON versionato) · workout_sessions, set_logs, set_tombstones · meal_logs, meal_templates, foods
   reminders, reminder_acks · sleep_logs, exercise_notes, grocery_spend · sessions · schema_migrations
```

Esposizione: solo LAN, `192.168.222.200:8088 → 8080`, HTTP non cifrato (rischio noto, `docs/SECURITY.md`). Nessun reverse proxy, nessun accesso da Internet.

### Dove vivono i dati (modello ibrido)

| Dominio | Dove | Scrittura | Concorrenza tra dispositivi |
|---|---|---|---|
| Profilo, scheda (`routines`), piano pasti, lista spesa, dispensa, pesate | blob `app_state` | `PUT /api/state` con l'intero stato e la versione letta | controllo ottimistico: 409 se la versione è cambiata, poi fusione a tre vie nel client (`static/js/sync.js`) |
| Sedute e serie | `workout_sessions`, `set_logs`, `set_tombstones` | una richiesta per serie (`PUT`/`DELETE` idempotenti) | vince l'ultima modifica **fatta**: `X-Edited-At` al millisecondo; un'eliminazione lascia un segno |
| Diario pasti, sonno, note esercizi | `meal_logs`, `sleep_logs`, `exercise_notes` | `PUT`/`DELETE` per voce | come sopra (`X-Edited-At`) |
| Pasti abituali, catalogo alimenti, promemoria e risposte, spesa pagata | `meal_templates`, `foods`, `reminders`, `reminder_acks`, `grocery_spend` | `PUT`/`DELETE` per voce | vince l'ultima arrivata |
| Accessi | `sessions` | login, logout, revoca | — |

Il campo `workouts` del blob è congelato: la migrazione 4 lo ha copiato in tabella e non viene più scritto. Estrarre altri domini dal blob si fa solo quando un rischio verificato lo giustifica (D-003).

### Autenticazione e sessioni

1. `POST /api/login {password, client?}`: password unica da variabile d'ambiente, confronto a tempo costante, al massimo 5 errori al minuto per indirizzo. Crea una riga in `sessions` e firma il suo id (itsdangerous).
2. Webapp e Android `stable`: il token viaggia nel cookie `HttpOnly`, `SameSite=Lax` (`Secure` con `COOKIE_SECURE=true`). Android `next` (`client: "app"`): il token è nella risposta, l'app lo tiene nel Keystore e lo manda come `Authorization: Bearer`.
3. Ogni richiesta autenticata verifica firma e riga in `sessions`; la sessione scade dopo 30 giorni senza uso. Dopo 24 ore il server emette un token con firma fresca (cookie nuovo, oppure intestazione `X-Renewed-Token` per l'app).
4. Le scritture controllano `Origin`: deve coincidere con l'host servito oppure essere una delle `APP_ORIGINS`.
5. Le sessioni sono **revocabili**: `POST /api/logout` (questa), `POST /api/logout-all`, `GET`/`DELETE /api/v1/sessions` (elenco dei dispositivi e revoca di uno).
6. Uscita lato client (`static/js/logout.js`, `platform.js`): elimina token, copia locale e coda; non si dà per riuscita se il server non ha revocato o il Keystore non ha eliminato (D-028).

### Frontend

ES modules nativi in `static/js/`, senza build né CDN. Ogni vista (`static/js/views/`) è una funzione che restituisce HTML; `render()` in `main.js` sostituisce `#content` e gli eventi sono gestiti per delega su `document`. La CSP vieta script e stili in linea: le dimensioni dinamiche passano da attributi `data-*` (`applyDynamicStyles`).

Moduli che fanno da contratto: `api.js` (unico punto HTTP, tempi massimi e stato offline nell'app), `store.js` (stato a blob, salvataggi in coda, conflitti), `workout/queue.js` (coda delle scritture per voce), `sync.js` (fusione a tre vie, oggi e agenda senza rete), `platform.js` (webapp o app, indirizzo del server, token), `cache.js` (copia locale delle GET, solo app), `backup.js` (cosa sostituisce un ripristino), `stats.js`/`timeline.js`/`schedule.js` (calcoli puri).

### Scritture offline e sincronizzazione

- **Scritture per voce** (sedute, serie, pasti, risposte ai promemoria, note degli esercizi, correzioni fatte da Progressi): entrano in una coda in `localStorage` con l'orario in cui sono state fatte. Errori di rete, 5xx e 429 si ritentano senza limite; un 4xx sposta l'operazione in "Modifiche non inviate" (Impostazioni → Dati e accesso), mai nel nulla (D-022). Alla risposta si toglie dalla coda solo l'operazione inviata (D-026).
- **Stato a blob**: resta in attesa sul dispositivo finché il server non lo accetta; su 409 il client rilegge, fonde (elenchi per id, piano pasti per giorno → pasto → ingrediente) e segnala i conflitti; una voce eliminata da una parte e modificata dall'altra resta (D-026).
- **Solo nell'app `next`**: le letture senza rete rispondono con l'ultima copia locale e l'app lo segnala. La webapp nel browser non ha copia offline delle pagine né delle letture: ha solo le due code qui sopra.
- **Promemoria**: con l'app aperta li controlla `reminders.js` ogni minuto; a schermo spento esistono solo come notifiche locali programmate dalle app Android (`native.js`, `schedule.js`).

### Backup e ripristino

| Cosa | Come | Contenuto |
|---|---|---|
| Backup SQLite | `scripts/backup.sh` (API di backup di SQLite, `integrity_check`) → `/opt/backups/fitweek/` | tutto il database |
| Backup fuori disco | `scripts/backup-offsite.sh` (cifrato, con verifica) → `OFFSITE_DEST`, da configurare | ultimo backup SQLite + chiave di firma dell'APK |
| Prima di una migrazione | automatico in `app/migrations.py` → `/data/backups/pre-migration-*.sqlite` | tutto il database |
| Prima di un ripristino JSON | automatico in `POST /api/v1/restore` → `/data/backups/pre-restore-*.sqlite` | tutto il database |
| Esportazione JSON | `GET /api/backup` (`fitweek-backup-v4`, una sola lettura coerente del DB) | i dati dell'utente; **non** contiene accessi, risposte ai promemoria, segni di eliminazione, voci già eliminate |
| Ripristino SQLite | `scripts/restore.sh <file>` (a mano, con conferma) | sostituisce tutto |
| Ripristino JSON | `POST /api/v1/restore` (formati v1–v4) | sostituisce stato e sedute sempre; gli altri domini **solo se presenti nel file**, altrimenti restano (matrice in `docs/API.md`); l'app lo dice prima della conferma |

### Compatibilità tra app Android e server

- `stable` carica le pagine dal server: segue sempre la versione installata sul server, l'APK va ricompilato solo se cambia `mobile/`.
- `next` contiene le pagine: ogni modifica al frontend richiede un nuovo APK, e se il frontend usa qualcosa di nuovo del server (rotta, campo, intestazione) l'APK va compilato **dopo** il deploy. Non esiste un controllo automatico di versione minima tra APK e server.
- Nessun APK è stato ancora provato su un telefono reale dopo la 1.10.2 (`docs/ANDROID_CHECKLIST.md`).

### Non implementato (pianificato o solo ipotizzato)

Service worker e PWA installabile; copia offline nella webapp da browser; accesso da Internet con HTTPS; assistente AI (M8) e lettura del menu della mensa sul telefono; importazione del sonno da Health Connect; estrazione dal blob di pesate, spesa e dispensa; controllo di versione tra APK e server.

---

## Storico

Le sezioni che seguono descrivono il progetto com'era o come si pensava di farlo evolvere. Restano per capire le decisioni: **non descrivono il sistema attuale**.

### Architettura al 2026-11-09 (prima di M1)

```
Browser (SPA vanilla, static/app.js)
   │  fetch JSON, cookie fitweek_session
   ▼
uvicorn :8080 ── FastAPI (main.py)
   │  - /api/login, /api/logout (cookie firmato itsdangerous, 30 gg)
   │  - /api/state GET/PUT (intero stato JSON + versione)
   │  - /api/backup, /api/original-pdf, /api/health
   │  - / e /static (file statici, non protetti)
   ▼
SQLite /data/fitweek.sqlite (WAL) ── tabella app_state: 1 riga {version, json}
   ▲
volume Docker fitweek-app_fitweek_data
```

Caratteristiche:
- **Stato client-centrico**: il browser carica tutto lo stato, lo modifica in memoria e lo rimanda intero a ogni modifica (`persist()`), con controllo ottimistico sulla versione (409 se cambiata).
- **Logica di dominio nel frontend**: calcolo serie per settimana, giorno A/B/C di oggi, totali spesa, grafico peso. Il backend è un archivio di documenti autenticato.
- Rendering: ogni vista è una funzione che restituisce una stringa HTML; `render()` sostituisce `#content.innerHTML`; eventi gestiti per delega su `window`.
- Auth: password unica da env, confronto a tempo costante, cookie HttpOnly SameSite=Lax, `Secure` opzionale (`COOKIE_SECURE`).

Limiti strutturali: vedi `AUDIT-2026-11-09.md` (blob unico, nessuna validazione, file minificati, logica nel client).

### Obiettivo dichiarato il 2026-11-09 (in parte realizzato in altra forma)

```
static/                      ES modules nativi, nessun build step
  index.html, manifest.webmanifest, sw.js (M6)
  css/tokens.css, base.css, components.css
  js/main.js, api.js, store.js, router.js, ui/*.js, views/*.js, domain/*.js
app/                         backend a moduli
  main.py                    crea app, middleware, monta router
  config.py                  env e costanti
  security.py                sessioni, rate limit, header
  db.py                      connessione, PRAGMA, transazioni
  migrations/NNN_*.sql|py    migrazioni versionate + runner
  routers/                   auth, state (legacy), workouts, body, meals, shopping, backup
  schemas/                   modelli Pydantic
  services/                  logica di dominio (programma, settimana corrente, spesa)
tests/                       pytest (API) + test JS di dominio (node:test)
scripts/                     backup.sh, restore.sh, check.sh
```

Principi:
1. **Strangler pattern**: si estraggono un dominio alla volta dal blob JSON verso tabelle dedicate, iniziando dagli allenamenti (dati più preziosi e più voluminosi). Finché un dominio non è migrato resta nel blob e l'API `/api/state` rimane compatibile.
2. **Logica di dominio dove serve**: regole che devono essere coerenti (settimana del programma, serie previste, totali) diventano funzioni pure testate; quelle server-side in `services/`.
3. **Scritture granulari** per gli allenamenti: ogni serie registrata è un `POST` idempotente (UUID generato dal client), così nessun dato si perde a metà seduta e non ci sono conflitti con altri domini.
4. **Offline-tolerant** per la sola schermata allenamento: coda locale delle serie non inviate (localStorage → IndexedDB in M6), sincronizzata al ritorno della rete.
5. **AI come modulo isolato** (M8): `services/assistant/` con provider configurabile, disattivato se manca la configurazione; legge dati tramite funzioni di sola lettura e produce proposte che l'utente approva.

### Flusso di autenticazione al 2026-11-09 (sostituito)

1. `GET /` serve la SPA; `load()` chiama `GET /api/state`.
2. 401 → schermata di login → `POST /api/login {password}` → cookie `fitweek_session` = firma di `'authorized'`.
3. Ogni chiamata autenticata verifica firma ed età ≤ 30 gg. Le scritture verificano anche `Origin == Host`.
4. Logout cancella il cookie lato client; il token resta valido fino a scadenza (da correggere in M1 con un "session epoch" lato server).
