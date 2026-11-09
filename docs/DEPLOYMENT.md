# Deployment, backup e ripristino

## Configurazione effettiva (verificata 2026-11-09)

| Voce | Valore |
|---|---|
| Host | PC Linux, LAN `192.168.222.200` |
| Directory | `/opt/fitweek-app` |
| Container | `fitweek` (immagine `fitweek-app-fitweek`, build locale) |
| Porta | `192.168.222.200:8088 → 8080` — **la 8080 dell'host è occupata da un altro servizio: non usarla** |
| Volume | `fitweek-app_fitweek_data` → `/data` (DB `/data/fitweek.sqlite`, proprietario uid 10001) |
| Healthcheck | `GET http://127.0.0.1:8080/api/health` ogni 30 s (definito in compose) |
| Restart | `unless-stopped` |
| Config | `.env` (non versionato): `APP_PASSWORD`, `SESSION_SECRET`, `COOKIE_SECURE`, `DB_PATH` |
| TZ container | UTC (non impostata) |

Sullo stesso host girano altri servizi (vaultwarden, jellyfin, homeassistant, gigi-*, armony-*, qbittorrent…): **non toccarli**.

## Procedura di aggiornamento (da eseguire solo con autorizzazione)

1. `git status` pulito nel repo dedicato; tag della versione precedente.
2. Backup coerente (vedi sotto) e verifica che il file sia leggibile (`PRAGMA integrity_check`).
3. Build senza fermare il servizio: `docker compose build`.
4. Test sull'immagine nuova in container usa-e-getta con **copia** del DB (`--network none`, nessuna porta).
5. `docker compose up -d` (ricrea solo `fitweek`; il volume resta).
6. Verifica: `docker inspect fitweek --format '{{.State.Health.Status}}'` → `healthy`; login e dati presenti.
7. Rollback: `git checkout <tag> && docker compose up -d --build`; se una migrazione ha alterato il DB, ripristino dal backup pre-migrazione.

## Backup

Stato attuale: solo export JSON manuale da Impostazioni. **Nessun backup automatico.**

Pianificato (M1):
- `scripts/backup.sh`: esegue nel container `python -c "sqlite3.connect(DB).backup(dest)"` (backup online coerente anche con WAL), salva in `/data/backups/fitweek-YYYYmmdd-HHMMSS.sqlite`, poi copia fuori dal volume (es. `/opt/backups/fitweek/`), verifica `integrity_check`, rotazione (7 giornalieri, 8 settimanali).
- Pianificazione via cron/systemd timer dell'host — **richiede autorizzazione**.
- Backup automatico pre-migrazione all'avvio del container.
- Non copiare mai il file `.sqlite` a caldo con `cp` (rischio inconsistenza con WAL).

## Ripristino

- JSON (attuale): Impostazioni → Ripristina; sostituisce l'intero stato.
- SQLite (pianificato `scripts/restore.sh`): ferma il container, salva il DB corrente come `pre-restore-*.sqlite`, copia il backup, `integrity_check`, riavvia, verifica healthcheck.
- Il ripristino va provato almeno una volta su container usa-e-getta.

## Rischi noti

- **Nome volume legato al project name** (`fitweek-app_`): rinominare la directory o usare `docker compose -p altro` monta un volume nuovo e vuoto. Proposta: volume con `name: fitweek_data` esplicito, migrato con copia via backup (oggi il DB contiene solo il seed → rischio minimo).
- `docker compose down -v` o `docker volume prune` cancellano i dati: non usarli.

## Accesso remoto

Esposizione solo LAN. Per uso fuori casa: VPN (WireGuard/Tailscale) oppure reverse proxy HTTPS con autenticazione aggiuntiva e `COOKIE_SECURE=true`. Mai HTTP diretto su Internet. Nota: le PWA e l'API Clipboard richiedono contesto sicuro (HTTPS o localhost): su `http://192.168.222.200:8088` l'installazione PWA completa non sarà disponibile (vedi `DECISIONS.md` D-008).
