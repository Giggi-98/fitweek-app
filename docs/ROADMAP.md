# Roadmap

Adattata al codice reale (audit 2026-11-09). Rispetto alla proposta iniziale: la **schermata allenamento mobile** sale a M2 (massimo valore quotidiano) insieme alle fondamenta del frontend e al design system, perché il logger nuovo richiede comunque codice leggibile e token; light mode entra già in M2. Le milestone successive restano nell'ordine proposto.

Stato: ⬜ da fare · 🔄 in corso · ✅ fatto · ⏸ in attesa di autorizzazione

| # | Milestone | Stato |
|---|---|---|
| M1 | Stabilizzazione, protezione dati, sicurezza | 🔄 (audit + docs fatti; implementazione ⏸) |
| M2 | Fondamenta frontend, design system, allenamento mobile | ⬜ |
| M3 | Dashboard "Oggi" e progressi | ⬜ |
| M4 | Alimentazione: calendario e pasti consumati | ⬜ |
| M5 | Spesa, dispensa, budget | ⬜ |
| M6 | PWA e offline | ⬜ |
| M7 | Rifinitura: accessibilità, performance, schede multiple | ⬜ |
| M8 | Assistente AI opzionale e integrazioni | ⬜ |

---

## M1 — Stabilizzazione, protezione dati, sicurezza

**Obiettivo**: nessuna perdita di dati possibile per cause tecniche; codice versionato; errori gestiti; scheda coerente col PDF. Nessun cambiamento visibile importante oltre ai fix.

Attività:
1. ⏸ Repo git dedicato in `/opt/fitweek-app` + `.gitignore` + commit iniziale dello stato attuale (D-012).
2. ⏸ `scripts/backup.sh` / `restore.sh` (backup API SQLite, verifica integrità, rotazione); prova di ripristino su container usa-e-getta; timer host (D-007 per i dettagli del volume).
3. ⏸ Volume con nome esplicito, migrato via backup (D-007).
4. Backend: corpo malformato → 400; `compare_digest` su bytes; validazione Pydantic di `PUT /api/state` (tipi e limiti per ogni dominio); header di sicurezza (CSP `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: same-origin`); rate limit login (es. 5 tentativi/min + backoff); `session_epoch` per invalidare le sessioni al logout/"esci da tutti i dispositivi"; logging strutturato (JSON, senza dati personali); `TZ=Europe/Rome`.
5. Migrazione dati idempotente: correzione `b6` e `c5` (TRAINING_PROGRAM.md), applicata solo se i valori correnti sono quelli errati del seed; backup prima. Correzione di `seed.py`.
6. Frontend (fix mirati sul file esistente, previa formattazione leggibile): `esc()` su tutti i valori interpolati; URL video solo `https:`; Impostazioni + Logout raggiungibili da mobile; bozza allenamento (incluse data, durata, note) in localStorage con ripristino; gestione 409 recuperabile (ricarica server + riapplica bozza); articoli senza categoria visibili; conferma eliminazione pesata.
7. Test: `tests/` con pytest + httpx (auth, rate limit, 400/401/403/409/413, validazione, backup) eseguiti nell'immagine Docker; `scripts/check.sh` (syntax check + test).
8. README allineato (porta, volume, backup).

Dipendenze: autorizzazione per 1–3 e per il deploy finale.

