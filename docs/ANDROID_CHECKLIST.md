# Checklist di Verifica Reale — Samsung S25 Ultra

Da compilare sul telefono reale dopo l'installazione di `fitweek-next.apk` (*Impostazioni → App Android → Scarica la versione di prova*).

Stato: `[ ]` da provare · `[x]` superato · `[!]` anomalia rilevata

---

## 1. Installazione e permessi
- [ ] **Installazione affiancata**: `fitweek-next.apk` ("FitWeek β", `app.fitweek.personal.next`) si installa senza sovrascrivere l'app stabile.
- [ ] **Avviso HTTP al login**: nella schermata di accesso con indirizzo `http://192.168.222.200:8088` compare la nota sulla connessione HTTP non cifrata.
- [ ] **Accesso e Keystore**: il login va a buon fine e in *Impostazioni → Dati e accesso → Sessione* il telefono compare come dispositivo attivo ("Questo dispositivo").
- [ ] **Permessi Samsung**: in *Impostazioni → App Android* dentro l'app risultano `Notifiche: consentite ✓` e `Orari esatti: consentiti ✓`; nelle impostazioni Android dell'app la batteria è su **Senza restrizioni**.

## 2. Notifiche locali
- [ ] **Notifica ad app chiusa**: premendo *Notifica di prova* e chiudendo subito l'app (o spegnendo lo schermo), la notifica suona dopo 5 secondi; toccandola si apre FitWeek.
- [ ] **Posticipa ("Più tardi")**: toccando *Più tardi (15′)* su un promemoria, la notifica viene riprogrammata al nuovo orario e suona 15 minuti dopo anche a schermo spento.
- [ ] **Dopo il riavvio del telefono**: riavviando l'S25 Ultra e aprendo l'app (anche senza rete), i promemoria restano programmati.
- [ ] **Con risparmio energetico attivo**: attivando il risparmio energetico del telefono (con FitWeek su *Senza restrizioni*), la notifica del promemoria successivo arriva comunque all'orario previsto.

## 3. Funzionamento offline, 4G e palestra
- [ ] **Server muto in 4G ("Lavora offline")**: con Wi‑Fi spento e 4G attivo (senza VPN, quindi server di casa irraggiungibile), aprendo l'app compare entro ~2,5 secondi il pulsante **"Lavora offline"**; toccandolo l'app si apre subito con la copia locale.
- [ ] **Conferma manuale dell'esercizio**: avviando una seduta e spuntando tutte le serie previste di un esercizio, la scheda dell'esercizio resta aperta finché non si tocca **"Esercizio completato"**; i pulsanti **"Serie extra"** e **"Togli serie"** aggiungono/tolgono serie non registrate.
- [ ] **Serie e pesata in modalità aereo**: in modalità aereo, registrando una serie e una pesata, l'indicatore in alto mostra `Offline · dati delle HH:MM · 2 da inviare`; chiudendo e riaprendo l'app sempre in modalità aereo, la serie e la pesata sono ancora presenti.
- [ ] **Rientro in Wi‑Fi**: riattivando il Wi‑Fi di casa, l'indicatore passa da solo a `Sincronizzato` e i dati compaiono anche sul PC.

## 4. Conflitti PC / telefono e uscita
- [ ] **Modifica dal PC durante l'offline**: mentre il telefono è in modalità aereo con una pesata o un prodotto aggiunto, aggiungendo un altro alimento in dispensa dal PC e poi riconnettendo il telefono, entrambe le modifiche sono presenti senza sovrascritture silenziose (e se è stata toccata la stessa voce compare l'avviso con il nome della voce).
- [ ] **Eliminata sul telefono, modificata dal PC**: in modalità aereo eliminare un articolo della dispensa; dal PC cambiarne la quantità; riconnettendo, l'articolo resta con la quantità del PC e compare l'avviso "Eliminato qui ma modificato su un altro dispositivo".
- [ ] **Pranzo e cena dello stesso giorno**: in modalità aereo cambiare il pranzo di un giorno del piano; dal PC cambiare la cena dello stesso giorno; riconnettendo ci sono entrambe.
- [ ] **Serie corretta al volo**: con rete lenta, spuntare una serie e correggerne subito il carico (o toglierla): sul PC compare l'ultimo valore.
- [ ] **Serie eliminata dal PC**: registrare una serie e aspettare `Sincronizzato`; in modalità aereo correggerne il carico sul telefono; qualche minuto dopo eliminare quella serie dal PC (Progressi → modifica seduta); riattivando la rete sul telefono la serie non ricompare sul PC.
- [ ] **Uscita con modifiche non inviate**: in modalità aereo registrare una serie e toccare *Esci*: compare la richiesta di conferma con il numero di modifiche; con *Annulla* si resta dentro e la serie parte al rientro in rete.
- [ ] **Uscita pulita**: toccando *Esci* in *Impostazioni → Dati e accesso*, l'app torna alla schermata di accesso e la copia locale viene cancellata.
- [ ] **Uscita senza server** (1.10.4): in modalità aereo toccare *Esci*: compare l'avviso che la sessione resta valida sul server; con *Annulla* si resta dentro, con *OK* si torna all'accesso. Riaprendo l'app (anche con la rete) non si rientra da soli. Dal PC, in *Dati e accesso*, la sessione del telefono è ancora in elenco e si può revocare.

