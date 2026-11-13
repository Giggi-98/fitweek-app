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


---

## Aggiornamento incrementale UX — 2026-11-13 — `70f7607..5e333bd`

**HEAD applicativo staticamente esaminato:** `5e333bd8ca290f96fc81dfddff66934de623614a`. Questa sezione aggiorna, senza riscriverle, le osservazioni della baseline riportate sopra. **Verdetto UX: MODIFICHE RICHIESTE.** Checkpoint ufficiale del Ledger: `null`, invariato.

### Commit e cambiamenti verificati

- `b0f78d2`: introduzione tombstone delle serie, snapshot coerente per backup ed aggiornamento documentazione. Effetti UX indiretti sulla fiducia nei dati.
- `79304c6`: nuova gestione coda di operazioni in volo, merge del piano pasti per slot, avvisi di conflitto, migrazione token e logout centralizzato con avviso di modifiche non inviate.
- `d8817c4` e `5e333bd`: documentazione/versionamento e coordinamento maker/reviewer; nessun intervento visuale significativo individuato.
- I file di layout e stile non sono stati ridisegnati in questo intervallo. Nessuna QA visiva o test runtime eseguito.

### Miglioramenti UX supportati staticamente, NON certificati runtime

1. `static/js/workout/queue.js`: la risposta di una richiesta in volo rimuove soltanto la stessa operazione tramite controllo di identità; riduce la possibilità che una seconda correzione di carico/ripetizioni venga eliminata dalla coda. **Collegamento: FW-REV-001**, ancora aperto per test.
2. `static/js/sync.js`: piano pasti fuso per giorno e slot, con trattamento degli ingredienti e conflitti; migliora la conservazione di correzioni indipendenti. **FW-REV-003** ancora in verifica; limitazione residuale ingredienti con identità ambigua.
3. `static/js/store.js`: `conflictNotice()` distingue versione locale conservata e voce remota mantenuta dopo cancellazione locale, con istruzione esplicita di eliminarla nuovamente se necessario. **FW-REV-008**; rimane un avviso temporaneo da valutare su dispositivo.
4. `static/js/logout.js:15-30`: tentativo di flush prima di uscire, conteggio delle modifiche pendenti, richiesta di conferma prima dello scarto e pulizia effettiva della coda. **FW-REV-006**: fix staticamente supportato, non chiuso.

### Rischi prioritari già registrati, senza nuovi ID UX

- **FW-REV-009 (P1), con FW-REV-002:** timestamp delle serie normalizzati al secondo consentono collisioni tra DELETE e PUT offline nello stesso secondo; non presumere integrità delle serie.
- **FW-REV-010 (P2):** `static/js/logout.js:25-29` ignora errore HTTP di revoca e `static/js/platform.js:65-68` ignora errore Keystore clear; l'app può riavviarsi pur mantenendo un token recuperabile. Non è dimostrata un'occorrenza in produzione.
- **FW-ARCH-001 (P2):** resta necessario chiarire il messaggio di ripristino rispetto ai domini realmente sostituiti. Proprietà chat 02.

### Rivalutazione dei finding UX proprietari

| Finding | Stato a `5e333bd` | Evidenza |
| --- | --- | --- |
| **FW-UX-001 (P2)** | **Aperto** | `static/js/views/shopping.js:242-250`: rimozione immediata senza Undo |
| **FW-UX-002 (P2)** | **Aperto** | `static/js/ui.js:32-35`: semantica tab senza navigazione completa da tastiera |
| **FW-UX-003 (P2)** | **Aperto** | `static/js/views/shopping.js:51-52`: bottoni annidati nel label della checkbox |

### Test, regressioni e prossima verifica

- **Test eseguiti dal reviewer UX:** nessuno; solo ispezione di diff e file GitHub.
- **Test aggiunti dal maker:** sorgenti di test JS, Python e Playwright presenti nei commit; nessuna attestazione di esito da parte di questa chat.
- **Test mancanti:** Undo della rimozione, indipendenza checkbox/pulsanti, accessibilità tab da tastiera, viewport e schermate reali, APK Android e ciclo offline→online→riavvio, errori HTTP+Keystore, timestamp subsecondo.
- **Regressioni UX nuove accertate:** nessuna oltre ai rischi registrati dalla chat 01; assenza di QA runtime impedisce di escluderle.
- **Prossima azione:** priorità ai problemi di integrità serie e logout di proprietà chat 01, quindi tre finding FW-UX con prove di interazione; non assegnare duplicati né avanzare il checkpoint.

