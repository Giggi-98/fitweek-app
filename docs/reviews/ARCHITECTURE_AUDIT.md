# FitWeek — Architecture Audit

- **Area proprietaria:** 02 — Audit architetturale
- **Data:** 2026-11-13
- **Repository:** `Giggi-98/fitweek-app`
- **Branch applicativo:** `main`
- **HEAD verificato nell'ultimo controllo:** `e014e0da498ffa05d8b0570c76cec2f074224483` (le sezioni storiche precedenti restano riferite a `5e333bd`)
- **Baseline del codice applicativo esaminato:** `2dac1ab955224228659143f70fff8c01cef01029`
- **Differenza baseline → HEAD:** cinque commit (`70f7607`, `b0f78d2`, `79304c6`, `d8817c4`, `5e333bd`) con correzioni applicative e documentazione; review incrementale della chat 01 disponibile nel report `2026-11-13-5e333bd.md`.
- **Branch di archivio:** `review/engineering`
- **Metodo:** analisi statica mirata del codice e coordinamento con la review baseline; non è un audit runtime completo
- **Stato ultimo controllo area 02:** APPROVATO CON RISERVE **per le correzioni FW-ARCH-001/002 esaminate staticamente**, senza approvazione di runtime/deploy e senza chiusura definitiva; le sezioni precedenti documentano lo stato storico.
- **Checkpoint ufficiale:** `null` secondo `REVIEW_LEDGER.md`; non avanzato

## 1. Confini di responsabilità

Questa chat possiede esclusivamente `ARCHITECTURE_AUDIT.md` e `TECHNICAL_DEBT.md`. Il registro dei finding applicativi `FW-REV-XXX`, il checkpoint e i report incrementali appartengono alla chat 01. I finding propri di architettura hanno ID `FW-ARCH-XXX`. Prima di una nuova assegnazione confrontare sempre il Ledger ufficiale sul branch `review/engineering`.

Fonti primarie di coordinamento lette:
- `docs/reviews/REVIEW_LEDGER.md` (dieci finding FW-REV registrati, nessuno formalmente chiuso, checkpoint `null`; alcune correzioni supportate staticamente)
- `docs/reviews/2026-11-13-2dac1ab.md` (baseline iniziale)
- `docs/reviews/2026-11-13-5e333bd.md` (review incrementale statica della chat 01, FW-REV-009/010 nuovi)
- `docs/reviews/REVIEW_POLICY.md`
- Codice GitHub `app/main.py`, `static/js/sync.js`, `app/migrations.py`, `docker-compose.yml`; documenti `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`.

## 2. Architettura osservata

FitWeek è una webapp monoutente self-hosted con backend FastAPI/Python, SQLite in WAL e frontend JavaScript ES Modules. Docker Compose mantiene il database nel volume esterno `fitweek_data`; sono presenti backup coerenti SQLite e script di ripristino. Queste proprietà sono osservazioni del repository, non verifiche della produzione.

La persistenza è ibrida: `app_state` contiene il blob JSON versionato con controllo di versione (`PUT /api/state` restituisce 409 se obsoleto), mentre allenamenti, pasti, promemoria e altre registrazioni usano tabelle SQLite dedicate. Il client Android `next` può includere il frontend nell'APK e utilizzare una coda offline e la fusione a tre vie; il canale `stable` è una shell Capacitor che carica la webapp dal server. La coerenza dei contratti APK/backend è un obbligo operativo da verificare, non un bug già dimostrato.

La migrazione incrementale è appropriata alla scala del prodotto. Nessuna evidenza raccolta giustifica una riscrittura generalizzata o la sostituzione di SQLite.

## 3. Finding distinti dell'area 02

