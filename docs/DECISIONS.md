# Decisioni architetturali (ADR sintetici)

Stato: **Accettata** (in vigore) · **Proposta** (in attesa di approvazione utente) · **Superata**.

## D-001 — Mantenere FastAPI + SQLite · Accettata
Contesto: un utente, volumi di dati minimi, deploy su mini PC. Decisione: nessun passaggio a PostgreSQL né a un altro backend. SQLite in WAL con un solo processo uvicorn. Conseguenze: backup = file singolo via backup API; nessun servizio DB aggiuntivo. Rivalutare solo con multi-utente o accesso concorrente intenso.

## D-002 — Frontend vanilla JS, de-minificato in ES modules, senza build · Accettata (M2, 2026-11-09)
Contesto: `app.js` (30 KB) e `style.css` sono minificati e monolitici; nessun sorgente leggibile. React/Next/Svelte richiederebbero toolchain Node, build in Docker e riscrittura completa senza benefici proporzionati per ~6 viste. Decisione proposta: formattare i file esistenti, poi dividerli in moduli ES nativi (`<script type="module">`), CSS in tokens/base/components. Nessuna dipendenza runtime. Rivalutare (es. Preact/htm via file vendorizzato, o Lit) solo se la gestione dello stato UI della schermata allenamento diventa difficile. Alternativa scartata: riscrittura in framework con build — costo alto, rischio regressioni.

## D-003 — Migrazione progressiva dal blob JSON a tabelle · Accettata (M2, 2026-11-09)
Contesto: lo stato unico causa riscritture totali, conflitti tra domini non correlati, limite 2 MB, nessuna validazione/query. Decisione proposta: strangler pattern, un dominio alla volta, iniziando da palestra (M2). `/api/state` resta per i domini non ancora migrati. Migrazioni additive con backup automatico pre-migrazione.

## D-004 — Migrazioni con runner interno, senza ORM · Accettata (implementata 2026-11-09)
SQL/py versionati in `app/migrations/`, tabella `schema_migrations`, eseguiti all'avvio in transazione dopo backup. Alembic/SQLAlchemy scartati: troppa infrastruttura per ~10 tabelle. Pydantic (già incluso in FastAPI) per la validazione.

## D-005 — Registrazione allenamento per serie, idempotente · Accettata (M2, 2026-11-09)
Ogni serie confermata è inviata subito con UUID client (`PUT /api/v1/set-logs/{id}`); coda locale se offline. Elimina la perdita dati a metà seduta e i conflitti 409. Quick win temporaneo in M1: bozza in localStorage nel modello attuale.

## D-006 — Settimana del programma calcolata · Accettata (M2, 2026-11-09)
`week = floor((oggi − start_date)/7) + 1`, limitata 1..8 (`app/domain.py`). L'override manuale non è un valore separato: `PUT /api/v1/program-week` sposta `startDate`, così esiste una sola fonte di verità. Il calcolo è funzione pura testata. Fuso orario: `Europe/Rome` (configurato in container e app).

## D-007 — Nome volume Docker esplicito · Accettata (implementata 2026-11-09)
Oggi `fitweek-app_fitweek_data` dipende dal nome della directory. Proposta: `volumes: fitweek_data: {name: fitweek_data}` con migrazione via backup coerente → nuovo volume → verifica → il vecchio volume resta finché l'utente non autorizza la rimozione. Momento ideale: ora (DB = solo seed).

## D-008 — PWA con offline limitato · Proposta (M6)
Manifest + service worker che mette in cache la shell; offline solo per la schermata allenamento (coda serie). Prerequisito: contesto sicuro. Su `http://IP:8088` i service worker non funzionano → serve HTTPS in LAN (es. reverse proxy con certificato di una CA locale, o Tailscale con HTTPS). Da decidere con l'utente prima di M6.

