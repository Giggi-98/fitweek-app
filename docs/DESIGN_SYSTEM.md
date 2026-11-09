# Design system

## Stato attuale (M2, 2026-11-09)

Implementato: `static/css/tokens.css` (spaziature, raggi, tipografia, colori semantici scuro/chiaro, `prefers-color-scheme` + override `[data-theme]` da Impostazioni) e `static/css/app.css` (componenti). Nessun colore esadecimale fuori dai token. Restano stili inline per larghezze delle barre di avanzamento.

## Stato prima di M2

`static/style.css` minificato, solo tema scuro. Variabili su `:root`: `--bg #0e1417`, `--panel #182226`, `--line #2c383b`, `--muted #89999a`, `--text #f3f8f4`, `--accent #b8ee7b`, `--amber #fac887`, `--radius 18px`. Molti colori sono però scritti a mano in `app.js` (inline style) e nel grafico SVG. Componenti esistenti: `panel`, `metric`, `pill`, `btn` (`primary`, `small`, `danger`, `quiet`), `entry`, `summary-row`, `daygrid`, `exercise`/`set-row`, `shopitem`, `toast`, `bottom-nav`. Icone: caratteri Unicode. Breakpoint: 1100 / 750 / 390 px.

## Principi

1. **Una cosa importante per schermata**: la dashboard mostra "adesso" e "dopo", non tutto.
2. **Pollice prima**: azioni primarie in basso, target ≥ 48×48 px, spaziatura ≥ 8 px tra target.
3. **Feedback immediato**: aggiornamento ottimistico, stato di sincronizzazione sempre visibile e onesto, errori con azione di recupero.
4. **Dati vs stime**: valori stimati o calcolati hanno etichetta/icona dedicata ("stima", "media calcolata").
5. **Calma**: niente rosso per il peso, niente linguaggio colpevolizzante.

## Token (da introdurre in M2, `css/tokens.css`)

- Colore semantico, non letterale: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-on-accent`, `--color-warning`, `--color-danger`, `--color-success`, `--color-focus`.
- Temi: default scuro (attuale), chiaro via `@media (prefers-color-scheme: light)` e override manuale `[data-theme]`, preferenza salvata in localStorage.
- Spaziatura scala 4 px: `--space-1…8` (4, 8, 12, 16, 20, 24, 32, 48).
- Tipografia: stack di sistema; `--text-xs 12px`, `--text-sm 14px`, `--text-md 16px` (minimo per input: evita lo zoom iOS), `--text-lg 20px`, `--text-xl 26px`, `--text-num` con `font-variant-numeric: tabular-nums` per kg/rip/timer.
- Raggi: `--radius-sm 10px`, `--radius-md 14px`, `--radius-lg 18px`. Ombre: 2 livelli.
- Movimento: 150–200 ms, rispettare `prefers-reduced-motion`.
- Contrasto: testo ≥ 4.5:1, componenti ≥ 3:1 in entrambi i temi.

## Componenti (target)

`Button`, `IconButton`, `Stepper` (−/valore/+ per kg e rip), `SetRow`, `RestTimer` (barra fissa in basso), `Card`, `Stat` (con variante "calcolato"), `Pill/Badge`, `Sheet` (pannello dal basso per dettagli), `Toast` (con azione "Annulla"/"Riprova"), `EmptyState`, `Skeleton`, `ListRow` swipe-free (azioni esplicite), `Chart` (linea, barre; colori da token; tabella alternativa accessibile).

## Schermata allenamento (riferimento)

- Header compatto: "Giorno A · W3 · 2/7 esercizi", tempo trascorso.
- Un esercizio in focus alla volta, gli altri compressi; scorrimento verticale.
- Ogni serie: `kg [− 40 +]`, `rip [− 10 +]`, pulsante grande **✓** a destra. Valori pre-compilati dall'ultima seduta (o dalla serie precedente). Un tocco su ✓ = serie salvata + timer avviato.
- Serie saltabile/non completata con un tocco lungo o menu, mai obbligatoria.
- Timer recupero come barra fissa sopra la nav, con +15 s / stop, vibrazione e suono opzionali.
- Note, RPE/RIR e video dietro un'icona, non nel flusso principale.
- Fine seduta: riepilogo (durata, serie, confronto con la volta precedente) e nota opzionale.

## Navigazione

Mobile: bottom nav con 5 voci — Oggi, Palestra, Pasti, Spesa, Altro (Progressi, Impostazioni, Logout). Desktop: sidebar attuale. La vista corrente si riflette nell'URL (hash) per supportare back e ricarica.
