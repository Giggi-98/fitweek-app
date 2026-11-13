# FitWeek — Audit iniziale Frontend & UX

- Data: 2026-11-13
- Responsabile: chat 03, namespace FW-UX-XXX
- Repository: Giggi-98/fitweek-app
- Branch applicativo: main; archivio: review/engineering
- Baseline di codice ispezionata: `2dac1ab955224228659143f70fff8c01cef01029`
- HEAD osservato durante audit: `70f7607a923c36e476ef833aa7cb270c870dd05e` (solo documentazione dopo baseline)
- HEAD osservato prima di pubblicare: `5e333bd8ca290f96fc81dfddff66934de623614a` — quattro nuovi commit applicativi NON ancora revisionati da questa chat
- Checkpoint ufficiale REVIEW_LEDGER.md: `null` (nessun avanzamento)
- Verdetto: **MODIFICHE RICHIESTE, preliminare / statico**.
- Nessun test browser, screenshot, Lighthouse, dispositivo Android o APK eseguito. Nessuna verifica visiva dichiarata.

## Perimetro

Lette da GitHub le viste `static/js/views/{dashboard,training,meals,shopping,progress,settings}.js`, `static/index.html`, `static/js/{main,ui,store,sync}.js`, `static/js/workout/queue.js`, `docs/DESIGN_SYSTEM.md`. Sono osservazioni statiche della baseline, non certificazione del nuovo HEAD o della produzione. I nuovi commit a sincronizzazione, logout, backend e test richiedono revisione autonoma; nessun finding altrui è considerato risolto soltanto per la loro presenza.

## Finding indipendenti

### FW-UX-001 — P2 — Rimozione non reversibile di articoli spesa/dispensa
- Stato: **aperto; conferma statica baseline**.
- Evidenza: `static/js/views/shopping.js:242-250` rimuove immediatamente l'elemento da `groceries` o `inventory` e chiama `persistState()` senza conferma né Undo nel ramo.
- Scenario/impatto: tocco accidentale della piccola azione di rimozione su telefono; articolo rimosso e potenzialmente sincronizzato, senza recupero guidato.
- Fix: Undo temporaneo robusto rispetto al salvataggio asincrono, senza aggiungere conferme invasive per ogni spunta.
- Test: rimuovi/annulla, ricarica, rete offline/online, assenza duplicati.
- Distinto da `FW-REV-008`, che riguarda conflitto delete locale vs update remoto.

### FW-UX-002 — P2 — ARIA tabs senza comportamento tastiera completo
- Stato: **aperto; conferma statica baseline**.
- Evidenza: `static/js/ui.js:32-35` emette `role=tablist`, `role=tab`, `aria-selected`, ma non roving tabindex, `aria-controls` o gestione dei tasti freccia. `static/js/main.js:177-183` gestisce Enter/Spazio per elementi con `role=button`, non la navigazione tra tab.
- Scenario/impatto: navigazione tastiera dei tab del piano pasti e viste condivise incompleta rispetto alla semantica dichiarata; impatto screen reader da provare.
- Fix: pattern tab/panel completo con tasti freccia, Home/End, focus, oppure semantica semplice di pulsanti se non sono veri tab.
- Test: Tab, frecce, Home/End, stato selezionato, associazione pannello, touch.

### FW-UX-003 — P2 — Button annidati nel label della checkbox spesa
- Stato: **aperto; markup confermato, runtime non verificato**.
- Evidenza: `static/js/views/shopping.js:51-52` genera `<label>` che contiene checkbox e due `<button>` (ricorrenza e rimozione).
- Scenario/impatto: semantica di etichetta e controlli interattivi incoerente; possibili annunci/azioni ambigui con input assistivo. NON è dimostrato il toggle involontario.
- Fix: contenitore non-label per la riga, label riferita soltanto alla checkbox, bottoni fratelli con nomi accessibili.
- Test: click/tap sulle singole azioni, tastiera e screen reader.

## Valutazione flussi principali (solo sorgente)

| Flusso | Osservato nel codice | Da provare |
| --- | --- | --- |
| Dashboard/agenda | CTA inizia/riprendi allenamento, azioni sonno e peso, timeline | Gerarchia visiva e leggibilità |
| Allenamento | Stepper kg/reps, check serie, timer recupero, aptica | Touch target, tastiera e uso con una mano |
| Diario pasti/piano | Aggiunta e modifica pasti, tab giorni, stime dichiarate | Tap count, accessibilità, errori |
| Spesa/dispensa | Spunte singole, generazione da piano, arrivo spesa | FW-UX-001/003, rapidità |
| Peso, sonno, progressi | Inserimento storico, tabelle e grafici | Viewport stretti, leggibilità |
| Impostazioni | Sessioni, notifiche, backup, restore, modifiche rifiutate | Messaggi irreversibilità/logout |
| Android/offline | Boot offline, coda e stato sync | APK e riconnessione reali |
| Navigazione/accessibilità | Sidebar desktop e nav mobile a cinque voci, dialog nativo | Focus, zoom, contrasto, lettore di schermo |

Obiettivi UX **da misurare** (non risultati): avvio seduta dalla dashboard 1-2 tocchi; conferma serie precompilata 1 tocco; modifica carico + conferma 2-3 interazioni; pasto abituale 4-5 tocchi massimo; spunta prodotto 1 tocco; peso 3-4 interazioni massimo.

## Collegamenti con registri di altre chat (senza duplicati)

- `FW-REV-001/002` (P1): serie perse/ricreate, affidabilità feedback registrazione.
- `FW-REV-003` (P1): merge piano pasti stesso giorno.
- `FW-REV-004` (P2): export JSON coerente.
- `FW-REV-005/006` (P2): Keystore Android, logout con operazioni pendenti.
- `FW-REV-008` (P2): conflitti dispensa non comunicati.
- `FW-REV-007` (P3): documentazione progressioni non allineata.
- `FW-ARCH-001` (P2): restore parziale; il messaggio in `static/js/views/settings.js:285-290` afferma che sostituisce «tutti i dati», da chiarire nell'ambito del finding esistente.
- `FW-ARCH-002` (P2): documentazione architettura disallineata.

Gli stati citati appartengono al Ledger/audit di area 02 consultati, **non** sono stati riverificati contro il HEAD più recente.

## Test ed evidenze

- Reviewer eseguiti: **nessuno**. Solo lettura codice/documenti GitHub.
- Dichiarati: repository contiene test Python, JS ed E2E Playwright; esito non attestato.
- Mancanti: browser/screenshot, screen reader, viewport 320/360/390/768 px, APK Android stable/next, offline→online→riavvio, tap count, regressioni dei tre FW-UX.

## Prossimi passi

Verificare i quattro commit successivi a `70f7607` prima di aggiornare stato dei problemi correlati. Eseguire QA visiva e Android. Correggere FW-UX-001/002/003 con test specifici. Nessuna modifica a main, codice, issue, PR, REVIEW_LEDGER o documenti di altre aree è autorizzata da questo audit.
