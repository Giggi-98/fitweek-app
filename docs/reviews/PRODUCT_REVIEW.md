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