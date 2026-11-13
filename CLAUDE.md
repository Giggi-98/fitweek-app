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

## Stack reale (aggiornato con 1.11.0, 2026-11-13)

- Backend: Python 3.12, FastAPI 0.128, uvicorn (`app.main:create_app --factory`), Pydantic, itsdangerous (firma ID sessione). Sessioni server-side revocabili per singolo dispositivo (`/api/v1/sessions`) con rinnovo automatico a scorrimento (`X-Renewed-Token` / cookie dopo 24 h), rate limit login, CSP senza `unsafe-inline` + header di sicurezza, log JSON.
- DB: SQLite (WAL) `/data/fitweek.sqlite`. Migrazioni versionate in `app/migrations.py` con backup automatico pre-migrazione (schema 9).
  - Allenamenti: tabelle `workout_sessions` + `set_logs` (API `/api/v1/...`, scritture idempotenti per serie) + `set_tombstones` (1.10.3): l'eliminazione di una serie lascia un segno con l'orario, così un `PUT` offline più vecchio non la ricrea. Gli orari delle modifiche (`X-Edited-At`) si confrontano al millisecondo (1.10.4).
  - Pasti composti (1.6): `meal_logs.items` = vassoio di voci {name, category, qty, kcal/protein per porzione, source, takeaway}; i totali del pasto sono SEMPRE ricalcolati dal server dalle voci, escluse quelle "porto a casa" (il secondo della mensa, che si conta a cena: `/api/v1/takeaway`). Catalogo `foods` per categoria come il menu della mensa (Primi, Salse, Secondi, Contorni, Piatto unico, Frutta, Dessert, Pane, Altro), seminato con stime e che impara i piatti inseriti. Abitudine utente: dopo la palestra ~2 pagnottine (~200 g) con il secondo.
  - Tutto ciò che si registra è modificabile dopo (pasti dal diario → editor `static/js/composer.js`; pesate e sedute passate da Progressi), con ricalcolo immediato di totali, medie e volumi.
  - Pasti e giornata (M4): `meal_logs` (diario), `meal_templates` (pasti abituali con valori marcati `estimate|label|manual`), `reminders` (un promemoria per ogni evento della routine, modificabili) + `reminder_acks` (fatto/non oggi/posticipa). `/api/v1/agenda` segna da solo come fatti i promemoria quando il pasto/pesata/seduta viene registrato; `/api/v1/weekly-summary` dà calorie e proteine **teoriche** con la copertura dei dati.
  - Dati leggeri della routine (1.8, `app/tracking.py`): `sleep_logs` (per giorno di risveglio, durata calcolata), `exercise_notes`, `grocery_spend` (totale reale per settimana). Ricerca prodotti su Open Food Facts lato server (`app/foodsearch.py`, D-018, fonte `off`, `FOOD_SEARCH=off` per spegnerla): è l'UNICA chiamata verso l'esterno.
  - Altri domini (profilo con i riferimenti `proteinTarget`/`kcalTarget` scelti dall'utente, scheda `routines`, pasti con ingredienti strutturati `items`, lista spesa e dispensa con quantità numerica `amount` e unità `unit`, pesate): ancora nel blob JSON `app_state` (`/api/state`, controllo 409), validato da `app/schemas.py`. Il campo `workouts` del blob è congelato (copiato in tabella dalla migrazione 4, non più scritto).
- Frontend: ES modules nativi senza build né CDN (`static/js/`), CSS a token con tema chiaro/scuro (`static/css/`). Coda offline idempotente per le scritture di allenamento e pasti: nessuna operazione viene buttata (errori di rete/5xx/429 ritentati senza limite; i 4xx finiscono in "Modifiche non inviate" in Impostazioni → Dati e accesso); ogni operazione porta l'orario in cui è stata fatta (`X-Edited-At`) e il server non la applica sopra un dato modificato più di recente (D-022). Alla risposta la coda toglie solo l'operazione inviata: una modifica più recente con la stessa chiave, arrivata mentre la prima era in volo, resta e parte subito dopo (D-026). Lo stato a blob resta in attesa sul dispositivo per ogni errore non definitivo; la fusione a tre vie (`static/js/sync.js`) segnala i conflitti: elenchi per id, piano pasti per giorno → pasto → ingrediente, e una voce eliminata da una parte ma modificata dall'altra resta sempre (D-026). L'uscita (`static/js/logout.js`) elimina tutto dal dispositivo, ma con modifiche non inviate chiede prima conferma, e non si dà mai per riuscita se non lo è (1.10.4, D-028; 1.10.6, D-031): se il server non revoca la sessione o il Keystore non elimina il token, l'utente viene avvisato e il token rimasto non viene più usato. L'uscita è fail-closed: eliminazione non confermata → marcatore su due canali (localStorage + cookie WebView, mai il token); se nessun canale registra, all'avvio l'app non rientra da sola e il token viene eliminato senza essere usato. Se non c'è né revoca sul server, né eliminazione, né marcatore, l'uscita non si conclude: l'utente resta collegato e viene avvisato, nulla viene eliminato (1.10.7, D-032). Un esercizio è completato solo su conferma dell'utente (D-023). Timer recupero basato su orario di fine. **Nessun attributo `style` nell'HTML generato** (lo vieta la CSP, c'è un test): le dimensioni dinamiche passano da `data-pct-h`/`data-pct-w`/`data-vars`, applicate da `applyDynamicStyles()` in `static/js/ui.js`. Progressi (1.7): calcoli puri in `static/js/stats.js` (media mobile 7 giorni, storia e record per esercizio, costanza, proposta spesa dal piano `planProposal`), grafico a linea riusabile in `static/js/chart.js`. Interfaccia a schede (1.10): ogni vista usa `tabs()` di `static/js/ui.js` per la navigazione interna (stato nel proprio `ui`; da tastiera Tab si ferma sulla scheda attiva e frecce/Inizio/Fine scelgono le altre, 1.10.5); ogni scheda dichiara il pannello che comanda (`aria-controls`) e il contenuto è avvolto da `tabpanel()` (`role="tabpanel"`, `aria-labelledby`, 1.10.6, FW-UX-002); `tabs()` si usa solo con un pannello, una scelta senza pannello (tema, giornata A/B/C) usa `choices()` (`radiogroup`, 1.10.7). in Oggi la scheda contestuale "Adesso" (`pickNowFocus` in `static/js/timeline.js`) mostra l'azione rilevante in corso o imminente senza duplicare il pulsante della palestra; il grafico a linea è un segnaposto disegnato alla larghezza reale da `mountCharts()` (chiamata da `render()` in `main.js`). `static/js/reminders.js`: controlla l'agenda ogni minuto **con l'app aperta** e apre il popup giusto (`<dialog>`); nessuna notifica a schermo spento finché non c'è l'app nativa (D-013).
- App Android autonoma (1.9, canale `next`, IN PROVA, D-021, D-024): le pagine di `static/` entrano nell'APK (`scripts/bundle-www.sh` + `scripts/build-apk.sh URL next`), l'app chiama il server con token `Bearer` (login `client: "app"`, CORS solo per `APP_ORIGINS`) custodito nell'Android Keystore tramite plugin nativo `SecureToken` (migrazione automatica da `localStorage`, che viene svuotato solo a scrittura nel Keystore confermata, e pulizia completa all'uscita). `static/js/platform.js` (dove gira il frontend, indirizzo del server, token cifrato, avviso se l'indirizzo è `http://`), `static/js/cache.js` (copia locale delle GET), `static/js/sync.js` (regole pure: fusione a tre vie dello stato, oggi e agenda senza rete). Le richieste dell'app hanno un tempo massimo e all'avvio, se il server tace, compare "Lavora offline" (D-023). **Ogni modifica al frontend richiede di ricompilare l'APK `next`**, e se il frontend usa qualcosa di nuovo del server (endpoint, campo, intestazione) l'APK va compilato solo dopo il deploy. La webapp non cambia comportamento: `standalone` è falso e il token non le arriva mai.
- App Android (M6, canale `stable`): shell Capacitor 6 in `mobile/` che carica la webapp da `server.url` (HTTP LAN, cleartext) e programma **notifiche locali** dei promemoria (prossimi 14 giorni, riallineate a ogni apertura/modifica senza vuoto intermedio) tramite `static/js/native.js` + `static/js/schedule.js` (funzione pura). Pagina offline inclusa nell'APK. Build in Docker con `scripts/build-apk.sh` → `mobile/dist/` (bind mount in sola lettura su `/app/downloads`), download dopo login da Impostazioni. Chiave di firma in `/opt/fitweek-secrets/` (mai nel repo; perderla = non poter aggiornare l'app installata). Checklist di prova su telefono reale in `docs/ANDROID_CHECKLIST.md`.
- Aggiornamento dell'app Android (1.11, D-033, entrambi i canali, MAI PROVATO SU TELEFONO): `static/js/update.js` confronta il `versionCode` installato (plugin `App`) con l'APK dello stesso canale sul server (`/api/v1/app/android`, nessuna API nuova; regola pura `pickUpdate`) all'avvio e al ritorno in primo piano; avviso con "Aggiorna" e riga in Impostazioni → App Android. Il plugin nativo `AppUpdate` (in `mobile/build/build-inside.sh`, permesso `REQUEST_INSTALL_PACKAGES`) scarica l'APK con la sessione, ne verifica lo SHA-256 e apre l'installatore di Android: serve sempre la conferma dell'utente e nulla si scarica da solo. Perché l'app proponga l'aggiornamento basta ricompilare l'APK (`mobile/dist` è montato nel container): **compilare un APK lo pubblica agli utenti dell'app**, quindi va fatto solo quando il server che lo deve servire è già aggiornato. Le app fino alla 1.10 non hanno il plugin: primo aggiornamento a mano.
- Test: pytest (`tests/`, 105; con date ISO validate davvero, non solo nel formato) + test JS (`tests/js/*.test.mjs`, 101, `node --test`; coda, token e salvataggi sono provati con browser e rete finti da `tests/js/helpers.mjs`) via `scripts/check.sh`; e2e Playwright (`tests/e2e/*.e2e.js`, 179 controlli in 7 file, `native` = notifiche e aggiornamento dell'app con bridge Capacitor simulato, `ux` = rimozione annullabile anche di più voci, riga della lista, schede da tastiera, relazione scheda–pannello su ogni scheda, gruppi di opzioni e conferma del ripristino, `reliability` = errori del server, rifiuti, memoria piena, scheda "Adesso", generazione lista dal piano, modifica durante l'invio e uscita con modifiche non inviate; l'app autonoma è provata con le pagine servite da un'altra origine; `E2E_ONLY=nome` per un solo file; Open Food Facts simulato; indipendenti dal giorno della settimana, incluso un bridge Capacitor simulato, viewport iPhone + desktop, un container nuovo per file) via `scripts/e2e.sh`. I test e2e disattivano i promemoria predefiniti per non dipendere dall'ora reale.

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
static/js/logout.js  uscita: ultimo invio, conferma se restano modifiche non inviate, pulizia del dispositivo
static/js/backup.js  ripristino da backup JSON: cosa viene sostituito e cosa resta (testo della conferma)
static/js/reminders.js  motore promemoria in app + popup di inserimento rapido (pasto, pesata, altri)
static/js/workout/   queue.js (coda offline), timer.js (recupero + preferenze)
tests/               pytest; tests/e2e/ Playwright
scripts/             backup.sh, backup-offsite.sh, restore.sh, check.sh, e2e.sh, deploy.sh, build-apk.sh [URL] [stable|next], bundle-www.sh (deploy-m1.sh: storico)
mobile/              progetto Capacitor: package.json (versioni esatte), www/offline.html, build/ (Dockerfile + build-inside.sh con SecureTokenPlugin.java e AppUpdatePlugin.java)
static/js/native.js  integrazione Android (no-op nel browser); static/js/schedule.js calcolo notifiche
static/js/update.js  aggiornamento dell'app Android: versione installata contro APK sul server, avvio dell'installazione
resources/           scheda-originale.pdf
docs/                documentazione (inclusi SECURITY.md e ANDROID_CHECKLIST.md)
```

Design system v3 "sportivo premium, a schede": `docs/DESIGN_SYSTEM.md` (token, icone Lucide in `static/js/icons.js`, movimento in `static/js/motion.js`, grafici secondo la skill dataviz). **Orari sempre a 24 ore**: niente `type="time"`/`type="date"` nativi per i dati frequenti.

Convenzioni frontend: ogni vista esporta `render()` e opzionalmente `onClick/onChange/onInput/onSubmit` (restituiscono `true` per ridisegnare) e `afterRender()` (misure sul DOM, es. puntatore della linea del tempo). I listener delle finestre vanno messi sugli elementi interni, mai su `#modal-body`, che è riusato da tutte le finestre. Ogni valore interpolato passa da `esc()`. Colori solo tramite token. Mai un `<button>` dentro una `<label>`: la label contiene solo il controllo e il suo testo, i pulsanti della riga sono fratelli (es. `.shoprow`). Una rimozione fatta con un solo tocco offre "Annulla" nel toast (`takeById`/`putBack` in `static/js/util.js` + `removalToast()` in `static/js/ui.js`, che tiene annullabili anche più rimozioni di fila), non una conferma.

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

