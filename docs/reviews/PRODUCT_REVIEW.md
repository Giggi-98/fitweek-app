# FitWeek — Initial Product Review

- Data: 2026-11-13
- Responsabile: chat 04 — Product Strategy, namespace `FW-PROD-XXX`
- Repository: `Giggi-98/fitweek-app`
- Branch codice: `main`; HEAD osservato: `5e333bd8ca290f96fc81dfddff66934de623614a`
- Branch documenti: `review/engineering`
- Tipo verifica: ispezione statica GitHub di documenti, sei viste frontend e funzioni pertinenti; nessun test runtime, APK o produzione.
- Checkpoint ufficiale chat 01: `null`; **non modificato**.
- Documenti di prodotto `PRODUCT_REVIEW.md` e `PRODUCT_BACKLOG.md`: non presenti sul branch review prima della pubblicazione autorizzata del 2026-11-13.

## Sintesi e valutazione

**Verdetto di prodotto: DIREZIONE CORRETTA, CONSOLIDAMENTO PRIORITARIO.** Le funzioni quotidiane fondamentali sono rappresentate nel codice. Il valore incrementale maggiore ora è dimostrare affidabilità Android/offline e ridurre il lavoro ripetuto tra piano dei pasti, spesa e dispensa. Non è giustificato accelerare AI, Health Connect, schede multiple o redesign estetici mentre restano verifiche di integrità e test sul dispositivo reale.

**Limite importante:** i requisiti `docs/PRODUCT_REQUIREMENTS.md` mantengono molti contrassegni storici `⬜` non allineati ai moduli successivi. La roadmap documenta implementazioni e test riferiti dal maker; non certifica la produzione, gli APK o il completamento dei finding. Il Ledger ufficiale mantiene aperti FW-REV-001…008, anche se commit successivi dichiarano fix.

## Inventario funzionale per area

| Area / schermata | Evidenza statica in `main` | Stato prodotto | Limite o verifica |
| --- | --- | --- | --- |
| Oggi | `static/js/views/dashboard.js`: agenda, timeline, scheda contestuale Adesso, allenamento del giorno, riepilogo settimana, peso, richiami nutrizione | IMPLEMENTATO nel codice | Non misurata utilità reale e gerarchia su telefono |
| Allenamento | `static/js/views/training.js`: settimana A/B/C, righe serie, kg/reps e stepper, conferma, note, RIR, riepilogo, recupero e serie extra; `app/workouts.py` | IMPLEMENTATO nel codice; affidabilità DA VERIFICARE | Conflitti/coda offline FW-REV-001/002; reale uso con una mano e APK non provati qui |
| Pasti | `static/js/views/meals.js`, `static/js/composer.js`, `app/daily.py`: diario, piano, abituali, editor pasti composti, secondo da asporto, fonte nutrizionale | IMPLEMENTATO nel codice; integrazione piano-lista PARZIALE | Piano testuale e ingredienti strutturati sono separati; il secondo viene gestito per la routine, ma il percorso completo va provato |
| Spesa/dispensa | `static/js/views/shopping.js`, `static/js/stats.js`: lista, budget/spesa effettiva, dispensa, scadenze, importazione spuntati, proposta dal piano meno scorte | IMPLEMENTATO nel codice; utilità automatica PARZIALE | Generazione basata solo su `items` strutturati; prezzi sconosciuti non sono inventati; UX cancellazione FW-UX-001/003 |
| Progressi | `static/js/views/progress.js`, `static/js/stats.js`: pesate, medie, trend, carichi, costanza, sonno | IMPLEMENTATO nel codice | Valutare solo indicatori che cambiano decisioni; test mobile mancanti |
| Impostazioni/routine | `static/js/views/settings.js`: promemoria, profilo, preferenze, sessioni, backup, stato modifiche non inviate, Android | IMPLEMENTATO nel codice | Semantica ripristino FW-ARCH-001, navigazione accessibile FW-UX-002 |
| Android stable | `CLAUDE.md`, `docs/ROADMAP.md`: shell Capacitor che carica il server | IMPLEMENTATO dichiarato, funzionamento DA VERIFICARE | Dipende dalla connettività per il contenuto; prove su telefono non disponibili |
| Android next | `CLAUDE.md`, `docs/DECISIONS.md`: frontend incluso nell'APK, cache, code offline, Keystore | IN PROVA / DA VERIFICARE | APK dopo fix 1.10.3 non dichiarato ricompilato; test reali e compatibilità backend indispensabili |
| AI e lettura menu mensa | `docs/ROADMAP.md`, `docs/DECISIONS.md` | PIANIFICATO | Non prioritario prima delle prove Android e dei flussi essenziali |
| Health Connect, programma oltre 8 settimane, ulteriori misure | `docs/ROADMAP.md`, D-019 | PIANIFICATO/PARZIALE secondo singola capacità | Richiesta di valore d'uso non ancora dimostrata; separare singole funzionalità |