Questa appendice riflette il codice fino a `5e333bd`; la sezione iniziale conserva intenzionalmente il contesto storico precedente.


---

## Aggiornamento incrementale UX — 2026-11-13 — `5e333bd..e014e0d`

- **HEAD main verificato:** `e014e0da498ffa05d8b0570c76cec2f074224483`.
- **Intervallo:** sette commit `9c5f20d`, `1418d74`, `d57212b`, `b8fa875`, `1e7702d`, `1327e5d`, `e014e0d` (compare GitHub).
- **Metodo:** revisione statica del compare, dei sorgenti applicativi interessati e dei test aggiunti; **nessun test Node/Python/Playwright eseguito dal reviewer**, nessuna prova visuale, screen reader o APK Android.
- **Verdetto:** **CORREZIONI UX SUPPORTATE STATICAMENTE, VERIFICA RUNTIME NECESSARIA**. Il verdetto globale di sicurezza/affidabilità e il checkpoint ufficiale restano esclusivi della chat 01; secondo il Ledger letto prima della scrittura, checkpoint `null`.
- **Contesto:** le sezioni precedenti registrano lo stato agli SHA precedenti; questa è la valutazione successiva, non la cancellazione dello storico.

### Stato aggiornato dei tre finding UX

| Finding | Valutazione indipendente a `e014e0d` | Evidenza e prova mancante |
| --- | --- | --- |
| **FW-UX-001 (P2)** — Eliminazione accidentale | **Fix presente, verifica runtime pendente; non chiuso** | `static/js/views/shopping.js:21,232-264` inserisce `removeWithUndo()` per `groceries` e `inventory`; toast "Annulla" per 7 s e ripristino con `putBack()` stesso ID/posizione (`static/js/util.js`). `tests/js/ui.test.mjs` include casi di doppio annullamento/idempotenza; `tests/e2e/ux.e2e.js:60-107` descrive offline, persistenza, reload e dispensa. Test NON eseguiti; verificare che toast concorrenti non facciano sparire prematuramente Undo e che errori/ritardi di persistState non ne impediscano l'uso. |
| **FW-UX-002 (P2)** — Tabs ARIA | **Fix parziale, aperto** | `static/js/ui.js:33-45` aggiunge roving `tabindex` e helper per frecce/Home/End; `static/js/main.js:173-192` attiva la scheda e recupera il focus dopo il render. `tests/js/ui.test.mjs:11-41`, `tests/e2e/ux.e2e.js:109-155` contengono scenari da eseguire. **Mancano ancora associazioni tab/pannello** (es. `aria-controls`, `role="tabpanel"`) per il pattern ARIA dichiarato; occorre decidere se completarlo o usare pulsanti semantici, provando la navigazione con screen reader. |
| **FW-UX-003 (P2)** — Bottoni dentro label spesa | **Fix presente, verifica runtime pendente; non chiuso** | `static/js/views/shopping.js:52-53`: `<div class="shoprow">` contiene `<label class="shopitem">` per la checkbox, mentre i pulsanti ricorrenza e rimozione sono fratelli esterni alla label, dotati di nomi accessibili. `tests/e2e/ux.e2e.js:36-58` descrive controlli indipendenti. Non eseguito con browser o lettore schermo. |

### Altre modifiche di interfaccia rilevanti (finding già di altre aree)

- **FW-REV-009/002 (P1, chat 01):** `app/workouts.py` conserva ora la precisione in millisecondi; correzione da verificare dalla chat 01 con scenari out-of-order, non chiusa da questa chat.
- **FW-REV-010 (P2, chat 01):** `static/js/logout.js:28-49` distingue fallimento revoca HTTP e uscita non possibile, richiede conferma del rischio nel client standalone e mostra messaggio su cancellazione Keystore non confermata. `static/js/platform.js:35-46,53-60,84-105` rilegge il Keystore e conserva un marcatore di uscita impedendo ri-autenticazione silenziosa. Nessun test di dispositivo, offline reale o rilancio APK.
- **FW-ARCH-001 (P2, chat 02):** `static/js/backup.js:19-44` e `static/js/views/settings.js:284-288` mostrano ora, prima di ripristinare, quali domini vengono sostituiti e quali mantenuti. I test `tests/js/backup.test.mjs`, `tests/test_restore_matrix.py`, `tests/e2e/ux.e2e.js` sono presenti ma non eseguiti dal reviewer.
- **FW-ARCH-002 (P2, chat 02):** `docs/ARCHITECTURE.md` aggiornato; verifica/chiusura di competenza esclusiva chat 02.

