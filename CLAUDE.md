# CLAUDE.md — FitWeek

Guida operativa per Claude Code. Tienila coerente con il codice: se cambi architettura, schema, API o deploy, aggiorna questo file e il documento in `docs/` corrispondente nello stesso lavoro.

## Cos'è FitWeek

Webapp self-hosted **per un singolo utente** che centralizza allenamento in palestra, alimentazione, spesa/dispensa e progressi corporei. Obiettivo del prodotto: rendere la routine quotidiana semplice, soprattutto **registrare un allenamento dal telefono, con una mano, in pochissimi tocchi**. Tono rispettoso e non giudicante; nessun meccanismo che incentivi comportamenti alimentari estremi.

Dettagli: `docs/PRODUCT_REQUIREMENTS.md` (requisiti e profilo), `docs/TRAINING_PROGRAM.md` (scheda verificata sul PDF).

## Profilo utente (sintesi)

Uomo, 28 anni, 166 cm, peso iniziale 90 kg, lavoro sedentario. Obiettivo: ricomposizione corporea. Nessuna allergia/restrizione. Vive da solo, vuole cucinare poco.

- Lavoro: lun–gio 09–18, ven 09–17; rientro ~18:15.
- Pasti: niente colazione (caffè). Pranzo al lavoro ~13:00 (primo + contorno). Il **secondo del lavoro** (sottovuoto, da microonde, 1 per giorno lavorativo) diventa la cena: non pianificare acquisti di altri secondi per le cene lun–ven.
- Palestra: **lun = A, mer = B, ven = C**, 19:30–22:00, rientro 22:15–22:30. Spuntino leggero pre-gym (banana, yogurt, gallette).
- Weekend poco organizzati: priorità a cene semplici con alimenti in casa.
- Spesa: Esselunga online, consegna lunedì, budget 30–50 €/settimana.
- Sonno: ~00:00 nei giorni di allenamento, ~02:00 negli altri; vuole regolarizzarlo.

I dati corporei cambiano nel tempo: **mai sovrascrivere lo storico**, solo aggiungere misurazioni.

## Stack reale (aggiornato con M2, 2026-11-09)

- Backend: Python 3.12, FastAPI 0.128, uvicorn (`app.main:create_app --factory`), Pydantic, itsdangerous (firma ID sessione). Sessioni server-side revocabili, rate limit login, CSP + header di sicurezza, log JSON.
- DB: SQLite (WAL) `/data/fitweek.sqlite`. Migrazioni versionate in `app/migrations.py` con backup automatico pre-migrazione.
  - Allenamenti: tabelle `workout_sessions` + `set_logs` (API `/api/v1/...`, scritture idempotenti per serie).
  - Pasti e giornata (M4): `meal_logs` (diario), `meal_templates` (pasti abituali con valori marcati `estimate|label|manual`), `reminders` (un promemoria per ogni evento della routine, modificabili) + `reminder_acks` (fatto/non oggi/posticipa). `/api/v1/agenda` segna da solo come fatti i promemoria quando il pasto/pesata/seduta viene registrato; `/api/v1/weekly-summary` dà calorie e proteine **teoriche** con la copertura dei dati.
  - Altri domini (profilo, scheda `routines`, pasti, spesa, dispensa, pesate): ancora nel blob JSON `app_state` (`/api/state`, controllo 409), validato da `app/schemas.py`. Il campo `workouts` del blob è congelato (copiato in tabella dalla migrazione 4, non più scritto).
- Frontend: ES modules nativi senza build né CDN (`static/js/`), CSS a token con tema chiaro/scuro (`static/css/`). Coda offline idempotente per le scritture di allenamento e pasti, timer recupero basato su orario di fine. `static/js/reminders.js`: controlla l'agenda ogni minuto **con l'app aperta** e apre il popup giusto (`<dialog>`); nessuna notifica a schermo spento finché non c'è l'app nativa (D-013).
- Test: pytest (`tests/`, 50) via `scripts/check.sh`; e2e Playwright (`tests/e2e/*.e2e.js`, 36 controlli, viewport iPhone + desktop, un container nuovo per file) via `scripts/e2e.sh`. I test e2e disattivano i promemoria predefiniti per non dipendere dall'ora reale.

## Struttura

```
app/main.py          create_app(): middleware, auth, /api/state, backup/restore, static
app/workouts.py      API v1 allenamenti (today, sedute, serie, settimana programma)
app/daily.py         API v1 giornata: diario pasti, pasti abituali, promemoria/agenda, riepilogo settimanale
app/domain.py        regole pure: settimana programma, giorno A/B/C, serie previste
app/migrations.py    migrazioni versionate + backup pre-migrazione
app/schemas.py       modelli Pydantic (extra=forbid)
app/security.py      sessioni, rate limit, Origin, CSP/header
app/config.py, db.py, logging_setup.py, seed.py
static/index.html    shell; static/css/tokens.css (colori/spazi), app.css (componenti)
static/js/main.js    avvio, routing hash, delega eventi alla vista attiva
static/js/{api,store,ui,util,constants}.js
static/js/views/     dashboard (agenda + settimana), training (logger), meals (diario/piano/abituali), shopping, progress, settings (+ promemoria)
static/js/reminders.js  motore promemoria in app + popup di inserimento rapido (pasto, pesata, altri)
static/js/workout/   queue.js (coda offline), timer.js (recupero + preferenze)
tests/               pytest; tests/e2e/ Playwright
scripts/             backup.sh, restore.sh, check.sh, e2e.sh (deploy-m1.sh: storico)
resources/           scheda-originale.pdf
docs/                documentazione
```

