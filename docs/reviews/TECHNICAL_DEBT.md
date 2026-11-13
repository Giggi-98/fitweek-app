# FitWeek — Technical Debt & Architecture Backlog

- **Responsabile:** Chat 02 — Audit architetturale
- **Data iniziale:** 2026-11-13
- **Codice applicativo preso a riferimento:** `2dac1ab955224228659143f70fff8c01cef01029`
- **Ultimo HEAD `main` consultato:** `e014e0da498ffa05d8b0570c76cec2f074224483` (7 commit dopo 5e333bd; storico precedente conservato nelle sezioni datate)
- **Archivio:** `review/engineering`
- **Regola di proprietà:** questo documento traccia debito tecnico e dipendenze; i finding FW-REV restano esclusivamente nel Ledger della chat 01. Non avanzare checkpoint o chiudere FW-REV da qui.

## Ordine di intervento proposto

| Rank | Tema | Riferimenti | Stato / evidenza | Azione minima verificabile |
| --- | --- | --- | --- | --- |
| 1 — Alta | Integrità offline e multi-dispositivo | FW-REV-002, FW-REV-009 (P1); FW-REV-001/003/008 | Tombstone introdotte, ma timestamp troncati a secondi; altri fix supportati staticamente, test indipendenti pendenti; owner chat 01 | Correggere precisione/ordinamento timestamp e test PUT stale dopo DELETE nello stesso secondo; poi verificare le altre regressioni |
| 2 — Alta | Sicurezza logout Android | FW-REV-010 (P2), collegato a FW-REV-005/006 | Rischio di token persistente dopo doppio fallimento HTTP/Keystore; chat 01 | Test fail-clear/fail-revoke, nessun logout falsamente riuscito o ri-autenticazione silenziosa |
| 3 — Media | Contratto restore per backup legacy | FW-ARCH-001 (P2), collegato a FW-REV-004 | Backend/schema preservano tabelle assenti nei vecchi backup, ma UI dichiara sostituzione di tutti i dati; snapshot export fix supportato staticamente | Matrice v1–v4 per dominio, conferma UI coerente, test restore isolati con dati sentinella e verifica set_tombstones |
| 4 — Media | Compatibilità APK/backend e test device | FW-REV-005/006/010; attività trasversale senza nuovo finding | Nessun APK/device verificato indipendentemente | Matrice APK stable/next e versione minima server, test riavvio/rete/login; non presumere deploy del codice GitHub |
| 5 — Media | Ownership dei dati e contratti del modello ibrido | Attività trasversale, nessun nuovo finding | Blob versionato e tabelle dedicate osservati | Tabella per dominio: fonte autorevole, API, versioning, merge, cancellazione, restore, migrazione |
| 6 — Media | Documentazione architetturale corrente | FW-ARCH-002 (P2), collegato tematicamente a FW-REV-007 | Disallineamento confermato | Aggiornare `docs/ARCHITECTURE.md` senza perdere cronologia, confrontare con codice |
| 7 — Condizionale | Sicurezza trasporto LAN | Rischio già documentato, nessun nuovo finding | HTTP LAN noto; esposizione Internet non dimostrata | Rivalutare modello di minaccia; preferire VPN/HTTPS dove necessario |

## Schede debito proprie dell'area 02

### FW-ARCH-001 — P2 — Contratto restore per versioni e domini
- **Problema:** `app/main.py` sostituisce sempre stato e sedute, ma altri domini solo se presenti nel backup.
- **Evidenza confermata:** `BackupRestore` in `app/schemas.py` tratta campi v3/v4 assenti come `None` = non toccare le tabelle; `settings.js` avverte invece che il ripristino sostituisce *tutti* i dati. Resta da testare la matrice v1–v4 end-to-end.
- **Deliverable minimo:** matrice `versione × dominio × azione`; mantenere i dati dei domini assenti nei backup legacy e rendere la UI esplicita; test su database temporaneo con dati sentinella. Verificare anche `reminder_acks` e `set_tombstones` della migrazione 9 durante il restore.
- **Accettazione:** nessuna conservazione o eliminazione implicita che contraddica la semantica esposta all'utente; backup pre-restore verificato; nessun restore sulla produzione.
- **Dipendenza:** coordinare l'export transazionale FW-REV-004, senza duplicarne il finding.
- **Stato:** aperto, mismatch backend/UI confermato staticamente; test runtime mancanti.

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

## Aggiornamento coordinato — 2026-11-13, main 5e333bd