> IMPLEMENTATO significa che esistono elementi applicativi nel repository, **non** che siano stati provati su dispositivo, in produzione o nell'uso quotidiano.

## Valutazione dei flussi reali

### 1. Allenamento lunedì, mercoledì, venerdì

Valore alto e ripetuto. Il codice supporta rapido completamento delle serie, precedente carico, esercizi A/B/C e timer. Il punto critico di prodotto non è aggiungere grafici ma la fiducia che una serie rimanga salvata dopo rete intermittente, crash, logout o modifica da altro dispositivo. Verificare sul telefono reale: avvio da Oggi, prima serie, modifica carico, recupero, ripresa dopo riavvio, ritorno online, correttezza del dato server. Target di esperienza, non risultato osservato: avvio entro 2 tocchi, serie già precompilata in 1 tocco.

### 2. Mensa, secondo da portare a casa, whey e fine settimana

Il diario con vassoio composto e `takeaway` è coerente con il pranzo al lavoro e la cena dal secondo della mensa. Pasti abituali e valori con fonte riducono le ricompilazioni. Verificare il percorso completo pranzo composto → secondo escluso dal pranzo → cena con secondo e accompagnamento → modifica a posteriori senza doppio conteggio. Dessert whey: gestibile come pasto abituale, non risulta giustificata una nuova sezione dedicata. Il weekend richiede libertà, non penalizzazioni: registrazione semplice di pizza/sushi e dati ignoti esplicitamente mancanti.

### 3. Domenica/lunedì: organizzazione spesa Esselunga

Esiste una proposta `fabbisogno dal piano − dispensa` che ignora prodotti scaduti e non inventa prezzi, rispettando le decisioni di prodotto. **Limite funzionale osservato:** `meals.js` conserva un piano in descrizioni testuali e un array di ingredienti `items` alimentato separatamente; `planProposal()` considera `items`, non analizza i testi del piano. Una settimana pianificata in testo può quindi produrre una lista incompleta senza errore software. Valutare con un test d'uso prima di introdurre parser o AI. Non prevedere scraping Esselunga o acquisti automatici.

### 4. Sonno, misurazioni, promemoria

Disponibili inserimenti leggeri e promemoria configurabili. La priorità è che siano discreti e affidabili, non più frequenti. Non aggiungere notifiche o indici di performance senza chiaro beneficio. Non trasformare dati nutrizionali stimati in giudizi, punteggi o limiti prescrittivi.

## Valore delle schermate principali

| Schermata | Decisione che dovrebbe facilitare | Giudizio preliminare |
| --- | --- | --- |
| Oggi | Cosa devo fare adesso? | Alta utilità; mantenere una sola azione prioritaria |
| Allenamento | Quale serie registro ora? | Massima utilità; la fiducia nel salvataggio precede il polish |
| Pasti | Cosa ho mangiato e cosa mangerò? | Alta; verificare rapidità pranzo-cena e gestione dati incompleti |
| Spesa | Cosa manca davvero? | Alta se il piano produce una lista affidabile; evitare doppia manutenzione |
| Progressi | Sto progredendo con dati sufficienti? | Media-alta; chiarezza tra misurato e calcolato |
| Impostazioni | Come controllo affidabilità e preferenze? | Essenziale ma non quotidiana; trasparenza restore e coda prima di nuove opzioni |

## Dipendenze aperte da altri audit