## D-009 — AI opzionale e solo propositiva · Accettata (come vincolo)
Disattivata di default; chiave solo lato server da env; consenso esplicito per l'invio di dati, con anteprima di cosa viene inviato; output = proposte che l'utente applica manualmente. Nessuna integrazione finché M1–M5 non sono stabili.

## D-010 — Nessuna integrazione Esselunga automatica · Accettata
Nessuna API pubblica nota; niente scraping né acquisti automatizzati. Prezzi inseriti/aggiornati manualmente e marcati come stima o reali. Eventuale modulo futuro isolato, previa verifica di fonti e termini d'uso.

## D-011 — Valori nutrizionali solo con fonte · Accettata
Ogni valore ha `source` (`label`, `manual`, `estimate`, `database:<nome>`). Le stime sono visualizzate come tali. Nessun target calorico prescrittivo.

## D-012 — Repository git dedicato · Accettata (implementata 2026-11-09)
Il repo attuale ha radice in `/opt` e include altri progetti. Proposta: `git init` in `/opt/fitweek-app`, `.gitignore` (`.env`, `__pycache__/`, backup, `*.sqlite*`), commit iniziale dello stato attuale prima di qualsiasi modifica al codice.

## D-013 — App mobile con Capacitor per promemoria affidabili · Accettata (Android, M6, 2026-11-09)
Contesto (richiesta utente 2026-11-09): l'app deve ricordare attivamente spuntino, pasti, allenamento e pesata, con popup di inserimento rapido. Una webapp/PWA servita in HTTP su LAN non può mostrare notifiche affidabili (service worker e Push richiedono HTTPS; su iOS solo PWA installata ≥16.4; le notifiche web non sono garantite a orario).
Decisione proposta: shell **Capacitor** attorno alla SPA esistente (stesso codice, nessun framework nuovo) con `@capacitor/local-notifications`: i promemoria sono programmati **sul telefono** a partire dalla routine (funzionano anche senza rete e senza server raggiungibile); il tocco sulla notifica apre direttamente il popup corretto (es. "Cosa hai mangiato?"). Il backend resta l'unica fonte dei dati.
Conseguenze: (1) la SPA va servita dal bundle dell'app e parla con il server via API → servono CORS limitato all'origine dell'app e un'autenticazione adatta (cookie SameSite=None+Secure o token), quindi **HTTPS sul server** (reverse proxy con certificato) — prerequisito comune anche a D-008; (2) fuori casa il server è raggiungibile solo via VPN; inserimenti offline in coda locale (già previsto per gli allenamenti, D-005); (3) Android: build con Android Studio/Gradle, installazione APK diretta, nessun costo; iOS: richiede Mac + Xcode e account Apple Developer (o re-firma ogni 7 giorni).
Alternativa valutata: PWA + Web Push (VAPID) dal server — nessuno store/build, ma richiede comunque HTTPS, è meno affidabile negli orari e su iOS più limitata. Rivalutare se la piattaforma è iOS senza Mac.

## D-014 — Promemoria come dati sul server, motore in app · Accettata (M4, 2026-11-09)
I promemoria vivono nella tabella `reminders` (non nel client): la webapp li mostra come popup quando è aperta e l'app Capacitor (D-013) li userà per programmare notifiche locali, senza duplicare la logica. Il completamento è dedotto dai dati (pasto/pesata/seduta registrati) per evitare doppie conferme. Popup limitati all'evento scaduto più recente (ultime 3 h) per non bombardare l'utente.

## D-015 — Stime nutrizionali generiche iniziali · Accettata (M4, 2026-11-09)
Per dare subito "calorie teoriche" i pasti abituali iniziali hanno valori medi indicativi marcati `estimate` con nota. L'interfaccia mostra sempre la fonte e la copertura; l'utente li corregge con le etichette (`label`). Nessuna integrazione con banche dati esterne senza decisione esplicita.