- Riletto `REVIEW_LEDGER.md` e il report `2026-11-13-5e333bd.md` sul branch `review/engineering`. Dieci FW-REV registrati; nessuno formalmente chiuso; checkpoint ufficiale ancora `null`.
- Correzioni di FW-REV-001/003/004/005/006/008 supportate staticamente dalla chat 01, ma non convalidate qui in esecuzione. FW-REV-002 incompleto e FW-REV-009 nuovo (P1) restano prima priorità. FW-REV-010 nuovo (P2) è rischio residuo logout Android.
- FW-ARCH-001 resta distinto da FW-REV-004: non riguarda lo snapshot export, ma il contratto di restore v1–v4 e la discrepanza fra la conservazione backend dei domini opzionali assenti e la conferma UI «sostituisce tutti i dati».
- FW-ARCH-002 resta aperto. Nessun FW-ARCH aggiuntivo per problemi già registrati dalla chat 01.
- Nessun test applicativo eseguito dalla chat 02; non sono stati verificati produzione, APK né restore reali.
- Il documento non trasferisce proprietà degli FW-REV, non modifica il Ledger e non autorizza deploy o interventi distruttivi.

## Aggiornamento backlog — 2026-11-13, main e014e0d

**Fonte di coordinamento:** `REVIEW_LEDGER.md` e `docs/reviews/2026-11-13-e014e0d.md` su `review/engineering`. **Checkpoint ufficiale:** `null`; nessuna applicazione di patch sul codice da questa chat. Nessun test eseguito dal reviewer 02. L'HEAD `main` era `e014e0d` nel confronto GitHub.

### Priorità attuali dopo i fix presenti nel repository

| Priorità | Area / owner | Stato a e014e0d | Verifiche e criteri ancora necessari |
| --- | --- | --- | --- |
| 1 — Alta | Integrità delle cancellazioni offline — FW-REV-002/009 (chat 01) | Tombstone e millisecondi presenti nel codice, supportati staticamente, runtime mancante | Suite API e test concorrenti per PUT/DELETE out-of-order, dati preesistenti a precisione secondi e stessi millisecondi |
| 2 — Alta | Logout Android e Keystore — FW-REV-010 (chat 01) | Fix principale presente; il Ledger segnala caso limite `plugin.clear/get` falliti + `storage.set` che restituisce `false` | Test fail-closed simultaneo con riavvio; non riassegnare il finding |
| 3 — Media / verifica | Restore e comunicazioni — FW-ARCH-001 (chat 02) | **Correzione supportata staticamente**: domini `replaced/kept`, anteprima UI e matrice docs/API.md; non chiuso | Eseguire `tests/test_restore_matrix.py` e `tests/js/backup.test.mjs`, test di restore isolato v1–v4 e guasti, verifica `set_tombstones`/`reminder_acks` |
| 4 — Media / verifica | Documentazione architetturale — FW-ARCH-002 (chat 02) | **Correzione supportata staticamente**: mappa corrente e storico distinti; non chiuso | Confronto completo con codice, dichiarazioni su LAN/Internet/deploy qualificate come non verificate operativamente |
| 5 — Media / verifica | APK stable/next e versioni backend (trasversale) | Nessuna prova indipendente su device o deploy | Matrice di compatibilità con versioni realmente installate; test offline, login, logout, notifiche |
| 6 — Media / documentazione | Confini tra blob e tabelle (trasversale) | Contratti migliorati in docs/ARCHITECTURE.md, migrazioni incrementali ancora necessarie solo per motivi fondati | Verificare proprietà e versioni per ogni dominio; non migrare o riscrivere senza rischio provato |
| 7 — Condizionale | HTTP LAN / protezione trasporto (rischio già documentato) | Non è un nuovo FW-ARCH, né evidenza di esposizione Internet | Valutare deployment reale e threat model con autorizzazione |

### Stati dei due finding propri

- **FW-ARCH-001 — P2:** da *correzione richiesta* a **correzione staticamente verificata, runtime pendente** (commit `1327e5d`). `app/main.py`, `app/schemas.py`, `static/js/backup.js`, `static/js/views/settings.js`, `docs/API.md` e test dedicati mostrano una comunicazione prima/dopo restore allineata alla semantica legacy. Il JSON non è un backup integrale del database. Chiudere solo dopo prova di restore isolata e test indipendenti.
- **FW-ARCH-002 — P2:** da *correzione richiesta* a **correzione documentale staticamente verificata, verifica conclusiva pendente** (commit `e014e0d`). `docs/ARCHITECTURE.md` presenta schema 9, auth, Android stable/next, sync e persistenza, con sezione storica. Verificare e qualificare le affermazioni operative non dimostrate.
- **Nuovi ID FW-ARCH:** nessuno. Le proprietà FW-REV/UX/PROD restano alle rispettive chat.

### Regole per la prossima verifica

1. Rileggere Ledger, ultimo report della chat 01, HEAD `main` e i due documenti dell'area 02.
2. Se `main` è avanzato, esaminare il diff dal precedente SHA architetturale `e014e0d`; non usare automaticamente il checkpoint ufficiale della chat 01.
3. Distinguere file, codice presente, test scritti, test eseguiti e APK/deploy reali.
4. Non modificare `main`, Ledger, issue o PR. Aggiornare questi due documenti solo dopo autorizzazione e lettura dei blob SHA correnti.

