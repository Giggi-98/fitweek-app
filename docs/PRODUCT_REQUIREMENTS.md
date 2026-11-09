# Requisiti di prodotto

## Visione

Un'unica app, sul proprio server, che risponde ogni giorno a: *cosa mi alleno oggi, cosa mangio, cosa devo comprare, come sto andando*. Deve far risparmiare tempo, non chiederne. Utente unico.

## Profilo e routine

Uomo, 28 anni, 166 cm, peso iniziale 90 kg, lavoro sedentario. Obiettivo **ricomposizione corporea** (perdere grasso progressivamente mantenendo/aumentando massa muscolare). Nessuna allergia, intolleranza o restrizione. Vive da solo, vuole cucinare il meno possibile. Principiante in palestra.

| Fascia | Lun | Mar | Mer | Gio | Ven | Sab | Dom |
|---|---|---|---|---|---|---|---|
| Lavoro | 9–18 | 9–18 | 9–18 | 9–18 | 9–17 | — | — |
| Pranzo 13:00 | lavoro | lavoro | lavoro | lavoro | lavoro | casa | casa |
| Pre-gym (~18:15–19:15) | spuntino | — | spuntino | — | spuntino | — | — |
| Palestra 19:30–22:00 | **A** | — | **B** | — | **C** | — | — |
| Cena | secondo lavoro ~22:30 | secondo lavoro | secondo lavoro ~22:30 | secondo lavoro | secondo lavoro ~22:30 | casa | casa |
| Sonno | ~00:00 | ~02:00 | ~00:00 | ~02:00 | ~00:00 | ~02:00 | ~02:00 |

- Colazione: no (caffè; a volte dolci dei colleghi).
- Pranzo al lavoro: primo + contorno; il **secondo** (sottovuoto, da microonde) si porta a casa per cena. Uno per giorno lavorativo → 5 cene coperte. Non vanno pianificati acquisti di secondi lun–ven.
- Weekend: oggi a volte un solo pasto per mancanza di cibo; occasionalmente asporto/sushi. Obiettivo: pasti semplici disponibili in casa, priorità alle cene, flessibilità.
- Spesa: Esselunga online, consegna lunedì, 30–50 €/sett. Copre spuntini, pre-gym, accompagnamenti dei secondi, pasti weekend, dispensa.
- Sonno: desiderio di regolarizzarlo progressivamente (funzione futura, non invasiva).

## Requisiti funzionali

Legenda stato: ✅ implementato · 🟡 parziale · ⬜ pianificato. Dettaglio nell'audit.

### A. Dashboard (centro operativo della giornata)
- 🟡 Giorno odierno e allenamento previsto (A/B/C) · ⬜ settimana del programma calcolata dalla data di inizio
- 🟡 Prossimi pasti (oggi piano testuale) · ⬜ orari coerenti con il giorno (lavoro/palestra/weekend)
- ⬜ Spuntino pre-palestra evidenziato nei giorni di allenamento, cena disponibile (secondo del lavoro)
- 🟡 Stato spesa (totale stimato, spunte) · ⬜ consegna del lunedì
- 🟡 Peso attuale · ⬜ trend/media 7 giorni
- ⬜ Attività da completare (es. pesata, spesa da confermare)
- ⬜ Pulsante primario "Inizia allenamento" nei giorni A/B/C

### B. Palestra
- ✅ Giorni A/B/C, 8 settimane, serie per settimana per esercizio, kg e ripetizioni per serie, durata, note, video, PDF originale consultabile
- 🟡 Storico carichi (lista testuale; "ultima" mostrata)
- ⬜ Salvataggio per serie (nessuna perdita a metà seduta), serie completata/non completata
- ⬜ Pre-compilazione con i carichi dell'ultima seduta, `+/-` rapidi
- ⬜ Timer recupero (avvio automatico al completamento della serie, vibrazione)
- ⬜ RPE/RIR opzionali, note tecniche per esercizio
- ⬜ Grafici prestazioni, confronto tra settimane
- ⬜ Schede multiple, riprogrammazione di una seduta saltata
- Vincoli: interfaccia usabile con una mano, target touch ≥ 48 px, nessun modulo lungo tra le serie.

### C. Alimentazione
- 🟡 Piano settimanale ricorrente (testo libero) · ⬜ calendario per data
- ⬜ Registrazione pasti consumati, pasti liberi, cambi di programma
- ⬜ Secondo del lavoro come pasto "disponibile" tracciato
- ⬜ Pasti abituali / ricette veloci, ingredienti e porzioni
- ⬜ Valori nutrizionali solo se disponibili, con fonte; stime dichiarate
- ⬜ Preferenze

### D. Spesa e inventario
- ✅ Lista, categorie, prezzo stimato, spunta, copia, budget
- 🟡 Dispensa (nome, quantità, scadenza)
- ⬜ Luogo (dispensa/frigo/freezer), quantità numeriche + unità
- ⬜ Spesa effettiva vs prevista, storico settimanale
- ⬜ Generazione lista dal piano pasti meno l'inventario
- ⬜ Esportazione/condivisione
- Esselunga: nessuna integrazione automatica; eventuale modulo separato da progettare su fonti legittime.

### E. Progressi
- ✅ Peso, girovita, nota, grafico peso, storico allenamenti
- ⬜ Medie settimanali (calcolate, marcate come tali), misure aggiuntive
- ⬜ Carichi per esercizio nel tempo, frequenza allenamenti, note di recupero

### G. Promemoria e inserimento rapido (richiesta 2026-11-09)
- ⬜ L'app ricorda attivamente cosa fare: spuntino pre-palestra, pasti, allenamento, pesata, spesa del lunedì. Orari derivati dalla routine, modificabili, silenziabili.
- ⬜ Tocco sul promemoria → popup di inserimento rapido (es. "Cosa hai mangiato?" con scelte abituali + testo libero; "Peso di oggi").
- ⬜ Pesata quando l'app lo ricorda (frequenza configurabile, default proposta: 1–2 volte a settimana, stessa condizione, es. mattina).
- ⬜ In palestra: per ogni esercizio serie e peso della settimana corrente del programma.
- ⬜ Dashboard settimanale: pasti consumati, **calorie teoriche** (sempre marcate come stima, con fonte), serie completate vs previste, peso e andamento.
- Tono: promemoria gentili, nessuna colpevolizzazione per pasti saltati o "sgarri"; nessun obiettivo calorico prescrittivo.
- Implementazione proposta: app Capacitor con notifiche locali (D-013).

### F. Assistente AI (opzionale)
- ⬜ Architettura predisposta, disattivata di default, chiavi solo backend, consenso esplicito per l'invio di dati, proposte che l'utente approva.

## Requisiti non funzionali

- **Affidabilità dati**: nessuna perdita durante un allenamento, backup automatici verificati, migrazioni non distruttive.
- **Sicurezza**: password unica forte, rate limit login, revoca sessioni, header di sicurezza, nessun segreto nel repo, solo LAN/VPN/HTTPS.
- **Prestazioni**: prima visualizzazione < 1 s in LAN; interazione di registrazione serie < 100 ms percepiti (aggiornamento ottimistico).
- **Mobile-first**, desktop completo; dark e light mode; accessibilità (contrasto AA, label, focus visibile).
- **Manutenibilità**: codice leggibile non minificato, moduli piccoli, test automatici, documentazione allineata.
- **Privacy**: nessun servizio esterno senza consenso; nessuna telemetria.
- **Tono**: non giudicante; niente punteggi colpevolizzanti, niente obiettivi calorici estremi, niente "streak" punitivi.