### FW-ARCH-001 — P2 — Semantica del ripristino JSON potenzialmente ibrida
- **Stato:** aperto; discrepanza backend/UI confermata staticamente, scenari di restore da provare.
- **File:** `app/main.py` endpoint `restore()` (circa righe 216–290), `app/schemas.py` modello `BackupRestore`, `static/js/views/settings.js` importazione backup.
- **Evidenza:** l'endpoint sostituisce sempre `app_state`, `set_logs` e `workout_sessions`, ma sostituisce `meal_templates`, `meal_logs`, `foods`, `sleep_logs`, `exercise_notes`, `grocery_spend` e `reminders` solo se il rispettivo campo del modello di backup non è `None`.
- **Schema verificato:** `BackupRestore` supporta v1–v4; i campi v3/v4 sono opzionali con default `None` (commento: non toccare le tabelle esistenti). 
- **UX verificata:** `settings.js` mostra `Il ripristino sostituisce tutti i dati attuali (il server ne conserva una copia). Continuare?`, che non descrive la conservazione condizionale dei domini assenti.
- **Scenario:** ripristino di un backup legacy con alcuni domini assenti su un database che contiene dati più recenti nei domini mancanti.
- **Impatto:** il restore può produrre dati di epoche diverse, mentre la conferma UI parla di sostituzione di tutti i dati. Il disallineamento del contratto è confermato staticamente; non sono state dimostrate perdite di dati in un test eseguito.
- **Proposta:** mantenere la compatibilità con i backup legacy, definire una matrice versione × dominio (`replace`, `retain`, `unsupported`), spiegare prima della conferma quali domini sono sostituiti e quali mantenuti; testare v1–v4 su DB temporanei con dati sentinella. Non cancellare automaticamente le tabelle assenti e preservare backup pre-restore/transazione.
- **Matrice osservata per campi assenti:** `app_state` è obbligatorio ed è sostituito; sedute/serie sono sostituite (v1 convertito dal blob); `meal_templates`, `meal_logs`, `reminders`, `foods`, `sleep_logs`, `exercise_notes`, `grocery_spend` restano inalterati quando i corrispondenti campi sono `None`. Verificare anche la semantica di `reminder_acks` e della nuova `set_tombstones` (migrazione 9) in restore e relativi test.
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
| FW-REV-008 (P2) | Delete locale vs update remoto non segnalato | Correzione supportata staticamente; test pending, nessun duplicato |
| FW-REV-009 (P1) | Timestamp subsecondo troncato e PUT stale post-DELETE | Proprietà chat 01; collegato a FW-REV-002, nessun nuovo FW-ARCH |
| FW-REV-010 (P2) | Logout può lasciare token Keystore valido | Proprietà chat 01; collegato ad auth/Android, nessun nuovo FW-ARCH |

**Rettifica dell'audit preliminare:** la precedente etichetta `FW-REV-001` applicata dal reviewer architetturale era impropria. Il problema di sincronizzazione già ricade in FW-REV-003 e FW-REV-008 (e, per altri aspetti della coda, FW-REV-001/002/006). Non assegnare un `FW-ARCH-003` per lo stesso difetto. L'unico titolare degli ID FW-REV è la chat 01.

## 5. Rischi residui e lavoro da verificare

1. **Integrità delle registrazioni offline:** FW-REV-002 rimane parzialmente mitigato; FW-REV-009 individua collisioni subsecondo che richiedono correzione prioritaria. Altri fix sono supportati staticamente ma i test indipendenti sono ancora mancanti.
2. **Backup/restore:** la soluzione snapshot di FW-REV-004 è supportata staticamente (test runtime non eseguito); restano matrice restore v1–v4, comunicazione UI coerente (FW-ARCH-001) e prova isolata completa.
3. **Android e autenticazione:** FW-REV-010 segnala rischio di ri-autenticazione dopo logout fallito; verificare anche installazione, cambio server, token, riconnessione, riavvio e contratti APK/backend senza assumere deploy avvenuto.
4. **Confini del modello ibrido:** documentare quali domini appartengono al blob, quali alle tabelle, e come vengono trattati merge, cancellazioni, backup, import e migrazioni.
5. **Sicurezza operativa:** HTTP LAN documentato come rischio accettato/da mitigare secondo il modello di minaccia, senza inventare esposizione Internet.
6. **Produzione:** non verificati container, dati reali, disponibilità backup, ripristini, stato APK o versione deployata.

