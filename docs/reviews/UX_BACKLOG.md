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
