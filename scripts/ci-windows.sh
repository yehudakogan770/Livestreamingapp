#!/usr/bin/env bash
# Gets a Windows build ready (run by CI before `tauri build`):
#   scripts/ci-windows.sh <tauri.conf.json> <its src-tauri folder>
# - the version (LUMORA_VERSION), so the Update button sees each build;
# - update signing from the TAURI_SIGNING_PRIVATE_KEY secret (or no update files);
# - FFmpeg (in ffmpeg-cache/) shipped next to the program.
set -uo pipefail
conf="$1"
dir="$2"

# Spaces, line breaks or quotes picked up when pasting the key are removed;
# a key that still can't be read builds without signing.
key=$(printf '%s' "${SIGNING_KEY_AS_PASTED:-}" | tr -d " \t\r\n\"'=")
# The "=" at the end is easy to miss when copying: put it back.
while [ $(( ${#key} % 4 )) -ne 0 ]; do key="$key="; done
# A hint for fixing a bad paste (never the key itself): a good key is 348
# characters and starts with "dW50cnVzdGVk".
echo "Signing key: ${#key} characters, starts like a key: $([ "${key:0:12}" = dW50cnVzdGVk ] && echo yes || echo no)"
signing=0
echo test > "$RUNNER_TEMP/sign-test.txt"
if [ -n "$key" ] && TAURI_SIGNING_PRIVATE_KEY="$key" npx tauri signer sign "$RUNNER_TEMP/sign-test.txt" > /dev/null 2>&1; then
  echo "TAURI_SIGNING_PRIVATE_KEY=$key" >> "$GITHUB_ENV"
  echo "Signing key OK."
  signing=1
else
  [ -n "${SIGNING_KEY_AS_PASTED:-}" ] && echo "::warning::The TAURI_SIGNING_PRIVATE_KEY secret can't be read; building without update signing."
fi

# FFmpeg, as the sidecar Tauri puts next to the program (ffmpeg.exe).
mkdir -p "$dir/binaries"
if [ ! -f ffmpeg-cache/ffmpeg.exe ]; then
  mkdir -p ffmpeg-cache
  for url in \
    "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip" \
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n7.1-latest-win64-gpl-7.1.zip"; do
    if curl -fsSL --retry 3 -o ffmpeg-cache/ffmpeg.zip "$url"; then
      7z e -y -offmpeg-cache ffmpeg-cache/ffmpeg.zip ffmpeg.exe "LICENSE*" -r > /dev/null && [ -f ffmpeg-cache/ffmpeg.exe ] && break
    fi
  done
  rm -f ffmpeg-cache/ffmpeg.zip
fi
if [ ! -f ffmpeg-cache/ffmpeg.exe ]; then
  echo "::error::FFmpeg could not be downloaded."
  exit 1
fi
cp ffmpeg-cache/ffmpeg.exe "$dir/binaries/ffmpeg-x86_64-pc-windows-msvc.exe"
license=$(ls ffmpeg-cache/LICENSE* 2>/dev/null | head -1)
cp "${license:-/dev/null}" "$dir/binaries/FFmpeg-license.txt" 2>/dev/null || echo "FFmpeg (https://ffmpeg.org), GPL." > "$dir/binaries/FFmpeg-license.txt"
"$dir/binaries/ffmpeg-x86_64-pc-windows-msvc.exe" -hide_banner -version | head -1

CONF="$conf" SIGNING="$signing" node -e "
  const fs = require('fs');
  const f = process.env.CONF;
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.version = process.env.LUMORA_VERSION;
  c.bundle.externalBin = ['binaries/ffmpeg'];
  c.bundle.resources = { 'binaries/FFmpeg-license.txt': 'FFmpeg-license.txt' };
  if (process.env.SIGNING !== '1') c.bundle.createUpdaterArtifacts = false;
  fs.writeFileSync(f, JSON.stringify(c, null, 2));
"