1. **Dati**: mai operazioni distruttive o migrazioni sul DB reale senza backup coerente verificato e consenso. Migrazioni solo additive e idempotenti, aggiunte in coda a `MIGRATIONS` con test su DB legacy. Le letture che attraversano più tabelle (export) stanno in `db.snapshot()`. Il ripristino da JSON sostituisce solo i domini presenti nel file (matrice in `docs/API.md`, "API 1.10.5") ed è atomico: un file che viola le chiavi del DB viene rifiutato con 422 e non cambia nulla (1.10.6): un dominio nuovo va aggiunto a `BACKUP_OPTIONAL_DOMAINS` in `app/schemas.py` **e** a `static/js/backup.js` (un test controlla che coincidano). Lo stato JSON contiene anche le `routines`: correggere `app/seed.py` NON aggiorna il DB esistente, serve una migrazione dati. Ogni nuovo campo del frontend va aggiunto a `app/schemas.py`, altrimenti il salvataggio riceve 422.
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

Repository dedicato in `/opt/fitweek-app` (branch `main`), remoto `origin` = `https://github.com/Giggi-98/fitweek-app`. `.env`, DB e backup sono esclusi da `.gitignore`. Nota: esiste anche un repo git con radice in `/opt` che contiene altri progetti: non usarlo per FitWeek. Commit e push su `main` solo quando l'utente li autorizza; mai force push, mai riscrivere la storia pubblicata (il reviewer ragiona per intervalli di SHA).