**Test eseguiti dalla chat 02:** nessun test applicativo. Solo consultazione statica GitHub, lettura Ledger/report più recenti e confronto HEAD `main` (identico a `5e333bd`), modelli Pydantic e UI restore. I nuovi test riportati dalla chat 01 sono presenti nel repository ma non eseguiti dal reviewer. Non rivendicare come superati i test dichiarati in `CLAUDE.md`.

## 6. Priorità e miglioramenti conservativi

Prima correggere FW-REV-002/009 e FW-REV-010 (proprietà chat 01); poi rendere deterministico e verificabile il restore FW-ARCH-001; infine definire confini, compatibilità e documentazione FW-ARCH-002. Evitare nuove dipendenze, database diversi o refactoring non motivati. Le azioni e i criteri sono organizzati in `docs/reviews/TECHNICAL_DEBT.md`.

## 7. Stato della review

Questo audit non modifica `REVIEW_LEDGER.md`, non certifica runtime/produzione e non avanza il checkpoint applicativo. Alla prossima revisione rileggere Ledger, ultimo report chat 01, HEAD `main`, questo file e il backlog prima di assegnare ID o cambiare stati. Non chiudere finding su dichiarazioni di Claude: occorrono prove di codice e test.

## 8. Aggiornamento coordinato — 2026-11-13

- **HEAD confermato:** `5e333bd8ca290f96fc81dfddff66934de623614a`; confronto GitHub con `main`: identical (0 commit aggiuntivi).
- **Ledger:** ultimo report `2026-11-13-5e333bd.md`, dieci finding FW-REV; checkpoint confermato `null`.
- **FW-ARCH-001:** specificato il conflitto tra semantica restore condizionale di backend/schema e testo UI che promette sostituzione totale.
- **FW-ARCH-002:** ancora aperto; documentazione `docs/ARCHITECTURE.md` non aggiornata.
- **Nessuna modifica applicativa o al Ledger.** Questo aggiornamento non dichiara test superati e non cambia il verdetto della chat 01.

## 9. Verifica correzioni architetturali — 2026-11-13, main e014e0d

- **Intervallo applicativo:** `5e333bd8ca290f96fc81dfddff66934de623614a..e014e0da498ffa05d8b0570c76cec2f074224483`, 7 commit fast-forward secondo compare GitHub. HEAD `main` verificato identico a `e014e0d` al momento della revisione/pubblicazione.
- **Coordinamento:** letto `docs/reviews/2026-11-13-e014e0d.md` e Ledger ufficiale aggiornato. La chat 01 ha esaminato staticamente l'intero intervallo, mantiene il checkpoint `null`, e ha evidenziato un caso limite ancora da verificare in FW-REV-010. Non duplicare FW-REV.
- **Verdetto circoscritto:** APPROVATO CON RISERVE per la direzione e la presenza delle correzioni architetturali, **non** approvazione di produzione, APK o recuperabilità reale. Nessun test applicativo eseguito dal reviewer 02.

### FW-ARCH-001 — P2 — Correzione supportata staticamente; test runtime pendenti

- **Commit:** `1327e5d61eb7ef9689c734a56c0646fb1a796ce7`.
- **Stato:** correzione presente nel codice, **aperto in attesa di verifica indipendente dei test e di restore isolato**. La discrepanza originaria della conferma generica è stata affrontata, senza cambiare la semantica legacy.
- **Evidenza:** `app/main.py` restituisce `replaced` e `kept`; `app/schemas.py` definisce `BACKUP_OPTIONAL_DOMAINS` e il significato di `None`; `static/js/backup.js` calcola gli stessi domini e genera testi pre/post ripristino, usati da `static/js/views/settings.js`. `docs/API.md` descrive la matrice per formati v1–v4, i dati esclusi dal JSON e il backup pre-restore.
- **Test presenti ma non eseguiti dal reviewer:** `tests/test_restore_matrix.py` con dati sentinella e test per `reminder_acks`; `tests/js/backup.test.mjs` per elenco e comunicazioni UI.
- **Rischio residuo:** il JSON non include `set_tombstones`, `reminder_acks`, record eliminati né sessioni: il restore azzera i tombstone con le sedute, azzera gli acknowledge solo se sostituisce i promemoria e non tocca gli accessi, secondo `docs/API.md`. La descrizione deve restare ben distinta da un recupero SQLite completo. La prova di restore su DB temporaneo e i test con guasti/transazioni concorrenti non sono stati eseguiti da questa chat.
- **Criteri prima della chiusura:** eseguire le suite Python/JS pertinenti con output verificabile; verificare v1–v4, contenuti `replaced/kept`, `reminder_acks`, `set_tombstones`, backup pre-restore, rollback su errore e UI. Non sperimentare su produzione.
- **Collegamento:** FW-REV-004 per coerenza dell'export, senza duplicazione.

