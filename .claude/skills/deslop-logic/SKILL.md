---
name: deslop-logic
description: Elimina lo "slop" logico da codice, test e documentazione scritti da un'IA - codice difensivo inutile, astrazioni premature, duplicazioni, commenti che ripetono il codice, test che non possono fallire, affermazioni non verificate. Da usare sul proprio diff prima di ogni commit e quando l'utente chiede di ripulire, semplificare o "togliere l'AI slop" dal codice di FitWeek. Parole chiave - slop, pulizia, semplifica, codice morto, ridondante, over-engineering, review del diff.
---

# Deslop logica

Lo slop logico è codice che esiste per sembrare accurato, non perché un caso reale lo richiede. Si lavora
sul diff (`git diff`), una voce alla volta. Ogni riga che resta deve avere un motivo che sai dire.

## 1. Domande per ogni blocco aggiunto

- **Quale input reale porta qui?** Se non sai nominarlo (un utente, una risposta del server, un dato del DB
  esistente), il ramo è slop: toglilo.
- **Chi lo chiama?** Funzione, parametro, opzione o export senza un chiamante nel repository → via.
- **Esiste già?** Cerca prima (`grep`) in `static/js/util.js`, `ui.js`, `stats.js`, `sync.js`, `app/domain.py`,
  `app/workouts.py` (`edit_time`, `is_stale`). Una seconda versione della stessa regola è un bug futuro.
- **È nel posto giusto?** Regole pure in moduli puri (testabili con `node --test`), I/O ai bordi. Una regola
  che esiste sia in Python sia in JS deve dichiararlo in un commento su entrambi i lati e avere un test che
  le confronta sugli stessi dati.

## 2. Schemi da togliere

**Difese finte**
- `try/catch` che inghiotte l'errore senza un motivo scritto. Un catch vuoto è ammesso solo con il commento
  che dice quale guasto atteso copre (es. `/* offline */`) e solo se lo stato resta coerente.
- Controlli su valori che non possono essere nulli per costruzione; `?.` a catena "per sicurezza"; valori di
  ripiego (`|| 0`, `|| ""`) che nascondono un dato mancante trasformandolo in un dato falso. Nei dati
  nutrizionali un valore assente resta assente (`null`, "senza valori"), mai zero.
- Validazione ripetuta a più livelli. Il confine è uno: Pydantic sul server, il modulo sul client.

**Astrazione prematura**
- Helper usato una volta; opzioni di configurazione con un solo valore; classi dove basta una funzione;
  "manager", "service", "handler" generici; livelli di indirezione che rinominano e inoltrano.
- Generalizzare per casi che nessuno ha chiesto. Tre righe simili sono meglio di un'astrazione sbagliata.

**Rumore**
- Commenti che ripetono il codice o raccontano la modifica ("aggiunto", "ora usa", "fix"). Un commento dice
  il *perché* o il vincolo che non si vede (CSP, D-0xx, ordine obbligato).
- Nomi vaghi (`data`, `result`, `tmp`, `handle2`), costanti magiche sparse, codice commentato, `console.log`.
- Compatibilità all'indietro per formati che non sono mai stati pubblicati.

**Stato incoerente**
- Lo stesso dato tenuto in due posti senza una regola su chi vince. Per ogni dato nuovo scrivi una riga:
  dove vive, chi lo scrive, cosa succede offline, cosa succede se due dispositivi lo cambiano.
- Scritture che saltano la coda (`request` con metodo diverso da GET fuori da `enqueue`) senza motivo.
- Operazioni non idempotenti o senza chiave: una scrittura ripetuta non deve duplicare.

## 3. Test

- Un test deve **poter fallire**: prima di fidarti, rompi di proposito la riga che protegge e guardalo
  diventare rosso. Un test di regressione fallisce prima della correzione e passa dopo.
- Via i test che verificano il mock, che ripetono l'implementazione nell'asserzione, o che controllano solo
  "non lancia". Un'asserzione per comportamento osservabile.
- Niente attese a tempo fisso né dipendenze da ora, giorno della settimana o ordine dei test.
- Non contare: i numeri di test nella documentazione si leggono dall'output di `scripts/check.sh` e
  `scripts/e2e.sh`, non si stimano.

## 4. Affermazioni

- "Funziona", "testato", "verificato" solo per ciò che hai eseguito in questa sessione, con l'output.
  Tutto il resto è "implementato, non provato" con il motivo (telefono reale, APK, deploy).
- Niente valori nutrizionali, prezzi, serie o ripetizioni inventati. Un numero ha una fonte o non c'è.
- Documentazione: descrive ciò che il codice fa oggi. Via gli aggettivi (robusto, completo, ottimizzato) e
  le promesse; restano comportamento, limiti e come verificarli.

## 5. Chiusura

1. Rileggi il diff intero come se fosse di un altro: ogni file toccato era necessario per la richiesta?
   Le modifiche non collegate si tolgono dal commit.
2. `scripts/check.sh`; se tocca frontend o sincronizzazione anche `scripts/e2e.sh`.
3. Il diff dopo la pulizia deve essere **più corto** di prima a parità di comportamento. Se è cresciuto,
   hai aggiunto invece di togliere.
