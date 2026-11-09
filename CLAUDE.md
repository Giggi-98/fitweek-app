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

## Stack reale (verificato 2026-11-09)

- Backend: Python 3.12, FastAPI 0.128, uvicorn (`app.main:create_app --factory`), Pydantic per la validazione, itsdangerous per firmare l'ID di sessione.
- Sessioni server-side revocabili (tabella `sessions`), rate limit login in memoria, header di sicurezza + CSP, log JSON su stdout.
- DB: SQLite (WAL) in `/data/fitweek.sqlite`. Stato applicativo ancora in **una sola riga JSON** (`app_state`) con versione per il controllo 409, validato da `app/schemas.py`. Migrazioni versionate in `app/migrations.py` (tabella `schema_migrations`, backup automatico pre-migrazione). Vedi `docs/DATA_MODEL.md`.
- Frontend: HTML + CSS + JS vanilla senza build e senza CDN, in `static/` (formattati con prettier, ancora monolitici: divisione in moduli prevista in M2, `docs/DECISIONS.md` D-002). Bozze allenamento in localStorage.
- Test: pytest in `tests/` (API, sicurezza, migrazioni), eseguiti da `scripts/check.sh` in container usa-e-getta.

## Struttura

```
app/main.py          create_app(): middleware, endpoint, static
app/config.py        Settings da env (nessun default per i segreti)
app/db.py            connessione SQLite, transazioni, backup API
app/migrations.py    migrazioni versionate + backup pre-migrazione
app/schemas.py       modelli Pydantic dello stato (extra=forbid)
app/security.py      sessioni, rate limit, Origin, CSP/header
app/seed.py          stato iniziale (routines verificate sul PDF, meals, groceries)
static/              index.html, app.js, style.css (SPA vanilla)
tests/               pytest
scripts/             backup.sh, restore.sh, check.sh
resources/           scheda-originale.pdf (fonte autorevole della scheda, servita solo dopo login)
docs/                documentazione di approfondimento
Dockerfile, docker-compose.yml, .env(.example)
```

## Comandi

```bash
# Sintassi + test automatici (container usa-e-getta, nessun dato reale)
scripts/check.sh

# Backup coerente del DB live → /opt/backups/fitweek/
scripts/backup.sh <etichetta>

# Stato del container live (sola lettura)
docker ps --filter name=fitweek ; docker inspect fitweek --format '{{.State.Health.Status}}'

# Prova manuale isolata: container usa-e-getta, DB temporaneo, porta solo su localhost
docker run --rm -p 127.0.0.1:18088:8080 -e APP_PASSWORD=... -e SESSION_SECRET=... -e DB_PATH=/tmp/t.sqlite fitweek:test
```

Build/deploy: `docs/DEPLOYMENT.md`. **Il deploy sull'istanza in uso richiede autorizzazione esplicita dell'utente.**

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
- Problemi noti aperti: allenamento ancora salvato sul server solo a fine seduta (mitigato dalla bozza locale; per-serie in M2); modello a blob unico; frontend monolitico con stili inline (CSP con `style-src 'unsafe-inline'`); settimana del programma manuale; link video `b4` da verificare.
