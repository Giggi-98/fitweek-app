# Design system

## Stato attuale: v2 "sportivo premium" (1.5.0, 2026-11-09; grafici aggiornati in 1.7.0, viste uniformate in 1.8.0)

Scelta dell'utente: direzione "sportivo premium". Implementazione:
- **Token** (`static/css/tokens.css`): fondo quasi nero con bagliori radiali, superfici a strati, accento lime elettrico `#c8ff47` (chiaro: `#3d7a00`), stati success/warning/danger, tema chiaro con passi propri. Font **Inter variable** incluso in `static/fonts/` (OFL), nessun CDN.
- **Icone** Lucide (ISC) incluse in `static/js/icons.js`: `icon(nome, classe)` → SVG inline `currentColor`. Per aggiungerne una, copiare il contenuto interno del file SVG di `lucide-static` (mai il commento di licenza).
- **Grafici** (skill dataviz): una serie → un colore (`--chart-1`), validato con `validate_palette.js` per banda di luminosità e contrasto in entrambi i temi (in scuro il lime UI era fuori banda, quindi i grafici usano `#5fa82a`). Barre ≤ 24 px con angoli 4 px solo in cima, linea 2 px, punti ≥ 8 px con anello di superficie, griglia hairline, tooltip su hover/tocco (mirino sul grafico del peso), valori anche in tabella.
- **Grafici 1.7** (`static/js/chart.js`): asse del tempo reale, tacche pulite (`niceTicks`), tela 420 px perché su telefono punti e testi restino leggibili. Due serie = legenda sempre presente: le pesate sono punti neutri (`--color-text-muted`), la media mobile calcolata è la linea `--chart-1`. La griglia della costanza usa solo `--chart-1` per "fatta"; "non fatta" è un contorno neutro, mai rosso.
- **Stili dinamici**: mai `style="…"` nell'HTML (CSP, D-017). Usare `data-pct-h`, `data-pct-w` o `data-vars="nome:valore"`.
- **Struttura delle viste (1.8)**: il titolo e un sottotitolo breve stanno solo nell'intestazione; ogni vista apre con riquadri (`.tiles`, 2×2 su telefono) o con una barra d'azione (`.view-bar`), poi pannelli con icona nel titolo. I moduli d'inserimento stanno dentro `details.free` o in una finestra, mai sempre aperti. Niente emoji né simboli tipografici come icone: solo `icon()`.
- **Linea del tempo** (`static/js/timeline.js`): binario con riempimento fino al puntatore, nodo pulsante solo sul prossimo evento, puntatore con l'ora in una pillola; i colori d'avviso servono solo per "da registrare".
- **Movimento** (`static/js/motion.js` + keyframes in `app.css`): ingresso a cascata solo al cambio pagina (`#content[data-anim=enter]`), View Transitions API, anelli che si disegnano, barre che crescono, conteggio dei numeri (`data-count`), "pop" e vibrazione sul ✓ della serie, scia luminosa sulla riga, coriandoli a fine esercizio e a fine seduta, foglio modale con molla. Tutto disattivato con `prefers-reduced-motion`.
- **Navigazione**: telefono = barra flottante a 5 voci + Impostazioni nell'intestazione; desktop = barra laterale. Stesso nome "Impostazioni" ovunque.
- **Ora e date**: sempre 24 ore. Niente `<input type="time">`/`type="date"` per dati frequenti (seguono la lingua del browser e possono mostrare AM/PM o MM/GG): campi `time24` con formattazione automatica e scelta del giorno da elenco.

## Stato M2 (storico)

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