## 5. Aggiornamento dell'app (1.11.0)
Premessa: sul telefono c'è un'app **dalla 1.11.0 in su** (la prima va installata a mano dal browser) e sul server è stato compilato un APK più recente dello stesso canale.
- [ ] **Avviso**: aprendo l'app in Wi‑Fi compare "FitWeek X è disponibile" con il pulsante **Aggiorna**; in *Impostazioni → App Android* si leggono versione installata e versione disponibile.
- [ ] **Installazione**: toccando **Aggiorna** compare "Scarico l'aggiornamento…" e poi la finestra di Android. La prima volta Android chiede di consentire a FitWeek di *installare app sconosciute*: dopo il consenso, tornando indietro, l'installazione prosegue (se non prosegue, toccare di nuovo **Aggiorna**).
- [ ] **Dopo l'installazione**: l'app si riapre già con l'accesso fatto, i dati locali e le notifiche programmate; in *App Android* compare "App aggiornata" con la versione nuova.
- [ ] **Canali separati**: l'app di prova (β) propone solo la versione di prova, quella normale solo la normale.
- [ ] **Senza rete**: in modalità aereo non compare nessun avviso né errore; "Cerca aggiornamenti" dice che il controllo non è riuscito.
- [ ] **Via VPN** (solo dopo la diagnosi del blocco durante il download dal PC dell'ufficio): l'aggiornamento scarica senza far cadere la connessione.

## 6. Codice a barre, proteine e copia locale (1.12.0)
Premessa: server alla 1.12.0 e APK compilato dopo il deploy.
- [ ] **Scanner**: in *Pasti → + Pasto → Aggiungi* il pulsante con il codice a barre apre la fotocamera di Google (la prima volta scarica il modulo: serve la rete). Android **non** chiede a FitWeek il permesso della fotocamera.
- [ ] **Prodotto trovato**: inquadrando una confezione compaiono nome, calorie e proteine per 100 g e la porzione in grammi; confronta i valori con l'etichetta.
- [ ] **Prodotto assente / fotocamera chiusa**: compare l'avviso, nessun valore viene inventato, l'editor resta com'è.
- [ ] **Polvere**: in *Impostazioni → Proteine in polvere* lo scanner compila nome e valori per misurino; dopo averli corretti sull'etichetta la fonte diventa "etichetta".
- [ ] **Shaker**: in *Oggi* tocca *Proteine*: misurini, acqua o latte, *Registra shaker*; la riga della giornata diventa "Registrato".
- [ ] **Giornata**: tocca un pasto già fatto → si apre "Modifica pasto" con le sue voci; tocca la pesata fatta → si corregge.
- [ ] **Editor con una mano**: le schede "Nel piatto" / "Aggiungi" e il pulsante di salvataggio si raggiungono con il pollice; la tastiera non copre il totale.
- [ ] **Senza rete (app β)**: in modalità aereo registra un pasto e rinomina un promemoria; giornata, proteine e diario si aggiornano subito; chiudi e riapri l'app: c'è ancora tutto. Togli la modalità aereo: l'indicatore torna "Sincronizzato" e dal PC si vedono le stesse modifiche.

## 7. Dati dall'orologio (1.14.0)
Premessa: server alla 1.14.0 e APK compilato dopo il deploy; OHealth con la scrittura su Health Connect attiva (verificato dall'utente il 2026-11-17).
- [ ] **Collegamento**: *Impostazioni → App Android → Dati dall'orologio → Collega Health Connect* apre la finestra di Android con sonno, passi, battito e battito a riposo; dopo il consenso il pannello dice cosa legge e cosa no.
- [ ] **Spiegazione dei dati**: nella finestra dei permessi, il link su come vengono usati i dati apre FitWeek senza errori.
- [ ] **Prima importazione**: in *Progressi → Sonno* compaiono le ultime notti con l'icona dell'orologio, gli orari corrispondono a OHealth (±1 minuto) e sotto l'elenco ci sono le fasi dell'ultima notte.
- [ ] **Notte a mano**: scrivi a mano una notte già importata, poi *Importa ora*: la notte resta come l'hai scritta. Eliminane un'altra: non ricompare.
- [ ] **Passi**: in *Progressi → Orologio* i passi di ieri coincidono con OHealth (con più fonti, ad esempio telefono e orologio, possono differire: annota di quanto).
- [ ] **Battito a riposo**: compare solo se OHealth lo scrive su Health Connect; se manca, annota se OHealth lo mostra comunque.
- [ ] **Battito in palestra**: dopo una seduta conclusa con l'orologio al polso, in *Progressi → Allenamento → Storico* compare "battito medio …, max … bpm"; confronta con OHealth.
- [ ] **Senza rete**: in modalità aereo *Importa ora* mette i valori in coda e Progressi li mostra; togliendo la modalità aereo arrivano al server (dal PC si vedono gli stessi numeri).
- [ ] **Permessi tolti**: toglili da *Permessi*; tornando nell'app il pannello lo dice e l'importazione non dà errori.

---

### Note / esito della prova
- Data prova:
- Versione APK provata: `1.10.2` (`next`) — le voci aggiunte con la 1.10.3 richiedono un APK `next` ricompilato dopo il deploy
- Osservazioni:

