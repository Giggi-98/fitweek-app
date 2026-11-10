# Decisioni architetturali (ADR sintetici)

Stato: **Accettata** (in vigore) · **Proposta** (in attesa di approvazione utente) · **Superata**.

## D-001 — Mantenere FastAPI + SQLite · Accettata
Contesto: un utente, volumi di dati minimi, deploy su mini PC. Decisione: nessun passaggio a PostgreSQL né a un altro backend. SQLite in WAL con un solo processo uvicorn. Conseguenze: backup = file singolo via backup API; nessun servizio DB aggiuntivo. Rivalutare solo con multi-utente o accesso concorrente intenso.

## D-002 — Frontend vanilla JS, de-minificato in ES modules, senza build · Accettata (M2, 2026-11-09)
Contesto: `app.js` (30 KB) e `style.css` sono minificati e monolitici; nessun sorgente leggibile. React/Next/Svelte richiederebbero toolchain Node, build in Docker e riscrittura completa senza benefici proporzionati per ~6 viste. Decisione proposta: formattare i file esistenti, poi dividerli in moduli ES nativi (`<script type="module">`), CSS in tokens/base/components. Nessuna dipendenza runtime. Rivalutare (es. Preact/htm via file vendorizzato, o Lit) solo se la gestione dello stato UI della schermata allenamento diventa difficile. Alternativa scartata: riscrittura in framework con build — costo alto, rischio regressioni.

## D-003 — Migrazione progressiva dal blob JSON a tabelle · Accettata (M2, 2026-11-09)
Contesto: lo stato unico causa riscritture totali, conflitti tra domini non correlati, limite 2 MB, nessuna validazione/query. Decisione proposta: strangler pattern, un dominio alla volta, iniziando da palestra (M2). `/api/state` resta per i domini non ancora migrati. Migrazioni additive con backup automatico pre-migrazione.

## D-004 — Migrazioni con runner interno, senza ORM · Accettata (implementata 2026-11-09)
SQL/py versionati in `app/migrations/`, tabella `schema_migrations`, eseguiti all'avvio in transazione dopo backup. Alembic/SQLAlchemy scartati: troppa infrastruttura per ~10 tabelle. Pydantic (già incluso in FastAPI) per la validazione.

## D-005 — Registrazione allenamento per serie, idempotente · Accettata (M2, 2026-11-09)
Ogni serie confermata è inviata subito con UUID client (`PUT /api/v1/set-logs/{id}`); coda locale se offline. Elimina la perdita dati a metà seduta e i conflitti 409. Quick win temporaneo in M1: bozza in localStorage nel modello attuale.

## D-006 — Settimana del programma calcolata · Accettata (M2, 2026-11-09)
`week = floor((oggi − start_date)/7) + 1`, limitata 1..8 (`app/domain.py`). L'override manuale non è un valore separato: `PUT /api/v1/program-week` sposta `startDate`, così esiste una sola fonte di verità. Il calcolo è funzione pura testata. Fuso orario: `Europe/Rome` (configurato in container e app).

## D-007 — Nome volume Docker esplicito · Accettata (implementata 2026-11-09)
Oggi `fitweek-app_fitweek_data` dipende dal nome della directory. Proposta: `volumes: fitweek_data: {name: fitweek_data}` con migrazione via backup coerente → nuovo volume → verifica → il vecchio volume resta finché l'utente non autorizza la rimozione. Momento ideale: ora (DB = solo seed).

## D-008 — PWA con offline limitato · Proposta (M6)
Manifest + service worker che mette in cache la shell; offline solo per la schermata allenamento (coda serie). Prerequisito: contesto sicuro. Su `http://IP:8088` i service worker non funzionano → serve HTTPS in LAN (es. reverse proxy con certificato di una CA locale, o Tailscale con HTTPS). Da decidere con l'utente prima di M6.

## D-009 — AI opzionale e solo propositiva · Accettata (come vincolo)
Disattivata di default; chiave solo lato server da env; consenso esplicito per l'invio di dati, con anteprima di cosa viene inviato; output = proposte che l'utente applica manualmente. Nessuna integrazione finché M1–M5 non sono stabili.

## D-010 — Nessuna integrazione Esselunga automatica · Accettata
Nessuna API pubblica nota; niente scraping né acquisti automatizzati. Prezzi inseriti/aggiornati manualmente e marcati come stima o reali. Eventuale modulo futuro isolato, previa verifica di fonti e termini d'uso.

## D-011 — Valori nutrizionali solo con fonte · Accettata
Ogni valore ha `source` (`label`, `manual`, `estimate`, `database:<nome>`). Le stime sono visualizzate come tali. Nessun target calorico prescrittivo.

