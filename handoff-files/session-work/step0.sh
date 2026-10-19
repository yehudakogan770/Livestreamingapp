#!/bin/bash
if [ "$HAS_URL" != "true" ] || [ "$HAS_PASSPHRASE" != "true" ]; then
  echo "::notice title=Database backup skipped::Add the SUPABASE_DB_URL and BACKUP_PASSPHRASE secrets to turn on backups (see docs/backup-restore.md)."
  echo "ready=false" >> "$GITHUB_OUTPUT"
else
  echo "ready=true" >> "$GITHUB_OUTPUT"
fi