## Independent Engineering Review Workflow

Dal 2026-11-13 (D-025) ogni commit pubblicato su `main` passa da una revisione tecnica indipendente. Ciclo: **Claude sviluppa → GitHub conserva → ChatGPT revisiona → Claude corregge → ChatGPT verifica.**

**Ruoli**
- **MAKER = Claude Code**: sviluppo, correzioni, test di regressione, documentazione applicativa, commit su `main` (quando autorizzato).
- **REVIEWER = ChatGPT**: analizza i commit pubblicati, apre i finding con ID stabili `FW-REV-NNN` (severità P0–P3), verifica le correzioni, mantiene il Ledger. Non scrive codice applicativo. Dal 2026-11-13 (D-027) è diviso in quattro chat specializzate: vedi "Multi-Reviewer Coordination & Mandatory Handoff".

**Branch**
- `main`: applicazione, del maker (sola lettura per il reviewer).
- `review/engineering`: archivio delle review e **canale di comunicazione asincrono** tra maker e reviewer (decisione dell'utente del 2026-11-13, confermata con D-027: l'utente non fa da tramite e non incolla messaggi, ognuno scrive nei **propri** file in `docs/reviews/`).
- **File del maker su `review/engineering`** (gli unici che scrive, mai codice):
  - `docs/reviews/YYYY-MM-DD-SHA.maker.md`: un handoff per ciclo, file nuovo ogni volta (data e SHA corto finale di `main`);
  - `docs/reviews/MAKER_HANDOFF.md`: indice degli handoff, una riga per ciclo in cima, con le chat destinatarie. È il punto d'ingresso dei reviewer.
