# FitWeek

Webapp self-hosted personale per scheda palestra A/B/C (8 settimane), diario dei carichi, alimentazione, lista della spesa, dispensa, peso e girovita. Singolo utente, dati sul proprio server.

Documentazione tecnica: [`CLAUDE.md`](CLAUDE.md) e [`docs/`](docs/) (architettura, roadmap, deploy, modello dati, scheda verificata).

## Requisiti

Docker con plugin `docker compose`.

## Installazione

```bash
cp .env.example .env          # imposta APP_PASSWORD (≥ 10 caratteri) e SESSION_SECRET (≥ 32, es. openssl rand -hex 32)
docker volume create fitweek_data
docker compose up -d --build
```

L'app è pubblicata su `http://192.168.222.200:8088` (solo LAN; la porta 8080 dell'host è usata da altri servizi). Per l'accesso da fuori casa usa una VPN (WireGuard/Tailscale) o un reverse proxy **HTTPS** con `COOKIE_SECURE=true`. Non esporre HTTP su Internet.

## Dati e backup

- DB SQLite nel volume Docker esterno `fitweek_data` (non viene cancellato da `docker compose down -v`).
- Backup coerente: `scripts/backup.sh [etichetta]` → `/opt/backups/fitweek/` (verificato con `integrity_check`, rotazione automatica). Un timer giornaliero lo esegue automaticamente (vedi `docs/DEPLOYMENT.md`).
- Ripristino: `scripts/restore.sh <file.sqlite>` (salva prima lo stato corrente).
- All'avvio, se ci sono migrazioni da applicare, viene creato un backup `pre-migration-*` in `/data/backups`.
- Dall'app: Impostazioni → Scarica backup (JSON) / Ripristina.

## Sviluppo

```bash
scripts/check.sh    # sintassi + test automatici in container usa-e-getta
```

Stack: Python 3.12, FastAPI, SQLite, frontend JavaScript senza build e senza CDN.

## Limitazioni note

- I prezzi della spesa sono stime manuali: nessuna integrazione Esselunga.
- Nessun calcolo nutrizionale; le indicazioni sono orientative, non prescrizioni mediche.
- Le frequenze cardiache della scheda sono riferimenti del PDF, non obiettivi personalizzati.
- Roadmap completa in `docs/ROADMAP.md`.
# fitweek-app