## D-016 — APK che carica la webapp dal server (server.url) · Accettata (M6, 2026-11-09)
Invece di impacchettare il frontend nell'APK (che richiederebbe CORS, cookie cross-site con HTTPS e un aggiornamento dell'APK a ogni modifica), l'app Capacitor carica `server.url` in HTTP LAN con `cleartext`. Vantaggi: zero build web, aggiornamenti immediati, stessi cookie della webapp. Svantaggi: senza server raggiungibile si vede solo la pagina offline (le notifiche, programmate localmente, funzionano comunque); l'URL è fissato in compilazione (`scripts/build-apk.sh URL`). Le notifiche sono "una tantum" per 14 giorni (non ripetizioni settimanali) per non suonare per eventi già registrati.

## D-017 — CSP senza stili inline · Accettata (1.7.0, 2026-11-10)
`style-src 'self'`: nessun attributo `style` né blocco `<style>` nel frontend. I pochi valori dinamici (altezza delle barre, larghezza del budget, dimensione e avanzamento degli anelli) sono scritti come `data-pct-h`, `data-pct-w`, `data-vars` e applicati via CSSOM da `applyDynamicStyles()` dopo ogni inserimento di HTML (vista e modale): le modifiche di stile fatte da script sono consentite dalla CSP, gli attributi no. Un test pytest blocca il ritorno di `style="` in `static/`, e i test e2e falliscono su qualsiasi errore in console, violazioni CSP comprese. Alternativa scartata: nonce per richiesta (richiederebbe di generare `index.html` lato server).

## D-018 — Ricerca prodotti su Open Food Facts · Accettata (1.8.0, 2026-11-10, decisione dell'utente)
Per avere valori nutrizionali dei prodotti confezionati senza inventarli, l'editor del pasto cerca per nome su Open Food Facts (database pubblico, licenza ODbL). La chiamata parte dal server (`app/foodsearch.py`), non dal browser: la CSP resta `connect-src 'self'` e al servizio arriva solo il testo cercato, con uno User-Agent generico e senza cookie. I valori sono per 100 g; l'utente indica la porzione in grammi e la voce viene salvata con fonte `off`, distinta da stima, etichetta e inserimento manuale, con l'avviso di controllare la confezione. Limiti: 10 ricerche al minuto (indicazione del servizio), cache in memoria, timeout 8 s; senza rete resta il catalogo locale. Si spegne con `FOOD_SEARCH=off`. Nessun altro servizio esterno è usato.

## D-019 — Sonno: inserimento manuale ora, Health Connect in seguito · Accettata (1.8.0, 2026-11-10)
L'OPPO Watch 2 non ha un'API pubblica. L'app OHealth (ex HeyTap Health) può scrivere il sonno su Health Connect di Android, da cui un'app nativa può leggerlo: servirebbe un plugin Capacitor per Health Connect nell'APK, i relativi permessi e una prova sul telefono reale. Per ora il sonno si registra a mano (ora di letto e di sveglia, due campi) e la tabella `sleep_logs` ha già la colonna `source` (`manual` | `health_connect`), così l'importazione potrà scrivere gli stessi record senza cambiare schema. Non verificato: che OHealth scriva davvero il sonno su Health Connect per questo modello.

## D-020 — Riferimenti di proteine e calorie scelti dall'utente · Accettata (1.8.0, 2026-11-10)
L'utente può impostare in Impostazioni un riferimento giornaliero di proteine e di calorie. L'app non li calcola, non li suggerisce e non li chiama obiettivi: mostra solo la stima della giornata rispetto al numero scelto, senza colori d'allarme quando lo si supera (coerente con il principio "calma" del design system e con la regola 5).

