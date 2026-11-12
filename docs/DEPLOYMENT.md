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
| Config | `.env` (non versionato): `APP_PASSWORD`, `SESSION_SECRET`, `COOKIE_SECURE`, `DB_PATH`, `FOOD_SEARCH` (`on` predefinito; `off` spegne la ricerca su Open Food Facts), `APP_ORIGINS` (origini dell'app Android autonoma ammesse via CORS; il predefinito va bene) |
| TZ container | `Europe/Rome` |
| Backup automatico | timer systemd `fitweek-backup.timer` ogni giorno alle 03:30 → `/opt/backups/fitweek/fitweek-auto-*.sqlite` (14 conservati) |

Sullo stesso host girano altri servizi (vaultwarden, jellyfin, homeassistant, gigi-*, armony-*, qbittorrent…): **non toccarli**.

## Procedura di aggiornamento (da eseguire solo con autorizzazione)

Automatizzata in `scripts/deploy.sh` (test → backup `pre-deploy-<commit>` → build → `up -d` → verifica healthcheck e migrazioni). Passi equivalenti manuali:

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
- **Backup esterno (`scripts/backup-offsite.sh`)**: crea un archivio `.tar.gz.enc` cifrato (`AES-256-CBC` con `PBKDF2`, 600.000 iterazioni) contenente l'ultimo backup SQLite verificato e la chiave di firma APK (`/opt/fitweek-secrets/fitweek-release.jks` + `android-keystore.env`), lo trasferisce verso `OFFSITE_DEST` (cartella montata NAS/USB oppure `utente@host:/percorso` via `scp`), verifica l'hash SHA-256 e prova la decifratura post-trasferimento. Ripristino con `scripts/backup-offsite.sh --restore <file.tar.gz.enc> <cartella>`. Se un passo fallisce invia un errore a `journald` (`fitweek-backup-offsite`) ed esce con codice ≠ 0.

## Ripristino

- `scripts/restore.sh <file.sqlite>` (chiede conferma scrivendo `SI`): backup `pre-restore` dello stato corrente, stop, copia come root + `chown 10001`, start. Provato il 2026-11-09 su container/volume usa-e-getta. All'avvio le migrazioni mancanti vengono riapplicate.
- JSON: Impostazioni → Ripristina (validato dal server).

## Rischi noti

- Volume esterno: `docker compose down -v` non lo cancella; `docker volume rm fitweek_data` / `docker volume prune -a` sì: non usarli.
- I file di backup sono leggibili solo da root: gli script che li montano in un container devono girare come root e poi fare `chown 10001`.

## Accesso remoto

Esposizione solo LAN. Per uso fuori casa: VPN (WireGuard/Tailscale) oppure reverse proxy HTTPS con autenticazione aggiuntiva e `COOKIE_SECURE=true`. Mai HTTP diretto su Internet. Nota: le PWA e l'API Clipboard richiedono contesto sicuro (HTTPS o localhost): su `http://192.168.222.200:8088` l'installazione PWA completa non sarà disponibile (vedi `DECISIONS.md` D-008).

## App Android (M6)

- Build: `scripts/build-apk.sh [URL]` (predefinito `http://192.168.222.200:8088`). Gira nel container `fitweek-android-builder:1` (Node 20, JDK 17, SDK 34); cache Gradle/npm in `~/.cache/fitweek-android`.
- Output: `mobile/dist/fitweek.apk` + `fitweek-apk.json`, montati in sola lettura su `/app/downloads` (docker-compose): una nuova build è subito scaricabile, senza riavvio.
- **Chiave di firma**: `/opt/fitweek-secrets/fitweek-release.jks` + `android-keystore.env` (600, root). Non è nei backup del DB: copiarla in un luogo sicuro. Se va persa, l'APK nuovo non si installa sopra quello vecchio (bisogna disinstallare, perdendo solo le preferenze locali dell'app; i dati sono sul server).
- Versione APK = `APP_VERSION` (`app/__init__.py`), versionCode = MAJOR·10000 + MINOR·100 + PATCH.
- Cambio indirizzo (es. VPN): ricompilare con il nuovo URL e reinstallare l'APK sopra il precedente.

## Rete in uscita (dalla 1.8)
Il container fa una sola chiamata verso l'esterno: `https://search.openfoodfacts.org` quando l'utente cerca un prodotto (D-018). Se la rete in uscita è bloccata l'app funziona ugualmente, senza i risultati online.

## APK: due canali (dalla 1.9)
- `scripts/build-apk.sh [URL] stable` → `mobile/dist/fitweek.apk`: guscio che carica la webapp dal server (D-016).
- `scripts/build-apk.sh [URL] next` → `mobile/dist/fitweek-next.apk`: app autonoma con le pagine dentro (D-021), appId `app.fitweek.personal.next`, installabile accanto alla stable. Va ricompilata a ogni modifica del frontend, perché le pagine non arrivano più dal server.
L'indirizzo del server si può cambiare dalla schermata di accesso dell'app (utile con una VPN), senza ricompilare.
