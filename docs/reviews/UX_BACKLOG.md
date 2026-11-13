# FitWeek — Backlog Frontend & UX

- Owner: chat 03; namespace esclusivo `FW-UX-XXX`.
- Data: 2026-11-13.
- Origine: `UX_AUDIT.md`, ispezione statica della baseline `2dac1ab955224228659143f70fff8c01cef01029`.
- HEAD noto prima della pubblicazione: `5e333bd8ca290f96fc81dfddff66934de623614a`; commit successivi **non revisionati dalla chat 03**.
- Branch di archivio: `review/engineering`; checkpoint ufficiale `null`, gestito solo dalla chat 01.
- `UX-QA-XXX` indica attività di verifica, NON bug accertato.

## Priorità ordinate per rischio, impatto e frequenza

| Ordine | Intervento | Priorità | Owner | Evidenza / stato |
| --- | --- | --- | --- | --- |
| 1 | Affidabilità serie offline e feedback salvataggio | P1 | FW-REV-001/002 (chat 01) | Aperti nel Ledger consultato; nuovo HEAD da verificare |
| 2 | Undo per cancellazione accidentale in spesa/dispensa | P2 | FW-UX-001 | Aperto, statico |
| 3 | Checkbox/azioni semanticamente indipendenti nella spesa | P2 | FW-UX-003 | Aperto, statico |
| 4 | Tab/pannelli accessibili da tastiera | P2 | FW-UX-002 | Aperto, statico |
| 5 | Logout con coda offline e feedback attendibile | P2 | FW-REV-006 (chat 01) | Stato successivo non verificato |
| 6 | Chiarezza restore e domini interessati | P2 | FW-ARCH-001 (chat 02) | Stato successivo non verificato |
| 7 | Conflitti pasti e inventario | P1/P2 | FW-REV-003/008 (chat 01) | Stato successivo non verificato |
| 8 | Tap count e leggibilità allenamento mobile | Verifica | UX-QA-001 | Mai misurato |
| 9 | Responsive, contrasto, focus, touch target | Verifica | UX-QA-002 | Mai misurato |
| 10 | Android offline/online/riavvio stable e next | Verifica | UX-QA-003 | Mai eseguito |

## Criteri di accettazione dei finding UX

### FW-UX-001 — Undo spesa/dispensa
Modificare in modo mirato `static/js/views/shopping.js` e, se necessario, riusare il toast azionabile esistente in `static/js/ui.js`. Dopo la rimozione deve essere possibile annullare senza duplicati né perdita durante salvataggio, offline e reload. Testare cancellazione/Undo e coerenza finale.

### FW-UX-002 — Tabs accessibili
Intervenire su `static/js/ui.js`, wiring di `static/js/main.js` e viste interessate. Pattern semantico completo o alternativa più semplice corretta. Testare Tab, frecce, Home/End, focus visibile, aria-selected, associazione col contenuto e regressione touch.

### FW-UX-003 — Riga spesa accessibile
In `static/js/views/shopping.js` separare checkbox e sua label dai button ricorrenza/rimozione. Test click singoli, tastiera e screen reader; nessuna azione collaterale.

## Piano QA (non nuovi finding)

- **UX-QA-001:** su telefono Android registrare tocchi reali, tempi e correzioni per: dashboard→palestra (target 1–2), serie precompilata (1), modifica carico + serie (2–3 interazioni), pasto abituale (max 4–5), spunta prodotto (1), peso (max 3–4). Sono obiettivi, non misure.
- **UX-QA-002:** testare viewport 320, 360, 390, 768 px, zoom 200%, navigazione tastiera, reader, error/loading, grafici, scroll orizzontale, target touch e contrasto. Non inventare Lighthouse.
- **UX-QA-003:** test APK stable e next con primo login, rete persa, serie/pasti/spesa, riavvio, ritorno online, code, conflitti e notifiche. Documentare versione APK/backend e prove effettive.

## Coordinamento e aggiornamenti

