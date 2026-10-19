#!/bin/bash
set -euo pipefail
d="$(mktemp -d)"
export GNUPGHOME="$d/gnupg"
mkdir -m 700 "$GNUPGHOME"
BACKUP_PASSPHRASE='correct horse battery staple'
echo hello > "$d/f"
gzip -9 "$d/f"
gpg --batch --yes --quiet --pinentry-mode loopback --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$d/f.gz.gpg" "$d/f.gz" 3<<< "$BACKUP_PASSPHRASE"
# Decrypt the way the doc says (with the passphrase given in batch mode here).
gpg --batch --quiet --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d "$d/f.gz.gpg" | gunzip
rm -rf "$d"
