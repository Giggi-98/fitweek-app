# FitWeek — Backlog Frontend & UX

- Owner: chat 03; namespace esclusivo `FW-UX-XXX`.
- Data: 2026-11-13.
- Origine: `UX_AUDIT.md`, ispezione statica della baseline `2dac1ab955224228659143f70fff8c01cef01029`.
- HEAD noto prima della pubblicazione: `5e333bd8ca290f96fc81dfddff66934de623614a`; commit successivi **non revisionati dalla chat 03**.
- Branch di archivio: `review/engineering`; checkpoint ufficiale `null`, gestito solo dalla chat 01.
- `UX-QA-XXX` indica attività di verifica, NON bug accertato.

## Priorità ordinate per rischio, impatto e frequenza

| Ordine | Intervento | Priorità | Owner | Evidenza / stato |
| --- | --- | --- | --- | --- |
| 1 | Affidabilità serie offline e feedback salvataggio | P1 | FW-REV-001/002 (chat 01) | Aperti nel Ledger consultato; nuovo HEAD da verificare |
| 2 | Undo per cancellazione accidentale in spesa/dispensa | P2 | FW-UX-001 | Aperto, statico |
| 3 | Checkbox/azioni semanticamente indipendenti nella spesa | P2 | FW-UX-003 | Aperto, statico |
| 4 | Tab/pannelli accessibili da tastiera | P2 | FW-UX-002 | Aperto, statico |
| 5 | Logout con coda offline e feedback attendibile | P2 | FW-REV-006 (chat 01) | Stato successivo non verificato |
| 6 | Chiarezza restore e domini interessati | P2 | FW-ARCH-001 (chat 02) | Stato successivo non verificato |
| 7 | Conflitti pasti e inventario | P1/P2 | FW-REV-003/008 (chat 01) | Stato successivo non verificato |
| 8 | Tap count e leggibilità allenamento mobile | Verifica | UX-QA-001 | Mai misurato |
| 9 | Responsive, contrasto, focus, touch target | Verifica | UX-QA-002 | Mai misurato |
| 10 | Android offline/online/riavvio stable e next | Verifica | UX-QA-003 | Mai eseguito |

## Criteri di accettazione dei finding UX

### FW-UX-001 — Undo spesa/dispensa
Modificare in modo mirato `static/js/views/shopping.js` e, se necessario, riusare il toast azionabile esistente in `static/js/ui.js`. Dopo la rimozione deve essere possibile annullare senza duplicati né perdita durante salvataggio, offline e reload. Testare cancellazione/Undo e coerenza finale.

### FW-UX-002 — Tabs accessibili
Intervenire su `static/js/ui.js`, wiring di `static/js/main.js` e viste interessate. Pattern semantico completo o alternativa più semplice corretta. Testare Tab, frecce, Home/End, focus visibile, aria-selected, associazione col contenuto e regressione touch.

### FW-UX-003 — Riga spesa accessibile
In `static/js/views/shopping.js` separare checkbox e sua label dai button ricorrenza/rimozione. Test click singoli, tastiera e screen reader; nessuna azione collaterale.

## Piano QA (non nuovi finding)

- **UX-QA-001:** su telefono Android registrare tocchi reali, tempi e correzioni per: dashboard→palestra (target 1–2), serie precompilata (1), modifica carico + serie (2–3 interazioni), pasto abituale (max 4–5), spunta prodotto (1), peso (max 3–4). Sono obiettivi, non misure.
- **UX-QA-002:** testare viewport 320, 360, 390, 768 px, zoom 200%, navigazione tastiera, reader, error/loading, grafici, scroll orizzontale, target touch e contrasto. Non inventare Lighthouse.
- **UX-QA-003:** test APK stable e next con primo login, rete persa, serie/pasti/spesa, riavvio, ritorno online, code, conflitti e notifiche. Documentare versione APK/backend e prove effettive.

## Coordinamento e aggiornamenti