## D-021 — App Android autonoma con copia locale e coda · In prova (1.9.0, 2026-11-10, decisione dell'utente)
Supera in parte D-016. L'utente vuole che l'app si apra e si usi anche lontano da casa. Scelta: le pagine del frontend entrano nell'APK (`scripts/bundle-www.sh`), l'app parla con il server a un indirizzo configurabile e il server resta l'unica fonte di verità.
- **Accesso**: l'app è su un'altra origine (`http://localhost`), quindi niente cookie: il login con `client: "app"` restituisce il token di sessione, inviato come `Authorization: Bearer`. CORS è ammesso solo per le origini in `APP_ORIGINS` e senza credenziali; la webapp continua con il cookie HttpOnly e non riceve mai il token.
- **Letture senza rete**: ogni risposta GET viene copiata in locale (`static/js/cache.js`); se il server non risponde si usa la copia e l'indicatore mostra "Offline · dati delle HH:MM". Data, giornata della scheda, settimana del programma e agenda del giorno si ricalcolano sul telefono (`static/js/sync.js`).
- **Scritture senza rete**: allenamenti, pasti, sonno, note e promemoria passano dalla coda idempotente già esistente; lo stato a blob (pesate, lista, dispensa, profilo, piano) resta in attesa e al ritorno viene fuso a tre vie con ciò che è cambiato sul server (elenchi per id, oggetti per campo), senza perdere né le modifiche locali né quelle remote. La stessa fusione sostituisce il vecchio "ripeti l'ultima modifica" dopo un 409 anche nella webapp.
- **Limiti dichiarati**: senza rete il riepilogo settimanale e lo stato "fatto" dei promemoria sono quelli dell'ultima copia; backup, ripristino e PDF della scheda si aprono solo dal browser; la ricerca su Open Food Facts richiede il server.
- **Rilascio**: canale `next` con appId `app.fitweek.personal.next` ("FitWeek β"), installabile accanto all'app attuale. Diventa la versione principale solo dopo la prova sul telefono reale. Alternativa scartata: database completo sul telefono con sincronizzazione nei due sensi (riscrittura della logica del server in JavaScript, più rischio per i dati).
Non verificato: comportamento nel WebView reale (origine, traffico in chiaro verso la LAN, notifiche con le pagine locali). Verificato nel browser con le pagine servite da un'altra origine (test e2e `standalone`).

## D-022 — Nessuna scrittura buttata; vince l'ultima modifica fatta · Accettata (1.10.1, 2026-11-12)
Contesto: revisione di consolidamento. La coda scartava un'operazione dopo 6 errori 5xx (~90 s); lo stato a blob restava in attesa solo senza rete (con 5xx o un secondo 409 viveva solo in memoria) e un 422 cancellava tutte le modifiche offline; una scrittura rimasta in coda per giorni sovrascriveva un dato corretto più di recente da un altro dispositivo.
Decisione:
- **Coda**: gli errori passeggeri (rete, 408, 429, 5xx) si ritentano senza limite; solo i rifiuti definitivi (4xx) escono dalla coda e finiscono in "Modifiche non inviate" (Impostazioni → Dati e accesso), da riprovare o scartare. Un `DELETE` che riceve 404 è considerato riuscito.
- **Stato a blob**: ogni errore non definitivo lascia le modifiche in attesa sul dispositivo (sopravvivono alla ricarica, nuovo tentativo ogni 20 s e al rientro); un 422 le mette da parte invece di cancellarle.
- **Memoria piena**: se `localStorage` rifiuta il salvataggio l'utente viene avvisato.
- **Ordine delle modifiche**: `X-Edited-At` (vedi `API.md`): il server non applica una scrittura più vecchia del dato salvato. Limite: si fida dell'orologio del telefono (mai oltre l'ora del server).
- **Fusione dello stato**: la stessa voce cambiata da entrambe le parti resta quella del dispositivo che sta salvando, ma ora con un avviso che la nomina; la scheda si fonde esercizio per esercizio; una voce modificata qui ed eliminata altrove viene tenuta; una sola pesata per giorno (una seconda misura nello stesso giorno corregge la prima; in fusione resta quella locale).
- Al rientro sull'app lo stato viene riletto dal server se non ci sono modifiche locali in sospeso.
Alternativa scartata: versioni per riga e risoluzione manuale di ogni conflitto (troppo per un solo utente con due dispositivi).

