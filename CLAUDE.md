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

## Stack reale (aggiornato con 1.10.2, 2026-11-12)

- Backend: Python 3.12, FastAPI 0.128, uvicorn (`app.main:create_app --factory`), Pydantic, itsdangerous (firma ID sessione). Sessioni server-side revocabili per singolo dispositivo (`/api/v1/sessions`) con rinnovo automatico a scorrimento (`X-Renewed-Token` / cookie dopo 24 h), rate limit login, CSP senza `unsafe-inline` + header di sicurezza, log JSON.
- DB: SQLite (WAL) `/data/fitweek.sqlite`. Migrazioni versionate in `app/migrations.py` con backup automatico pre-migrazione (schema 8).
  - Allenamenti: tabelle `workout_sessions` + `set_logs` (API `/api/v1/...`, scritture idempotenti per serie).
  - Pasti composti (1.6): `meal_logs.items` = vassoio di voci {name, category, qty, kcal/protein per porzione, source, takeaway}; i totali del pasto sono SEMPRE ricalcolati dal server dalle voci, escluse quelle "porto a casa" (il secondo della mensa, che si conta a cena: `/api/v1/takeaway`). Catalogo `foods` per categoria come il menu della mensa (Primi, Salse, Secondi, Contorni, Piatto unico, Frutta, Dessert, Pane, Altro), seminato con stime e che impara i piatti inseriti. Abitudine utente: dopo la palestra ~2 pagnottine (~200 g) con il secondo.
  - Tutto ciò che si registra è modificabile dopo (pasti dal diario → editor `static/js/composer.js`; pesate e sedute passate da Progressi), con ricalcolo immediato di totali, medie e volumi.
  - Pasti e giornata (M4): `meal_logs` (diario), `meal_templates` (pasti abituali con valori marcati `estimate|label|manual`), `reminders` (un promemoria per ogni evento della routine, modificabili) + `reminder_acks` (fatto/non oggi/posticipa). `/api/v1/agenda` segna da solo come fatti i promemoria quando il pasto/pesata/seduta viene registrato; `/api/v1/weekly-summary` dà calorie e proteine **teoriche** con la copertura dei dati.
  - Dati leggeri della routine (1.8, `app/tracking.py`): `sleep_logs` (per giorno di risveglio, durata calcolata), `exercise_notes`, `grocery_spend` (totale reale per settimana). Ricerca prodotti su Open Food Facts lato server (`app/foodsearch.py`, D-018, fonte `off`, `FOOD_SEARCH=off` per spegnerla): è l'UNICA chiamata verso l'esterno.
  - Altri domini (profilo con i riferimenti `proteinTarget`/`kcalTarget` scelti dall'utente, scheda `routines`, pasti con ingredienti strutturati `items`, lista spesa e dispensa con quantità numerica `amount` e unità `unit`, pesate): ancora nel blob JSON `app_state` (`/api/state`, controllo 409), validato da `app/schemas.py`. Il campo `workouts` del blob è congelato (copiato in tabella dalla migrazione 4, non più scritto).
- Frontend: ES modules nativi senza build né CDN (`static/js/`), CSS a token con tema chiaro/scuro (`static/css/`). Coda offline idempotente per le scritture di allenamento e pasti: nessuna operazione viene buttata (errori di rete/5xx/429 ritentati senza limite; i 4xx finiscono in "Modifiche non inviate" in Impostazioni → Dati e accesso); ogni operazione porta l'orario in cui è stata fatta (`X-Edited-At`) e il server non la applica sopra un dato modificato più di recente (D-022). Lo stato a blob resta in attesa sul dispositivo per ogni errore non definitivo; la fusione a tre vie (`static/js/sync.js`) segnala i conflitti. Un esercizio è completato solo su conferma dell'utente (D-023). Timer recupero basato su orario di fine. **Nessun attributo `style` nell'HTML generato** (lo vieta la CSP, c'è un test): le dimensioni dinamiche passano da `data-pct-h`/`data-pct-w`/`data-vars`, applicate da `applyDynamicStyles()` in `static/js/ui.js`. Progressi (1.7): calcoli puri in `static/js/stats.js` (media mobile 7 giorni, storia e record per esercizio, costanza, proposta spesa dal piano `planProposal`), grafico a linea riusabile in `static/js/chart.js`. Interfaccia a schede (1.10): ogni vista usa `tabs()` di `static/js/ui.js` per la navigazione interna (stato nel proprio `ui`); in Oggi la scheda contestuale "Adesso" (`pickNowFocus` in `static/js/timeline.js`) mostra l'azione rilevante in corso o imminente senza duplicare il pulsante della palestra; il grafico a linea è un segnaposto disegnato alla larghezza reale da `mountCharts()` (chiamata da `render()` in `main.js`). `static/js/reminders.js`: controlla l'agenda ogni minuto **con l'app aperta** e apre il popup giusto (`<dialog>`); nessuna notifica a schermo spento finché non c'è l'app nativa (D-013).
- App Android autonoma (1.9, canale `next`, IN PROVA, D-021, D-024): le pagine di `static/` entrano nell'APK (`scripts/bundle-www.sh` + `scripts/build-apk.sh URL next`), l'app chiama il server con token `Bearer` (login `client: "app"`, CORS solo per `APP_ORIGINS`) custodito nell'Android Keystore tramite plugin nativo `SecureToken` (migrazione automatica da `localStorage` e pulizia completa all'uscita). `static/js/platform.js` (dove gira il frontend, indirizzo del server, token cifrato, avviso se l'indirizzo è `http://`), `static/js/cache.js` (copia locale delle GET), `static/js/sync.js` (regole pure: fusione a tre vie dello stato, oggi e agenda senza rete). Le richieste dell'app hanno un tempo massimo e all'avvio, se il server tace, compare "Lavora offline" (D-023). **Ogni modifica al frontend richiede di ricompilare l'APK `next`**, e se il frontend usa qualcosa di nuovo del server (endpoint, campo, intestazione) l'APK va compilato solo dopo il deploy. La webapp non cambia comportamento: `standalone` è falso e il token non le arriva mai.
- App Android (M6, canale `stable`): shell Capacitor 6 in `mobile/` che carica la webapp da `server.url` (HTTP LAN, cleartext) e programma **notifiche locali** dei promemoria (prossimi 14 giorni, riallineate a ogni apertura/modifica senza vuoto intermedio) tramite `static/js/native.js` + `static/js/schedule.js` (funzione pura). Pagina offline inclusa nell'APK. Build in Docker con `scripts/build-apk.sh` → `mobile/dist/` (bind mount in sola lettura su `/app/downloads`), download dopo login da Impostazioni. Chiave di firma in `/opt/fitweek-secrets/` (mai nel repo; perderla = non poter aggiornare l'app installata). Checklist di prova su telefono reale in `docs/ANDROID_CHECKLIST.md`.
- Test: pytest (`tests/`, 85; con date ISO validate davvero, non solo nel formato) + test JS puri (`tests/js/*.test.mjs`, 44, `node --test`) via `scripts/check.sh`; e2e Playwright (`tests/e2e/*.e2e.js`, 136 controlli in 6 file, `reliability` = errori del server, rifiuti, memoria piena, scheda "Adesso" e generazione lista dal piano; l'app autonoma è provata con le pagine servite da un'altra origine; `E2E_ONLY=nome` per un solo file; Open Food Facts simulato; indipendenti dal giorno della settimana, incluso un bridge Capacitor simulato, viewport iPhone + desktop, un container nuovo per file) via `scripts/e2e.sh`. I test e2e disattivano i promemoria predefiniti per non dipendere dall'ora reale.

