# FitWeek — Architecture Audit

- **Area proprietaria:** 02 — Audit architetturale
- **Data:** 2026-11-13
- **Repository:** `Giggi-98/fitweek-app`
- **Branch applicativo:** `main`
- **HEAD verificato:** `70f7607a923c36e476ef833aa7cb270c870dd05e`
- **Baseline del codice applicativo esaminato:** `2dac1ab955224228659143f70fff8c01cef01029`
- **Differenza baseline → HEAD:** un commit documentale (`CLAUDE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`); nessuna modifica applicativa nel compare GitHub
- **Branch di archivio:** `review/engineering`
- **Metodo:** analisi statica mirata del codice e coordinamento con la review baseline; non è un audit runtime completo
- **Stato:** MODIFICHE RICHIESTE (preliminare); non costituisce nuovo verdetto della review incrementale
- **Checkpoint ufficiale:** `null` secondo `REVIEW_LEDGER.md`; non avanzato

## 1. Confini di responsabilità

Questa chat possiede esclusivamente `ARCHITECTURE_AUDIT.md` e `TECHNICAL_DEBT.md`. Il registro dei finding applicativi `FW-REV-XXX`, il checkpoint e i report incrementali appartengono alla chat 01. I finding propri di architettura hanno ID `FW-ARCH-XXX`. Prima di una nuova assegnazione confrontare sempre il Ledger ufficiale sul branch `review/engineering`.

Fonti primarie di coordinamento lette:
- `docs/reviews/REVIEW_LEDGER.md` (otto finding FW-REV aperti, nessuno risolto, checkpoint `null`)
- `docs/reviews/2026-11-13-2dac1ab.md` (baseline statica, test runtime non eseguiti)
- `docs/reviews/REVIEW_POLICY.md`
- Codice GitHub `app/main.py`, `static/js/sync.js`, `app/migrations.py`, `docker-compose.yml`; documenti `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`.

## 2. Architettura osservata

FitWeek è una webapp monoutente self-hosted con backend FastAPI/Python, SQLite in WAL e frontend JavaScript ES Modules. Docker Compose mantiene il database nel volume esterno `fitweek_data`; sono presenti backup coerenti SQLite e script di ripristino. Queste proprietà sono osservazioni del repository, non verifiche della produzione.

La persistenza è ibrida: `app_state` contiene il blob JSON versionato con controllo di versione (`PUT /api/state` restituisce 409 se obsoleto), mentre allenamenti, pasti, promemoria e altre registrazioni usano tabelle SQLite dedicate. Il client Android `next` può includere il frontend nell'APK e utilizzare una coda offline e la fusione a tre vie; il canale `stable` è una shell Capacitor che carica la webapp dal server. La coerenza dei contratti APK/backend è un obbligo operativo da verificare, non un bug già dimostrato.

La migrazione incrementale è appropriata alla scala del prodotto. Nessuna evidenza raccolta giustifica una riscrittura generalizzata o la sostituzione di SQLite.

## 3. Finding distinti dell'area 02

### FW-ARCH-001 — P2 — Semantica del ripristino JSON potenzialmente ibrida
- **Stato:** aperto, evidenza statica; scenario end-to-end da provare.
- **File:** `app/main.py`, `restore()`, circa righe 216–290; da verificare con `app/schemas.py` e chiamante UI.
- **Evidenza:** l'endpoint sostituisce sempre `app_state`, `set_logs` e `workout_sessions`, ma sostituisce `meal_templates`, `meal_logs`, `foods`, `sleep_logs`, `exercise_notes`, `grocery_spend` e `reminders` solo se il rispettivo campo del modello di backup non è `None`.
- **Scenario:** ripristino di un backup legacy con alcuni domini assenti su un database che contiene dati più recenti nei domini mancanti.
- **Impatto:** potenziale mescolanza di dati ripristinati e preesistenti, non necessariamente evidente all'utente. Non è dimostrato che tale comportamento sia contrario alla UX dichiarata finché non si verificano schema, UI e test.
- **Proposta:** definire una matrice di comportamento per versione e dominio (`replace`, `retain`, `unsupported`); rendere espliciti prima della conferma i domini mantenuti; testare backup legacy e correnti su DB isolato con dati sentinella. Preservare backup pre-restore e transazionalità già implementati.
- **Criterio di accettazione:** dopo restore il risultato di ogni dominio coincide con la matrice dichiarata e la UI lo comunica; nessun dato viene eliminato o trattenuto in modo inatteso.
- **Relazione con FW-REV-004:** correlato ma **non duplicato**: FW-REV-004 riguarda snapshot incoerenti durante export, FW-ARCH-001 le regole di import/restore.