## Aggiornamento backlog — 2026-11-13, ciclo 5, main 439dc83

- **Intervallo:** `e014e0da498ffa05d8b0570c76cec2f074224483..439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7` (quattro commit GitHub). `main` confermato a `439dc83`. Ledger/review chat 01 ancora al candidato statico `e014e0d`; checkpoint ufficiale `null`, non modificato.
- **Fonti:** codice e test a HEAD; `docs/reviews/MAKER_HANDOFF.md`, `docs/reviews/2026-11-13-439dc83.maker.md` (dichiarazioni maker da verificare), `docs/reviews/REVIEW_LEDGER.md`, `docs/reviews/2026-11-13-e014e0d.md`.

### Priorità di verifica aggiornate (senza nuovi finding)

| Priorità | Finding / owner | Stato dopo ispezione statica | Test / gate prima della chiusura |
| --- | --- | --- | --- |
| 1 — Alta | FW-REV-010 / chat 01 | Nuovo handling Keystore + marcatori in localStorage/cookie e percorso fail-closed presenti a `9ba8b7c`; maker riferisce rischio residuo se entrambi i marcatori non persistono e lo storage torna disponibile | Riproduzione indipendente con errori Keystore/cookie/localStorage, riavvio e revoca server; test su Android reale; non duplicare FW-REV |
| 2 — Alta | FW-REV-002/009 / chat 01 | Tombstone/millisecondi già supportati staticamente; non modificati in questo ciclo | Eseguire regressioni stesso secondo, ordine inverso, precisione dati precedenti e prova su dispositivo/rete offline |
| 3 — Media / verifica | FW-ARCH-001 (P2) / chat 02 | `f2bf1e6`: gestione `sqlite3.IntegrityError -> 422` e test di rollback completo presenti; contratto replaced/kept e matrice v1–v4 già supportati staticamente | Verificare con esecuzione indipendente test Python/JS e restore isolato, inclusi rollback dopo violazione chiave, pre-restore SQLite, `reminder_acks` e `set_tombstones` |
| 4 — Media / verifica | FW-ARCH-002 (P2) / chat 02 | Documento architetturale invariato in ciclo 5, riallineato staticamente | Controllare dichiarazioni di produzione/rete/APK contro evidenza operativa; evitare fatti non verificati |
| 5 — Media / verifica | APK stable/next e deploy (trasversale) | Handoff maker afferma deploy 1.10.6 schema 9 e APK next ricompilato; non certificati dal reviewer | Verificare health dell'istanza, checksum/metadati APK, compatibilità server/APK e Android reale senza presumere il risultato |
| 6 — Media / coordinamento | FW-UX-002 e undo/409 / chat 03, chat 01 | Codice UI e test modificati a `cfb68d8`; risultati dichiarati dal maker | Eseguire test e QA visiva/accessibilità; rispettare proprietà degli ID |

### Stato dei finding architetturali e rischi residui

- **FW-ARCH-001 — aperto, correzione staticamente supportata:** il test nuovo in `tests/test_restore_matrix.py` simula due notti con stessa chiave e verifica risposta 422 + export invariato; `app/main.py` gestisce `IntegrityError` esternamente alla transazione. Questo non è un test eseguito dal reviewer. JSON e SQLite non sono equivalenti: il backup JSON non comprende tombstone, acknowledge, sedute eliminate e sessioni; `docs/API.md` ne esplicita l'effetto.
- **FW-ARCH-002 — aperto, documentazione statica riallineata:** nessun cambiamento applicativo nel ciclo 5 richiede una nuova riscrittura. Resta la qualificazione delle affermazioni di infrastruttura effettiva.
- **Nuovi ID FW-ARCH:** nessuno. I problemi FW-REV e FW-UX restano nelle rispettive aree; l'autore Kimi non è verificabile sulla base dei file/commit consultati.

### Verifiche mancanti e disciplina dell'evidenza

- Maker dichiara 105 pytest, 83 JS, 169 e2e e deploy live successivo alla pubblicazione dell'handoff. **Nessun test applicativo, deploy, APK o dato reale è stato verificato direttamente dal reviewer 02.** Conservare questa distinzione anche se il maker dichiara successo.
- Alla prossima revisione rileggere nuovi HEAD, Ledger, report, handoff e i due documenti propri, poi verificare i test e il comportamento effettivo. Non avanzare checkpoint, non cambiare stati FW-REV e non dedurre approvazione operativa.
- Nessun nuovo framework, migrazione generalizzata o riscrittura richiesti: chiudere prima le verifiche residue di sicurezza e integrità.