- Chat 01, **stato ufficiale aperto**: `FW-REV-001/002/003` (P1, sincronizzazione serie e piano), `FW-REV-004/005/006/008` (P2, export, token, logout, conflitti dispensa), `FW-REV-007` (P3, documentazione). Fix 1.10.3 **dichiarati dal maker**, non considerati verificati.
- Chat 02: `FW-ARCH-001` restore legacy/ibrido; `FW-ARCH-002` documentazione architettura.
- Chat 03: `FW-UX-001` Undo spesa/dispensa; `FW-UX-002` tab tastiera; `FW-UX-003` struttura dei controlli spesa. QA mobile non ancora eseguita.
- Nessun finding tecnico viene duplicato o chiuso in questo documento.

## Raccomandazioni e roadmap di prodotto

**Ciclo 0 — gate di affidabilità (prima di nuove feature):** review indipendente dei fix 1.10.3 e test documentati di persistenza offline, backup/restore, APK next sul telefono reale; non promuovere `next` a stable sulla base dei soli test simulati. Misurare il flusso serie e le modifiche pendenti.

**Ciclo 1 — meno lavoro ripetuto:** prova d'uso del piano pasti → ingredienti → spesa → dispensa. Se la frizione è confermata, proporre un intervento minimo e deterministico, con conferma esplicita e nessuna deduzione automatica di quantità o valori nutrizionali. Verificare mensa → cena e registrazione rapida dei pasti abituali.

**Ciclo 2 — rifinitura motivata dai dati:** correggere le frizioni effettivamente misurate su Android, coordinandosi con chat 03; evitare interventi estetici indipendenti. Definire se la gestione del programma dopo 8 settimane è un bisogno imminente.

**Rinviati:** AI lettura menu, Health Connect, integrazione Esselunga, automazioni prescrittive, nuove dashboard e metriche prive di domanda verificata.

## Misure proposte (baseline da raccogliere)

- Allenamento: tocchi avvio, tocchi per serie invariata, percentuale di serie riapparse correttamente su server dopo offline/riavvio (target: 100% nei casi di test).
- Pasti: tocchi e tempo per registrare un pranzo mensa + takeaway e la cena; assenza di doppi conteggi; visibilità della fonte nutrizionale.
- Spesa: numero di ingredienti del piano rimasti fuori dalla lista per mancanza di struttura; quantità di correzioni manuali; tempo settimanale dedicato a piano+lista.
- Android: task completati offline e sincronizzati senza perdite; stato compatibilità APK/backend; nessun dato reale nei log.
- Feedback: promemoria utili, posticipati o disattivati; nessuna misura di streak/punizione.

## Test eseguiti e non eseguiti

Eseguiti dal reviewer: sola lettura statica dei documenti GitHub e dei moduli indicati, senza build né runtime. Dichiarati dal maker: suite pytest, Node JS e Playwright nella roadmap/CLAUDE; non attestati indipendentemente qui. Mancanti: reale APK Samsung, percorsi completi offline/online, import/export/restore isolato, screenshot e misurazioni d'interazione, prova d'uso mensa/spesa.

## Fonti e identificazione versioni

- `main` HEAD osservato: `5e333bd8ca290f96fc81dfddff66934de623614a`.
- Blob documenti `main`: `CLAUDE.md` `dbb3b6d`; `PRODUCT_REQUIREMENTS.md` `65181f2`; `ROADMAP.md` `469b368`; `DECISIONS.md` `95b092a`.
- Blob audit branch review: Ledger `1dc4760`; Architecture `278ce8d`; Technical Debt `67ed46c`; UX Audit `2cacbfd`; UX Backlog `d191380`.
- Questa analisi non certifica che `main`, APK o produzione coincidano. Prima della pubblicazione sono stati ricontrollati HEAD di `main`, Ledger e assenza dei documenti sul branch di review.
---

## Aggiornamento Product Strategy — 2026-11-13 — e014e0d