## Struttura

```
app/main.py          create_app(): middleware, auth, /api/state, backup/restore, static
app/workouts.py      API v1 allenamenti (today, sedute, serie, settimana programma)
app/daily.py         API v1 giornata: diario pasti, pasti abituali, promemoria/agenda, riepilogo settimanale
app/tracking.py      API v1 sonno, note per esercizio, spesa reale settimanale
app/foodsearch.py    ricerca prodotti su Open Food Facts (proxy lato server, cache, limite al minuto)
app/domain.py        regole pure: settimana programma, giorno A/B/C, serie previste
app/migrations.py    migrazioni versionate + backup pre-migrazione
app/schemas.py       modelli Pydantic (extra=forbid)
app/security.py      sessioni, rate limit, Origin, CSP/header
app/config.py, db.py, logging_setup.py, seed.py
static/index.html    shell; static/css/tokens.css (colori/spazi), app.css (componenti)
static/js/main.js    avvio, routing hash, delega eventi alla vista attiva
static/js/{api,store,ui,util,constants}.js
static/js/{platform,cache,sync}.js  app autonoma: ambiente e token, copia locale, fusione e giorno senza rete
static/js/stats.js   calcoli puri (medie, record, costanza, tacche); static/js/chart.js grafico a linea SVG
static/js/timeline.js  linea del tempo di Oggi: calcoli puri + puntatore live
static/js/views/     dashboard (riquadri, linea del tempo live, settimana), training (logger), meals (diario/piano/abituali), shopping, progress, settings (+ promemoria)
static/js/reminders.js  motore promemoria in app + popup di inserimento rapido (pasto, pesata, altri)
static/js/workout/   queue.js (coda offline), timer.js (recupero + preferenze)
tests/               pytest; tests/e2e/ Playwright
scripts/             backup.sh, backup-offsite.sh, restore.sh, check.sh, e2e.sh, deploy.sh, build-apk.sh [URL] [stable|next], bundle-www.sh (deploy-m1.sh: storico)
mobile/              progetto Capacitor: package.json (versioni esatte), www/offline.html, build/ (Dockerfile + build-inside.sh con SecureTokenPlugin.java)
static/js/native.js  integrazione Android (no-op nel browser); static/js/schedule.js calcolo notifiche
resources/           scheda-originale.pdf
docs/                documentazione (inclusi SECURITY.md e ANDROID_CHECKLIST.md)
```

