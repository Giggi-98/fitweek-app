# FitWeek — webapp self-hosted

Una webapp personale, responsive e pronta per Docker, per gestire scheda palestra A/B/C, progressioni delle 8 settimane, diario carichi, alimentazione, lista Esselunga, dispensa, peso e girovita.

## Installazione

Prerequisito: Docker con plugin `docker compose`.

```bash
unzip fitweek-app.zip
cd fitweek-app
cp .env.example .env
```

**Prima di avviare**, modifica `.env` e sostituisci `APP_PASSWORD` (almeno 10 caratteri) e `SESSION_SECRET` (almeno 32 caratteri casuali, ad esempio con `openssl rand -hex 32`).

```bash
docker compose up -d --build
```

Apri `http://localhost:8088` se stai eseguendo Docker sul tuo PC. Se Docker gira su un server remoto, la porta è deliberatamente legata a `127.0.0.1`: puoi accedere con un tunnel SSH:

```bash
ssh -L 8088:127.0.0.1:8088 utente@IP_DEL_SERVER
```

Poi apri `http://localhost:8088` sul PC.

Per accedere da telefono senza tunnel, configura un reverse proxy **HTTPS** (Caddy, Nginx Proxy Manager o simili) con restrizioni di accesso appropriate, imposta `COOKIE_SECURE=true` e pubblica la webapp solo dopo aver verificato proxy, DNS e autenticazione. Non esporre direttamente HTTP su Internet. In alternativa usa una VPN come WireGuard o Tailscale.

## Contenuti già presenti

- Scheda A/B/C trascritta dal PDF fornito, con serie previste per W1–W8 e link video dove presenti.
- PDF originale protetto da login, sotto `resources/scheda-originale.pdf`.
- Menu iniziale lunedì–domenica editabile.
- Lista iniziale Esselunga con prezzi **puramente stimati**, da sostituire ai prezzi reali.
- Profilo iniziale: 28 anni, 166 cm, 90 kg, budget 50 €.

## Utilizzo

1. In **Impostazioni** verifica il profilo e la settimana attuale.
2. In **Allenamenti**, seleziona Giorno A/B/C e W1–W8, inserisci kg e ripetizioni per ogni serie, quindi salva.
3. In **Alimentazione**, modifica direttamente ogni pranzo, spuntino e cena.
4. In **Spesa & dispensa**, cambia prodotti e stime, segna quelli acquistati e aggiungi gli alimenti rimasti.
5. In **Progressi**, registra peso/girovita e consulta il diario.
6. In **Impostazioni**, esporta il backup JSON con regolarità.

## Dati e backup

Il database SQLite è nel volume Docker `fitweek_data`. La funzione **Scarica backup** esporta il contenuto in JSON; **Ripristina** sostituisce lo stato corrente. Conserva il backup in luogo sicuro.

Il progetto è pensato per **un singolo utente**, con password condivisa dell'istanza. Non implementa account multipli, login social, recupero password o permessi differenziati.

## Limitazioni MVP

- Il PDF originale è già stato **trascritto nella scheda**; non è presente un parser generico che importi qualsiasi PDF automaticamente.
- I prezzi Esselunga sono stime modificabili; nessun checkout o accesso al catalogo del supermercato.
- Non calcola calorie o macro di piatti del lavoro privi di valori nutrizionali.
- Nessuna sincronizzazione con wearable o promemoria automatici.
- Salva con un controllo di versione. Se si modifica lo stesso dato su più dispositivi contemporaneamente, può essere necessario ricaricare.
- La data di inizio, le quantità e le frequenze cardiache sono riferimenti da personalizzare; non prescrizioni mediche.

## Stack

Python 3.12, FastAPI, SQLite e frontend JavaScript senza CDN, database su volume Docker persistente. Nessuna dipendenza da un servizio cloud.