- **HEAD `main` verificato:** `e014e0da498ffa05d8b0570c76cec2f074224483`.
- **Delta rispetto all'audit iniziale:** `5e333bd8ca290f96fc81dfddff66934de623614a..e014e0da498ffa05d8b0570c76cec2f074224483`, 7 commit (D-027, correzioni 1.10.4 e 1.10.5, documentazione).
- **Metodo:** confronto GitHub e lettura delle revisioni aggiornate di chat 01/02/03, roadmap e documentazione; consultazione statica del codice coinvolto nelle verifiche precedenti. **Nessun test applicativo, APK, restore reale o prova su telefono eseguito da questa chat.**
- **Checkpoint ufficiale:** `null`, esclusiva competenza chat 01. La review incrementale `docs/reviews/2026-11-13-e014e0d.md` copre staticamente il delta e conclude **APPROVATO CON RISERVE (solo statico)**, non autorizzazione al rilascio.

### Evidenze nuove e stato prodotto

| Dominio | Evidenza del repository / audit proprietario | Implicazione product |
| --- | --- | --- |
| Integrità serie offline | `1418d74`: `app/workouts.py` conserva millisecondi in `edit_time`; chat 01 considera FW-REV-002/009 corretti nel percorso statico, **ancora aperti per test runtime**. A pari millisecondo resta un caso di ordinamento da valutare. | FW-PROD-001 **non sbloccato**; serve riproduzione out-of-order e APK reale. |
| Logout Android | `d57212b`: `platform.js`/`logout.js` distinguono il logout fallito; chat 01 mantiene FW-REV-010 **aperto** per caso con fallimento contemporaneo di Keystore e scrittura flag localStorage. | FW-PROD-001 include test di fallimento e riavvio senza ri-autenticazione silenziosa. |
| Spesa/dispensa | `b8fa875`: Undo rimozione e separazione pulsanti dalla label; chat 03: FW-UX-001/003 fix staticamente presenti, **non chiusi**. | FW-PROD-006: verificare Undo con rete instabile, reload, toast concorrenti e persistenza. |
| Navigazione | `1e7702d`: tabs con tastiera; chat 03: FW-UX-002 **parziale** perché mancano legami tab/pannello, screen reader non provato. | FW-PROD-005 rimane QA prima di altro polish. |
| Ripristino | `1327e5d`: API e UI esplicitano `replaced` e `kept`; chat 02: FW-ARCH-001 **aperto**, test restore isolato non eseguiti. | FW-PROD-002: non confondere export JSON con recupero SQLite completo; verificare versioni v1–v4, ack/tombstone e rollback. |
| Architettura | `e014e0d`: `docs/ARCHITECTURE.md` riallineato; chat 02: FW-ARCH-002 ancora aperto per accuratezza finale e condizioni operative. | Dipendenza documentale; non giustifica nuova feature. |

### Verdetto, priorità e decisioni

**DIREZIONE CORRETTA; GATE DI AFFIDABILITÀ ANCORA APERTO.** Le correzioni sono presenti in `main` e i test di regressione sono descritti dal maker; nessun reviewer ne ha attestato l'esecuzione. Non è dimostrato che il codice sia distribuito sul server o incluso nell'APK `next` installato. La roadmap segnala 1.10.5 nel repository e non in produzione, con APK da ricompilare.

1. **FW-PROD-001 (P1):** mantenere come primo gate; richiede verifiche FW-REV-002/009/010, sincronizzazione e riavvio su Android reale con combinazione APK/backend esplicitata.
2. **FW-PROD-002 (P1):** mantenere gate backup/restore; il miglioramento della comunicazione non sostituisce il test isolato di recuperabilità.
3. **FW-PROD-003 (P2):** consentita **analisi funzionale senza sviluppo** del doppio lavoro piano→ingredienti→lista, usando tre settimane tipo e misurando tempi/correzioni. Non introdurre parser, ricette complesse o AI sulla base del solo audit statico.
4. **FW-PROD-004/005/006 (P2):** QA dei flussi mensa-cena, interazioni Android e spesa/dispensa in coordinamento con i finding esistenti.
5. **FW-PROD-007/008 (P3):** restano rinviati; nessuna nuova funzionalità richiesta adesso.

**Criterio per sbloccare il prossimo ciclo:** esiti indipendenti di test critici, prova reale Android, restore isolato e conferma della compatibilità deploy/APK; eventuali finding tecnici restano di proprietà dei rispettivi reviewer. Nessun nuovo FW-PROD assegnato in questo aggiornamento.

### Riferimenti di coordinamento

