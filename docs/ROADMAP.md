# Roadmap

Adattata al codice reale (audit 2026-11-09). Rispetto alla proposta iniziale: la **schermata allenamento mobile** sale a M2 (massimo valore quotidiano) insieme alle fondamenta del frontend e al design system, perché il logger nuovo richiede comunque codice leggibile e token; light mode entra già in M2. Le milestone successive restano nell'ordine proposto.

Stato: ⬜ da fare · 🔄 in corso · ✅ fatto · ⏸ in attesa di autorizzazione

| # | Milestone | Stato |
|---|---|---|
| M1 | Stabilizzazione, protezione dati, sicurezza | ✅ in produzione dal 2026-11-09 (resta: verifica manuale da telefono) |
| M2 | Fondamenta frontend, design system, allenamento mobile | ✅ 2026-11-09 (parziali: RIR/RPE UI, note per esercizio, grafici → M3) |
| M3 | Dashboard "Oggi" e progressi | 🔄 progressi in 1.7.0, scheda "Adesso" in 1.10.2; restano misure aggiuntive e confronto settimane |
| M4 | Alimentazione, promemoria in app, riepilogo settimanale | ✅ 2026-11-09 (notifiche native → M6) |
| M5 | Spesa, dispensa, budget | ✅ spesa reale e ricorrenti in 1.8.0; quantità numeriche e lista generata dal piano in 1.10.2 |
| M6 | App Android (Capacitor) con notifiche native | ✅ 2026-11-09 · app autonoma con Keystore, copia locale e coda in prova (1.9.0 / 1.10.2, D-021, D-024) |
| M7 | Rifinitura: redesign v2 ✅ (1.5.0); accessibilità, performance, schede multiple ⬜ |
| M8 | Assistente AI opzionale e integrazioni | ⬜ |

---

## Review indipendente — correzioni lato maker (D-025)

Stato ufficiale dei finding: solo nel Ledger su `origin/review/engineering`. Qui c'è soltanto l'avanzamento del lavoro del maker.

Dal 2026-11-13 i reviewer sono quattro (D-027): oltre ai `FW-REV` del Ledger esistono `FW-ARCH` (`ARCHITECTURE_AUDIT.md`, `TECHNICAL_DEBT.md`), `FW-UX` (`UX_AUDIT.md`, `UX_BACKLOG.md`) e `FW-PROD` (`PRODUCT_REVIEW.md`, `PRODUCT_BACKLOG.md`), tutti sullo stesso branch e non copiati qui. Alla data, nessun `FW-ARCH`/`FW-UX`/`FW-PROD` è stato affrontato dal maker.

Baseline su `2dac1ab` (2026-11-13): verdetto **MODIFICHE RICHIESTE**, otto finding da analisi statica; report `docs/reviews/2026-11-13-2dac1ab.md` pubblicato su `review/engineering` (`b09e7ca`).

Ciclo 1 (1.10.3, 2026-11-13) — per tutti: **correzione implementata, in attesa di verifica indipendente**. Scelte in D-026.

| Finding | Riprodotto dal maker | Correzione | Test |
|---|---|---|---|
| FW-REV-001 (P1) | sì, test JS con rete comandata | `queue.js`: si toglie solo l'operazione inviata | `tests/js/queue.test.mjs`, e2e `reliability` §8 |
| FW-REV-002 (P1) | sì, pytest | `set_tombstones` (migrazione 9) + confronto in `put_set` | `tests/test_edit_time.py`, `tests/test_migrations.py` |
| FW-REV-003 (P1) | sì, test JS | `sync.js`: piano per giorno → pasto → ingrediente | `tests/js/sync.test.mjs` |
| FW-REV-004 (P2) | sì, pytest con scrittura a metà export | `db.snapshot()` in `GET /api/backup` | `tests/test_api.py` |
| FW-REV-005 (P2) | sì, test JS con Keystore finto guasto | `platform.js`: rimozione solo a scrittura confermata | `tests/js/platform.test.mjs` |
| FW-REV-006 (P2) | sì, test JS + e2e | `logout.js`: ultimo invio, poi conferma esplicita | `tests/js/queue.test.mjs`, e2e `reliability` §9 |
| FW-REV-008 (P2) | sì, test JS | `sync.js`: la voce resta, avviso dedicato | `tests/js/sync.test.mjs` |
| FW-REV-007 (P3) | confermato leggendo doc e seed | `docs/TRAINING_PROGRAM.md` riscritto; nessuna migrazione | `test_seed_progressions_match_the_pdf_table` |