Prima di cambiare gli stati, rileggere su GitHub HEAD main, `REVIEW_LEDGER.md`, ultimo report, `ARCHITECTURE_AUDIT.md`, questo backlog e il codice pertinente. Non chiudere FW-UX soltanto per affermazioni del developer. Non duplicare FW-REV/FW-ARCH, non avanzare checkpoint. Solo i due file UX possono essere aggiornati dalla chat 03 con autorizzazione esplicita; verificare sempre la persistenza rileggendo da GitHub.


---

## Aggiornamento backlog UX — 2026-11-13 — HEAD applicativo `5e333bd`

Revisione statica incrementale di `70f7607..5e333bd`. La tabella iniziale rimane come storico della baseline; **questa sezione rappresenta l'ordinamento operativo corrente per il codice esaminato**, senza chiudere finding di altri owner. Nessun test browser, APK o Android è stato eseguito. Checkpoint ufficiale Ledger: `null`.

| Ordine attuale | Attività | Priorità | Owner | Stato statico e accettazione |
| --- | --- | --- | --- | --- |
| 1 | Proteggere le serie eliminate da scritture offline precedenti nello stesso secondo | P1 | FW-REV-002 / FW-REV-009, chat 01 | **Aperto**; precisione subsecondo e test out-of-order obbligatori |
| 2 | Logout affidabile quando falliscono revoca HTTP e clear Keystore | P2 | FW-REV-010, chat 01 | **Aperto**; non presentare logout riuscito né ri-autenticare silenziosamente |
| 3 | Undo eliminazione accidentale di lista e dispensa | P2 | FW-UX-001, chat 03 | **Aperto**; Undo robusto contro persistenza asincrona, reload e rete instabile |
| 4 | Separare checkbox, etichetta e pulsanti nella lista spesa | P2 | FW-UX-003, chat 03 | **Aperto**; tastiera/tocco/reader, nessun toggle collaterale |
| 5 | Completa semantica e navigazione tastiera delle schede | P2 | FW-UX-002, chat 03 | **Aperto**; focus, frecce, Home/End, aria-controls/panel o pattern alternativo valido |
| 6 | Verifica effettiva fix coda e merge | P1/P2 | FW-REV-001/003/006/008, chat 01 | Fix **supportati staticamente**, test e UX Android non eseguiti |
| 7 | Chiarire restore domini e conferma | P2 | FW-ARCH-001, chat 02 | **Aperto**; UI aderente alla matrice dei dati |
| 8 | Tap count flussi quotidiani Android | Verifica | UX-QA-001 | Non misurato |
| 9 | Responsive, focus e accessibilità reale | Verifica | UX-QA-002 | Non misurato |
| 10 | Offline→online→riavvio APK stable/next | Verifica | UX-QA-003 | Non testato |

### Stato dopo il diff

- **FW-UX-001/002/003:** tutti aperti; nessuna modifica risolutiva nei file pertinenti a `5e333bd`.
- **FW-REV-001:** identity settlement della queue; miglioramento statico, test indipendenti pendenti.
- **FW-REV-003:** merge slot pasti; miglioramento statico, test indipendenti pendenti.
- **FW-REV-006:** preavviso/scarto esplicito della queue al logout; miglioramento statico; distinguere FW-REV-010.
- **FW-REV-008:** avviso di conflitto delete/update; miglioramento statico, ancora da provare su Android.
- **FW-REV-009/010:** finding ufficiali della chat 01, **non duplicare** nel namespace FW-UX.

### Indicazioni al maker

1. Correggere prima i rischi di integrità dei dati e falsa uscita, coordinandosi con chat 01.
2. Implementare FW-UX-001 e FW-UX-003 insieme in `static/js/views/shopping.js`; riusare componenti esistenti e includere test di Undo, checkbox e bottoni.
3. Implementare FW-UX-002 con semantica tastiera corretta e test delle viste che usano il componente `tabs()`.
4. Eseguire e riportare test effettivi, separando screenshot/browser da Android reale; evitare redesign, dipendenze o migrazioni non necessari.
5. Prima di qualsiasi futura scrittura rileggere l'HEAD branch, il Ledger e gli SHA dei due file UX; preservare storia, contributi concorrenti e proprietà documentali.