## D-023 — Lavorare offline per scelta; esercizio completato solo su conferma · Accettata (1.10.1, 2026-11-12, richieste dell'utente dopo la prova sul telefono)
- **Server muto**: fuori casa in 4G il server di casa non risponde con un errore, resta in silenzio, e l'app aspettava all'infinito. Ora, solo nell'app autonoma, ogni richiesta ha un tempo massimo (6 s letture, 12 s scritture); all'avvio, dopo 2,5 s senza risposta compare "Lavora offline", che apre subito la copia locale. Da offline le letture rispondono subito dalla copia e una sonda leggera (`/api/health`, al più ogni 10 s) riporta l'app in linea da sola quando il server torna raggiungibile.
- **Esercizio**: non si chiude più da solo al raggiungimento delle serie previste. Si chiude con "Esercizio completato" (e si può riaprire); le serie di oggi si possono aggiungere ("Serie extra") o togliere ("Togli serie", solo se non registrate). La scheda non cambia (regola 4); la conferma è una preferenza locale della seduta in corso, non un dato sul server.

## D-024 — Scheda "Adesso", Keystore Android, backup cifrato esterno e lista dal piano · Accettata (1.10.2, 2026-11-12)
- **Oggi ("Adesso")**: in cima alla dashboard una funzione pura (`nowAction` in `static/js/timeline.js`) sceglie una sola azione rilevante per l'orario e la routine: l'evento scaduto più recente entro 3 ore, altrimenti il prossimo entro 90 minuti; nascosta durante l'allenamento.
- **Token e sessioni**: nell'APK Android il plugin nativo Capacitor `SecureToken` (`SecureTokenPlugin.java`) cifra il token con `AES/GCM/NoPadding` usando una chiave nell'Android Keystore (`fitweek_token_key`), migrando e rimuovendo l'eventuale valore in `localStorage`. Le sessioni sul server hanno scadenza scorrevole (`last_seen_at`, rinnovo firma via `X-Renewed-Token` / cookie dopo 24 h) e sono elencate con revoca singola in *Impostazioni → Dati e accesso* (`/api/v1/sessions`). L'uscita pulisce token, copia locale (`cache`), coda inviata e stati temporanei. I rischi di `http://` e le opzioni HTTPS/VPN sono documentati in `docs/SECURITY.md`, con avviso nella schermata di accesso quando l'indirizzo è `http://`.
- **Backup esterno**: `scripts/backup-offsite.sh` impacchetta e cifra (`AES-256-CBC` + `PBKDF2`) l'ultimo backup SQLite verificato insieme alla chiave di firma APK (`/opt/fitweek-secrets`), trasferisce verso `OFFSITE_DEST` e verifica integrità e decifratura dopo il trasferimento.
- **Piano → dispensa → lista**: dispensa e lista portano `amount` numerico e `unit` (migrazione 8 additiva da `qty`); ogni giorno del piano ha ingredienti strutturati (`items`) e `Genera dal piano` (`planProposal` in `static/js/stats.js`) propone `fabbisogno − dispensa (non scaduta)`, escludendo pranzi e secondi delle cene lun–ven (portati dalla mensa) e lasciando vuoto il prezzo se mai inserito dall'utente. La proposta richiede conferma esplicita prima di entrare nella lista.