Prima di cambiare gli stati, rileggere su GitHub HEAD main, `REVIEW_LEDGER.md`, ultimo report, `ARCHITECTURE_AUDIT.md`, questo backlog e il codice pertinente. Non chiudere FW-UX soltanto per affermazioni del developer. Non duplicare FW-REV/FW-ARCH, non avanzare checkpoint. Solo i due file UX possono essere aggiornati dalla chat 03 con autorizzazione esplicita; verificare sempre la persistenza rileggendo da GitHub.


---

## Aggiornamento backlog UX — 2026-11-13 — HEAD applicativo `5e333bd`

Revisione statica incrementale di `70f7607..5e333bd`. La tabella iniziale rimane come storico della baseline; **questa sezione rappresenta l'ordinamento operativo corrente per il codice esaminato**, senza chiudere finding di altri owner. Nessun test browser, APK o Android è stato eseguito. Checkpoint ufficiale Ledger: `null`.

| Ordine attuale | Attività | Priorità | Owner | Stato statico e accettazione |
| --- | --- | --- | --- | --- |
| 1 | Proteggere le serie eliminate da scritture offline precedenti nello stesso secondo | P1 | FW-REV-002 / FW-REV-009, chat 01 | **Aperto**; precisione subsecondo e test out-of-order obbligatori |
| 2 | Logout affidabile quando falliscono revoca HTTP e clear Keystore | P2 | FW-REV-010, chat 01 | **Aperto**; non presentare logout riuscito né ri-autenticare silenziosamente |
| 3 | Undo eliminazione accidentale di lista e dispensa | P2 | FW-UX-001, chat 03 | **Aperto**; Undo robusto contro persistenza asincrona, reload e rete instabile |
| 4 | Separare checkbox, etichetta e pulsanti nella lista spesa | P2 | FW-UX-003, chat 03 | **Aperto**; tastiera/tocco/reader, nessun toggle collaterale |
| 5 | Completa semantica e navigazione tastiera delle schede | P2 | FW-UX-002, chat 03 | **Aperto**; focus, frecce, Home/End, aria-controls/panel o pattern alternativo valido |
| 6 | Verifica effettiva fix coda e merge | P1/P2 | FW-REV-001/003/006/008, chat 01 | Fix **supportati staticamente**, test e UX Android non eseguiti |
| 7 | Chiarire restore domini e conferma | P2 | FW-ARCH-001, chat 02 | **Aperto**; UI aderente alla matrice dei dati |
| 8 | Tap count flussi quotidiani Android | Verifica | UX-QA-001 | Non misurato |
| 9 | Responsive, focus e accessibilità reale | Verifica | UX-QA-002 | Non misurato |
| 10 | Offline→online→riavvio APK stable/next | Verifica | UX-QA-003 | Non testato |

### Stato dopo il diff

- **FW-UX-001/002/003:** tutti aperti; nessuna modifica risolutiva nei file pertinenti a `5e333bd`.
- **FW-REV-001:** identity settlement della queue; miglioramento statico, test indipendenti pendenti.
- **FW-REV-003:** merge slot pasti; miglioramento statico, test indipendenti pendenti.
- **FW-REV-006:** preavviso/scarto esplicito della queue al logout; miglioramento statico; distinguere FW-REV-010.
- **FW-REV-008:** avviso di conflitto delete/update; miglioramento statico, ancora da provare su Android.
- **FW-REV-009/010:** finding ufficiali della chat 01, **non duplicare** nel namespace FW-UX.

### Indicazioni al maker

1. Correggere prima i rischi di integrità dei dati e falsa uscita, coordinandosi con chat 01.
2. Implementare FW-UX-001 e FW-UX-003 insieme in `static/js/views/shopping.js`; riusare componenti esistenti e includere test di Undo, checkbox e bottoni.
3. Implementare FW-UX-002 con semantica tastiera corretta e test delle viste che usano il componente `tabs()`.
4. Eseguire e riportare test effettivi, separando screenshot/browser da Android reale; evitare redesign, dipendenze o migrazioni non necessari.
5. Prima di qualsiasi futura scrittura rileggere l'HEAD branch, il Ledger e gli SHA dei due file UX; preservare storia, contributi concorrenti e proprietà documentali.