Ciclo 2 (1.10.4, 2026-11-13), dal report `docs/reviews/2026-11-13-5e333bd.md` — **correzione implementata, in attesa di verifica indipendente**. Scelte in D-028.

| Finding | Riprodotto dal maker | Correzione | Test |
|---|---|---|---|
| FW-REV-009 (P1), completa FW-REV-002 | sì, pytest (3 test falliti prima) | `app/workouts.py`: `edit_time` al millisecondo | `tests/test_edit_time.py` |
| FW-REV-010 (P2) | sì, test JS (6 falliti prima) | `platform.js`: eliminazione riletta e segno di uscita; `logout.js`: avvisi e conferma | `tests/js/platform.test.mjs`, `tests/js/logout.test.mjs` |

Non fatto in questo ciclo: deploy (lo schema 9 arriva sull'istanza in uso solo al deploy, con backup pre-migrazione automatico), APK `next` ricompilato, prova su telefono reale.

## M1 — Stabilizzazione, protezione dati, sicurezza

**Obiettivo**: nessuna perdita di dati possibile per cause tecniche; codice versionato; errori gestiti; scheda coerente col PDF. Nessun cambiamento visibile importante oltre ai fix.

Attività:
1. ✅ Repo git dedicato in `/opt/fitweek-app` + `.gitignore` + commit iniziale dello stato attuale (D-012).
2. ✅ `scripts/backup.sh` / `restore.sh` (backup API SQLite, verifica integrità, rotazione); prova di ripristino su container usa-e-getta; timer host (D-007 per i dettagli del volume).
3. ✅ Volume con nome esplicito, migrato via backup (D-007).
4. Backend: corpo malformato → 400; `compare_digest` su bytes; validazione Pydantic di `PUT /api/state` (tipi e limiti per ogni dominio); header di sicurezza (CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`); rate limit login (es. 5 tentativi/min + backoff); `session_epoch` per invalidare le sessioni al logout/"esci da tutti i dispositivi"; logging strutturato (JSON, senza dati personali); `TZ=Europe/Rome`.
5. Migrazione dati idempotente: correzione `b6` e `c5` (TRAINING_PROGRAM.md), applicata solo se i valori correnti sono quelli errati del seed; backup prima. Correzione di `seed.py`.
6. Frontend (fix mirati sul file esistente, previa formattazione leggibile): `esc()` su tutti i valori interpolati; URL video solo `https:`; Impostazioni + Logout raggiungibili da mobile; bozza allenamento (incluse data, durata, note) in localStorage con ripristino; gestione 409 recuperabile (ricarica server + riapplica bozza); articoli senza categoria visibili; conferma eliminazione pesata.
7. Test: `tests/` con pytest + httpx (auth, rate limit, 400/401/403/409/413, validazione, backup) eseguiti nell'immagine Docker; `scripts/check.sh` (syntax check + test).
8. README allineato (porta, volume, backup).

Dipendenze: autorizzazione per 1–3 e per il deploy finale.

Criteri di accettazione:
- [x] `git log` mostra il commit iniziale; `.env` non è tracciato.
- [x] Un backup automatico esiste, supera `PRAGMA integrity_check` e un ripristino su container usa-e-getta restituisce gli stessi conteggi.
- [x] Nessun endpoint restituisce 500 per input malformato (test).
- [x] Uno stato con tipi errati (es. `weight` stringa HTML) è rifiutato con 422 (test).
- [x] Dopo 5 login errati in 1 minuto le richieste successive ricevono 429 (test).
- [x] Dopo il logout il vecchio cookie riceve 401 (test).
- [x] Le risposte includono gli header di sicurezza e la SPA funziona con la CSP (verifica manuale + test header).
- [x] Le serie previste di `b6` e `c5` coincidono col PDF nel DB live dopo la migrazione; gli altri esercizi invariati (test sulla migrazione).
- [x] Ricaricando la pagina a metà compilazione di un allenamento, i valori inseriti sono ancora presenti.
- [x] Da smartphone (< 750 px) si raggiungono Impostazioni e Logout.
- [x] Dopo un 409 l'utente può recuperare senza perdere la bozza.
- [x] `scripts/check.sh` passa; healthcheck `healthy` dopo il deploy.

Esito (2026-11-09): 20 test pytest; 16 controlli e2e Playwright (viewport iPhone) su container usa-e-getta; migrazione provata su copia del DB reale; ripristino provato su container/volume usa-e-getta; deploy con volume `fitweek_data`, healthcheck `healthy`, b6/c5 corretti nel DB live. Da fare: prova manuale sul telefono reale.
Test previsti: pytest API; test della migrazione su copia del DB live; verifica manuale da telefono (checklist in PR).
Rischi: la CSP può rompere stili inline presenti in `app.js` (mitigazione: spostare gli inline style in classi, o `style-src 'self' 'unsafe-inline'` temporaneo dichiarato); migrazione volume (mitigazione: il vecchio volume non viene cancellato).

## M2 — Fondamenta frontend, design system, allenamento mobile ✅

Obiettivo raggiunto: apri l'app → "Inizia Giorno A · W1" → ogni serie è precompilata (ultima seduta o serie precedente) → un tocco su ✓ la salva e avvia il recupero.

Fatto:
- Frontend in ES modules (D-002), CSS a token, tema chiaro/scuro/automatico, routing con hash, nav mobile a 6 voci.
- Tabelle `workout_sessions`/`set_logs` con migrazione dei workouts del blob (D-003, D-004); API v1 idempotenti (D-005).
- Settimana del programma calcolata dalla data di inizio, modificabile da Impostazioni (D-006).
- Logger: stepper kg/rip, precompilazione, ✓ = serie salvata, annulla serie con un tocco, serie extra, cardio, note, termina con riepilogo (volume marcato "calcolato", confronto con la seduta precedente), annulla seduta, recupero di sedute (scelta giorno/settimana).
- Coda offline persistente; seduta e timer sopravvivono a ricariche e schermo spento.
- Import delle bozze non salvate della versione 1.1.
- Backup JSON v2 con sedute; ripristino lato server con backup automatico.
- Dashboard "Oggi": CTA allenamento, timeline del giorno, settimana con sedute fatte, media peso 7 gg (calcolata).
- Progressi: medie settimanali (calcolate), tabella carichi recenti, storico da API.

Criteri di accettazione:
- [x] Seduta registrabile con 1 tocco per serie quando si ripetono i carichi (e2e).
- [x] Nessuna perdita dati: ricarica a metà seduta e serie inserite offline (e2e).
- [x] Workouts del blob migrati con conteggi identici (test migrazione).
- [x] Tema chiaro e scuro verificati (e2e + screenshot).
- [ ] Lighthouse accessibilità ≥ 90: non misurato (label, contrasto e target ≥ 44–48 px curati a mano).
- [ ] Prova su telefono reale.

Parziale/rimandato: RIR/RPE (colonna presente, UI no), note per singolo esercizio, grafici carichi per esercizio (M3), schede multiple (M7), wake lock schermo (richiede HTTPS).

## M3 — Dashboard "Oggi" e progressi
Obiettivo: la dashboard risponde a "cosa faccio adesso". Timeline del giorno basata sulla routine (lavoro, pre-gym, palestra, cena); CTA allenamento; trend peso con media mobile 7 gg (marcata "calcolata"); misure aggiuntive; grafici carichi per esercizio; confronto settimane; frequenza allenamenti.
Accettazione: dati calcolati distinti visivamente dai registrati; grafici con alternativa tabellare.

### 1.7.0 (2026-11-10) — fatto
- Peso: grafico su asse temporale reale (prima i punti erano equidistanti anche con pesate irregolari), media mobile sui 7 giorni di calendario marcata "calcolata", riquadri ultima pesata / media / variazione dall'inizio.
- Costanza: griglia settimane del programma × giorni A/B/C (fatta, non fatta, oggi, in programma), senza toni di rimprovero.
- Carichi per esercizio: scelta dell'esercizio, serie più pesante per seduta (grafico dalla seconda seduta), carico massimo, volume calcolato in tabella.
- Logger: trofeo sulla serie che supera il carico massimo precedente (la prima volta non è un record) e riepilogo dei record a fine seduta.
- Affidabilità: la coda offline ritenta gli errori passeggeri del server (5xx, 429) invece di scartare la serie; al ritorno sull'app si aggiornano anche agenda e settimana; orario della palestra in dashboard letto dal promemoria.
- Spesa: "Spuntati → dispensa", dispensa ordinata per scadenza con evidenza entro 3 giorni.
- Sicurezza: CSP senza `'unsafe-inline'` (D-017).
- Test: e2e non più dipendenti dal giorno della settimana (2 controlli fallivano dal martedì alla domenica).

Verificato: 62 pytest, 14 test JS, 68 controlli e2e su container usa-e-getta. Non verificato: telefono reale. In produzione dal 2026-11-10 (container healthy, schema 6 invariato).
Restano per M3: misure aggiuntive oltre a peso e girovita, confronto tra settimane, grafico del girovita.

## M4 — Alimentazione, promemoria in app, riepilogo settimanale ✅

Richiesta utente 2026-11-09: "le giornate sono tutte organizzate, quindi dovrà esserci un promemoria per ogni evento rilevante".

Fatto:
- 34 promemoria predefiniti dalla routine (pranzo, spuntino/pre-palestra, palestra, cena, sonno, pesata mar/ven 08:00, spesa domenica 18:00), modificabili per giorno in Impostazioni (orario, titolo, attivo, elimina, nuovi personalizzati).
- Con l'app aperta: popup all'orario (solo il più recente scaduto nelle ultime 3 h, nessuna raffica), sospesi durante l'allenamento; "Più tardi" (15′), "Non oggi".
- Popup pasto: "Come previsto" dal piano (eredita la stima se coincide con un pasto abituale), pasti abituali con un tocco, testo libero con kcal facoltative, "Saltato".
- Popup pesata; popup palestra/spesa che portano alla schermata giusta.
- Agenda di oggi in dashboard con stato (fatto, saltato, posticipato, da registrare); completamento automatico quando il dato viene registrato.
- Diario pasti per settimana con totale teorico per giorno; pasti abituali modificabili con fonte dei valori (stima/etichetta/inserito).
- Riepilogo settimanale: calorie e proteine medie teoriche con copertura, pasti registrati/previsti, allenamenti e serie, peso medio.
- Backup v3 (pasti, abituali, promemoria).

Criteri di accettazione:
- [x] Ogni evento della routine ha un promemoria modificabile (test API).
- [x] Dal popup all'inserimento salvato in 1 tocco per i pasti abituali/previsti (e2e).
- [x] Nessun valore nutrizionale senza fonte; somme marcate come stime e con pasti senza valori dichiarati (test + e2e).
- [x] Posticipo e "non oggi" funzionanti (test + e2e).
- [ ] Notifiche a schermo spento: non possibili in una webapp HTTP → M6 (Capacitor).

## M4b — Pasto composto, catalogo, modifiche successive ✅ (1.6.0, 2026-11-09)
Richiesta utente: registrare primo, salsa, secondo e contorno della mensa e scegliere poi il momento (pranzo, cena, spuntino); poter modificare dopo qualsiasi valore con ricalcolo; abitudine di 2 pagnottine (~200 g) dopo la palestra.
Fatto: editor del vassoio con categorie del menu della mensa, quantità a passi di ½, "porto a casa" (secondo per cena, escluso dal pranzo e proposto dal popup della cena insieme al pane), totale live, scelta pasto e giorno; catalogo piatti che impara; modifica di pasti, pesate e sedute passate. Layout web a tutta larghezza.
Da fare: inserimento del menu del giorno (foto o testo) per precompilare il catalogo della giornata — solo con decisione esplicita, nessun servizio esterno.

## 1.8.0 (2026-11-10) — funzioni potenziate e schermate uniformate

Richiesta utente: potenziare le funzioni, rendere coerente l'aspetto, agenda "col puntatore live in base all'ora", API pubbliche dove utili, pasti inseriti a mano da ritrovare la volta dopo, sonno "nel calderone", riferimenti di proteine e calorie.

Fatto:
- **Oggi**: linea del tempo verticale con eventi distanziati in proporzione all'orario, puntatore "adesso" che scorre (aggiornato ogni 15 s), conto alla rovescia al prossimo evento, azione sull'evento successivo; riquadri 2×2 con calorie e proteine rispetto ai riferimenti scelti dall'utente, sonno e peso (un tocco per registrare); avviso degli alimenti in scadenza.
- **Sonno**: registrazione di ora di letto e sveglia, durata calcolata, media settimanale in Oggi, pannello in Progressi con grafico dell'orario di letto.
- **Pasti**: ricerca nel catalogo mentre si scrive, ricerca prodotti su Open Food Facts con porzione in grammi (D-018), pasti recenti riselezionabili con un tocco, "scrivi tu" che entra nel catalogo con i suoi valori.
- **Palestra**: RIR facoltativo dopo il ✓, nota per esercizio che resta tra le sedute, proposta "+ passo di carico" quando l'ultima volta tutte le serie hanno raggiunto il massimo delle ripetizioni (precompila soltanto: la scheda non cambia).
- **Spesa**: totale reale pagato per settimana con storico rispetto al budget, flusso "Spesa arrivata" (spuntati in dispensa, i ricorrenti restano in lista), articoli "ogni settimana".
- **Aspetto**: stesse intestazioni, riquadri e pulsanti in tutte le viste; moduli lunghi a comparsa; icone al posto di emoji e simboli; meno testo esplicativo.
- Schema 7 (solo tabelle nuove), backup v4.

Verificato: 72 pytest, 20 test JS, 89 controlli e2e (telefono e desktop, Open Food Facts simulato nei test; la chiamata reale è stata provata a mano dal container). Non verificato: telefono reale; qualità dei dati di Open Food Facts per i prodotti Esselunga.
Non fatto: importazione del sonno dall'orologio (D-019), prezzi reali per articolo, lista della spesa generata dal piano, grafico del girovita, confronto tra settimane.

## M4c — Stime nutrizionali personali (in parte coperta da D-018)
Sostituire le stime generiche con quelle dei prodotti reali (etichette Esselunga, secondi del lavoro se hanno etichetta). Nessun database esterno senza decisione esplicita.

## M5 — Spesa, dispensa, budget
Liste per settimana con storico; quantità numeriche + unità; prezzo stimato vs reale; spesa effettiva vs budget; dispensa con luogo e scadenze; generazione lista = fabbisogno piano − inventario; esportazione testo; nessuna integrazione Esselunga automatica (D-010).

## M6 — App Android con notifiche native ✅

Richiesta 2026-11-09: Samsung S25 Ultra, APK scaricabile dalla pagina web.

Fatto:
- Progetto Capacitor 6 (`mobile/`), build e firma in Docker (`scripts/build-apk.sh`), chiave in `/opt/fitweek-secrets`.
- L'app carica la webapp dal server (sempre aggiornata senza reinstallare); pagina offline inclusa se il server non è raggiungibile.
- Notifiche locali per tutti i promemoria abilitati, prossimi 14 giorni, senza quelle di oggi già registrate; riallineamento all'avvio, al ritorno in primo piano, dopo ogni registrazione e modifica dei promemoria.
- Tocco sulla notifica → popup giusto; tasto indietro Android (chiude popup, torna indietro, riduce a icona).
- Impostazioni: download APK (solo dopo login) con istruzioni Samsung; dentro l'app stato permessi, orari esatti, numero notifiche, notifica di prova.

Criteri di accettazione:
- [x] APK firmato scaricabile dalla webapp (e2e).
- [x] Notifiche programmate correttamente dai promemoria del server (test JS + e2e con bridge simulato).
- [ ] Prova su S25 Ultra reale: installazione, notifiche ad app chiusa, battery optimization Samsung.
- [ ] Uso fuori casa: richiede VPN o HTTPS pubblico protetto (decisione utente).

Non fatto: offline completo (registrare senza server: oggi la coda locale copre brevi cali di rete, ma l'app deve poter caricare la pagina), aggiornamento automatico dell'APK, iOS.

## 1.10.4 (2026-11-13) — correzioni della seconda review

FW-REV-009 (orari delle modifiche al millisecondo) e FW-REV-010 (uscita che non si dà per riuscita se non lo è): vedi la sezione "Review indipendente" in cima e D-028. Nessuna funzione nuova, nessun cambio di schema. Stato: nel repository, **non in produzione**; APK `next` da ricompilare dopo il deploy.

## 1.10.3 (2026-11-13) — correzioni della prima review indipendente

Otto finding del reviewer (FW-REV-001…008) corretti con test di riproduzione: vedi la sezione "Review indipendente" in cima e D-026. Nessuna funzione nuova. Stato: nel repository, **non in produzione**.

## 1.10.2 (2026-11-12) — token nel Keystore, sessioni a scorrimento, backup fuori disco, scheda "Adesso" e lista dal piano

Completamento del piano di consolidamento (D-024):

Fatto e verificato su container usa-e-getta (85 pytest, 44 test JS, 136 controlli e2e in 6 file):
- **Sicurezza e sessioni**: token dell'app autonoma custodito nell'Android Keystore (`SecureTokenPlugin.java`, AES-256-GCM) con migrazione automatica da `localStorage` e pulizia completa all'uscita (token, cache locale, coda e modifiche non inviate); rinnovo automatico a scorrimento dopo 24 h (`last_seen_at`, `X-Renewed-Token` / cookie); elenco dei dispositivi collegati e revoca singola (`GET /api/v1/sessions`, `DELETE /api/v1/sessions/{id}`); avviso `#http-warning` sulla schermata di accesso quando l'indirizzo è `http://`; guida completa in `docs/SECURITY.md` e checklist per S25 Ultra in `docs/ANDROID_CHECKLIST.md`.
- **Backup cifrato fuori disco**: `scripts/backup-offsite.sh` cifra (AES-256-CBC + PBKDF2) l'ultimo backup SQLite verificato e la chiave di firma dell'APK (`/opt/fitweek-secrets`), trasferisce verso `OFFSITE_DEST` (cartella montata o `scp`), verifica l'integrità (SHA-256 + prova di decifratura su archivio temporaneo) e supporta `--restore`.
- **Oggi — scheda "Adesso"**: `pickNowFocus()` in `static/js/timeline.js` mostra in cima a Oggi l'unica azione non completata in corso o imminente (−30 min … +90 min) senza duplicare il pulsante della palestra e nascondendosi durante una seduta aperta.
- **Dal piano alla dispensa alla lista**: quantità numerica `amount` + `unit` su lista spesa e dispensa (schema 8, migrazione additiva con estrazione dalle stringhe esistenti); ingredienti strutturati per giorno in `Pasti → Piano` (senza secondi per le cene lun–ven, coperti dal lavoro); pulsante `"Genera dal piano"` in `Spesa → Lista` con finestra di conferma che calcola `fabbisogno − dispensa non scaduta` nella stessa unità e lascia vuoto il prezzo se non già inserito dall'utente.

## 1.10.1 (2026-11-12) — consolidamento: nessuna perdita di dati, conflitti, notifiche

Richiesta utente: prima un prodotto stabile, poi nuove funzioni. Dettagli in D-022 e D-023.

Fatto e verificato su container usa-e-getta (83 pytest, 35 test JS, 128 controlli e2e in 6 file):
- App autonoma: tempo massimo sulle richieste, pulsante "Lavora offline" dopo 2,5 s, rientro in linea automatico.
- Palestra: esercizio completato solo su conferma, "Togli serie" accanto a "Serie extra".
- Coda e stato: nessuna scrittura scartata per errori del server; rifiuti in "Modifiche non inviate"; avviso a memoria piena.
- Conflitti: `X-Edited-At` su serie, pasti, sonno e note; avviso quando la stessa voce è cambiata su due dispositivi; scheda fusa per esercizio; una pesata per giorno; stato riletto al rientro.
- Notifiche: "Più tardi" riprogramma la notifica; le notifiche esistenti non vengono più cancellate prima di averne programmate di nuove.
- Test: nuovo `reliability.e2e.js`; `native.e2e.js` non dipende più dall'ora; attesa dopo l'avvio del container (Chromium annullava i caricamenti con `net::ERR_NETWORK_CHANGED`).

Stato del rilascio: in produzione dal 2026-11-12 (deploy `cd20548`, backup `pre-deploy-cd20548`, container healthy, schema 7 invariato). APK `next` 1.10.1 ricompilato dopo il deploy, con tutte le voci qui sopra. Regola per il futuro: se le pagine usano qualcosa di nuovo del server (qui l'intestazione `X-Edited-At`), l'APK va compilato dopo il deploy.

Da fare (in ordine): prova su S25 Ultra con checklist; token nel Keystore, rinnovo e elenco dispositivi, `docs/SECURITY.md` (serve la scelta su HTTPS); backup fuori dal server (serve la destinazione); scheda "Adesso" in dashboard; lista della spesa generata dal piano.
Non coperto: `X-Edited-At` per le modifiche alle sedute (`PATCH`/`DELETE`); notifiche oltre i 14 giorni senza aprire l'app.

## 1.10.0 (2026-11-11) — interfaccia a schede (design system v3)

Implementato e verificato (pytest 78, test JS, e2e Playwright dei 5 file) su container usa-e-getta. In produzione (verificato il 2026-11-12: `/api/health` risponde `1.10.0`, schema 7).

- Schede orizzontali in ogni vista (`tabs()`), niente elementi sovrapposti, Oggi a tutta altezza su desktop.
- Pasti: striscia dei 7 giorni + riepilogo del giorno; piano a griglia settimanale; abituali per momento del giorno.
- Spesa: Lista (categorie in colonne con subtotale) / Dispensa / Spese (colonne + tabella).
- Progressi: Peso / Allenamento / Sonno; grafici a linea disegnati alla larghezza reale.
- Impostazioni: Generale / Promemoria / App Android / Dati e accesso.
- Test: `workout.e2e.js` ora sceglie sempre il Giorno A (prima falliva nei giorni di palestra B/C). Nota: i test e2e restano sensibili all'orario a cavallo della mezzanotte (promemoria alle 23:57/23:59, date calcolate in UTC tra le 00:00 e le 01:00).

## 1.9.0 (2026-11-10) — app Android autonoma, tappa 1 di 2

Richiesta utente: app che funziona da sola e sincronizza con il server nei due sensi, poi un modello IA sul telefono (Google AI Edge) per leggere il menu della mensa.

Tappa 1, fatta: vedi D-021. APK di prova `mobile/dist/fitweek-next.apk` (canale `next`), scaricabile da Impostazioni → App Android nella webapp.
Verificato: 78 pytest, 29 test JS, 103 controlli e2e, compreso un percorso completo "accesso → serie e pesata senza rete → riavvio senza rete → modifica da un altro dispositivo → ritorno online e fusione". Non verificato: l'APK su un telefono vero.
Prova richiesta all'utente (S25 Ultra): installazione accanto all'app attuale, accesso, una serie e una pesata in modalità aereo, chiusura e riapertura dell'app, ritorno in Wi-Fi, notifica di prova.

Tappa 2, da fare dopo la conferma della tappa 1: plugin nativo con LiteRT-LM (Gemma scaricato dall'utente) e funzione "menu della mensa" con proposte da confermare; modulo spento di default (regola 7).

## M7 — Rifinitura
Accessibilità completa, performance, schede multiple / nuovo programma dopo le 8 settimane, sonno (registrazione leggera, opzionale).

## M8 — Assistente AI opzionale
Modulo isolato, disattivato di default, provider configurabile da env, consenso per invio dati con anteprima, sole proposte (D-009): pianificazione settimanale, riepilogo, pasti compatibili con la dispensa, lacune nei dati.

---

## Quick win (alto valore, basso rischio) — candidati per l'inizio di M1

1. `.gitignore` + repo dedicato + commit iniziale.
2. Correzione progressioni `b6`/`c5` (seed + migrazione idempotente).
3. Bozza allenamento in localStorage.
4. Impostazioni/Logout nella bottom nav mobile.
5. 400 invece di 500 su input malformato; `compare_digest` su bytes.
6. Header di sicurezza.
7. Escape completo delle interpolazioni + solo `https:` per i video.
8. `TZ=Europe/Rome` nel compose.
9. README allineato alla configurazione reale.