### FW-ARCH-002 — P2 — Architettura documentata non allineata a quella implementata
- **Stato:** aperto, disallineamento confermato staticamente.
- **File:** `docs/ARCHITECTURE.md` (sezioni iniziali e autenticazione); confrontato con `CLAUDE.md`, `app/main.py` e documentazione del modello dati.
- **Evidenza:** il documento si presenta come verificato al 2026-11-09 e descrive cookie firmati non revocabili, una struttura iniziale client-centrica e moduli indicati come obiettivi futuri; il codice e `CLAUDE.md` descrivono sessioni server-side revocabili, tabelle dedicate e due modalità Android.
- **Impatto:** rischio di implementare interventi contro contratti obsoleti, con maggior costo di manutenzione.
- **Proposta:** aggiornare la mappa `current architecture` con moduli, auth, persistenza, API, sincronizzazione, backup, due modalità Android e compatibilità. Spostare l'architettura storica in una sezione chiaramente datata; evitare di cancellare decisioni pregresse.
- **Criterio di accettazione:** i contratti descritti corrispondono a file, endpoint e modelli realmente presenti; nessuna funzionalità futura è descritta come già esistente.
- **Relazione con FW-REV-007:** distinta; FW-REV-007 riguarda le progressioni nel documento del programma di allenamento.

## 4. Sovrapposizioni con il registro ufficiale (NON nuovi FW-ARCH)

| ID chat 01 | Area architetturale | Trattamento |
| --- | --- | --- |
| FW-REV-001 (P1) | Coda offline: dedup di richieste in volo | Seguire correzione e test ufficiali |
| FW-REV-002 (P1) | Tombstone e ordinamento delle cancellazioni serie | Seguire correzione e migrazione |
| FW-REV-003 (P1) | Merge piano pasti per giorno anziché slot | Nessun duplicato |
| FW-REV-004 (P2) | Snapshot coerente nell'export JSON | Collegato a FW-ARCH-001 ma distinto |
| FW-REV-005 (P2) | Migrazione token al Keystore Android | Seguire test dispositivo/mock |
| FW-REV-006 (P2) | Queue pendente attraverso logout | Seguire policy e UX |
| FW-REV-007 (P3) | Documentazione progressioni del seed | Distinto da FW-ARCH-002 |
| FW-REV-008 (P2) | Delete locale vs update remoto non segnalato | Nessun duplicato |

**Rettifica dell'audit preliminare:** la precedente etichetta `FW-REV-001` applicata dal reviewer architetturale era impropria. Il problema di sincronizzazione già ricade in FW-REV-003 e FW-REV-008 (e, per altri aspetti della coda, FW-REV-001/002/006). Non assegnare un `FW-ARCH-003` per lo stesso difetto. L'unico titolare degli ID FW-REV è la chat 01.

## 5. Rischi residui e lavoro da verificare

1. **Integrità delle registrazioni offline:** rischio prioritario noto, coperto dagli FW-REV aperti; occorrono test concorrenti e riproducibili.
2. **Backup/restore:** occorrono snapshot export coerenti (FW-REV-004), specifica formati e matrice del restore (FW-ARCH-001), prova isolata di ripristino completo.
3. **Compatibilità APK/backend:** verificare installazione, cambio server, token, riconnessione, riavvio e contratto minimo versionato; non dichiarare un difetto senza prova.
4. **Confini del modello ibrido:** documentare quali domini appartengono al blob, quali alle tabelle, e come vengono trattati merge, cancellazioni, backup, import e migrazioni.
5. **Sicurezza operativa:** HTTP LAN documentato come rischio accettato/da mitigare secondo il modello di minaccia, senza inventare esposizione Internet.
6. **Produzione:** non verificati container, dati reali, disponibilità backup, ripristini, stato APK o versione deployata.

**Test eseguiti dalla chat 02:** nessun test applicativo. Solo consultazione statica GitHub, lettura Ledger/report e confronto dei file del commit documentale. Non rivendicare come superati i test dichiarati in `CLAUDE.md`.

## 6. Priorità e miglioramenti conservativi

Prima correggere i difetti di integrità dati già assegnati alla chat 01; poi rendere deterministico e verificabile il restore; infine definire confini, compatibilità e documentazione. Evitare nuove dipendenze, database diversi o refactoring non motivati. Le azioni e i criteri sono organizzati in `docs/reviews/TECHNICAL_DEBT.md`.

## 7. Stato della review

Questo audit non modifica `REVIEW_LEDGER.md`, non certifica runtime/produzione e non avanza il checkpoint applicativo. Alla prossima revisione rileggere Ledger, ultimo report chat 01, HEAD `main`, questo file e il backlog prima di assegnare ID o cambiare stati. Non chiudere finding su dichiarazioni di Claude: occorrono prove di codice e test.
