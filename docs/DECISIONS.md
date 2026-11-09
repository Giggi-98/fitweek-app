# Decisioni architetturali (ADR sintetici)

Stato: **Accettata** (in vigore) · **Proposta** (in attesa di approvazione utente) · **Superata**.

## D-001 — Mantenere FastAPI + SQLite · Accettata
Contesto: un utente, volumi di dati minimi, deploy su mini PC. Decisione: nessun passaggio a PostgreSQL né a un altro backend. SQLite in WAL con un solo processo uvicorn. Conseguenze: backup = file singolo via backup API; nessun servizio DB aggiuntivo. Rivalutare solo con multi-utente o accesso concorrente intenso.

## D-002 — Frontend vanilla JS, de-minificato in ES modules, senza build · Proposta
Contesto: `app.js` (30 KB) e `style.css` sono minificati e monolitici; nessun sorgente leggibile. React/Next/Svelte richiederebbero toolchain Node, build in Docker e riscrittura completa senza benefici proporzionati per ~6 viste. Decisione proposta: formattare i file esistenti, poi dividerli in moduli ES nativi (`<script type="module">`), CSS in tokens/base/components. Nessuna dipendenza runtime. Rivalutare (es. Preact/htm via file vendorizzato, o Lit) solo se la gestione dello stato UI della schermata allenamento diventa difficile. Alternativa scartata: riscrittura in framework con build — costo alto, rischio regressioni.

## D-003 — Migrazione progressiva dal blob JSON a tabelle · Proposta
Contesto: lo stato unico causa riscritture totali, conflitti tra domini non correlati, limite 2 MB, nessuna validazione/query. Decisione proposta: strangler pattern, un dominio alla volta, iniziando da palestra (M2). `/api/state` resta per i domini non ancora migrati. Migrazioni additive con backup automatico pre-migrazione.

## D-004 — Migrazioni con runner interno, senza ORM · Proposta
SQL/py versionati in `app/migrations/`, tabella `schema_migrations`, eseguiti all'avvio in transazione dopo backup. Alembic/SQLAlchemy scartati: troppa infrastruttura per ~10 tabelle. Pydantic (già incluso in FastAPI) per la validazione.

## D-005 — Registrazione allenamento per serie, idempotente · Proposta
Ogni serie confermata è inviata subito con UUID client (`PUT /api/v1/set-logs/{id}`); coda locale se offline. Elimina la perdita dati a metà seduta e i conflitti 409. Quick win temporaneo in M1: bozza in localStorage nel modello attuale.

## D-006 — Settimana del programma calcolata · Proposta
`week = floor((oggi − start_date)/7) + 1`, limitata 1..8, con override manuale e gestione sedute riprogrammate. Il calcolo è funzione pura testata. Fuso orario: `Europe/Rome` (configurato in container e app).

## D-007 — Nome volume Docker esplicito · Proposta (richiede autorizzazione)
Oggi `fitweek-app_fitweek_data` dipende dal nome della directory. Proposta: `volumes: fitweek_data: {name: fitweek_data}` con migrazione via backup coerente → nuovo volume → verifica → il vecchio volume resta finché l'utente non autorizza la rimozione. Momento ideale: ora (DB = solo seed).

## D-008 — PWA con offline limitato · Proposta (M6)
Manifest + service worker che mette in cache la shell; offline solo per la schermata allenamento (coda serie). Prerequisito: contesto sicuro. Su `http://IP:8088` i service worker non funzionano → serve HTTPS in LAN (es. reverse proxy con certificato di una CA locale, o Tailscale con HTTPS). Da decidere con l'utente prima di M6.

## D-009 — AI opzionale e solo propositiva · Accettata (come vincolo)
Disattivata di default; chiave solo lato server da env; consenso esplicito per l'invio di dati, con anteprima di cosa viene inviato; output = proposte che l'utente applica manualmente. Nessuna integrazione finché M1–M5 non sono stabili.

## D-010 — Nessuna integrazione Esselunga automatica · Accettata
Nessuna API pubblica nota; niente scraping né acquisti automatizzati. Prezzi inseriti/aggiornati manualmente e marcati come stima o reali. Eventuale modulo futuro isolato, previa verifica di fonti e termini d'uso.

## D-011 — Valori nutrizionali solo con fonte · Accettata
Ogni valore ha `source` (`label`, `manual`, `estimate`, `database:<nome>`). Le stime sono visualizzate come tali. Nessun target calorico prescrittivo.

## D-012 — Repository git dedicato · Proposta (richiede autorizzazione)
Il repo attuale ha radice in `/opt` e include altri progetti. Proposta: `git init` in `/opt/fitweek-app`, `.gitignore` (`.env`, `__pycache__/`, backup, `*.sqlite*`), commit iniziale dello stato attuale prima di qualsiasi modifica al codice.

## D-013 — App mobile con Capacitor per promemoria affidabili · Proposta (in attesa di scelta piattaforma)
Contesto (richiesta utente 2026-11-09): l'app deve ricordare attivamente spuntino, pasti, allenamento e pesata, con popup di inserimento rapido. Una webapp/PWA servita in HTTP su LAN non può mostrare notifiche affidabili (service worker e Push richiedono HTTPS; su iOS solo PWA installata ≥16.4; le notifiche web non sono garantite a orario).
Decisione proposta: shell **Capacitor** attorno alla SPA esistente (stesso codice, nessun framework nuovo) con `@capacitor/local-notifications`: i promemoria sono programmati **sul telefono** a partire dalla routine (funzionano anche senza rete e senza server raggiungibile); il tocco sulla notifica apre direttamente il popup corretto (es. "Cosa hai mangiato?"). Il backend resta l'unica fonte dei dati.
Conseguenze: (1) la SPA va servita dal bundle dell'app e parla con il server via API → servono CORS limitato all'origine dell'app e un'autenticazione adatta (cookie SameSite=None+Secure o token), quindi **HTTPS sul server** (reverse proxy con certificato) — prerequisito comune anche a D-008; (2) fuori casa il server è raggiungibile solo via VPN; inserimenti offline in coda locale (già previsto per gli allenamenti, D-005); (3) Android: build con Android Studio/Gradle, installazione APK diretta, nessun costo; iOS: richiede Mac + Xcode e account Apple Developer (o re-firma ogni 7 giorni).
Alternativa valutata: PWA + Web Push (VAPID) dal server — nessuno store/build, ma richiede comunque HTTPS, è meno affidabile negli orari e su iOS più limitata. Rivalutare se la piattaforma è iOS senza Mac.
