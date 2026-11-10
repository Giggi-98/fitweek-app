# Roadmap

Adattata al codice reale (audit 2026-11-09). Rispetto alla proposta iniziale: la **schermata allenamento mobile** sale a M2 (massimo valore quotidiano) insieme alle fondamenta del frontend e al design system, perché il logger nuovo richiede comunque codice leggibile e token; light mode entra già in M2. Le milestone successive restano nell'ordine proposto.

Stato: ⬜ da fare · 🔄 in corso · ✅ fatto · ⏸ in attesa di autorizzazione

| # | Milestone | Stato |
|---|---|---|
| M1 | Stabilizzazione, protezione dati, sicurezza | ✅ in produzione dal 2026-11-09 (resta: verifica manuale da telefono) |
| M2 | Fondamenta frontend, design system, allenamento mobile | ✅ 2026-11-09 (parziali: RIR/RPE UI, note per esercizio, grafici → M3) |
| M3 | Dashboard "Oggi" e progressi | 🔄 progressi fatti in 1.7.0 (2026-11-10); restano misure aggiuntive e confronto settimane |
| M4 | Alimentazione, promemoria in app, riepilogo settimanale | ✅ 2026-11-09 (notifiche native → M6) |
| M5 | Spesa, dispensa, budget | ⬜ |
| M6 | App Android (Capacitor) con notifiche native | ✅ 2026-11-09 (accesso fuori casa: serve VPN) |
| M7 | Rifinitura: redesign v2 ✅ (1.5.0); accessibilità, performance, schede multiple ⬜ |
| M8 | Assistente AI opzionale e integrazioni | ⬜ |

---

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

## M4c — Stime nutrizionali personali (proposta)
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