Convenzioni frontend: ogni vista esporta `render()` e opzionalmente `onClick/onChange/onInput/onSubmit` (restituiscono `true` per ridisegnare). Ogni valore interpolato passa da `esc()`. Colori solo tramite token.

## Comandi

```bash
# Sintassi + test automatici (container usa-e-getta, nessun dato reale)
scripts/check.sh

# Test end-to-end nel browser (container usa-e-getta su 127.0.0.1:18088)
scripts/e2e.sh

# Backup coerente del DB live → /opt/backups/fitweek/
scripts/backup.sh <etichetta>

# Stato del container live (sola lettura)
docker ps --filter name=fitweek ; docker inspect fitweek --format '{{.State.Health.Status}}'

# Prova manuale isolata: container usa-e-getta, DB temporaneo, porta solo su localhost
docker run --rm -p 127.0.0.1:18088:8080 -e APP_PASSWORD=... -e SESSION_SECRET=... -e DB_PATH=/tmp/t.sqlite fitweek:test
```

Build/deploy: `scripts/deploy.sh` (dettagli in `docs/DEPLOYMENT.md`). **Il deploy sull'istanza in uso richiede autorizzazione esplicita dell'utente**; il classificatore dei permessi di Claude Code blocca il deploy anche se autorizzato a voce: in quel caso l'utente lo lancia con `! scripts/deploy.sh`.

## Regole non negoziabili

1. **Dati**: mai operazioni distruttive o migrazioni sul DB reale senza backup coerente verificato e consenso. Migrazioni solo additive e idempotenti, aggiunte in coda a `MIGRATIONS` con test su DB legacy. Lo stato JSON contiene anche le `routines`: correggere `app/seed.py` NON aggiorna il DB esistente, serve una migrazione dati. Ogni nuovo campo del frontend va aggiunto a `app/schemas.py`, altrimenti il salvataggio riceve 422.
2. **Infrastruttura**: mapping porta `192.168.222.200:8088:8080` (la 8080 dell'host è occupata da un altro servizio). Volume **esterno** `fitweek_data`. Mantenere l'healthcheck. Non toccare altri container, reti o volumi del server. Il vecchio volume `fitweek-app_fitweek_data` è conservato come copia di sicurezza: non rimuoverlo senza autorizzazione.
3. **Segreti**: mai leggere/stampare/committare `.env`, password, `SESSION_SECRET`, chiavi API. Usa solo `.env.example` con placeholder.
4. **Scheda allenamento**: il PDF è la fonte autorevole. Non modificare serie/ripetizioni/progressioni di propria iniziativa. Le frequenze cardiache del PDF non sono obiettivi personalizzati.
5. **Nutrizione**: non inventare valori nutrizionali o prezzi Esselunga. Ogni valore stimato va marcato come tale (`source: estimate`). Nessuna prescrizione medica.
6. **Esselunga**: nessuna integrazione/scraping/acquisto automatico; eventuale modulo separato e solo con fonti legittime.
7. **AI**: opzionale, disattivata di default, chiavi solo backend, nessun invio di dati personali senza consenso, nessuna modifica dati senza conferma.
8. **Esposizione**: niente accesso da Internet senza HTTPS, reverse proxy e protezioni adeguate.
9. **Onestà**: distinguere implementato / parziale / pianificato / da verificare. Mai dichiarare test eseguiti se non lo sono.

## Standard di sviluppo

- Niente riscritture totali né cambi di stack senza motivazione documentata in `docs/DECISIONS.md`.
- Funzioni piccole, nomi chiari, costanti e configurazione centralizzate, nessun codice morto, nessuna dipendenza superflua.
- Backend: validazione con Pydantic, errori 4xx espliciti (mai 500 per input malformato), logging strutturato.
- Frontend: ogni valore interpolato in HTML passa da `esc()`; URL esterni solo `https:`; componenti riutilizzabili; mobile-first.
- Per ogni modifica significativa: comportamento precedente → risultato atteso → implementazione → test → regressioni → docs.
- UI/UX: `docs/DESIGN_SYSTEM.md`. API: `docs/API.md`. Architettura: `docs/ARCHITECTURE.md`.

## Git

Repository dedicato in `/opt/fitweek-app` (branch `main`). `.env`, DB e backup sono esclusi da `.gitignore`. Nota: esiste anche un repo git con radice in `/opt` che contiene altri progetti: non usarlo per FitWeek.

## Stato e roadmap

- Audit iniziale: `docs/AUDIT-2026-11-09.md`.
- Milestone e avanzamento: `docs/ROADMAP.md`.
- Problemi noti aperti: promemoria solo con app aperta (notifiche vere con l'app Capacitor, D-013: serve scelta Android/iOS e HTTPS); pesate, spesa e dispensa ancora nel blob; stime nutrizionali generiche da correggere con le etichette reali; stili inline residui (CSP `style-src 'unsafe-inline'`); RIR/RPE senza UI; link video `b4` da verificare.