- **File dei reviewer**: tutto il resto (Policy, Ledger, report, audit, backlog). Il maker non li modifica, nemmeno per un refuso: lo segnala nel proprio handoff. La riga già presente in `## Maker notes` del Ledger (commit `28e6f98`) resta com'è e non se ne aggiungono altre.
- Prima di ogni scrittura: `git fetch` e ripartire dall'`HEAD` remoto del branch; mai force push; se un reviewer ha scritto nel frattempo, si rifà il commit sopra il suo. Nessun merge di `review/engineering` in `main` (né il contrario) e nessuna copia dei documenti dei reviewer in `main`.

**Dove leggere (sempre la versione remota, mai una copia locale vecchia)**
```bash
git fetch origin
git show origin/review/engineering:docs/reviews/REVIEW_POLICY.md
git show origin/review/engineering:docs/reviews/REVIEW_LEDGER.md
git ls-tree --name-only origin/review/engineering docs/reviews/   # report pubblicati
```
Il **Ledger è l'unica fonte ufficiale** dello stato dei finding e del checkpoint revisionato: non duplicarlo qui né in `docs/`. A inizio sessione, se l'utente chiede di "controllare le review", si legge da lì senza farsi incollare nulla. Un finding comunicato dall'utente ma non ancora presente su GitHub va trattato come "riferito, report non pubblicato": si può lavorare, ma dichiarandolo.