---

## Aggiornamento operativo UX — 2026-11-13 — HEAD `e014e0d`

Questa sezione **sostituisce l'ordinamento operativo corrente** delle precedenti tabelle, mantenute come storico. Revisione statica dei sette commit `5e333bd..e014e0d`; il codice aggiornato contiene fix e nuovi test, ma nessun test applicativo o Android è stato eseguito dal reviewer. Checkpoint Ledger letto prima di scrivere: `null`.

| Ordine | ID / attività | Priorità | Stato a `e014e0d` | Accettazione o verifica necessaria |
| --- | --- | --- | --- | --- |
| 1 | **FW-UX-002** schede ARIA e pannelli | P2, chat 03 | **Parziale — aperto** | Completare relazioni `aria-controls`/`tabpanel`, oppure semantica di navigazione alternativa; E2E tastiera, screen reader e touch |
| 2 | **FW-UX-001** Undo rimozione spesa e dispensa | P2, chat 03 | **Fix statico, test pendenti** | Eseguire `tests/js/ui.test.mjs` e `tests/e2e/ux.e2e.js`; testare toast concorrenti, Undo doppio, offline/online, reload e errori di salvataggio |
| 3 | **FW-UX-003** controlli indipendenti riga spesa | P2, chat 03 | **Fix statico, test pendenti** | Provare markup, checkbox, pulsanti, lettore schermo, touch; nessun toggle involontario |
| 4 | **FW-REV-002/009** serie offline | P1, chat 01 | Fix timestamp presente, stato ufficiale altrui invariato | Test consegna PUT/DELETE out-of-order nello stesso secondo e Android |
| 5 | **FW-REV-010** logout Android | P2, chat 01 | Fix statico presente, stato ufficiale altrui invariato | Test doppio fallimento HTTP+Keystore, riavvio APK e messaggi all'utente |
| 6 | **FW-ARCH-001** restore domini | P2, chat 02 | Miglioramento UI/statico presente, stato ufficiale altrui invariato | Eseguire test matrice backup legacy e completa, comunicazione prima della conferma |
| 7 | **UX-QA-001** tap count flussi quotidiani | QA | Non misurato | Confrontare con target originali su device |
| 8 | **UX-QA-002** responsive/accessibilità | QA | Non eseguito | 320/360/390/768 px, zoom 200%, focus, contrasto, screen reader e screenshot |
| 9 | **UX-QA-003** APK Android offline | QA | Non eseguito | Stable/next, perdita rete, retry, riavvio, sincronizzazione, messaggi |
| 10 | Verifica degli altri fix offline/merge | QA, chat 01 | Solo evidenza statica | FW-REV-001/003/006/008 da verificare indipendentemente |

### Criteri e vincoli aggiornati

- Non assegnare nuovi `FW-UX` ai problemi già posseduti da `FW-REV` o `FW-ARCH`.
- Non chiudere `FW-UX-001/003` soltanto perché il codice e i test sono presenti: servono esiti documentati.
- Per `FW-UX-002`, evitare un rifacimento generalizzato dell'interfaccia; intervento minimo sul componente e sulle viste realmente coinvolte.
- Segnalare l'eventuale sostituzione del toast Undo come rischio da **provare**, non come bug confermato.
- Non confondere test Playwright su emulazione Pixel 7 con test su APK/dispositivo Android fisico.
- Non modificare Ledger, documenti dell'area 01/02, `main`, Issues o PR senza autorizzazione specifica.


---

## Backlog UX aggiornato — 2026-11-13 — `439dc83`

