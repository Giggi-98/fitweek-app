# FitWeek — Technical Debt & Architecture Backlog

- **Responsabile:** Chat 02 — Audit architetturale
- **Data iniziale:** 2026-11-13
- **Codice applicativo preso a riferimento:** `2dac1ab955224228659143f70fff8c01cef01029`
- **HEAD `main` consultato:** `70f7607a923c36e476ef833aa7cb270c870dd05e` (commit documentale rispetto alla baseline)
- **Archivio:** `review/engineering`
- **Regola di proprietà:** questo documento traccia debito tecnico e dipendenze; i finding FW-REV restano esclusivamente nel Ledger della chat 01. Non avanzare checkpoint o chiudere FW-REV da qui.

## Ordine di intervento proposto

| Rank | Tema | Riferimenti | Stato / evidenza | Azione minima verificabile |
| --- | --- | --- | --- | --- |
| 1 — Alta | Integrità offline e multi-dispositivo | FW-REV-001, FW-REV-002, FW-REV-003, FW-REV-008 | Finding baseline aperti, evidenza statica; owner chat 01 | Fix mirati e test di enqueue mentre drain è in volo, PUT dopo DELETE, merge slot e delete-vs-update |
| 2 — Alta | Coerenza esportazione e semantica ripristino | FW-REV-004; FW-ARCH-001 (P2) | Export noto nel Ledger; comportamento condizionale restore letto in `app/main.py` | Snapshot transazionale export; matrice formati/ domini restore; prova restore isolato con verifica di ogni dominio |
| 3 — Media | Lifecycle Android, queue, token e compatibilità | FW-REV-005, FW-REV-006; attività trasversale senza nuovo finding | APK/device non provati; test mancanti | Verifica errori Keystore, logout con queue, matrix APK stable/next contro backend, test su device reale |
| 4 — Media | Ownership dei dati e contratti del modello ibrido | Attività di documentazione/verification, nessun ID bug | Blob versionato e tabelle dedicate osservati | Tabella per dominio: fonte di verità, writer, versioning, merge, cancellazione, restore, migrazione |
| 5 — Media | Documentazione architetturale corrente | FW-ARCH-002 (P2), collegato solo tematicamente a FW-REV-007 | Disallineamento confermato | Aggiornare `docs/ARCHITECTURE.md`, preservare cronologia, confrontare con codice |
| 6 — Condizionale | Sicurezza trasporto LAN | Rischio documentato in Ledger/SECURITY; nessun nuovo finding | HTTP sulla LAN documentato; esposizione Internet non dimostrata | Rivedere modello di minaccia, preferire VPN/HTTPS dove necessario; verificare configurazione reale solo con autorizzazione |

## Schede debito proprie dell'area 02

### FW-ARCH-001 — P2 — Contratto restore per versioni e domini
- **Problema:** `app/main.py` sostituisce sempre stato e sedute, ma altri domini solo se presenti nel backup.
- **Da accertare:** modelli `BackupRestore`, UX di conferma, trattamento effettivo dei backup v1–v4, test esistenti.
- **Deliverable minimo:** matrice `versione × dominio × azione`; comportamento esplicito e comunicato; test su database temporaneo con dati sentinella.
- **Accettazione:** nessuna conservazione o eliminazione implicita che contraddica la semantica esposta all'utente; backup pre-restore verificato; nessun restore sulla produzione.
- **Dipendenza:** coordinare l'export transazionale FW-REV-004, senza duplicarne il finding.
- **Stato:** proposto/aperto, test runtime mancanti.

### FW-ARCH-002 — P2 — Specifica architetturale verificata
- **Problema:** `docs/ARCHITECTURE.md` è datato e non rappresenta tutte le evoluzioni attuali.
- **Deliverable minimo:** diagramma `browser / Android stable / Android next → API → SQLite`; contratti auth, sync, backup e confini dei domini; sezione storica distinta.
- **Accettazione:** ogni componente ed endpoint citato riscontrabile in repository; decisioni future chiaramente separate.
- **Dipendenza:** non modificare né duplicare FW-REV-007.
- **Stato:** proposto/aperto, disallineamento statico confermato.

## Attività trasversali senza nuovo finding

### Confini tra blob e tabelle
Registrare per ogni dominio dati: sistema autorevole, validazione, API mutanti, concorrenza, idempotenza, cancellazioni e restore. Non è proposta una migrazione generale del blob: procedere solo quando un rischio verificato la giustifichi.

### Matrice APK/backend
Per ogni canale Android annotare versione APK, versione backend minima, feature/endpoint richiesti, comportamenti offline e procedura di upgrade. Testare le combinazioni realmente distribuite. Non presumere che il server reale esegua HEAD.

### Backup e recupero
Oltre a `integrity_check`, verificare restore isolato di backup SQLite e JSON con dati attesi per tabella. Annotare esplicitamente che nessun ripristino reale è stato eseguito da questo reviewer.

## Dipendenze e coordinamento

- **Chat 01:** gestisce `REVIEW_LEDGER.md`, `YYYY-MM-DD-SHA.md`, ID `FW-REV-XXX`, stato e verifica correzioni.
- **Chat 02:** gestisce solo `ARCHITECTURE_AUDIT.md` e `TECHNICAL_DEBT.md`; ID `FW-ARCH-XXX`.
- **Chat 03/04:** possiedono rispettivamente documenti UX e Product; non sovrascriverli.
- Prima di ogni aggiornamento: rileggere da GitHub Ledger, ultimo report, HEAD main e due documenti area 02; riconciliare cambiamenti concorrenti; scrivere soltanto su `review/engineering` dopo autorizzazione e rileggere l'output.

## Verifiche ancora mancanti

Nessun test pytest, JS, Playwright, Android o restore è stato eseguito in questa sessione. Le sole evidenze sono la lettura di repository e documentazione e il confronto GitHub della baseline con HEAD. Nessun avanzamento checkpoint o giudizio sul runtime è autorizzato da questo documento.