## D-012 — Repository git dedicato · Accettata (implementata 2026-11-09)
Il repo attuale ha radice in `/opt` e include altri progetti. Proposta: `git init` in `/opt/fitweek-app`, `.gitignore` (`.env`, `__pycache__/`, backup, `*.sqlite*`), commit iniziale dello stato attuale prima di qualsiasi modifica al codice.

## D-013 — App mobile con Capacitor per promemoria affidabili · Accettata (Android, M6, 2026-11-09)
Contesto (richiesta utente 2026-11-09): l'app deve ricordare attivamente spuntino, pasti, allenamento e pesata, con popup di inserimento rapido. Una webapp/PWA servita in HTTP su LAN non può mostrare notifiche affidabili (service worker e Push richiedono HTTPS; su iOS solo PWA installata ≥16.4; le notifiche web non sono garantite a orario).
Decisione proposta: shell **Capacitor** attorno alla SPA esistente (stesso codice, nessun framework nuovo) con `@capacitor/local-notifications`: i promemoria sono programmati **sul telefono** a partire dalla routine (funzionano anche senza rete e senza server raggiungibile); il tocco sulla notifica apre direttamente il popup corretto (es. "Cosa hai mangiato?"). Il backend resta l'unica fonte dei dati.
Conseguenze: (1) la SPA va servita dal bundle dell'app e parla con il server via API → servono CORS limitato all'origine dell'app e un'autenticazione adatta (cookie SameSite=None+Secure o token), quindi **HTTPS sul server** (reverse proxy con certificato) — prerequisito comune anche a D-008; (2) fuori casa il server è raggiungibile solo via VPN; inserimenti offline in coda locale (già previsto per gli allenamenti, D-005); (3) Android: build con Android Studio/Gradle, installazione APK diretta, nessun costo; iOS: richiede Mac + Xcode e account Apple Developer (o re-firma ogni 7 giorni).
Alternativa valutata: PWA + Web Push (VAPID) dal server — nessuno store/build, ma richiede comunque HTTPS, è meno affidabile negli orari e su iOS più limitata. Rivalutare se la piattaforma è iOS senza Mac.

## D-014 — Promemoria come dati sul server, motore in app · Accettata (M4, 2026-11-09)
I promemoria vivono nella tabella `reminders` (non nel client): la webapp li mostra come popup quando è aperta e l'app Capacitor (D-013) li userà per programmare notifiche locali, senza duplicare la logica. Il completamento è dedotto dai dati (pasto/pesata/seduta registrati) per evitare doppie conferme. Popup limitati all'evento scaduto più recente (ultime 3 h) per non bombardare l'utente.

## D-015 — Stime nutrizionali generiche iniziali · Accettata (M4, 2026-11-09)
Per dare subito "calorie teoriche" i pasti abituali iniziali hanno valori medi indicativi marcati `estimate` con nota. L'interfaccia mostra sempre la fonte e la copertura; l'utente li corregge con le etichette (`label`). Nessuna integrazione con banche dati esterne senza decisione esplicita.

## D-016 — APK che carica la webapp dal server (server.url) · Accettata (M6, 2026-11-09)
Invece di impacchettare il frontend nell'APK (che richiederebbe CORS, cookie cross-site con HTTPS e un aggiornamento dell'APK a ogni modifica), l'app Capacitor carica `server.url` in HTTP LAN con `cleartext`. Vantaggi: zero build web, aggiornamenti immediati, stessi cookie della webapp. Svantaggi: senza server raggiungibile si vede solo la pagina offline (le notifiche, programmate localmente, funzionano comunque); l'URL è fissato in compilazione (`scripts/build-apk.sh URL`). Le notifiche sono "una tantum" per 14 giorni (non ripetizioni settimanali) per non suonare per eventi già registrati.

## D-017 — CSP senza stili inline · Accettata (1.7.0, 2026-11-10)
`style-src 'self'`: nessun attributo `style` né blocco `<style>` nel frontend. I pochi valori dinamici (altezza delle barre, larghezza del budget, dimensione e avanzamento degli anelli) sono scritti come `data-pct-h`, `data-pct-w`, `data-vars` e applicati via CSSOM da `applyDynamicStyles()` dopo ogni inserimento di HTML (vista e modale): le modifiche di stile fatte da script sono consentite dalla CSP, gli attributi no. Un test pytest blocca il ritorno di `style="` in `static/`, e i test e2e falliscono su qualsiasi errore in console, violazioni CSP comprese. Alternativa scartata: nonce per richiesta (richiederebbe di generare `index.html` lato server).

