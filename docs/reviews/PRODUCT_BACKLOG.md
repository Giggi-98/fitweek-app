# FitWeek — Product Backlog (proposta iniziale)

- Data: 2026-11-13; owner: chat 04; namespace esclusivo `FW-PROD-XXX`.
- HEAD codice di riferimento: `5e333bd8ca290f96fc81dfddff66934de623614a` (`main`).
- Branch di pubblicazione: `review/engineering`.
- Stato: **BACKLOG INIZIALE PUBBLICATO**; nessuna modifica a Ledger o agli audit delle altre chat.
- P1/P2/P3 qui esprimono **priorità di prodotto**, non severità di un nuovo bug tecnico. Le evidenze tecniche restano dei relativi owner.

## Backlog ordinato per rischio e valore

| Ordine | ID | Problema / opportunità | Priorità | Costo indicativo | Stato | Dipendenze |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | FW-PROD-001 | Dimostrare integrità del ciclo allenamento offline su Android reale prima della promozione di `next` | P1 | M (QA, non nuova feature) | BLOCCATO / DA VERIFICARE | FW-REV-001/002/005/006; review 1.10.3 |
| 2 | FW-PROD-002 | Validare backup/restore comprensibile e affidabile prima di considerarli protezione completa | P1 | M (QA e definizione contratto) | BLOCCATO / DA VERIFICARE | FW-REV-004; FW-ARCH-001 |
| 3 | FW-PROD-003 | Ridurre il doppio lavoro tra descrizioni del piano e ingredienti per la lista | P2 | S per studio; M per possibile soluzione mirata | PARZIALE / PROPOSTO | FW-REV-003; codice `meals.js`, `stats.js`, `shopping.js` |
| 4 | FW-PROD-004 | Verificare flusso mensa → secondo per cena → correzioni successive senza doppio conteggio | P2 | S (QA); fix solo se fallisce | IMPLEMENTATO / DA VERIFICARE | Affidabilità pasti FW-REV-003, app/daily.py |
| 5 | FW-PROD-005 | Misurare e semplificare tocchi/tempi nelle azioni più frequenti su Android | P2 | S (QA); M se servono correzioni | DA VERIFICARE | Chat 03 UX-QA-001/003; FW-UX-001/003 |
| 6 | FW-PROD-006 | Validare uso settimanale della spesa: scorte, scadenze, quantità, prezzi sconosciuti e arrivo spesa | P2 | S (QA); fix condizionato | IMPLEMENTATO / DA VERIFICARE | FW-UX-001/003; FW-REV-008 |
| 7 | FW-PROD-007 | Decidere quale percorso serva dopo le 8 settimane prima di realizzare schede multiple | P3 | S ricerca; L per ipotetica feature | PIANIFICATO / NON AUTORIZZATO | Continuità programma e fedeltà al PDF; nessuna nuova dipendenza richiesta |
| 8 | FW-PROD-008 | Valutare in futuro lettura menu mensa con AI solo dopo consolidamento | P3 | L e rischio alto | PIANIFICATO / RINVIATO | D-009, D-021, device reale, consenso e accuratezza |

## Schede e criteri di accettazione

### FW-PROD-001 — Gate Android / allenamento
**Beneficio:** fiducia che ogni serie resti salvata, anche senza rete. **Frequenza:** tre sedute settimanali. **Accettazione:** su device reale, creare/modificare/eliminare una serie in offline, chiudere/riaprire app, connettersi, verificare una volta sola il valore server; eseguire anche modifica concorrente, uscita con coda pendente e scenario Keystore non disponibile; registrare versione APK, versione backend e risultato. Nessuna promozione automatica `next`→`stable`. **Owner implementazione:** Claude; verifiche tecniche indipendenti chat 01/02/03.

### FW-PROD-002 — Gate backup/restore
**Beneficio:** poter recuperare dati senza ambiguità. **Accettazione:** su database temporaneo, per backup correnti e legacy documentare quali domini vengono sostituiti, mantenuti o non supportati; mostrare chiaramente all'utente l'effetto; nessun test distruttivo in produzione; esito dati per dominio verificato. Coordinare con FW-ARCH-001, senza attribuirne la risoluzione a questa chat.