- Chat 01: Ledger corrente e `docs/reviews/2026-11-13-e014e0d.md`: FW-REV-001…010, nessuna chiusura formale dei finding, checkpoint `null`.
- Chat 02: `ARCHITECTURE_AUDIT.md` / `TECHNICAL_DEBT.md`, sezione di verifica a `e014e0d`, FW-ARCH-001/002 aperti.
- Chat 03: `UX_AUDIT.md` / `UX_BACKLOG.md`, appendice a `e014e0d`, FW-UX-001/003 in attesa di runtime e FW-UX-002 parziale.
- Prodotti: `CLAUDE.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md` letti sul branch `main`.

**Persistenza:** aggiornamento riservato ai documenti chat 04 su `review/engineering`, senza scrittura su `main`, Ledger o audit di altre aree.


---

## Aggiornamento Product Strategy 1.10.6 — 2026-11-13

- **HEAD `main` verificato:** `439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`.
- **Intervallo successivo alla review di prodotto:** `e014e0da498ffa05d8b0570c76cec2f074224483..439dc830f35ba10ab24b3e7f40659d2b4f2f2bd7`, **quattro commit consecutivi** secondo GitHub compare: `9ba8b7c`, `cfb68d8`, `f2bf1e6`, `439dc83`.
- **Metodo:** confronto dei commit, ispezione statica dei sorgenti `platform.js`, `logout.js`, `ui.js`, `shopping.js`, test presenti, Ledger e audit specialistici, `CLAUDE.md`, `ROADMAP.md`, `DECISIONS.md` e handoff maker `docs/reviews/2026-11-13-439dc83.maker.md`.
- **Stato chat 01:** ultimo report ufficiale `docs/reviews/2026-11-13-e014e0d.md` **non include** questi quattro commit. Checkpoint ufficiale `null`. I finding FW-REV non sono chiusi da questa chat.
- **Test eseguiti da reviewer 04:** **nessuno**. Il maker dichiara 105 pytest + 83 test JS e 169 controlli E2E, ma questi risultati non sono stati verificati indipendentemente.
- **Attribuzione:** non emerge evidenza GitHub sufficiente per attribuire a Kimi singoli interventi; evitare attribuzioni personali non verificabili.

### Impatto delle quattro modifiche sul prodotto

| Commit / finding proprietario | Evidenza verificabile nel repository | Impatto e stato dal punto di vista prodotto |
| --- | --- | --- |
| `9ba8b7c` — FW-REV-010 | `static/js/platform.js`: controllo eliminazione Keystore, marcatore di logout su localStorage/cookie WebView, avvio fail-closed se lo storage non è scrivibile; `static/js/logout.js`: messaggi distinti secondo esito locale e revoca server. Test JS aggiunti. | Riduce il rischio di accesso non atteso, ma non prova il comportamento su Android reale. **FW-PROD-001 ancora BLOCCATO/DA VERIFICARE**. Il maker documenta un caso residuo se entrambi i marcatori falliscono al logout e lo storage torna disponibile al riavvio: richiede valutazione owner FW-REV-010, avviso comprensibile e test dispositivo. |
| `cfb68d8` — FW-UX-002 e FW-UX-001 | `static/js/ui.js`: `aria-controls` e `tabpanel()` con `aria-labelledby`, collegamenti nelle viste; test per Undo durante PUT, 409 e due eliminazioni. | Migliora la navigazione. Il toast ha un solo slot: la seconda rimozione sostituisce l'azione **Annulla** precedente. **Non è un bug di perdita dati dimostrato**; è un limite di recuperabilità percepita, da verificare nell'ambito FW-UX-001 e FW-PROD-006. Lettore di schermo non provato. |
| `f2bf1e6` — FW-ARCH-001 | `app/main.py`: `sqlite3.IntegrityError` restituisce 422 nel restore; transazione preesistente intende fare rollback; `tests/test_restore_matrix.py` aggiunge confronto pre/post con record duplicato. | Riduce il rischio di ripristino parziale non segnalato. **FW-PROD-002 ancora BLOCCATO/DA VERIFICARE** finché un reviewer non esegue restore su DB temporaneo, compresi dati non catturati dal solo export JSON. |
| `439dc83` — documentazione | Aggiornati `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md` con ciclo 5 / 1.10.6. | Rende rintracciabili intenzione e test dichiarati; non equivale a validazione del rilascio. |