## D-025 — Revisione tecnica indipendente Maker/Reviewer · Accettata (2026-11-13, decisione dell'utente)
Contesto: finora sviluppo e verifica erano fatti dallo stesso agente; le affermazioni nei commit e nei documenti non sono prova di correttezza.
Decisione: Claude Code è il **maker** (codice, test, documentazione applicativa, commit su `main` quando autorizzato); ChatGPT è il **reviewer** indipendente dei commit pubblicati su GitHub (`Giggi-98/fitweek-app`). Il reviewer scrive solo nel branch `review/engineering` (`docs/reviews/`: Policy, Ledger, report per SHA) e assegna ai finding ID stabili `FW-REV-NNN` con severità P0–P3.
- Il maker non unisce `review/engineering` a `main` e non ne copia i documenti in `main`: li legge da `origin/review/engineering`.
- Aggiornamento dello stesso giorno (decisione dell'utente): il branch è anche il canale asincrono tra i due, così l'utente non deve fare da tramite. Il maker vi scrive solo le proprie risposte (`docs/reviews/YYYY-MM-DD-SHA.maker.md`) e una riga per ciclo nella sezione `## Maker notes` in fondo al Ledger; Policy, report, stato dei finding e checkpoint restano del reviewer. **Precisato da D-027: il maker scrive solo in file propri, non più dentro il Ledger.**
- Il Ledger è l'unica fonte ufficiale dello stato dei finding e del checkpoint revisionato.
- Ogni correzione ha un test che fallisce prima e passa dopo; un finding ritenuto errato si contesta con codice e test, non si ignora.
- Il maker dichiara al massimo "correzione implementata, in attesa di verifica indipendente"; la chiusura è del reviewer.
- Niente force push né riscrittura della storia di `main`: le review ragionano per intervalli di SHA.
Procedura operativa: `CLAUDE.md`, sezione "Independent Engineering Review Workflow".
Alternativa scartata: tenere le review in `main` (mescola codice e giudizio sul codice, e il maker potrebbe modificarle).

## D-026 — Correzioni della prima review indipendente (FW-REV-001…008) · Implementata, in attesa di verifica indipendente (1.10.3, 2026-11-13)
Contesto: audit statico del reviewer su `2dac1ab` (report `docs/reviews/2026-11-13-2dac1ab.md` nel branch `review/engineering`). Lo stato ufficiale dei finding è nel Ledger; qui restano le scelte fatte dal maker.
- **Coda (001)**: alla risposta del server si toglie dalla coda solo l'operazione effettivamente inviata, riconosciuta per identità. Se nel frattempo è stata sostituita da una più recente con la stessa chiave, quella resta e parte subito dopo; l'esito di quella superata (anche un rifiuto) non conta più.
- **Serie eliminate (002)**: segno di eliminazione per posizione (`set_tombstones`, migrazione 9 additiva) confrontato con `X-Edited-At`. Alternativa scartata: eliminazione logica dentro `set_logs` (tocca tutte le letture, i grafici e il formato di backup).
- **Piano pasti (003)**: fusione per giorno → pasto → ingrediente. Gli ingredienti non hanno id: l'identità è pasto + nome; con due voci uguali nello stesso pasto vale l'elenco locale intero, segnalato.
- **Eliminata qui, modificata altrove (008)**: la voce **resta**, con un avviso dedicato. Corregge D-022 ("le eliminazioni locali valgono"): un'eliminazione locale vale solo se l'altro dispositivo non ha toccato la voce. È la regola simmetrica a "modificata qui, eliminata altrove → tenuta", e il recupero è immediato (basta eliminarla di nuovo). Alternativa scartata: far vincere l'eliminazione mostrando solo un avviso (la modifica remota sarebbe persa e non recuperabile dall'app).
- **Esportazione (004)**: una sola transazione di lettura per tutto il file.
- **Token (005)**: il valore in `localStorage` si toglie solo a scrittura nel Keystore confermata; un token nuovo non viene mai scritto in chiaro come ripiego.
- **Uscita (006)**: resta "l'uscita cancella tutto dal dispositivo" (D-024), ma con modifiche non inviate serve una conferma esplicita dopo un ultimo tentativo di invio. Alternativa scartata: conservare la coda per l'accesso successivo (è ciò che il finding segnala come comportamento inatteso).
- **Progressioni (007)**: solo documentazione e un test sul seed; nessuna migrazione.
Rischi residui dichiarati: orari al secondo e fidati dal dispositivo; i segni di eliminazione non sono nel backup JSON; con il Keystore guasto dopo un nuovo accesso la sessione non sopravvive al riavvio; nessuna prova su telefono reale.