### FW-PROD-003 — Piano → spesa, senza doppio inserimento
**Beneficio:** meno minuti la domenica e meno articoli dimenticati. **Evidenza:** `meals.js` espone descrizioni di pasti e un elenco `items` separato; `stats.js:planProposal()` usa solo `items`. **Accettazione iniziale:** eseguire almeno tre scenari realistici di settimana, misurare ciò che manca in lista e le correzioni manuali. **Se confermato:** proposta minima di riuso/collegamento esplicito degli ingredienti, senza parser non verificato, senza stime inventate, senza aggiornare spesa senza conferma. Mantenere esclusione secondo mensa lun–ven e sottrazione scorte non scadute.

### FW-PROD-004 — Flusso pranzo/cena della mensa
**Beneficio:** registrazione rapida senza doppio conteggio. **Accettazione:** pranzo con primo, contorno e secondo marcato "porto a casa"; pranzo esclude il secondo, cena lo propone e lo conta una sola volta; correzioni successive aggiornano i totali; fonte dei dati chiara; nessun obbligo di registrare colazione/spuntini o penalità per weekend.

### FW-PROD-005 — Misura dei flussi frequenti
**Beneficio:** meno interazioni in palestra e durante i pasti. **Accettazione:** raccolta su telefono vero di tocchi/tempi per avvio allenamento, serie invariata, serie modificata, pasto abituale, riga spesa, pesata; confrontare con target chat 03 (avvio ≤2 tocchi, serie invariata 1, spunta prodotto 1); non chiamare bug uno scostamento senza osservazione. Nessun redesign senza un problema misurato.

### FW-PROD-006 — Ciclo lista/dispensa/spesa reale
**Beneficio:** ridurre sprechi e mantenere budget indicativo senza prezzi fittizi. **Accettazione:** lista dal piano e dispensa; verifica quantità e unità; articoli scaduti non coprono fabbisogno; articoli senza prezzo rimangono ignoti; spuntati trasferiti alla dispensa correttamente; spesa reale distinta dalla stima; rimozione accidentale gestita nell'ambito FW-UX-001; conflitti sincronizzazione verificati nell'ambito FW-REV-008.

### FW-PROD-007 — Proseguimento programma dopo settimana 8
**Beneficio:** continuità di allenamento solo se necessaria. **Accettazione:** chiarire quando termina il ciclo in uso e che cosa deve accadere (riavvio ciclo, nuovo programma o pausa); conservare storico, carichi e programma originario; nessuna generazione automatica di progressioni e nessuna implementazione prima della decisione.

### FW-PROD-008 — AI lettura menu (posticipata)
**Beneficio ipotetico:** meno inserimento manuale per mensa. **Accettazione per rivalutazione, non sviluppo:** device Android `next` verificato, flusso manuale rapido e affidabile, misurazione tempo risparmiabile, prova di accuratezza con menu reali, conferma esplicita delle proposte, privacy/costi/manutenzione verificati. Non procedere ora.

## Roadmap raccomandata

- **Ciclo 0, prima di feature nuove:** FW-PROD-001 e 002; verifiche indipendenti FW-REV, FW-ARCH; Android reale, backup isolato.
- **Ciclo 1:** FW-PROD-003, 004 e 006 come prove di flusso; fix minimi solo per problemi confermati.
- **Ciclo 2:** FW-PROD-005 e decisione FW-PROD-007; correzioni UX coordinate con chat 03.
- **Oltre:** FW-PROD-008 e altre integrazioni solo se il beneficio supera costi/rischi.

## Regole di modifica e storico

Prima di pubblicare: rileggere HEAD `main`, `PRODUCT_REVIEW.md` e `PRODUCT_BACKLOG.md` se esistono, Ledger, audit chat 02/03 e roadmap. Non sovrascrivere contributi concorrenti. Scrivere soltanto questi due file su `review/engineering` con autorizzazione esplicita e rileggere dopo la pubblicazione. Il checkpoint ufficiale resta esclusivamente della chat 01.
---

## Aggiornamento backlog — 2026-11-13 — e014e0d

- **Baseline product aggiornata:** `e014e0da498ffa05d8b0570c76cec2f074224483`, sette commit successivi a `5e333bd`.
- **Stato ufficiale chat 01:** review statica del delta `APPROVATO CON RISERVE`; checkpoint pienamente verificato `null`; FW-REV-001…010 non formalmente chiusi. Le correzioni dichiarate dal maker non equivalgono a test del reviewer.
- **Altri owner:** chat 02 mantiene aperti FW-ARCH-001/002; chat 03 mantiene FW-UX-001/002/003 (001/003 con fix statico, 002 parziale). Nessun finding tecnico duplicato.