## D-018 — Ricerca prodotti su Open Food Facts · Accettata (1.8.0, 2026-11-10, decisione dell'utente)
Per avere valori nutrizionali dei prodotti confezionati senza inventarli, l'editor del pasto cerca per nome su Open Food Facts (database pubblico, licenza ODbL). La chiamata parte dal server (`app/foodsearch.py`), non dal browser: la CSP resta `connect-src 'self'` e al servizio arriva solo il testo cercato, con uno User-Agent generico e senza cookie. I valori sono per 100 g; l'utente indica la porzione in grammi e la voce viene salvata con fonte `off`, distinta da stima, etichetta e inserimento manuale, con l'avviso di controllare la confezione. Limiti: 10 ricerche al minuto (indicazione del servizio), cache in memoria, timeout 8 s; senza rete resta il catalogo locale. Si spegne con `FOOD_SEARCH=off`. Nessun altro servizio esterno è usato.

## D-019 — Sonno: inserimento manuale ora, Health Connect in seguito · Accettata (1.8.0, 2026-11-10)
L'OPPO Watch 2 non ha un'API pubblica. L'app OHealth (ex HeyTap Health) può scrivere il sonno su Health Connect di Android, da cui un'app nativa può leggerlo: servirebbe un plugin Capacitor per Health Connect nell'APK, i relativi permessi e una prova sul telefono reale. Per ora il sonno si registra a mano (ora di letto e di sveglia, due campi) e la tabella `sleep_logs` ha già la colonna `source` (`manual` | `health_connect`), così l'importazione potrà scrivere gli stessi record senza cambiare schema. Non verificato: che OHealth scriva davvero il sonno su Health Connect per questo modello.

## D-020 — Riferimenti di proteine e calorie scelti dall'utente · Accettata (1.8.0, 2026-11-10)
L'utente può impostare in Impostazioni un riferimento giornaliero di proteine e di calorie. L'app non li calcola, non li suggerisce e non li chiama obiettivi: mostra solo la stima della giornata rispetto al numero scelto, senza colori d'allarme quando lo si supera (coerente con il principio "calma" del design system e con la regola 5).

## D-021 — App Android autonoma con copia locale e coda · In prova (1.9.0, 2026-11-10, decisione dell'utente)
Supera in parte D-016. L'utente vuole che l'app si apra e si usi anche lontano da casa. Scelta: le pagine del frontend entrano nell'APK (`scripts/bundle-www.sh`), l'app parla con il server a un indirizzo configurabile e il server resta l'unica fonte di verità.
- **Accesso**: l'app è su un'altra origine (`http://localhost`), quindi niente cookie: il login con `client: "app"` restituisce il token di sessione, inviato come `Authorization: Bearer`. CORS è ammesso solo per le origini in `APP_ORIGINS` e senza credenziali; la webapp continua con il cookie HttpOnly e non riceve mai il token.
- **Letture senza rete**: ogni risposta GET viene copiata in locale (`static/js/cache.js`); se il server non risponde si usa la copia e l'indicatore mostra "Offline · dati delle HH:MM". Data, giornata della scheda, settimana del programma e agenda del giorno si ricalcolano sul telefono (`static/js/sync.js`).
- **Scritture senza rete**: allenamenti, pasti, sonno, note e promemoria passano dalla coda idempotente già esistente; lo stato a blob (pesate, lista, dispensa, profilo, piano) resta in attesa e al ritorno viene fuso a tre vie con ciò che è cambiato sul server (elenchi per id, oggetti per campo), senza perdere né le modifiche locali né quelle remote. La stessa fusione sostituisce il vecchio "ripeti l'ultima modifica" dopo un 409 anche nella webapp.
- **Limiti dichiarati**: senza rete il riepilogo settimanale e lo stato "fatto" dei promemoria sono quelli dell'ultima copia; backup, ripristino e PDF della scheda si aprono solo dal browser; la ricerca su Open Food Facts richiede il server.
- **Rilascio**: canale `next` con appId `app.fitweek.personal.next` ("FitWeek β"), installabile accanto all'app attuale. Diventa la versione principale solo dopo la prova sul telefono reale. Alternativa scartata: database completo sul telefono con sincronizzazione nei due sensi (riscrittura della logica del server in JavaScript, più rischio per i dati).
Non verificato: comportamento nel WebView reale (origine, traffico in chiaro verso la LAN, notifiche con le pagine locali). Verificato nel browser con le pagine servite da un'altra origine (test e2e `standalone`).
