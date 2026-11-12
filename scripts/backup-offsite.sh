#!/usr/bin/env bash
# Copia cifrata (AES-256-CBC con PBKDF2) dell'ultimo backup SQLite verificato e della chiave di firma
# dell'APK Android verso una destinazione esterna al disco del server (cartella montata NAS/USB oppure
# host remoto via scp/rsync), con verifica di integrità e decifratura dopo il trasferimento.
#
# Uso:
#   scripts/backup-offsite.sh [DESTINAZIONE]
#   scripts/backup-offsite.sh --restore <archivio.tar.gz.enc> <cartella-di-uscita>
#
# Variabili d'ambiente:
#   OFFSITE_DEST             destinazione predefinita (percorso locale/montato o user@host:/percorso)
#   FITWEEK_BACKUP_DIR       cartella dei backup SQLite (default /opt/backups/fitweek)
#   FITWEEK_SECRETS_DIR      cartella con la chiave di firma APK (default /opt/fitweek-secrets)
#   OFFSITE_PASSPHRASE_FILE  file con la passphrase di cifratura (default /opt/fitweek-secrets/backup-passphrase)
#   OFFSITE_PASSPHRASE       passphrase esplicita (alternativa a OFFSITE_PASSPHRASE_FILE)
#   KEEP_OFFSITE             quante copie cifrate conservare sulla destinazione (default 14)
set -euo pipefail

BACKUP_DIR="${FITWEEK_BACKUP_DIR:-/opt/backups/fitweek}"
SECRETS_DIR="${FITWEEK_SECRETS_DIR:-/opt/fitweek-secrets}"
PASS_FILE="${OFFSITE_PASSPHRASE_FILE:-$SECRETS_DIR/backup-passphrase}"
KEEP_OFFSITE="${KEEP_OFFSITE:-14}"

fail() {
  echo "ERRORE backup-offsite: $*" >&2
  command -v logger >/dev/null 2>&1 && logger -t fitweek-backup-offsite -p user.err -- "$*" || true
  exit 1
}

read_pass() {
  if [[ -n "${OFFSITE_PASSPHRASE:-}" ]]; then
    printf '%s' "$OFFSITE_PASSPHRASE"
    return
  fi
  if [[ ! -f "$PASS_FILE" ]]; then
    mkdir -p "$(dirname "$PASS_FILE")"
    umask 077
    openssl rand -base64 36 > "$PASS_FILE"
    chmod 600 "$PASS_FILE"
  fi
  tr -d '\r\n' < "$PASS_FILE"
}

if [[ "${1:-}" == "--restore" ]]; then
  ENC_FILE="${2:?specifica il file .tar.gz.enc da ripristinare}"
  OUT_DIR="${3:?specifica la cartella di uscita}"
  [[ -f "$ENC_FILE" ]] || fail "File non trovato: $ENC_FILE"
  PASS="$(read_pass)"
  [[ -n "$PASS" ]] || fail "Passphrase mancante per decifrare $ENC_FILE"
  mkdir -p "$OUT_DIR"
  chmod 700 "$OUT_DIR"
  PASS_ENV="$PASS" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:PASS_ENV -in "$ENC_FILE" \
    | tar -xzf - -C "$OUT_DIR" || fail "Decifratura o estrazione fallita"
  (cd "$OUT_DIR" && sha256sum -c SHA256SUMS >/dev/null) || fail "Controllo SHA256SUMS fallito dopo l'estrazione"
  DB_FILE="$(find "$OUT_DIR" -maxdepth 1 -name 'fitweek-*.sqlite' | head -n 1)"
  [[ -n "$DB_FILE" ]] || fail "Nessun file SQLite trovato nell'archivio"
  python3 - "$DB_FILE" <<'PY' || fail "Verifica SQLite del backup estratto fallita"
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert c.execute("SELECT count(*) FROM app_state").fetchone()[0] == 1
PY
  echo "$DB_FILE"
  exit 0
fi

DEST="${1:-${OFFSITE_DEST:-}}"
[[ -n "$DEST" ]] || fail "Destinazione non impostata (passa il percorso come argomento o imposta OFFSITE_DEST)"