### Ordine operativo (ID esistenti preservati)

| Rank | ID | Stato dopo verifica | Dipendenze/criterio per avanzare |
| --- | --- | --- | --- |
| 1 | **FW-PROD-001 — P1** | **BLOCCATO / DA VERIFICARE**; correzioni di sicurezza e serie in `main`, runtime e APK non certificati | FW-REV-001/002/005/006/009/010; verificare subsecondo out-of-order, stesso millisecondo, coda persistente, fallimenti Keystore + marcatore localStorage, logout/riavvio, test su Android reale e versione APK/backend |
| 2 | **FW-PROD-002 — P1** | **BLOCCATO / DA VERIFICARE**; semantica UI restore più chiara | FW-REV-004; FW-ARCH-001. Test isolato v1–v4, `replaced`/`kept`, `reminder_acks`, `set_tombstones`, rollback; JSON non è ripristino completo SQLite |
| 3 | **FW-PROD-003 — P2** | **PRONTO PER ANALISI, NON PER SVILUPPO** | Eseguire tre settimane tipo piano testuale/ingredienti → lista e contare prodotti mancanti, correzioni e minuti. Fix solo se beneficio misurato; nessun parser automatico |
| 4 | **FW-PROD-004 — P2** | **DA VERIFICARE** | Percorso mensa→secondo asporto→cena con modifiche e nutrienti senza doppio conteggio; legame FW-REV-003 |
| 5 | **FW-PROD-005 — P2** | **DA VERIFICARE** | UX-QA-001/003; FW-UX-002 parziale; misurazioni su telefono, focus/tastiera/screen reader prima di ulteriori UI |
| 6 | **FW-PROD-006 — P2** | **DA VERIFICARE** | FW-UX-001/003 con correzioni in codice e test pendenti; Undo con toast concorrenti, offline/reload, sync FW-REV-008; lista e prezzi ignoti |
| 7 | **FW-PROD-007 — P3** | **PIANIFICATO / NON AUTORIZZATO** | Decidere prima esigenze reali del programma dopo settimana 8; nessuna implementazione avviata |
| 8 | **FW-PROD-008 — P3** | **RINVIATO** | AI solo dopo affidabilità Android, dati e beneficio misurabile |

### Gate e verifica della proposta

**Ciclo 0:** non promuovere Android `next` né attribuire recuperabilità completa finché mancano test indipendenti e prova su dispositivo/restore isolato. La roadmap dichiara 1.10.5 presente nel repository, non in produzione; APK `next` da ricompilare.

**Attività consentita in parallelo:** ricerca/QA di FW-PROD-003 (tre settimane tipo), senza modifiche applicative, evitando interferenze con le aree 01/02/03.

**Cicli successivi:** interventi minimi solo su frizioni validate; AI e nuove funzionalità non giustificate al momento.

**Misure richieste:** serie corrette dopo offline/riavvio 100% nei casi di test; nessuna ri-autenticazione silenziosa dopo logout non riuscito; restore isolato con conteggi per dominio; lista generata con ingredienti mancanti, correzioni manuali e tempo di preparazione settimanale. Si tratta di criteri proposti, **non risultati osservati**.


---

## Aggiornamento operativo del backlog 1.10.6 — 2026-11-13

- **Baseline:** `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7` (`e014e0d..439dc83`: 4 commit, GitHub compare).
- **Ultimo checkpoint ufficiale:** `null`; la chat 01 ha revisionato staticamente solo fino a `e014e0d`. I nuovi commit 1.10.6 attendono review incrementale della chat 01.
- **Ambito:** aggiornamento dei finding già esistenti FW-PROD-001…008, senza duplicare gli ID FW-REV/FW-ARCH/FW-UX.
- **Evidenze:** `static/js/platform.js`, `logout.js`, `ui.js`, `views/shopping.js`, `app/main.py`, test pertinenti e `docs/reviews/2026-11-13-439dc83.maker.md`. Maker dichiara 105 pytest, 83 JS, 169 E2E superati; reviewer 04 **non ha eseguito** le suite.

### Stato e prossime azioni, ordinate per valore/rischio