### FW-ARCH-002 — P2 — Documentazione riallineata staticamente; verifica operativa pendente

- **Commit:** `e014e0da498ffa05d8b0570c76cec2f074224483`.
- **Stato:** correzione documentale presente e sostanzialmente coerente con i componenti di codice esaminati; **aperto fino a controllo conclusivo di accuratezza e dichiarazioni operative**.
- **Evidenza:** `docs/ARCHITECTURE.md` separa architettura attuale 1.10.5, elementi non implementati e testo storico 2026-11-09. Documenta FastAPI, SQLite schema 9, stato ibrido, auth revocabile, Android stable/next, offline, backup e limiti di compatibilità, facendo riferimento a `docs/API.md` e altri documenti tecnici.
- **Rischio residuo:** dichiarazioni come “nessun accesso da Internet”, stato dei deploy e APK su dispositivi non possono essere confermate dal solo tree GitHub; descriverle come configurazione prevista/dichiarata, salvo evidenza operativa.
- **Criteri prima della chiusura:** confronto finale delle sezioni con configurazione e codice a SHA fisso; separare fatti di repository e condizioni di produzione; niente riscrittura generalizzata.
- **Collegamento:** FW-REV-007 riguarda un documento funzionale differente.

### Altre verifiche e coordinamento

- I fix FW-REV-002/009 di ordinamento timestamp sono supportati staticamente dalla chat 01; è ancora necessaria la verifica runtime. Il caso limite Keystore + flag localStorage di FW-REV-010 rimane di proprietà chat 01 e non genera FW-ARCH.
- La compatibilità APK/backend è debito da provare su versioni realmente distribuite. Non inferire che `main` sia in produzione.
- Questa revisione architetturale non modifica `REVIEW_LEDGER.md`, non cambia checkpoint o stati FW-REV e non dichiara test superati.

## 10. Controllo del ciclo 5 — 2026-11-13 — main 439dc83

- **Intervallo verificato staticamente:** `e014e0da498ffa05d8b0570c76cec2f074224483..439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`. GitHub compare: quattro commit consecutivi, nessun commit saltato; `main` coincideva con `439dc83` al momento della pubblicazione.
- **Commit:** `9ba8b7c` (FW-REV-010), `cfb68d8` (FW-UX-002 e test undo/409), `f2bf1e6` (FW-ARCH-001), `439dc83` (documentazione 1.10.6).
- **Coordinamento:** `REVIEW_LEDGER.md` e ultima review chat 01 `2026-11-13-e014e0d.md` riletti su `review/engineering`; ultima review chat 01 **non copre ancora** i quattro commit di questo intervallo. Maker handoff `2026-11-13-439dc83.maker.md` letto come dichiarazione e non come prova indipendente. Checkpoint ufficiale `null`, non modificato.
- **Verdetto area 02:** **APPROVATO CON RISERVE per la correzione architetturale esaminata staticamente**, non approvazione operativa del deploy, APK o ripristino effettivo. Nessun test eseguito dal reviewer 02.

### FW-ARCH-001 — P2 — Errore di integrità su restore: correzione presente, verifica runtime pendente