## D-027 — Quattro reviewer specializzati e handoff obbligatorio su file · Accettata (2026-11-13, decisione dell'utente)
Contesto: la revisione indipendente (D-025) aveva un solo reviewer. L'utente l'ha divisa in quattro conversazioni del Project ChatGPT "FitWeek — Engineering Review", ognuna con i propri documenti su `review/engineering` e un proprio namespace: 01 review incrementali (`FW-REV`, unica a gestire Ledger e checkpoint), 02 audit architetturale (`FW-ARCH`), 03 frontend e UX (`FW-UX`), 04 product strategy (`FW-PROD`).
Decisione:
- Ogni attività pubblicata dal maker finisce con un **REVIEW HANDOFF**: riepilogo, chat da coinvolgere e un messaggio completo per ciascuna. La chat 01 riceve sempre le modifiche applicative; le altre solo se la loro area è toccata.
- **Si comunica tramite i rispettivi file**, non tramite l'utente ("vorrei parlare il meno possibile"): il maker scrive l'handoff in `docs/reviews/YYYY-MM-DD-SHA.maker.md` e lo elenca nel proprio indice `docs/reviews/MAKER_HANDOFF.md`; i reviewer rispondono nei loro documenti. Una prima stesura di questa decisione prevedeva il branch in sola lettura per il maker e messaggi da incollare: scartata dall'utente lo stesso giorno.
- Rispetto a D-025 il maker non scrive più dentro il Ledger (`## Maker notes`): con quattro reviewer ogni file ha un solo proprietario. La riga già presente (commit `28e6f98`) resta come storico.
- Negli handoff solo SHA completi verificati su `origin/main`, quindi l'handoff si scrive dopo il push. "Implementato" non è "approvato": lo stato lo cambia solo la chat proprietaria.
Procedura operativa: `CLAUDE.md`, sezione "Multi-Reviewer Coordination & Mandatory Handoff". I finding e i backlog non vengono copiati in `main`.

## D-028 — Correzioni della seconda review (FW-REV-009, FW-REV-010) · Implementata, in attesa di verifica indipendente (1.10.4, 2026-11-13)
Contesto: review statica di `2dac1ab..5e333bd` (report `docs/reviews/2026-11-13-5e333bd.md` su `review/engineering`). Entrambi i finding riprodotti con test prima della correzione.
- **Orari al millisecondo (009)**: `edit_time` non tronca più al secondo. Chiude il caso residuo di FW-REV-002 (eliminazione e `PUT` più vecchio nello stesso secondo) e lo stesso difetto su serie, pasti, sonno e note. Nessuna migrazione: i valori già salvati al secondo si confrontano correttamente con quelli nuovi (valgono come `.000`). A parità esatta vale l'ultima arrivata. Alternativa scartata: numero di revisione per riga (richiede schema e protocollo nuovi per un caso, lo stesso millisecondo da due dispositivi, che per un solo utente non è realistico). Resta vero che l'orario è quello dichiarato dal dispositivo.
- **Uscita non riuscita (010)**: dopo `clear()` il Keystore viene riletto; se il token c'è ancora, un segno in `localStorage` (`fitweek.signedOut.v1`) fa sì che agli avvii successivi quel token non venga usato e l'eliminazione venga ritentata; il segno sparisce a eliminazione confermata o a nuovo accesso salvato. Se il server non revoca la sessione l'utente lo sa prima di uscire: nella webapp l'uscita non avviene, nell'app si può uscire dal solo dispositivo dopo conferma.
- **Non fatto, e perché**: il report suggerisce uno stato di "revoca in sospeso" da completare al ritorno della rete. Richiederebbe di conservare il token sul dispositivo dopo l'uscita, cioè il contrario di ciò che l'uscita promette (D-024). Si è preferito eliminarlo e dire all'utente che la sessione va revocata da un altro accesso. Punto da far valutare al reviewer.