Criteri di accettazione:
- [ ] `git log` mostra il commit iniziale; `.env` non è tracciato.
- [ ] Un backup automatico esiste, supera `PRAGMA integrity_check` e un ripristino su container usa-e-getta restituisce gli stessi conteggi.
- [ ] Nessun endpoint restituisce 500 per input malformato (test).
- [ ] Uno stato con tipi errati (es. `weight` stringa HTML) è rifiutato con 422 (test).
- [ ] Dopo 5 login errati in 1 minuto le richieste successive ricevono 429 (test).
- [ ] Dopo il logout il vecchio cookie riceve 401 (test).
- [ ] Le risposte includono gli header di sicurezza e la SPA funziona con la CSP (verifica manuale + test header).
- [ ] Le serie previste di `b6` e `c5` coincidono col PDF nel DB live dopo la migrazione; gli altri esercizi invariati (test sulla migrazione).
- [ ] Ricaricando la pagina a metà compilazione di un allenamento, i valori inseriti sono ancora presenti.
- [ ] Da smartphone (< 750 px) si raggiungono Impostazioni e Logout.
- [ ] Dopo un 409 l'utente può recuperare senza perdere la bozza.
- [ ] `scripts/check.sh` passa; healthcheck `healthy` dopo il deploy.

Test previsti: pytest API; test della migrazione su copia del DB live; verifica manuale da telefono (checklist in PR).
Rischi: la CSP può rompere stili inline presenti in `app.js` (mitigazione: spostare gli inline style in classi, o `style-src 'self' 'unsafe-inline'` temporaneo dichiarato); migrazione volume (mitigazione: il vecchio volume non viene cancellato).

## M2 — Fondamenta frontend, design system, allenamento mobile

**Obiettivo**: registrare una seduta dal telefono con una mano: apri l'app → "Inizia Giorno A · W3" → per ogni serie un tocco su ✓ (valori pre-compilati) → timer parte da solo.

Attività: de-minificazione e divisione in ES modules (D-002); `tokens.css` con dark/light; navigazione con hash routing e bottom nav a 5 voci; tabelle `programs/…/sessions/set_logs` con migrazione dei `workouts` esistenti (D-003, D-004); API `today`, `sessions`, `set-logs` idempotenti (D-005); settimana calcolata (D-006); logger per serie con stepper, pre-compilazione dall'ultima seduta, serie non completata, timer recupero, RPE/RIR opzionali, note per esercizio, cardio come esercizio a tempo; riepilogo fine seduta; riprogrammazione seduta saltata.
Accettazione: seduta completa registrabile con ≤ 1 tocco per serie quando si ripetono i carichi; nessuna perdita dati chiudendo il browser a metà; dati storici migrati con conteggi identici; Lighthouse accessibilità ≥ 90 su mobile; dark e light verificati.
Test: unit test JS delle funzioni di dominio (`node --test`), pytest su API e migrazione, checklist manuale su telefono reale.
Rischi: regressioni durante la divisione in moduli (mitigazione: prima solo spostamento di codice, poi modifiche).

## M3 — Dashboard "Oggi" e progressi
Obiettivo: la dashboard risponde a "cosa faccio adesso". Timeline del giorno basata sulla routine (lavoro, pre-gym, palestra, cena); CTA allenamento; trend peso con media mobile 7 gg (marcata "calcolata"); misure aggiuntive; grafici carichi per esercizio; confronto settimane; frequenza allenamenti.
Accettazione: dati calcolati distinti visivamente dai registrati; grafici con alternativa tabellare.

## M4 — Alimentazione
Calendario per data; pasti pianificati vs consumati (un tocco: "mangiato come previsto"); secondo del lavoro come pasto disponibile lun–ven; pasti abituali e ricette veloci; ingredienti/porzioni; valori nutrizionali con fonte (D-011).
Accettazione: nessun valore nutrizionale mostrato senza fonte; weekend con proposte basate su ciò che è in dispensa.

## M5 — Spesa, dispensa, budget
Liste per settimana con storico; quantità numeriche + unità; prezzo stimato vs reale; spesa effettiva vs budget; dispensa con luogo e scadenze; generazione lista = fabbisogno piano − inventario; esportazione testo; nessuna integrazione Esselunga automatica (D-010).

## M6 — PWA e offline
Manifest, icone, service worker per la shell, coda offline delle serie. Prerequisito: HTTPS in LAN (D-008) — decisione utente.

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