### Rischi UX residui e test obbligatori

1. **FW-UX-002:** completare semantica dei pannelli o adottare un modello navigazionale alternativo correttamente accessibile. Verificare tastiera, focus, tasti freccia, Home/End, associazione al contenuto, screen reader e mobile.
2. **FW-UX-001:** eseguire E2E Undo, persistenza, offline/online, reload e **toast concorrenti**; le due chiamate `persistState()` non sono attese dalla funzione.
3. **FW-UX-003:** E2E indipendenza ricorrenza/checkbox/rimozione; tastiera e lettore schermo.
4. Eseguire realmente `tests/js/ui.test.mjs` e `tests/e2e/ux.e2e.js`, annotando comando, exit code e risultato; nessun risultato di suite del maker viene assunto come prova del reviewer.
5. Eseguire QA responsive 320/360/390/768 px e APK Android stable/next, con screenshot, touch target e scenari offline.

**Nuovi finding esclusivi UX:** nessuno supportato da evidenza sufficiente in questo intervallo. **Finding UX formalmente chiusi:** nessuno; due fix staticamente supportati, un fix parziale.


---

## Review UX incrementale — 2026-11-13 — `e014e0d..439dc83`

- **HEAD applicativo verificato su GitHub:** `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`.
- **Intervallo:** 4 commit fast-forward: `9ba8b7c4872ab6d93217917b6e751211ea710f75`, `cfb68d845b7054803982d8b646b7a23a0d8d9a17`, `f2bf1e6d11eab164b296b78cde5873325820bbfc`, `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`.
- **Perimetro:** diff e sorgenti di UI/sottoviste, shopping/Undo, logout, piattaforma Android, test aggiunti, `CLAUDE.md`, `DESIGN_SYSTEM.md`, handoff del maker `2026-11-13-439dc83.maker.md`. Nessun APK/dispositivo, browser interattivo o test eseguito dal reviewer.
- **Verdetto area 03:** **APPROVATO CON RISERVE per avanzamento statico; nessun finding UX chiuso formalmente**. Il checkpoint ufficiale di chat 01 resta `null` secondo il Ledger consultato; nessuna modifica al Ledger.
- **Nota sull'autore:** i commit sono attribuiti all'account GitHub `ThaOcelot`; GitHub non permette di distinguere con affidabilità quale modifica sia stata prodotta da Claude e quale da Kimi. Le dichiarazioni del maker non costituiscono test indipendenti.

### Risultati dei finding dell'area 03

**FW-UX-001 — P2 — Undo cancellazione spesa/dispensa.** **Fix supportato staticamente, verifica runtime pendente; resta aperto.**