- **Stato:** aperto; correzione principale contratto v1–v4 precedentemente supportata staticamente, nuovo handling rollback/422 supportato staticamente a `f2bf1e6`.
- **Evidenza:** in `app/main.py` la transazione del restore è ora avvolta da `try/except sqlite3.IntegrityError`, che produce `HTTPException(422, ...)`. Il context manager `transaction(c)` gestisce il rollback se l'eccezione interrompe gli insert. `tests/test_restore_matrix.py` aggiunge `test_restore_rolls_back_completely_when_a_domain_fails`: due `sleep_logs` con la stessa data provocano errore e il test confronta il JSON esportato prima e dopo. La verifica diretta del sorgente conferma struttura ed esistenza del test, **non il suo esito**.
- **Scenario e impatto:** file JSON malformato con chiavi duplicate a metà del restore; la precedente via non gestita poteva produrre HTTP 500, mentre il codice nuovo intende offrire 422 e annullamento di tutte le scritture. Il backup pre-restore resta fuori dalla transazione e viene creato prima dell'importazione.
- **Test necessari:** eseguire indipendentemente `tests/test_restore_matrix.py` e `tests/js/backup.test.mjs`; controllare atomicità sul DB SQLite temporaneo, v1–v4, collisioni e limiti del JSON (inclusi `set_tombstones` e `reminder_acks`), verifica rollback di dati non rappresentati nell'export; nessun test distruttivo sul live.
- **Rischio residuo:** il backup JSON resta parziale rispetto al database SQLite e il risultato reale di restore sui dati dell'utente non è stato verificato da questa chat. I casi di eccezioni diverse da `IntegrityError` non sono qualificati come bug nuovi senza riproduzione.
- **Collegamenti:** FW-REV-004 (export snapshot), FW-REV-002/009 (serie offline) senza duplicare i finding di chat 01.

### FW-ARCH-002 — P2 — Situazione invariata

- Il contenuto architetturale corretto nel commit `e014e0d` non è stato modificato dal ciclo 5; la documentazione corrente resta staticamente riallineata, con verifica operativa sulle affermazioni di deploy/rete e APK ancora pendente. Nessun nuovo ID.

### Cambiamenti esterni all'owner area 02

- **FW-REV-010:** `static/js/platform.js` aggiunge controllo Keystore, marcatore in cookie WebView e mancato auto-login quando `localStorage` non è scrivibile; `static/js/logout.js` distingue gli esiti `true`, `marked` e `false`. Un caso combinato di mancata persistenza dei marcatori seguito da ripresa dello storage rimane descritto dal maker come rischio residuo. La chat 01 è owner; non chiudere né duplicare qui.
- **FW-UX-002 / undo spesa:** `static/js/ui.js`, viste, CSS e test di interazione sono stati modificati; le verifiche accessibilità e undo/409 spettano alla chat 03 e/o chat 01 secondo i loro ID.
- **Autore Kimi:** nessun commit o documento consultato attribuisce inequivocabilmente lavoro a Kimi; non attribuire modifiche senza prova.

### Test e distribuzione: evidenza distinta

- **Dichiarazioni maker nell'handoff:** `scripts/check.sh` con 105 pytest e 83 test JS, `scripts/e2e.sh` con 169 controlli; prima del fix restore un test mostrava 500 e dopo il fix 422 con rollback. Nessuna uscita dei test è stata verificata indipendentemente dalla chat 02.
- **Aggiornamento operativo nell'handoff maker:** riferisce deploy live 1.10.6, schema 9 e APK Android `next` ricompilato. Il reviewer 02 **non ha verificato** endpoint di produzione, stato container, checksum APK o funzionamento su telefono reale. Non asserire “nessun deploy” come fatto attuale.
- **Prossime verifiche:** prove indipendenti del restore su copia isolata; evidenza di versione realmente distribuita; test sul device Android `next` e QA dei casi falliti per integrità dati.

**Nessuna modifica a `main`, `REVIEW_LEDGER.md`, al checkpoint o ai documenti degli altri owner.**

## 11. Segnalazione operativa — perdita di connettività VPN durante download APK — 2026-11-13

