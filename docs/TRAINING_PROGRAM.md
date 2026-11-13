# Scheda di allenamento — riferimento verificato

Fonte autorevole: `resources/scheda-originale.pdf` (4 pagine: tabelle W1–W8 e link video). Ricostruzione verificata il 2026-11-09 estraendo le coordinate delle celle (`pdftotext -bbox`) e associando ogni cambio di serie alla colonna `WEEKn` corrispondente. Le virgolette `“ “ “` nel PDF significano "come la settimana precedente".

Non modificare questi valori senza indicazione dell'allenatore. Le BPM sono riferimenti del PDF, non obiettivi personalizzati.

## Serie per settimana (W1…W8)

Ripetizioni costanti per tutte le 8 settimane.

### Giorno A — Lunedì
| id | Esercizio | Rip. | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|---|---|
| a1 | Lat machine | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| a2 | Face pull al cavo | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| a3 | Military press in piedi (manubri) | 10–12 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 |
| a4 | Leg curl sdraiato | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| a5 | Hyperextension con disco | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| a6 | Pushdown corda | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| a7 | French press cavo basso | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| — | Cyclette | 10 min | 130–150 BPM W1–W4 · 150–170 BPM W5–W8 |

### Giorno B — Mercoledì
| id | Esercizio | Rip. | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|---|---|
| b1 | Chest press | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| b2 | Croci ai cavi | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| b3 | Shoulder press machine | 10–12 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 |
| b4 | Leg extension | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| b5 | Mezzo affondo con manubri | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| b6 | Curl manubri su panca | 8–10 | 3 | 3 | 3 | 3 | **4** | 4 | 4 | 4 |
| b7 | Bayesian curl ai cavi bassi | 8–10 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 4 |
| — | Tapis roulant inclinato | 10 min | 130–150 BPM W1–W4 · 150–170 BPM W5–W8 |

### Giorno C — Venerdì
| id | Esercizio | Rip. | W1 | W2 | W3 | W4 | W5 | W6 | W7 | W8 |
|---|---|---|---|---|---|---|---|---|---|---|
| c1 | Spinte manubri | 8–10 | 3 | 3 | 3 | 4 | 4 | 4 | 4 | 4 |
| c2 | Pulley sbarra lunga | 8–10 | 3 | 3 | 3 | 3 | 4 | 4 | 4 | 4 |
| c3 | Leg press 45° | 8–10 | 4 | 4 | 4 | 4 | 4 | 5 | 5 | 5 |
| c4 | Curl corda bassa | 8–10 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 4 |
| c5 | Calf su rialzo con manubri | 10–12 | 5 | 5 | 5 | 5 | 5 | 5 | **6** | 6 |
| — | Vogatore | 10 min | 130–150 BPM W1–W4 · 150–170 BPM W5–W8 |

## Allineamento tra PDF, `seed.py` e DB

Stato al 2026-11-13 (sezione riscritta dopo il finding FW-REV-007: prima descriveva come "attuale" un seed che non esisteva più).

| Dove | b6 (Curl manubri su panca) | c5 (Calf su rialzo) | Come è verificato |
|---|---|---|---|
| PDF | `[3,3,3,3,4,4,4,4]` (4 serie da W5) | `[5,5,5,5,5,5,6,6]` (6 serie da W7) | tabelle qui sopra, estratte il 2026-11-09 |
| `app/seed.py` oggi | uguale al PDF | uguale al PDF | test `test_seed_progressions_match_the_pdf_table` |
| Seed della versione 1.0 (storico) | `[3,3,3,4,4,4,4,4]` (4 serie da W4) | `[5,5,5,5,5,6,6,6]` (6 serie da W6) | errore di trascrizione, corretto in M1 |
| DB creati con la 1.0 | corretti dalla migrazione 3 (`fix_progressions_b6_c5`), solo se il valore era ancora quello errato: una progressione cambiata dall'utente non viene toccata | idem | test `test_legacy_db_is_backed_up_and_fixed…` e `test_user_modified_progression_is_not_touched` |
| DB dell'istanza in uso | **non riletto in questa revisione** (nessun accesso ai dati reali): la migrazione 3 risulta applicata dal deploy di M1, ma il contenuto attuale di `routines` va confermato guardando la scheda nell'app | idem | da verificare a mano |

Tutti gli altri 18 esercizi coincidono tra seed e PDF. Non c'è nessuna correzione pianificata: **non scrivere una nuova migrazione delle progressioni** partendo da questa pagina.

## Note

- Il cardio non è nel seed come esercizio: è una costante nel frontend (`CARDIO`). Da modellare come esercizio a tempo in M2.
- Link video: tutti coincidono con il PDF; `b4` ha un ID di 10 caratteri già troncato nel PDF → da far verificare/sostituire all'utente.
- Il PDF non indica tempi di recupero né RPE: eventuali default nel timer sono impostazioni utente, non indicazioni della scheda.