- Codice `static/js/views/shopping.js:232-264`: `removeWithUndo` elimina la voce con `takeById`, registra lo stato, mostra un toast Annulla per 7 secondi e la reintroduce con `putBack` usando lo stesso ID.
- A `439dc83` è stato aggiunto `tests/js/store.test.mjs:41-129` per la serializzazione dei PUT, Undo durante un PUT in volo, HTTP 409/merge, eliminazione modificata altrove e doppie rimozioni. Sono test di componenti e moduli reali, **non** un E2E completo del clic sul toast in condizioni concorrenti.
- **Limite UX confermato dal codice:** `static/js/ui.js:4-19` mantiene un singolo toast, sovrascritto dal successivo `replaceChildren`. Due rimozioni ravvicinate possono far sparire il primo Annulla prima dei 7 secondi promessi. Il maker conferma che è un comportamento intenzionalmente attuale, non prova perdita automatica di dati. Miglioramento consigliato: conservare un recupero per ogni eliminazione ancora annullabile (es. toast con conteggio/stack o piccola coda d'azioni), senza introdurre modali bloccanti; verificare con tocchi rapidi e toast di sincronizzazione.

**FW-UX-002 — P2 — Semantica e tastiera delle schede.** **Fix sostanziale ma non completo in tutti gli utilizzi; aperto.**

- `static/js/ui.js:35-48` introduce ID stabili, `aria-controls` opzionale e `tabpanel()` con `role="tabpanel"` e `aria-labelledby`; `static/js/main.js:173-192` continua a gestire frecce, Home/End e recupero del focus.
- Collegamenti presenti nei tab principali di `dashboard.js`, `meals.js`, `shopping.js`, `progress.js`, `settings.js` e nelle sottoschede Elenco/Carichi di Progressi.
- **Copertura non totale:** `static/js/views/meals.js:113,150` (giorni del piano, momenti dei pasti abituali) e `static/js/views/settings.js:44,209` (giorni promemoria, selezione tema) usano ancora `tabs()` senza pannello associato. Non è corretto considerare chiuso il requisito generale soltanto perché il nuovo E2E controlla i tab che già espongono `aria-controls`: `tests/e2e/ux.e2e.js:161` seleziona espressamente `[role=tab][aria-controls]`, non verifica tutti i `[role=tab]`.
- **Rimedio consigliato:** collegare i veri tab secondari a pannelli, oppure renderli controlli appropriati alla loro funzione (es. radio/segmented selection per il tema). Testare anche assistive tech, focus e contenuto dopo i cambi di giorno/pasto.

**FW-UX-003 — P2 — Button dentro label della checkbox.** **Fix presente staticamente, da verificare su dispositivo; resta aperto.**

- `static/js/views/shopping.js:52-53` mantiene pulsanti e label come fratelli nella riga `.shoprow`, con nomi accessibili; i test `tests/e2e/ux.e2e.js:36-58` controllano la separazione e l'indipendenza delle azioni, ma non sono stati eseguiti da questo reviewer.
- Rimangono necessari tastiera reale, click sui pulsanti e screen reader; nessuna regressione nuova confermata nello specifico markup.

### Cambi trasversali di proprietà altrui

- **FW-REV-010 — chat 01:** `static/js/platform.js:41-170` introduce ulteriore wipe/lettura Keystore, marcatore di uscita localStorage e cookie WebView, più probe di scrivibilità; `static/js/logout.js:20-55` comunica il caso peggiore. Miglioramento del feedback supportato staticamente. Il maker stesso segnala che se **nessun** canale conserva il marcatore e la memoria torna funzionante al riavvio, il token può ancora restare valido. Non registrato come un nuovo finding UX e non dichiarato risolto.
- **FW-ARCH-001 — chat 02:** `app/main.py` intercetta il restore invalido con 422 e rollback dichiarato; `tests/test_restore_matrix.py` include scenario aggiuntivo. La UI di conferma è stata già migliorata. Spetta alla chat 02 verificarlo.
- **FW-REV-002/009 — chat 01:** nessun ulteriore intervento diretto in questo intervallo; mantenere la richiesta di test indipendenti su timestamp subsecondi.

### Evidenza dei test e distribuzione

- **Reviewer:** nessuna suite eseguita, nessuna QA browser, nessun lettore schermo o APK reale. Non attestare `PASS`.
- **Maker (dichiarazioni nel suo handoff):** `scripts/check.sh` = 105 pytest + 83 JS, `scripts/e2e.sh` = 169 controlli in 7 file, exit 0; nessun log indipendentemente acquisito.
- **Produzione (solo dichiarazione successiva del maker):** versione 1.10.6 distribuita, schema 9 migrato, backup preliminari e APK next ricompilato; **non verificati dal reviewer**. La prova su S25 Ultra e screen reader è ancora assente.
- **Test aggiuntivi consigliati:** E2E doppia rimozione in 7 s con doppio Undo; qualunque toast concorrente; tutte le tablist (incluse le sottoschede), lettore schermo; Android offline/online e riavvio; test indipendenti delle suite prima di chiudere un finding.

**Prossima azione UX:** chiudere il gap semantico di FW-UX-002; migliorare la recuperabilità di FW-UX-001 sotto azioni ripetute; certificare FW-UX-003 su browser/dispositivo. Non sono stati identificati nuovi ID UX in questo intervallo.