| Ordine | ID | Stato product | Azione richiesta al maker / prova di accettazione |
| --- | --- | --- | --- |
| 1 | **FW-PROD-001 (P1)** | **BLOCCATO / DA VERIFICARE**. Correzione FW-REV-010 1.10.6 in codice; gate Android ancora aperto. | Consegnare a chat 01 scenario e test FW-REV-010 (Keystore+localStorage+cookie, incluse memorie che recuperano funzionalità al riavvio); regressione serie FW-REV-002/009; fornire log verificabili di versione server/APK e device-test offline/riavvio/online, logout/revoca. **Nessuna promozione `next`→`stable` senza validazione.** |
| 2 | **FW-PROD-002 (P1)** | **BLOCCATO / DA VERIFICARE**. Restore 422/rollback aggiunto (`f2bf1e6`), FW-ARCH-001 resta di chat 02. | Mettere a disposizione prova di restore su **DB temporaneo** con v1–v4, domini sostituiti e mantenuti, collisione/422, rollback completo e differenze JSON vs SQLite. Proibita prova distruttiva su DB live senza autorizzazione. |
| 3 | **FW-PROD-006 (P2)** | **QA PRIORITARIO, non nuova feature**. Undo aggiunto in 1.10.5; limite toast unico caratterizzato in 1.10.6. | Concordare con chat 03 valutazione di due rimozioni rapide: primo Undo diventa inaccessibile dal toast quando compare il secondo. Misurare recuperabilità e frequenza; decidere se accettare il limite o chiedere intervento minimo. Test anche offline, 409, reload e dispensa; non chiamarlo perdita dati accertata. |
| 4 | **FW-PROD-005 (P2)** | **DA VERIFICARE**. Collegamenti `aria-controls` / `tabpanel` ora nel codice. | QA chat 03: browser e screen reader, tasti freccia/Home/End, focus, rapporto tab/pannello in tutte le viste e viewport reale; documentare risultati prima di chiudere FW-UX-002. |
| 5 | **FW-PROD-003 (P2)** | **PRONTO PER DISCOVERY, NON PER SVILUPPO** | Eseguire tre settimane alimentari tipo, misurare ingredienti omessi dalla lista, correzioni e tempo; solo dopo proporre la soluzione minima, senza parser/AI. |
| 6 | **FW-PROD-004 (P2)** | **DA VERIFICARE** | Test mensa→secondo asporto→cena e modifica del pasto senza doppio conteggio; coordinare FW-REV-003. |
| 7 | **FW-PROD-007 (P3)** | **RINVIATO** | Decisione su dopo-settimana-8 solo quando necessaria; nessun ampliamento automatico. |
| 8 | **FW-PROD-008 (P3)** | **RINVIATO** | AI menu mensa non autorizzata durante consolidamento. |

### Richiesta di handoff verificabile per la 1.10.6

- **Chat 01:** commit `9ba8b7c..439dc83`, condizione di ripartenza senza credenziali dopo guasti storage, FW-REV-002/009, regressioni e test indipendenti. Il Ledger e il checkpoint sono esclusivamente suoi.
- **Chat 02:** FW-ARCH-001: test isolati di restore e rollback, più controllo di coerenza fra API e interfaccia. Non duplicare la registrazione tecnica.
- **Chat 03:** FW-UX-001 toast multipli; FW-UX-002 semantica/lettore di schermo; FW-UX-003 regressione controlli spesa.
- **Chat 04:** valutare il **beneficio reale** e l'accettabilità del limite Undo, e predisporre la discovery di FW-PROD-003.

### Stato del rilascio e prerequisiti

Nell'**aggiornamento operativo** dell'handoff maker `2026-11-13-439dc83.maker.md`, Claude dichiara che il deploy **1.10.6/schema 9** è avvenuto, che sono presenti backup pre-deploy e pre-migrazione e che l'APK `next` **versionCode 11006** è stato ricompilato. Queste sono **dichiarazioni del maker**, non verifiche indipendenti del reviewer 04; il dispositivo Android, l'integrità dei backup e la distribuzione effettiva richiedono prove. **Non usare le precedenti frasi «non in produzione» come stato corrente accertato.**

**Gate 0 NON SUPERATO:** prima dell'approvazione di prodotto occorrono review chat 01 fino al nuovo HEAD, test critici indipendenti, compatibilità server/APK e verifica fisica del flusso offline/online, nonché ripristino isolato. Il fatto che il maker abbia eventualmente distribuito non rappresenta approvazione del reviewer.

**Handoff a Claude:** consultare il backlog in GitHub, produrre soltanto le evidenze e gli interventi minimi elencati; evitare nuova feature e riscritture. Non modificare documenti di altre aree né avanzare checkpoint. Pubblicazione di questa appendice non autorizza ulteriori deploy o modifiche a `main`.
