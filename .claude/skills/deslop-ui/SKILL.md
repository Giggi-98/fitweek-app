---
name: deslop-ui
description: Elimina lo "slop" grafico da interfacce generate o modificate da un'IA (schermate, popup, CSS, testi dell'interfaccia). Da usare PRIMA di scrivere o ritoccare una vista, un componente, una finestra o del CSS di FitWeek, e di nuovo sul risultato prima di dichiararlo finito. Parole chiave - UI, UX, popup, modale, layout, CSS, redesign, "sembra fatto da un'IA", generico, disordinato, sovrapposto.
---

# Deslop UI

Lo slop grafico è ciò che un'IA aggiunge perché "fa interfaccia", non perché serve a chi usa lo schermo.
Questa skill è un controllo in due passate: una prima di disegnare, una sul risultato. Vale il design system
del progetto (`docs/DESIGN_SYSTEM.md`): qui c'è solo ciò che serve a riconoscere e togliere lo slop.

## Passata 1 — prima di scrivere

Rispondi in una riga ciascuna; se non sai rispondere, non sei pronto a disegnare.

1. **Qual è l'unica azione principale** di questa schermata/finestra? Ce n'è una sola con stile `primary`.
2. **Cosa guarda l'utente per primo, e cosa per secondo?** L'ordine visivo deve essere quell'ordine.
3. **Quali informazioni servono per decidere**, e quali sono solo "disponibili"? Le seconde vanno dietro un
   tocco (`details`, scheda, seconda riga), non sullo schermo.
4. **Con una mano, sul telefono, il pollice dove arriva?** L'azione principale sta in basso, sempre visibile.
5. **Esiste già un componente** per questo (`tabs()`, `choices()`, `.tiles`, `.pick`, `.qty`, `.tray-row`,
   `removalToast()`…)? Se sì si riusa; un componente nuovo va giustificato.

## Passata 2 — caccia allo slop sul risultato

Per ogni voce: se la trovi, **toglila** (non attenuarla).

**Struttura**
- Lo stesso dato mostrato due volte nello stesso schermo (es. totale in alto *e* nella barra in basso).
- Due zone con funzioni diverse che si assomigliano (ciò che ho scelto / ciò da cui scelgo): devono avere
  titolo, sfondo o posizione diversi.
- Scatole dentro scatole: bordo + sfondo + ombra su tre livelli annidati. Un livello di contenitore, poi righe.
- Elementi fissi che coprono il contenuto che scorre; doppie barre di scorrimento; contenuto tagliato a metà
  sotto una barra senza sfumatura né margine.
- Righe di pulsanti dove tutti hanno lo stesso peso. Una primaria, le altre secondarie o testuali.
- Titoli che ripetono il titolo sopra ("Modifica pasto" → sezione "Modifica del pasto").

**Decorazione**
- Gradienti, bagliori, ombre colorate, bordi luminosi, icone messe "per riempire". Un'icona resta solo se
  distingue una voce dalle altre o sostituisce un'etichetta.
- Emoji o simboli tipografici usati come icone (qui solo `icon()`).
- Colori scritti a mano: solo token. Rosso/arancio solo per errori veri e "da registrare", mai per peso,
  calorie o proteine sopra/sotto il riferimento.
- Animazioni che non comunicano un cambio di stato.

**Testo**
- Frasi di cortesia e di riempimento ("Ecco il tuo…", "Benvenuto in…", "Qui puoi…").
- Etichette che descrivono il componente invece del contenuto ("Sezione", "Elenco", "Dettagli").
- Sottotitoli che ripetono il titolo con altre parole. Segnaposto usati al posto delle etichette.
- Tono giudicante o prescrittivo su cibo e corpo. L'app propone, non ordina; un valore stimato è sempre
  marcato come stima, con la sua fonte.
- Numeri senza unità, o con precisione finta (247,3 kcal da una stima).

**Stati**
- Manca lo stato vuoto, quello "senza valori", quello offline, quello di errore con un'azione di recupero.
- Un controllo che sembra cliccabile e non lo è, o cliccabile senza sembrarlo (riga senza affordance).
- Target sotto 44×44 px, o due target a meno di 8 px.

## Verifica obbligatoria

- Guarda davvero lo schermo: screenshot a 390 px e a ≥ 1280 px, tema scuro e chiaro (Playwright nel container
  e2e). Non dichiarare "sistemato" un layout che non hai visto renderizzato.
- Conta: azioni primarie = 1; livelli di contenitore ≤ 2; dimensioni di testo diverse nella finestra ≤ 4.
- Regole del progetto: nessun attributo `style` (usa `data-pct-*`/`data-vars`), ogni valore interpolato in
  `esc()`, nessun `<button>` dentro una `<label>`, orari a 24 ore, tastiera e `aria-*` coerenti con il ruolo.
- Se hai spostato un contenuto in un'altra scheda o zona, aggiorna i test e2e che lo cercano.

## Cosa NON fare

Non "abbellire". Togliere slop significa meno elementi e una gerarchia più chiara, non uno stile nuovo.
Se dopo la passata la schermata ha più elementi di prima, rifalla.
