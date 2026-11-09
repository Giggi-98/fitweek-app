# Architettura

## Attuale (verificata 2026-11-09)

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

## Obiettivo (evoluzione incrementale, non riscrittura)

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

## Flusso di autenticazione (attuale)

1. `GET /` serve la SPA; `load()` chiama `GET /api/state`.
2. 401 → schermata di login → `POST /api/login {password}` → cookie `fitweek_session` = firma di `'authorized'`.
3. Ogni chiamata autenticata verifica firma ed età ≤ 30 gg. Le scritture verificano anche `Origin == Host`.
4. Logout cancella il cookie lato client; il token resta valido fino a scadenza (da correggere in M1 con un "session epoch" lato server).