Design system v3 "sportivo premium, a schede": `docs/DESIGN_SYSTEM.md` (token, icone Lucide in `static/js/icons.js`, movimento in `static/js/motion.js`, grafici secondo la skill dataviz). **Orari sempre a 24 ore**: niente `type="time"`/`type="date"` nativi per i dati frequenti.

Convenzioni frontend: ogni vista esporta `render()` e opzionalmente `onClick/onChange/onInput/onSubmit` (restituiscono `true` per ridisegnare) e `afterRender()` (misure sul DOM, es. puntatore della linea del tempo). I listener delle finestre vanno messi sugli elementi interni, mai su `#modal-body`, che è riusato da tutte le finestre. Ogni valore interpolato passa da `esc()`. Colori solo tramite token.

## Comandi

```bash
# Sintassi + test automatici (container usa-e-getta, nessun dato reale)
scripts/check.sh

# Test end-to-end nel browser (container usa-e-getta su 127.0.0.1:18088)
scripts/e2e.sh

# APK Android (dopo ogni cambio di versione in app/__init__.py o di mobile/)
scripts/build-apk.sh [URL_SERVER] [stable|next]

# Backup coerente del DB live → /opt/backups/fitweek/
scripts/backup.sh <etichetta>

# Backup cifrato fuori disco (DB + chiave APK) con verifica di decifratura
OFFSITE_DEST=/mnt/usb/fitweek scripts/backup-offsite.sh

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
5. **Nutrizione**: non inventare valori nutrizionali o prezzi Esselunga. Ogni valore porta la sua fonte (`estimate`, `label`, `manual`, `off` = Open Food Facts). I riferimenti di proteine e calorie li sceglie l'utente: l'app non li calcola né li suggerisce (D-020). Nessuna prescrizione medica.
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
- UI/UX: `docs/DESIGN_SYSTEM.md`. I test e2e cliccano le schede (`[data-tab=…]`) prima di cercare il contenuto: se sposti un pannello in un'altra scheda, aggiorna il test. API: `docs/API.md`. Architettura: `docs/ARCHITECTURE.md`.

## Git

Repository dedicato in `/opt/fitweek-app` (branch `main`). `.env`, DB e backup sono esclusi da `.gitignore`. Nota: esiste anche un repo git con radice in `/opt` che contiene altri progetti: non usarlo per FitWeek.

## Stato e roadmap

- Audit iniziale: `docs/AUDIT-2026-11-09.md`.
- Milestone e avanzamento: `docs/ROADMAP.md`.
- Problemi noti aperti: traffico HTTP non cifrato in LAN (documentato in `docs/SECURITY.md` con avviso in app e opzioni Tailscale HTTPS / reverse proxy locale); destinazione esterna `OFFSITE_DEST` da configurare per `scripts/backup-offsite.sh`; server raggiungibile solo in LAN (l'app autonoma lavora senza rete e invia al rientro; per sincronizzare fuori casa serve una VPN, l'indirizzo si cambia dalla schermata di accesso); nessun APK provato su un telefono reale (checklist pronta in `docs/ANDROID_CHECKLIST.md`); tappa 2 (modello IA sul telefono per il menu della mensa) da fare; pesate, spesa e dispensa ancora nel blob; stime nutrizionali generiche per i piatti della mensa; sonno solo a mano (importazione dall'orologio via Health Connect da valutare, D-019); prezzi reali per articolo da inserire a mano la prima volta (la lista generata dal piano lascia il prezzo vuoto se non già noto); grafico del girovita e confronto tra settimane (M3); link video `b4` da verificare.