**Baseline incrementale di questa sezione:** `e014e0da498ffa05d8b0570c76cec2f074224483..439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7` (4 commit). Il backlog precedente resta come cronologia; **questa è la sequenza operativa più recente**. Verifica solo statica GitHub, nessuna suite del reviewer eseguita, checkpoint ufficiale `null` nel Ledger consultato.

| Ordine | Finding / verifica | Priorità | Stato evidenza | Criterio di accettazione |
| --- | --- | --- | --- | --- |
| 1 | **FW-UX-002** — completare tab secondari e selettori | P2 | Fix parziale; **aperto** | Per ogni `role=tablist`, tab ↔ pannello corretto, oppure semantica alternativa coerente. Intervenire su `meals.js:113,150`, `settings.js:44,209`; tastiera e screen reader; estendere E2E oltre `[role=tab][aria-controls]` |
| 2 | **FW-UX-001** — più eliminazioni e toast concorrenti | P2 | Fix Undo presente; limite UX confermato | Rimozione rapida di due articoli: ogni azione recuperabile almeno nella finestra UX promessa; toast rete non deve nascondere l'unico Undo; test unitari e browser |
| 3 | **FW-UX-003** — validazione assistiva lista spesa | P2 | Markup corretto staticamente, test mancanti | Tastiera, reader, touch e clic su checkbox, ricorrenza/rimozione senza attivazioni collaterali |
| 4 | **UX-QA-002** — prove responsive e accessibilità | QA | Non eseguito | 320/360/390/768 px, focus, zoom, contrasto, tablist, screenshot, lettore schermo |
| 5 | **UX-QA-003** — Android reale e offline | QA | Non eseguito | APK next 1.10.6 su device, rete assente/ripristinata, perdita dati, riavvio, logout e avvisi |
| 6 | **UX-QA-001** — efficienza dei flussi | QA | Non misurato | Tap count obiettivi precedenti su telefono reale |
| 7 | **FW-REV-010** — logout sicuro | P2 / chat 01 | Nuovo codice presente; stato di terzi invariato | Fallimenti combinati Keystore/localStorage/cookie e riavvio; comunicazione corretta |
| 8 | **FW-REV-002/009** — serie offline | P1 / chat 01 | Modifiche precedenti, stato di terzi invariato | Test out-of-order entro stesso secondo sul backend e Android |
| 9 | **FW-ARCH-001** — restore atomico e UX conferma | P2 / chat 02 | Nuova gestione 422; stato di terzi invariato | Prova su DB isolato con backup legacy, valido e malformato |
| 10 | Verifica indipendente test del maker | QA | Solo dichiarazioni nel handoff | Rilanciare `scripts/check.sh` / `scripts/e2e.sh`; documentare output e exit code |

### Test e rischi specifici

- Il maker ha aggiunto `tests/js/store.test.mjs` con casi per PUT concorrenti, merge 409 e doppia rimozione: **file verificato; esiti non verificati**. Il test toast attuale `tests/js/ui.test.mjs:85-100` registra la sostituzione del toast precedente, **non** la possibilità di annullare entrambe le rimozioni.
- `tests/e2e/ux.e2e.js:161-171` controlla solo le tab con `aria-controls`: l'asserzione va estesa a **tutti** i tab con semantica dichiarata o bisogna escludere i selettori di preferenza dalla tablist.
- Evitare redesign, dipendenze, migrazioni e alterazioni del backend non giustificati; i cambi frontend nell'APK next richiedono ricompilazione e verifica sul dispositivo.
- Handoff `docs/reviews/2026-11-13-439dc83.maker.md`: dichiarazioni di deploy 1.10.6 e APK next pronto, **da verificare indipendentemente**. Nessuna attribuzione individuale dimostrabile tra Claude e Kimi in base ai commit.
- Non modificare `REVIEW_LEDGER.md`, audit di altre aree, `main`, issue o PR. Nessuna chiusura senza prove di codice **e** test appropriati.
