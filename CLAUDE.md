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

- Backend: Python 3.12, FastAPI 0.128, uvicorn, itsdangerous (cookie firmato). Un solo file: `main.py`.
- Dati iniziali: `seed.py` (scheda A/B/C, menu, lista spesa).
- DB: SQLite (WAL) in `/data/fitweek.sqlite`, **una sola riga JSON** (`app_state`) con contatore di versione. Vedi `docs/DATA_MODEL.md`.
- Frontend: HTML + CSS + JS vanilla senza build e senza CDN, in `static/`. **Attualmente minificati** (`app.js` ~30 KB su 65 righe, `style.css` su 1 riga): vanno de-minificati prima di modifiche sostanziali (vedi `docs/DECISIONS.md` D-002).
- Nessun test automatico esistente.

## Struttura

```
main.py              API FastAPI, auth, persistenza, serve static
seed.py              stato iniziale (routines, meals, groceries)
static/              index.html, app.js, style.css (SPA vanilla)
resources/           scheda-originale.pdf (fonte autorevole della scheda, servita solo dopo login)
docs/                documentazione di approfondimento
Dockerfile, docker-compose.yml, .env(.example)
```

## Comandi

```bash
# Controlli statici (non distruttivi)
node --check static/app.js && python3 -m py_compile main.py seed.py

# Stato del container live (sola lettura)
docker ps --filter name=fitweek ; docker inspect fitweek --format '{{.State.Health.Status}}'

# Smoke test isolato: container usa-e-getta, DB temporaneo, nessuna porta esposta
docker run --rm --network none -e APP_PASSWORD=... -e SESSION_SECRET=... -e DB_PATH=/tmp/t.sqlite fitweek-app-fitweek ...
```

Build/deploy: `docs/DEPLOYMENT.md`. **Il deploy sull'istanza in uso richiede autorizzazione esplicita dell'utente.**

## Regole non negoziabili

1. **Dati**: mai operazioni distruttive o migrazioni sul DB reale senza backup coerente verificato e consenso. Migrazioni solo additive e idempotenti. Lo stato JSON contiene anche le `routines`: correggere `seed.py` NON aggiorna il DB esistente, serve una migrazione dati.
2. **Infrastruttura**: mapping porta `192.168.222.200:8088:8080` (la 8080 dell'host è occupata da un altro servizio). Mantenere l'healthcheck. Non toccare altri container, reti o volumi del server.
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

Il repository git attuale ha radice in **`/opt`** (non in `/opt/fitweek-app`), è senza commit e include altri progetti. Non eseguire `git add`/commit lì. Proposta (in attesa di OK): repository dedicato in `/opt/fitweek-app` con `.gitignore` che esclude `.env`.

## Stato e roadmap

- Audit iniziale: `docs/AUDIT-2026-11-09.md`.
- Milestone e avanzamento: `docs/ROADMAP.md`.
- Problemi noti principali: progressioni di 2 esercizi errate nel seed; salvataggio allenamento solo a fine seduta (rischio perdita dati); Impostazioni/logout irraggiungibili da mobile; nessun backup automatico; input malformati → 500; nessuna validazione server dello stato; frontend minificato.