**Gestione di un finding**
1. Leggere il report originale e verificare i riferimenti al codice sullo SHA indicato.
2. Riprodurre il problema con un test (i finding da analisi statica, specie di concorrenza, sono ipotesi finché non riprodotti). Se non è riproducibile, dirlo con il motivo.
3. Confermare o contestare con evidenze.
4. Correzione minima e robusta, senza modifiche non correlate al finding.
5. Test di regressione che **fallisce prima** della correzione e **passa dopo**; poi `scripts/check.sh` e, se tocca frontend/sync, `scripts/e2e.sh`.
6. Controllo degli effetti collaterali e aggiornamento della documentazione applicativa (`docs/`, questo file).
7. Commit su `main` solo se autorizzato, con l'ID del finding nel messaggio (es. `fix(FW-REV-001): …`), possibilmente un commit per finding.

Ordine di priorità: P0/P1 prima (integrità dei dati e affidabilità offline), poi P2, poi P3. Le regole non negoziabili restano valide: niente deploy, migrazioni sul DB reale o operazioni distruttive senza autorizzazione.

**Contestazioni**: un finding ritenuto errato non si ignora. Si presenta una contestazione tecnica con codice (file:riga sullo SHA revisionato) e un test che dimostra il comportamento reale; decide il reviewer, lo stato lo cambia solo lui.

**Implementato ≠ verificato**: il maker non dichiara mai un finding chiuso. La formula è "correzione implementata, in attesa di verifica indipendente"; "verificato/chiuso" lo scrive solo il reviewer nel Ledger. Lo stesso vale per i test: quelli eseguiti dal maker sono "dichiarati dal maker" finché il reviewer non li riesegue.

**Consegna al reviewer (fine di ogni ciclo)**: è il REVIEW HANDOFF descritto nella sezione seguente, scritto nei file del maker su `review/engineering` dopo aver pubblicato i commit su `main`. Contenuto minimo per ogni finding: riprodotto o no (con motivo) · file modificati · soluzione · test aggiunti · test eseguiti con risultati reali · rischi residui · **SHA completi (40 caratteri) dei commit pubblicati su `main`**, con l'intervallo `SHA_precedente..SHA_nuovo` e il finding associato a ciascuno · cosa va verificato a mano (telefono reale, APK, deploy).

