# Deployment, backup e ripristino

## Configurazione effettiva (aggiornata dopo il deploy M1 del 2026-11-09)

| Voce | Valore |
|---|---|
| Host | PC Linux, LAN `192.168.222.200` |
| Directory | `/opt/fitweek-app` |
| Container | `fitweek` (immagine `fitweek:latest`, build locale; avvio `uvicorn app.main:create_app --factory`) |
| Porta | `192.168.222.200:8088 → 8080` — **la 8080 dell'host è occupata da un altro servizio: non usarla** |
| Volume | **esterno** `fitweek_data` → `/data` (DB `/data/fitweek.sqlite`, uid 10001; backup pre-migrazione in `/data/backups`). Il vecchio `fitweek-app_fitweek_data` (stato al 2026-11-09, versione 4) è conservato come copia: rimuoverlo solo con autorizzazione |
| Healthcheck | `GET http://127.0.0.1:8080/api/health` ogni 30 s (definito in compose) |
| Restart | `unless-stopped` |
| Config | `.env` (non versionato): `APP_PASSWORD`, `SESSION_SECRET`, `COOKIE_SECURE`, `DB_PATH` |
| TZ container | `Europe/Rome` |
| Backup automatico | timer systemd `fitweek-backup.timer` ogni giorno alle 03:30 → `/opt/backups/fitweek/fitweek-auto-*.sqlite` (14 conservati) |

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

- `scripts/backup.sh [etichetta]`: backup online con l'API di SQLite dentro al container, file autonomo (senza WAL), `integrity_check`, copia in `/opt/backups/fitweek/` (dir 700, file 600), rotazione (14 `auto`, 20 etichettati).
- Automatico: `systemctl list-timers fitweek-backup.timer`; log con `journalctl -u fitweek-backup.service`.
- Pre-migrazione: creato dall'app all'avvio se ci sono migrazioni da applicare (`/data/backups/pre-migration-*`, 10 conservati).
- Non copiare mai il `.sqlite` a caldo con `cp`.
- Da valutare: copia dei backup su un secondo disco/macchina (oggi stanno sullo stesso disco del server).

## Ripristino

- `scripts/restore.sh <file.sqlite>` (chiede conferma scrivendo `SI`): backup `pre-restore` dello stato corrente, stop, copia come root + `chown 10001`, start. Provato il 2026-11-09 su container/volume usa-e-getta. All'avvio le migrazioni mancanti vengono riapplicate.
- JSON: Impostazioni → Ripristina (validato dal server).

## Rischi noti

- Volume esterno: `docker compose down -v` non lo cancella; `docker volume rm fitweek_data` / `docker volume prune -a` sì: non usarli.
- I file di backup sono leggibili solo da root: gli script che li montano in un container devono girare come root e poi fare `chown 10001`.

## Accesso remoto

Esposizione solo LAN. Per uso fuori casa: VPN (WireGuard/Tailscale) oppure reverse proxy HTTPS con autenticazione aggiuntiva e `COOKIE_SECURE=true`. Mai HTTP diretto su Internet. Nota: le PWA e l'API Clipboard richiedono contesto sicuro (HTTPS o localhost): su `http://192.168.222.200:8088` l'installazione PWA completa non sarà disponibile (vedi `DECISIONS.md` D-008).
