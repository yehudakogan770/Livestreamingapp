import sys
root = sys.argv[1]
p = root + '/scripts/ci-windows.sh'
s = open(p).read()
s = s.replace("""#   scripts/ci-windows.sh <tauri.conf.json> <its src-tauri folder>""", """#   scripts/ci-windows.sh <tauri.conf.json> <its src-tauri folder> [--no-ffmpeg]""")
s = s.replace("""# - FFmpeg (in ffmpeg-cache/) shipped next to the program.
set -uo pipefail
conf="$1"
dir="$2"
""", """# - FFmpeg (in ffmpeg-cache/) shipped next to the program (not with
#   --no-ffmpeg: Lumora Photo has no use for it).
set -uo pipefail
conf="$1"
dir="$2"
ffmpeg=1
[ "${3:-}" = "--no-ffmpeg" ] && ffmpeg=0
""")
s = s.replace("""# FFmpeg, as the sidecar Tauri puts next to the program (ffmpeg.exe).
mkdir -p "$dir/binaries"
""", """# FFmpeg, as the sidecar Tauri puts next to the program (ffmpeg.exe).
if [ "$ffmpeg" = 1 ]; then
mkdir -p "$dir/binaries"
""")
s = s.replace(""""$dir/binaries/ffmpeg-x86_64-pc-windows-msvc.exe" -hide_banner -version | head -1
""", """"$dir/binaries/ffmpeg-x86_64-pc-windows-msvc.exe" -hide_banner -version | head -1
fi
""")
s = s.replace("""CONF="$conf" SIGNING="$signing" node -e \"""", """CONF="$conf" SIGNING="$signing" FFMPEG="$ffmpeg" node -e \"""")
s = s.replace("""  c.bundle.externalBin = ['binaries/ffmpeg'];
  c.bundle.resources = { 'binaries/FFmpeg-license.txt': 'FFmpeg-license.txt' };""", """  if (process.env.FFMPEG === '1') {
    c.bundle.externalBin = ['binaries/ffmpeg'];
    c.bundle.resources = { 'binaries/FFmpeg-license.txt': 'FFmpeg-license.txt' };
  }""")
open(p, 'w').write(s)

p = root + '/.github/workflows/ci.yml'
s = open(p).read()
a = """            echo "::error::docs/titler is out of date: run npm run titler:build and commit docs/titler"
            exit 1
          fi
"""
assert a in s
s = s.replace(a, a + """      # And Lumora Photo from docs/photo.
      - name: Lumora Photo build (docs/photo is up to date)
        run: |
          npm run photo:build
          if [ -n "$(git status --porcelain -- docs/photo)" ]; then
            git status --short -- docs/photo
            echo "::error::docs/photo is out of date: run npm run photo:build and commit docs/photo"
            exit 1
          fi
""", 1)
job = """
  windows-photo:
    name: Lumora Photo installer
    runs-on: windows-latest
    needs: checks
    env:
      LUMORA_VERSION: 0.1.${{ github.run_number }}
      SIGNING_KEY_AS_PASTED: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ''
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@1.98.1
      - uses: Swatinem/rust-cache@v2
      - run: npm ci
      - name: Version and signing
        shell: bash
        run: scripts/ci-windows.sh photo/src-tauri/tauri.conf.json photo/src-tauri --no-ffmpeg
      - name: Build the installer
        run: npm run photo:app:build
      - name: Upload installer
        uses: actions/upload-artifact@v4
        with:
          name: Lumora-Photo-Setup-windows
          path: |
            target/release/bundle/nsis/Lumora Photo_*.exe
            target/release/bundle/nsis/Lumora Photo_*.sig
          if-no-files-found: error
"""
anchor = """            target/release/bundle/nsis/Lumora Titler_*.sig
          if-no-files-found: error
"""
assert anchor in s
s = s.replace(anchor, anchor + job, 1)
assert "needs: [windows, windows-edit, windows-titler]" in s
s = s.replace("needs: [windows, windows-edit, windows-titler]", "needs: [windows, windows-edit, windows-titler, windows-photo]")
b = """      - uses: actions/download-artifact@v4
        with:
          name: Lumora-Titler-Setup-windows
          path: titler
"""
assert b in s
s = s.replace(b, b + """      - uses: actions/download-artifact@v4
        with:
          name: Lumora-Photo-Setup-windows
          path: photo
""")
c = """          publish titler Lumora-Titler-Setup.exe latest-titler.json "A new version of Lumora Titler."
"""
assert c in s
s = s.replace(c, c + """          publish photo Lumora-Photo-Setup.exe latest-photo.json "A new version of Lumora Photo."
""")
s = s.replace("""            out/Lumora-Titler-Setup.exe
""", """            out/Lumora-Titler-Setup.exe
            out/Lumora-Photo-Setup.exe
""")
d = """            Lumora Titler (motion graphics for Lumora and Studio): download Lumora-Titler-Setup.exe.
"""
assert d in s
s = s.replace(d, d + """            Lumora Photo (photo editing and design): download Lumora-Photo-Setup.exe.
""")
open(p, 'w').write(s)
print('ok')