- **Stato:** segnalazione utente osservata, diagnosi da eseguire; **nessun finding FW-ARCH numerato** finché non emerga una causa verificata. Priorità di triage suggerita **P2**, da rivalutare se vengono dimostrate indisponibilità globale, perdite di dati o rischi di sicurezza.
- **HEAD applicativo ispezionato:** `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7` (confronto GitHub: `main` identico), **nessuna modifica applicativa** dal precedente audit.
- **Scenario riferito direttamente dall'utente:** da un unico PC dell'ufficio collegato alla rete domestica tramite VPN, avviando dal browser web il download dell'APK FitWeek si interrompono contemporaneamente, dal punto di vista di quel PC, SSH, ping e pagina web verso l'host domestico. Il download da LAN locale funziona. Non è stato verificato se si interrompa il tunnel VPN, solo il percorso verso l'host oppure la connettività per altri client. Tipo VPN, MTU, dimensione APK e tempi di recupero non ancora noti.
- **Impatto:** indisponibilità temporanea apparente dell'accesso remoto durante un trasferimento di grandi dimensioni; nessuna evidenza di crash del server, container, router o altre applicazioni.
- **Evidenza di codice:** `app/main.py`: `GET /api/v1/app/android/download?channel=stable|next`, autenticato con `require_session`, verifica metadati `*-apk.json` e serve l'APK locale con `fastapi.responses.FileResponse`. `static/js/views/settings.js` rende un normale link `<a href=... download>`. `app/config.py`: directory download locale; `docker-compose.yml`: bind `192.168.222.200:8088:8080`, volume `./mobile/dist:/app/downloads:ro`; `Dockerfile`: Uvicorn/FastAPI. Non è stata riscontrata, mediante esame statico mirato, logica applicativa che spieghi da sola la perdita simultanea di SSH/ping/web.
- **Ipotesi non confermate, in ordine diagnostico:** saturazione dell'upload domestico o bufferbloat; MTU/MSS/PMTUD anomalo del tunnel; router/firewall/NAT o client VPN sotto trasferimento sostenuto; solo in seconda battuta anomalie HTTP/FileResponse, Range, socket o carico Uvicorn/Docker. Non dichiarare la causa senza dati.

### Verifiche richieste al maker (diagnosi, non implementazione preventiva)

1. Identificare VPN, endpoint di ingresso, host e percorso di routing, senza esporre credenziali; stabilire se il guasto è tunnel-wide, host-specific o server-wide con ping/SSH dalla LAN e da un secondo client durante un trasferimento **controllato**.
2. Raccogliere dimensioni APK, velocità e tempi di download, consumo banda e CPU/RAM server, stato del container, eventuali log kernel/router/VPN. Evitare ripetizioni incontrollate che interrompano la connessione dell'utente.
3. Confrontare APK con un trasferimento statico equivalente via VPN e con un trasferimento a velocità limitata; verificare HTTP status/header `Content-Length`, `Accept-Ranges`/Range, disconnessione e eventuale riavvio del servizio.
4. Se la prova lo indica, indagare MTU/MSS/PMTUD e saturazione/bufferbloat; effettuare prima diagnosi reversibili. Non modificare VPN, firewall, Docker, configurazione di rete, limiti o sistema live senza autorizzazione dell'utente.
5. Riportare risultati riproducibili (comandi, orari, metriche, log redatti, condizioni di rete, risultati comparativi, commit SHA), distinguere causa dimostrata e plausibile; proporre intervento minimo e criteri di accettazione solo dopo identificazione.

### Accettazione della diagnosi e coordinamento

- La diagnosi è sufficiente quando è noto **quale segmento cade**, un confronto trasferimento lento/veloce o equivalente isola un fattore, e vengono raccolte evidenze per almeno una causa o per escluderla ragionevolmente. Un eventuale fix richiede test VPN dalla postazione interessata e controllo che SSH/ping restino raggiungibili durante il trasferimento APK.
- **Test eseguiti dal reviewer:** nessuno lato VPN/live; la valutazione è solo lettura del codice e segnalazione utente. Non attribuire il problema a FitWeek, né a provider VPN, né al router senza riscontro.
- **Relazione con altre aree:** possibile relazione con compatibilità Android/APK e disponibilità operativa, ma distinta dagli FW-ARCH-001/002 e FW-REV correnti. Owner di triage: area 02; nessuna modifica a Ledger o altre aree.