## D-029 — Correzioni dei finding UX (FW-UX-001, 002, 003) · Implementata, in attesa di verifica indipendente (1.10.5, 2026-11-13)
Contesto: `UX_AUDIT.md` e `UX_BACKLOG.md` su `review/engineering`, aggiornati a `5e333bd`.
- **Annulla invece di conferma (001)**: la rimozione resta a un tocco e viene salvata subito; "Annulla" rimette la voce con un secondo salvataggio normale, in coda dopo il primo. Alternativa scartata: ritardare il salvataggio finché scade "Annulla" (un ricaricamento o una chiusura dell'app in quei secondi lascerebbe sul server una voce che l'utente ha visto sparire). Conseguenze accettate: per qualche secondo un altro dispositivo può vedere la voce sparire e tornare; dopo un ricaricamento "Annulla" non c'è più; si annulla solo l'ultima rimozione.
- **Riga senza pulsanti nella label (003)**: contenitore `.shoprow`, label solo per casella e testo. Corretti insieme a 001 perché toccano le stesse righe.
- **Schede (002)**: completato il comportamento da tastiera nel componente condiviso (sosta unica, frecce, Inizio/Fine, fuoco dopo il ridisegno). **Non fatto**: `role="tabpanel"` con `aria-controls`/`aria-labelledby`, perché richiede di avvolgere il contenuto di dodici punti in sei viste, con effetti su griglie e animazioni che vanno controllati a vista su telefono. Dichiarato come parziale: decide il reviewer se è necessario. I filtri per categoria dell'editor dei pasti dichiaravano `role="tablist"` senza schede all'interno: ora sono un gruppo di pulsanti con `aria-pressed`.

## D-030 — Contratto del ripristino dichiarato; architettura documentata sul codice (FW-ARCH-001, FW-ARCH-002) · Implementata, in attesa di verifica indipendente (1.10.5, 2026-11-13)
Contesto: `ARCHITECTURE_AUDIT.md` e `TECHNICAL_DEBT.md` su `review/engineering`, aggiornati a `5e333bd`.
- **Ripristino (001)**: il comportamento del server **non cambia** (un backup vecchio non cancella i domini che non contiene, come chiesto dal reviewer). Cambia ciò che viene detto: la risposta elenca `replaced` e `kept`, la conferma nell'app elenca prima cosa viene sostituito e cosa resta, il messaggio finale ripete cosa non è stato toccato. L'elenco dei domini è in un solo punto per lato (`BACKUP_OPTIONAL_DOMAINS`, `static/js/backup.js`) e un test verifica che coincidano. Alternative scartate: far cancellare a un backup vecchio i domini assenti (perdita di dati non recuperabile dall'app); rifiutare i backup vecchi (toglie l'unica via di recupero per chi ha solo quelli); un'anteprima calcolata dal server (una rotta in più per ripetere una regola di una riga).
- **Limiti dichiarati, non corretti**: il JSON non contiene risposte ai promemoria, segni di eliminazione, voci eliminate e accessi (tabella in `docs/API.md`). Aggiungerli richiede un formato v5: non fatto perché nessun finding lo chiede e il backup completo resta quello SQLite. In Impostazioni il testo "copia completa in JSON" è diventato "copia dei tuoi dati in JSON".
- **Architettura (002)**: `docs/ARCHITECTURE.md` riscritto dal codice (tre client, moduli, dove vivono i dati, sessioni, sincronizzazione, backup, compatibilità APK/server, elenco esplicito di ciò che non esiste). Il testo del 2026-11-09 resta in fondo come storico datato. Corrette due righe superate in `docs/API.md` (logout, formati del ripristino).