## Multi-Reviewer Coordination & Mandatory Handoff

Dal 2026-11-13 (D-027) il reviewer è composto da **quattro chat indipendenti** del Project ChatGPT "FitWeek — Engineering Review". Il maker non legge le chat: legge i loro documenti su `origin/review/engineering` e risponde nei propri file sullo stesso branch. **L'utente non fa da tramite**: nella risposta in chat l'handoff non va ripetuto, bastano poche righe (cosa è stato fatto, SHA, file dell'handoff, eventuale azione che solo l'utente può fare). Le regole della sezione precedente restano valide; dove parlano di "reviewer" per i finding `FW-REV` e il checkpoint si intende la chat 01.

| Chat | Area | Documenti in `docs/reviews/` | Namespace | Quando coinvolgerla |
|---|---|---|---|---|
| **01 — Review incrementali** | commit, bug e regressioni, sicurezza e integrità dati, test, verifica delle correzioni. **Unica** a gestire checkpoint ufficiale e stato dei `FW-REV` | `REVIEW_POLICY.md`, `REVIEW_LEDGER.md`, report `YYYY-MM-DD-SHA.md` | `FW-REV-NNN` | **sempre**, dopo modifiche applicative pubblicate su `main` |
| **02 — Audit architetturale** | backend, database e migrazioni, contratti API, autenticazione, backup/ripristino, Docker/deploy, debito tecnico | `ARCHITECTURE_AUDIT.md`, `TECHNICAL_DEBT.md` | `FW-ARCH-NNN` | architettura, persistenza, migrazioni, autenticazione, API, deploy, confini tra componenti |
| **03 — Frontend & UX** | interfaccia, navigazione, responsive/mobile, accessibilità, esperienza Android, feedback visivo, regressioni UX | `UX_AUDIT.md`, `UX_BACKLOG.md` | `FW-UX-NNN` (`UX-QA-NNN` = verifica da fare, non bug) | schermate, componenti, CSS, interazioni, flussi, comportamento percepibile su Android |
| **04 — Product Strategy** | utilità delle funzioni, coerenza con i requisiti, roadmap e priorità, complessità non necessaria | `PRODUCT_REVIEW.md`, `PRODUCT_BACKLOG.md` | `FW-PROD-NNN` (P1–P3 = priorità di prodotto, non severità) | funzioni nuove, modificate o rimosse; comportamento di prodotto; attività di roadmap. **Non** per refactoring interni |

Finding e backlog vivono solo in quei documenti: non copiarli qui né in `docs/`. Ogni area cita i finding delle altre senza duplicarli: usare sempre l'ID originale.

**Prima di ogni attività**
1. `git status` e `git fetch origin`; annotare gli SHA completi di `main` e `origin/review/engineering`.
2. Leggere il Ledger e i documenti delle aree toccate (`git show origin/review/engineering:docs/reviews/<FILE>`), controllando nell'intestazione su quale SHA di `main` sono basati: un audit fatto su uno SHA più vecchio non dice nulla sui commit successivi.
3. Cercare finding aperti pertinenti e verificare se l'attività è già in un backlog o già implementata (un commit che dichiara una correzione **non** rende risolto il finding).
4. Individuare dipendenze e rischi tra aree (es. integrità dati che blocca una funzione) e decidere quali chat coinvolgere alla fine.

Una richiesta che nasce da una review si lavora con gli ID originali, i passi di "Gestione di un finding" e, se tocca più aree, una sola correzione coordinata, non interventi contraddittori.

**A fine di OGNI attività: REVIEW HANDOFF** in `docs/reviews/YYYY-MM-DD-SHA.maker.md` + riga in `MAKER_HANDOFF.md` (obbligatorio anche senza modifiche al codice, salvo attività senza alcun commit su `main`: in quel caso non c'è nulla da revisionare e lo si dice all'utente in una riga). Schema fisso del file:

```
REVIEW HANDOFF
MAKER SUMMARY            attività · SHA iniziale · SHA finale o "non pubblicato" · file modificati · finding affrontati ·
                         test eseguiti con risultati · test non eseguiti · rischi residui · deploy sì/no · dati e migrazioni
CHAT 01 — REVIEW INCREMENTALI    messaggio completo per la chat (se necessaria; altrimenti "non richiesta" e perché)
CHAT 02 — AUDIT ARCHITETTURALE   idem
CHAT 03 — FRONTEND & UX          idem
CHAT 04 — PRODUCT STRATEGY       idem
ORDINE CONSIGLIATO       sequenza motivata; segnalare se un problema di un'area ne blocca un'altra
PROSSIMA AZIONE          cosa resta all'utente (prova manuale, autorizzare un deploy, oppure nulla e perché)
```

- Ogni messaggio è **autonomo e completo** (non "chiedi una review"): chat destinataria · repository e branch · SHA iniziale e finale · modifiche · file importanti · ID dei finding · test eseguiti dal maker · test mancanti · rischi · verifiche indipendenti richieste · documento di competenza da aggiornare. Deve chiedere esplicitamente di **verificare il codice senza fidarsi delle dichiarazioni del maker** e non chiede mai un'approvazione.
- Instradamento: chat 01 sempre per modifiche applicative pubblicate; + 02, 03, 04 secondo la tabella. Più aree = più messaggi. Nessuna review inutile.
- **SHA verificati**: solo SHA completi letti da `git rev-parse` dopo `git fetch`, e controllando che lo SHA finale sia davvero su `origin/main`. L'handoff si scrive solo dopo il push di `main`: un lavoro non pubblicato non è verificabile su GitHub e non va presentato come tale.
- **Implementato ≠ approvato**: il maker scrive "correzione implementata, in attesa di verifica indipendente". Chiuso, verificato, approvato e avanzamento del checkpoint li scrive solo la chat proprietaria nel proprio documento. Il maker non modifica Ledger, audit o backlog e non dichiara approvati i propri commit.
- **Risposte dei reviewer**: a inizio sessione il maker le cerca da solo (`git fetch`, poi `git log origin/review/engineering` dall'ultimo handoff in `MAKER_HANDOFF.md`), senza farsi incollare nulla.

## Stato e roadmap

- Audit iniziale: `docs/AUDIT-2026-11-09.md`.
- Milestone e avanzamento: `docs/ROADMAP.md`.
- Review indipendenti: stato dei finding `FW-REV` nel Ledger e di `FW-ARCH`/`FW-UX`/`FW-PROD` nei documenti delle rispettive chat su `origin/review/engineering` (vedi "Independent Engineering Review Workflow" e "Multi-Reviewer Coordination & Mandatory Handoff"); l'avanzamento delle correzioni lato maker è in `docs/ROADMAP.md`.
- Problemi noti aperti: traffico HTTP non cifrato in LAN (documentato in `docs/SECURITY.md` con avviso in app e opzioni Tailscale HTTPS / reverse proxy locale); destinazione esterna `OFFSITE_DEST` da configurare per `scripts/backup-offsite.sh`; server raggiungibile solo in LAN (l'app autonoma lavora senza rete e invia al rientro; per sincronizzare fuori casa serve una VPN, l'indirizzo si cambia dalla schermata di accesso); nessun APK provato su un telefono reale (checklist pronta in `docs/ANDROID_CHECKLIST.md`); tappa 2 (modello IA sul telefono per il menu della mensa) da fare; pesate, spesa e dispensa ancora nel blob; stime nutrizionali generiche per i piatti della mensa; sonno solo a mano (importazione dall'orologio via Health Connect da valutare, D-019); prezzi reali per articolo da inserire a mano la prima volta (la lista generata dal piano lascia il prezzo vuoto se non già noto); grafico del girovita e confronto tra settimane (M3); link video `b4` da verificare.
