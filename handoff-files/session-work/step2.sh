#!/bin/bash
set -euo pipefail
umask 077
PG_BIN=/usr/lib/postgresql/17/bin
stamp="$(date -u +%Y-%m-%d_%H%M)"
out="backup"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Everything in public (all of Lumora's tables) and auth (the accounts).
# If the auth schema can't be read with these credentials, public is
# still backed up and a warning says so.
if "$PG_BIN/pg_dump" --dbname="$SUPABASE_DB_URL" --format=custom \
  --schema=public --schema=auth --file="$work/lumora-$stamp.dump" 2> "$work/err.txt"; then
  echo "Dumped schemas: public, auth"
  schemas="public auth"
else
  echo "::warning title=auth schema not backed up::Dumping public and auth together failed; trying public only. Accounts (auth.users) are NOT in this backup."
  sed -E 's#postgres(ql)?://[^ ]*#<connection string>#g' "$work/err.txt" >&2 || true
  "$PG_BIN/pg_dump" --dbname="$SUPABASE_DB_URL" --format=custom \
    --schema=public --file="$work/lumora-$stamp.dump"
  schemas="public"
fi

# A readable copy of the structure (tables, functions, row-level security rules).
schema_args=()
for s in $schemas; do schema_args+=(--schema="$s"); done
"$PG_BIN/pg_dump" --dbname="$SUPABASE_DB_URL" --schema-only \
  "${schema_args[@]}" --file="$work/lumora-$stamp-schema.sql"

for f in "$work/lumora-$stamp.dump" "$work/lumora-$stamp-schema.sql"; do
  gzip -9 "$f"
  # The passphrase goes in on a private file descriptor: never on the
  # command line, never in the log.
  gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
    --passphrase-fd 3 --output "$out/$(basename "$f").gz.gpg" "$f.gz" 3<<< "$BACKUP_PASSPHRASE"
done

{
  echo "Lumora database backup, $stamp UTC"
  echo "Schemas: $schemas"
  echo "Decrypt: gpg -d FILE.gpg > FILE.gz, then gunzip FILE.gz (see docs/backup-restore.md)"
} > "$out/README.txt"
ls -l "$out"
echo "BACKUP_NAME=lumora-db-backup-$stamp" >> "$GITHUB_ENV"