LATEST="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'fitweek-*.sqlite' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n 1 | cut -d' ' -f2-)"
[[ -n "$LATEST" && -f "$LATEST" ]] || fail "Nessun backup SQLite trovato in $BACKUP_DIR"

python3 - "$LATEST" <<'PY' || fail "Il backup sorgente $LATEST non supera integrity_check"
import sqlite3, sys
c = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
assert c.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
assert c.execute("SELECT count(*) FROM app_state").fetchone()[0] == 1
PY

PASS="$(read_pass)"
[[ -n "$PASS" ]] || fail "Passphrase vuota"

WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE"
cp -p "$LATEST" "$STAGE/"
if [[ -d "$SECRETS_DIR" ]]; then
  for f in fitweek-release.jks android-keystore.env; do
    [[ -f "$SECRETS_DIR/$f" ]] && cp -p "$SECRETS_DIR/$f" "$STAGE/"
  done
fi
(cd "$STAGE" && sha256sum -- * > SHA256SUMS)

TS="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="fitweek-offsite-${TS}.tar.gz.enc"
ARCHIVE_PATH="$WORK/$ARCHIVE_NAME"
tar -czf - -C "$STAGE" . \
  | PASS_ENV="$PASS" openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:PASS_ENV -out "$ARCHIVE_PATH" \
  || fail "Cifratura dell'archivio fallita"
chmod 600 "$ARCHIVE_PATH"
EXPECTED_SHA="$(sha256sum "$ARCHIVE_PATH" | cut -d' ' -f1)"
printf '%s  %s\n' "$EXPECTED_SHA" "$ARCHIVE_NAME" > "$ARCHIVE_PATH.sha256"

if [[ "$DEST" == *:* && ! -d "$DEST" ]]; then
  HOST="${DEST%%:*}"
  REMOTE_DIR="${DEST#*:}"
  ssh -o BatchMode=yes "$HOST" "mkdir -p '$REMOTE_DIR' && chmod 700 '$REMOTE_DIR'" || fail "Impossibile preparare $DEST"
  scp -q "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256" "$DEST/" || fail "Trasferimento SCP verso $DEST fallito"
  REMOTE_SHA="$(ssh -o BatchMode=yes "$HOST" "sha256sum '$REMOTE_DIR/$ARCHIVE_NAME' | cut -d' ' -f1")" || fail "Verifica remota fallita"
  [[ "$REMOTE_SHA" == "$EXPECTED_SHA" ]] || fail "SHA-256 remoto non corrispondente ($REMOTE_SHA != $EXPECTED_SHA)"
  scp -q "$DEST/$ARCHIVE_NAME" "$WORK/verify.enc" || fail "Rilettura di verifica da $DEST fallita"
  VERIFY_FILE="$WORK/verify.enc"
else
  mkdir -p "$DEST" || fail "Impossibile creare la destinazione $DEST"
  chmod 700 "$DEST" 2>/dev/null || true
  cp -f "$ARCHIVE_PATH" "$ARCHIVE_PATH.sha256" "$DEST/" || fail "Copia verso $DEST fallita"
  (cd "$DEST" && sha256sum -c "$ARCHIVE_NAME.sha256" >/dev/null) || fail "Checksum sulla destinazione $DEST non valido"
  VERIFY_FILE="$DEST/$ARCHIVE_NAME"
  find "$DEST" -maxdepth 1 -type f -name 'fitweek-offsite-*.tar.gz.enc' -printf '%T@ %p\n' \
    | sort -rn | tail -n +$(( KEEP_OFFSITE + 1 )) | cut -d' ' -f2- \
    | while read -r old; do rm -f "$old" "$old.sha256"; done
fi

# Verifica post-trasferimento: decifra la copia trasferita e controlla SHA256SUMS interni.
VERIFY_OUT="$WORK/verify-out"
mkdir -p "$VERIFY_OUT"
PASS_ENV="$PASS" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:PASS_ENV -in "$VERIFY_FILE" \
  | tar -xzf - -C "$VERIFY_OUT" || fail "Verifica di decifratura della copia trasferita fallita"
(cd "$VERIFY_OUT" && sha256sum -c SHA256SUMS >/dev/null) || fail " Contenuto dell'archivio trasferito corrotto"

echo "${DEST%/}/$ARCHIVE_NAME"

