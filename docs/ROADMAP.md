# Roadmap

Adattata al codice reale (audit 2026-11-09). Rispetto alla proposta iniziale: la **schermata allenamento mobile** sale a M2 (massimo valore quotidiano) insieme alle fondamenta del frontend e al design system, perché il logger nuovo richiede comunque codice leggibile e token; light mode entra già in M2. Le milestone successive restano nell'ordine proposto.

Stato: ⬜ da fare · 🔄 in corso · ✅ fatto · ⏸ in attesa di autorizzazione

| # | Milestone | Stato |
|---|---|---|
| M1 | Stabilizzazione, protezione dati, sicurezza | ✅ in produzione dal 2026-11-09 (resta: verifica manuale da telefono) |
| M2 | Fondamenta frontend, design system, allenamento mobile | ✅ 2026-11-09 (parziali: RIR/RPE UI, note per esercizio, grafici → M3) |
| M3 | Dashboard "Oggi" e progressi | ⬜ |
| M4 | Alimentazione, promemoria in app, riepilogo settimanale | ✅ 2026-11-09 (notifiche native → M6) |
| M5 | Spesa, dispensa, budget | ⬜ |
| M6 | App mobile (Capacitor) con promemoria e offline — anticipabile dopo M2 (D-013) | ⬜ |
| M7 | Rifinitura: accessibilità, performance, schede multiple | ⬜ |
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

## M4b — Stime nutrizionali personali (proposta)
Sostituire le stime generiche con quelle dei prodotti reali (etichette Esselunga, secondi del lavoro se hanno etichetta). Nessun database esterno senza decisione esplicita.

## M5 — Spesa, dispensa, budget
Liste per settimana con storico; quantità numeriche + unità; prezzo stimato vs reale; spesa effettiva vs budget; dispensa con luogo e scadenze; generazione lista = fabbisogno piano − inventario; esportazione testo; nessuna integrazione Esselunga automatica (D-010).

## M6 — App mobile Capacitor: notifiche native dei promemoria, offline
Richiesta utente 2026-11-09 (D-013). Shell Capacitor sulla SPA esistente; notifiche locali programmate dalla routine (spuntino, pasti, palestra, pesata, spesa); tocco → popup di inserimento rapido; coda offline. Prerequisiti: HTTPS sul server (reverse proxy), auth adatta a un'app nativa, scelta piattaforma (Android/iOS). Le parti dati (pasti consumati, calorie teoriche, pesate pianificate) arrivano da M3–M4, quindi M6 può partire in parallelo a M4 una volta pronta l'infrastruttura HTTPS.
Accettazione: promemoria che arrivano all'orario anche con app chiusa e senza rete; dal promemoria all'inserimento salvato in ≤ 3 tocchi.

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
