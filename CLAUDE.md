# CLAUDE.md — Lumora

**Read HANDOFF.md first.** It has the full history, current status and the
"WHERE EVERYTHING LIVES" map (repos, hosting, domain, database, services and
key names).

## What this project is

Lumora is a free family of production apps, all in this one repo
(`yehudakogan770/Livestreamingapp`):

| App | What it is | Code |
|---|---|---|
| **Lumora** | Windows live-production switcher/streamer, like vMix/OBS/Wirecast (multi-screen: main, stage monitor, back screen) | `app/src` (React/TS UI), `src-tauri` (crate `lumora`), `crates/*` |
| **Lumora Studio** | Pro video editor, like Premiere/Resolve (amber theme) | `editor/app/src`, `editor/src-tauri` (crate `lumora-edit`), `crates/studio-engine`, `crates/vst3-host` |
| **Lumora Titler** | Broadcast-graphics designer (web + desktop + inside Lumora/Studio) | `titler/`, `titler/src-tauri` (crate `lumora-titler`), `crates/titler-host` |
| **Lumora Photo** | Photoshop-class image editor (web + desktop) | `photo/`, `photo/src-tauri` (crate `lumora-photo`) |
| **Lumora Planner** | Web/PWA run-of-show planner with chat, calendar, show calling | `planner/` (built into `docs/planner`) |
| **Stream Deck plugin** | Elgato plugin for Lumora | `streamdeck/` |
| **Companion module** | Bitfocus Companion module | `companion/` |
| **Website** | lumoraproduction.com (GitHub Pages from `docs/`) | `docs/index.html`, `site.css`, `site.js` |
| Database | Supabase (accounts, approvals, Planner) | `supabase/*.sql` |

## How the owner wants things done (standing rules — follow all of them)

- **Every app must be the best on the market** in its category. Look at every
  competitor and cover all of their tools, plus more. Keep honest feature
  tables in `docs/COMPETITORS-*.md`.
- **Polished beats half-done.** Anything not ready is hidden, never shipped
  half-working. Make sure everything works; test it.
- **Never change anything the owner approved** (see `docs/APPROVED.md`): the
  Lumora sign-in screen, the "Meet Lumora." website design, Studio's amber
  theme, Lumora's neutral charcoal console (teal only for the
  controlled-screen marker, links and logo), the logos. When a change looked
  better to you, it still is not allowed — ask first.
- **Professional look, never an "AI look":** no glows, gradients, emoji or
  letter-spaced capitals in the interface chrome; not plain or "sci-fi/hacker".
  Model the look on pro tools (vMix etc.). Blue only where necessary, never on
  every button. No wasted space, no overlapping, no needless scrolling; all
  controls stay available (live events: no hunting through 100 buttons).
- **Wording:** American spelling only. No religious or school wording in
  examples or UI (Jewish tools such as Pesukim are hidden by default behind a
  Settings switch). Catchy taglines, never cheap or cringy. Don't advertise
  limits.
- **No-access message (exact):** "Your account isn't set up for Lumora Studio.
  Contact the Lumora team for help." — same pattern for Lumora, Lumora Photo.
- **Accounts:** one account for all apps; the owner approves each account and
  chooses which apps it can use (from the in-app owner controls). Planner
  teammates don't need an approved Lumora account.
- **Everything stays free** for users (stay on free tiers: Supabase free plan
  is kept awake by `.github/workflows/keep-awake.yml`).
- **Works offline** for the basic system; internet only for features that need it.
- **Owner communication:** give a **% progress** in every update. Don't ask
  questions unless it's a big decision — otherwise decide and keep building.
  Give simple, numbered step-by-step instructions for anything the owner must
  do. The owner has no phone (no authenticator-app 2FA). Mac build skipped for now.
- Text on screens always fades on and off; timers going into Next don't start
  until they go live, and at zero they show 0 then fade / go to Next.

## Security (never break these)

- **Never** put the Supabase service_role key, database password, access
  tokens, the updater signing private key, or any password in the apps, the
  repo (it is **public**), commits, or chat. Only the publishable key
  (`sb_publishable_…`) belongs in app code.
- Secrets live only in GitHub repo secrets (set by the owner):
  `TAURI_SIGNING_PRIVATE_KEY`, `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`,
  `LUMORA_YT_CLIENT_SECRET`. Never echo them.
- Backups of the database must be encrypted (public repo).

## Structure, tools and style

- Tauri 2 + React 18 + TypeScript (Vite) front ends; Rust workspace
  (`Cargo.toml` members) for the native side. Match the surrounding code's
  style, naming and comment density; comments are plain English.
- ts-rs: types in `crates/engine` export to `app/src/engine/types` — after
  `cargo test -p lumora-engine`, run prettier on that folder.
- `docs/planner`, `docs/titler`, `docs/photo` are **build outputs committed to
  git**; CI fails if they don't match the build. Rebuild with
  `npm run planner:build`, `npm run titler:build`, `npm run photo:build`
  and commit the output.
- Windows file names are case-insensitive: never have two files differing only
  by case (guarded by `app/src/fileNames.test.ts`).
- Database changes: a new numbered `supabase/update-N-*.sql` that is safe to
  re-run, also appended to `supabase/setup.sql`, with a test in
  `supabase/test/` (runs on plain PostgreSQL with `mock-auth.sql`). The owner
  runs update files by hand in the Supabase SQL Editor.

## Commands

```bash
npm ci                       # install
npm run typecheck            # tsc --noEmit
npm test                     # vitest run (all front ends)
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run check                # all of the above
npm run ui:dev | edit:ui:dev | planner:dev | titler:dev | photo:dev   # web dev servers
npm run dev | edit:dev | titler:app:dev | photo:app:dev               # desktop (Windows)
```

- Use `CARGO_INCREMENTAL=0` in the cloud container (disk is small); delete
  `target/debug/incremental` and old duplicates in `target/debug/deps` when
  the disk fills. Don't build release locally.
- Never `pkill -f`/`pgrep -f` with a pattern that also appears in your own
  command line (it kills your shell).
- Playwright: Chromium is preinstalled (`/opt/pw-browsers`); never run
  `playwright install`.

## Deploy

- **Develop on branch `claude/festive-curie-637ic2`** and push there. Every push
  runs `.github/workflows/ci.yml`: tests, then the Windows installers (Lumora,
  Studio, Titler, Photo, Stream Deck plugin), and publishes a GitHub Release
  `v0.1.<run number>` with `latest*.json` — the installed apps auto-update
  from it. **A push to this branch ships to users.**
- The website (GitHub Pages) is served from `docs/` on branch
  `claude/festive-curie-637ic2` (every Pages deploy runs from that branch), at
  https://lumoraproduction.com (`docs/CNAME`). Scheduled workflows
  (keep-awake, db-backup) only run from `main`, which holds just those two
  workflow files.
- Do not merge to `main` without the owner's OK.
