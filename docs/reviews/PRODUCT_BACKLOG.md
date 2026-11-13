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