### Stato del deploy: separare dichiarazione e prova

L'handoff maker `docs/reviews/2026-11-13-439dc83.maker.md` contiene un **aggiornamento operativo successivo** alla sua redazione iniziale: Claude dichiara deploy live 1.10.6, schema 9, health check e frontend servito aggiornato, backup pre-deploy e pre-migrazione, APK `next` versionCode 11006 ricompilato (checksum manifest in `mobile/dist/fitweek-next-apk.json`). **Il reviewer 04 non ha verificato direttamente endpoint live, stato DB, integrità dei backup, artefatto APK né installazione sul dispositivo**. Le sezioni più vecchie della roadmap che indicano «non in produzione» sono storiche rispetto a quell'handoff e non vanno trattate come prova dello stato attuale.

### Verdetto e gate

**VERDETTO PRODUCT STRATEGY: CORREZIONI COERENTI CON LE PRIORITÀ, GATE DI AFFIDABILITÀ NON SUPERATO.** Non emergono nuove funzioni che richiedano ampliamento della roadmap. Le correzioni riducono la complessità percepita e affrontano problemi esistenti; i test indipendenti e la verifica del dispositivo restano necessari.

1. **FW-PROD-001, P1:** prima del via libera all'uso dell'APK `next` come stabile, ottenere dalla chat 01 la review dei quattro commit, la riesecuzione indipendente di test serie offline/logout e un test Android reale offline→riavvio→online (inclusi Keystore/storage e compatibilità versione).
2. **FW-PROD-002, P1:** prova indipendente di restore isolato (formati legacy e nuovo, 422 e rollback, domini `replaced/kept`), senza toccare dati live; chiarire limiti dell'export JSON rispetto a SQLite.
3. **FW-PROD-006, P2, collegato a FW-UX-001:** far valutare alla chat 03 se il limite del toast unico sia accettabile nel flusso spesa. Test d'uso: eliminare due articoli rapidamente, tentare di annullare entrambi, contare articoli da ricreare. Una coda Undo si giustifica **solo se** il fastidio è riproducibile e significativo; non aggiungere UI a priori.
4. **FW-PROD-005, P2:** completare test di focus, tastiera e screen reader di FW-UX-002; non attribuire chiusura alla sola presenza di `tabpanel`.
5. **FW-PROD-003, P2:** confermare che resta pronto **solo per analisi** di tre settimane alimentari realistiche; il ciclo 1 non è autorizzato a partire senza gate 0.

**Nessun nuovo finding FW-PROD:** si aggiornano attività e dipendenze già registrate. Proprietà, ID, checkpoint e stati ufficiali delle altre chat restano invariati.

### Attività operative per Claude / coordinamento tra owner

Claude deve leggere **direttamente da GitHub** questa sezione e l'aggiornamento corrispondente in `PRODUCT_BACKLOG.md`, insieme ai documenti della chat 01/02/03. Non è richiesta una riscrittura generalizzata né nuove funzioni.

- **Priorità immediata: evidenze, non altre feature.** Fornire a chat 01 la prova riproducibile del caso FW-REV-010 con fallimento multiplo, la verifica di FW-REV-002/009 su operazioni consegnate fuori ordine e comandi/output/exit code delle suite. Le **verifiche indipendenti** rimangono dei reviewer.
- **Deploy:** se già effettuato come dichiarato, fornire prove verificabili di versione server, schema, backup, SHA artefatto APK e compatibilità; non ripetere deploy, migrazioni o restore su produzione senza nuova autorizzazione.
- **Android:** organizzare la verifica guidata sul telefono reale (senza assumere che sia stata eseguita), con risultati, log senza dati sensibili, versione APK/backend e test fallimento/restart. Non promuovere automaticamente `next` a `stable`.
- **UX:** condividere con la chat 03 il limite del toast singolo; effettuare eventuale correzione solo a fronte di decisione UX/prodotto o problema confermato, preservando il comportamento a un tocco.
- **Product discovery:** non implementare per ora FW-PROD-003, AI o nuove schermate. Preparare semmai i tre scenari e misurazioni per la prova piano→spesa.

**Nessuna prova runtime o conclusione di risoluzione formale aggiunta da questa chat.**
