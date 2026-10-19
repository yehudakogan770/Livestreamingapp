# HANDOFF — Lumora (read this first)

This file lets a brand-new Claude session continue exactly where the previous
one stopped. Rules and commands are in `CLAUDE.md`; the owner's approved
designs are in `docs/APPROVED.md`.

Last updated: **2026-10-19**. Everything is pushed to
**`yehudakogan770/Livestreamingapp`**, branch **`claude/festive-curie-637ic2`**.

---

## 1. What the project is and its goal

The owner (GitHub `yehudakogan770`) is building **Lumora**, a free family of
production apps for live events. The goal, repeated many times: **every app
must be the best on the market in its category** — cover every tool the
competitors have, plus more, with a professional (never "AI-looking") design,
and everything must actually work. Everything stays free for users.

The apps:

1. **Lumora** — Windows live production (cameras, media, titles, timers,
   slideshows, stage monitor text, back screen, streaming and recording).
   Competes with vMix, OBS, Wirecast, ATEM Software Control, StreamYard/Restream.
2. **Lumora Studio** — professional video editor (Premiere Pro, DaVinci
   Resolve, Final Cut, CapCut, Descript).
3. **Lumora Titler** — broadcast-graphics designer (Vizrt, Ross XPression,
   Chyron, Singular.live, H2R Graphics, CasparCG/SPX, vMix GT, Loopic).
4. **Lumora Photo** — new Photoshop-class editor (Photoshop, Affinity Photo,
   Photopea, GIMP, Pixelmator, Krita, Lightroom). Owner said "make all the
   decisions yourself".
5. **Lumora Planner** — web/phone run-of-show planner with chat, calendar,
   show calling, crew lists (lumoraproduction.com/planner).
6. **Stream Deck plugin** and **Bitfocus Companion module** for Lumora.
7. **Audience tools** (phones join: polls, Q&A with votes, word cloud,
   ratings, reactions, trivia).
8. **Website** — https://lumoraproduction.com.

---

## 2. Current status (as of 2026-10-19)

**Overall: about 92% done.** Code is all pushed. CI run for commit `e56a9b5`
was in progress at handoff (the previous run failed only on Rust formatting,
fixed in `e56a9b5`; the full workspace clippy passes locally). Latest
published release seen: **v0.1.253**.

Competitor coverage (honest counts kept in `docs/COMPETITORS-*.md`):

| App | ✅ has it | ◐ partly | ❌ missing | Notes |
|---|---|---|---|---|
| Lumora (117 rows) | 109 | 7 | 1 | ❌ VST plug-ins in Lumora's live audio |
| Lumora Studio (78) | 70 | 6 | 2 | ❌ generative AI, client review links |
| Lumora Titler (43) | 38 | 3 | 2 | ❌ online template store, scoreboard hardware feeds |
| Lumora Photo (65) | 60 | 2 | 3 | score 61/65 vs Photoshop 61.5 |
| Planner | 49/53 | 2 | 2 | from the last count |
| Stream Deck | 23 | 0 | 1 | ❌ profiles that switch by themselves |
| Audience | 20/20 | 0 | 0 | |

### Finished in the last stretch (all pushed)
- **Planner**: chat rebuilt as a texting thread (bubbles, grouping, day
  dividers, pinned composer, "new messages" pill); calendar is a real
  calendar (month default, week/day time grids, agenda, phone layout,
  keyboard); professional polish pass. Screenshots in
  `handoff-files/session-work/final/`.
- **Titler**: big bug hunt (typing into new text, Escape in dialogs, shortcut
  clashes, data sources, layout), dockable panels, 3D camera, extrusion,
  component overrides, PSD import, on-canvas mask/path editing.
- **Studio**: magnetic timeline, RNNoise voice isolation, speaker detection,
  HDR (PQ/HLG) sequences and HDR10 export, node compositor page, VST3 plug-ins
  (separate helper process, crate `crates/vst3-host`), automatic B-roll.
- **Lumora / Deck / Audience**: "This computer's sound" (Windows loopback
  capture), recording copy to a second folder, Stream Deck input pictures and
  PTZ keys (plugin 1.2.0), Companion 0.3.0, audience Q&A votes + moderation,
  word cloud, ratings, reactions overlay, CSV export.
- **Lumora Photo** (new app, `photo/`): GPU compositor, 27 blend modes, layers/
  masks/styles/smart objects, adjustments, Camera Raw panel, brushes, healing,
  content-aware fill (PatchMatch), selections incl. classical Select Subject,
  filters, Liquify, PSD/TIFF/GIF/BMP/DNG/PNG/JPEG/WebP IO, docking UI,
  actions, templates, "send to Lumora/Titler/Studio", desktop crate
  `lumora-photo`, CI installer `Lumora-Photo-Setup.exe` + `latest-photo.json`,
  website section. 48 tests pass. It was being finished when the session hit
  its usage limit; its last step (competitor doc) is committed.
- **Domain**: lumoraproduction.com connected to GitHub Pages with HTTPS;
  app/site URLs switched to it.
- **Database update 10** got a schema reload and a new `my_planner_plans()`
  that returns `time_zone` and `end_by` (for the calendar).

### Still left / skipped (and why)
1. **Supabase project is unreachable** — on 2026-10-19 the address
   `vtlrrhctnwktnaxtdopz.supabase.co` stopped resolving (DNS "no such
   domain"); keep-awake last succeeded 2026-10-16. Owner must open
   supabase.com → the project → **Restore** if paused (or tell Claude if the
   project is gone). Nobody can sign in until then. **UNCONFIRMED cause.**
2. **Run `supabase/update-10-planner-pro.sql`** in the Supabase SQL Editor
   (whole file). A first attempt only partly applied (only
   `planner_sections` existed). Then verify via REST: the tables
   `planner_live`, `planner_items`, `planner_files`, `planner_versions`,
   `planner_notifications`, `planner_feeds` should answer 401/200, not 404.
3. **Supabase URL settings** for the new domain: Authentication → URL
   Configuration → Site URL `https://lumoraproduction.com/planner/`, add
   redirect `https://lumoraproduction.com/**`; and paste the 6 updated email
   templates from `supabase/email-templates/` (logo URL changed). Not
   confirmed done by the owner.
4. **GitHub Pages "Enforce HTTPS"** checkbox (Settings → Pages) — owner step,
   not confirmed.
5. **Northwest DNS**: apex has only 1 of 4 GitHub A records
   (185.199.110.153). Optional: add 185.199.108.153, .109.153, .111.153.
6. **Tests on a real Windows PC** (can't be done in the cloud): the test
   event (Standard + Unified engine), "This computer's sound", Studio VST3
   plug-in windows, Stream Deck key pictures on a real device.
7. **YouTube/Facebook sign-in for going live** needs the owner's Google OAuth
   client and Meta app (docs/LIVE_ACCOUNTS.md) → repo variables
   `LUMORA_YT_CLIENT_ID`, `LUMORA_YT_CLIENT_SECRET`, `LUMORA_FB_APP_ID`.
8. **Encrypted DB backup** workflow (`db-backup.yml` on `main`) is disabled:
   the `SUPABASE_DB_URL` secret failed password auth; owner chose to skip.
9. Known feature gaps (only if the owner asks): VST in Lumora live audio,
   Stream Deck auto profile switching, Lumora backstage guest chat /
   follower alerts / AI clips / per-output size / virtual camera, Mac
   version (owner: "skip the Mac build"), Photo Puppet/Perspective Warp
   (hidden), non-DNG raw formats, on-device ML Select Subject model,
   Titler OpenType stylistic sets, NDI/SDI out of the Titler, Studio
   ACES/Audio Units/track-level plug-ins.
10. Small known issue: in the Planner **dev server** the "From a template…"
    dialog closes instantly (React StrictMode double-run); production build is
    fine. Not fixed.
11. **Security follow-up for the owner**: earlier in the chat the owner pasted
    a Supabase personal access token (`sbp_…`) and the admin account password
    in plain text. They are **not** in the repo. Recommend revoking that token
    (supabase.com → Account → Access Tokens) and changing that password.

---

## 3. How it is built and structured

Monorepo, one git repo:

```
app/src/            Lumora UI (React/TS). App.tsx = window picker, ControlApp.tsx = control window
src-tauri/          Lumora desktop crate `lumora` (Rust): live.rs, accounts.rs, seats.rs, atem.rs, decklink.rs, encode.rs, control.rs, remote/ (audience pages)…
crates/engine       shared types (ts-rs → app/src/engine/types), titler.rs, drawing.rs, triggers.rs, persist.rs
crates/live-engine  "Unified" wgpu engine: zero-copy Media Foundation encoders, HDR, NDI, DeckLink, loopback audio
crates/live-accounts YouTube/Facebook OAuth (PKCE), YouTube resumable + Vimeo tus upload
crates/seats        multiple operators on one show (encrypted, ring)
crates/atem, decklink, titler-host, studio-engine, vst3-host, selftest, syscheck, testevent, crash
editor/             Lumora Studio (editor/app/src UI, editor/src-tauri crate `lumora-edit`)
titler/             Lumora Titler (web → docs/titler, desktop titler/src-tauri `lumora-titler`)
photo/              Lumora Photo (web → docs/photo, desktop photo/src-tauri `lumora-photo`)
planner/            Lumora Planner (→ docs/planner)
streamdeck/         Stream Deck plugin   companion/  Companion module
supabase/           setup.sql + update-1…10 + email-templates + tests
docs/               website (index.html, site.css, site.js), built web apps, project docs
e2e/                Windows end-to-end smoke tests (CI)
.github/workflows/  ci.yml (tests, installers, release), keep-awake.yml, db-backup.yml
```

Key docs: `docs/ARCHITECTURE.md`, `ENGINE.md`, `PERFORMANCE.md`, `API.md`
(control API), `FEATURES.md`, `LIVE_ACCOUNTS.md`, `security-checklist.md`,
`backup-restore.md`, `SPEC.md` (original spec), `COMPETITORS-*.md`.

## 4. Important decisions and why

- **Tauri 2 + React/TS + Rust** (not Electron, not a website): owner wanted a
  real PC app that works **offline**; Tauri is small and fast; Rust for the
  video engine.
- **Name "Lumora"** chosen by the owner from options (Stage Mix was too close
  to vMix). Editor renamed **"Lumora Studio"** (owner: "let's go with studio").
- **One repo for all apps** so CI builds and releases them together; the
  public GitHub Release is the download and auto-update source.
- **Public repo** so the website/downloads are free (GitHub Pages + Releases);
  therefore no secrets in the repo, and DB backups must be encrypted.
- **Supabase free plan** for accounts: owner approves every account and picks
  which apps each may use; sign-in behavior is controlled from the owner's
  in-app settings (update 9). Owner turned off two-step sign-in (no phone).
  A keep-awake workflow stops the free project from pausing.
- **Two engines in Lumora**: Standard (browser compositing) and **Unified**
  (wgpu GPU engine, one render shared by all outputs) — owner asked for the
  fastest possible engine ("do the full engine").
- **Multiple screens**: operator picks which screen they're controlling
  (main, stage monitor for text to performers, back screen); can mirror live
  to the back screen; failover lineup if a camera drops; blank screen on crash
  instead of a "panic" button.
- **Jewish/religious tools hidden by default** (owner: no religious wording);
  Pesukim feature exists behind a Settings switch.
- **Sign-in screen look, website design, Studio amber, neutral console,
  logos are frozen** (docs/APPROVED.md) after an accidental change upset the owner.
- **Lumora Photo decisions** (made by Claude per owner): separate app,
  same shape as the Titler (web + Windows desktop, own installer and
  updates), WebGL2 tiled compositor, `.lumphoto` zip format, PSD read/write,
  no cloud AI (pictures never uploaded), classical Select Subject until an
  on-device model is clearly better.
- Website contact form uses **web3forms** (public access key in
  `docs/site.js`; it only allows sending to the owner).

## 5. How to run, test and deploy

See `CLAUDE.md` → Commands and Deploy. In short: `npm ci`, `npm run check`.
Push to `claude/festive-curie-637ic2` → CI builds Windows installers and
publishes Release `v0.1.<run>` with `latest.json`, `latest-edit.json`,
`latest-titler.json`, `latest-photo.json`; installed apps auto-update. The
website deploys from `docs/` on the same branch. **Pushing ships to users;
merging to `main` does not change the site** (main only has the two scheduled
workflows) but don't merge without asking.

Database changes are applied by the owner by hand (Supabase → SQL Editor →
paste file → Run). Verify with REST using the publishable key:
`curl "$URL/rest/v1/<table>?select=*&limit=0" -H "apikey: <publishable key>"`
→ 200/401 means it exists, 404 means missing.

---

## 6. WHERE EVERYTHING LIVES

### GitHub
- **Repo:** `yehudakogan770/Livestreamingapp` (public), owner account
  `yehudakogan770`.
  - `claude/festive-curie-637ic2` — **all work; the branch that builds,
    releases and serves the website.**
  - `main` — default branch; only the initial commit plus
    `.github/workflows/keep-awake.yml` and `db-backup.yml` (scheduled jobs run
    only from the default branch).
- No other repos are involved (UNCONFIRMED: the owner never mentioned another).
- **GitHub Releases** of that repo = public downloads and the auto-update feed:
  `https://github.com/yehudakogan770/Livestreamingapp/releases/latest/download/{Lumora-Setup.exe, Lumora-Studio-Setup.exe, Lumora-Titler-Setup.exe, Lumora-Photo-Setup.exe, Lumora.streamDeckPlugin, latest.json, latest-edit.json, latest-titler.json, latest-photo.json}`
- **GitHub Actions**: `ci.yml` (every push), `keep-awake.yml` (every 3 days,
  on main), `db-backup.yml` (weekly, on main, currently **disabled**).
- **GitHub Pages**: serves `docs/` from `claude/festive-curie-637ic2`, custom
  domain via `docs/CNAME`.

### Live site and apps
- Website: **https://lumoraproduction.com** (old address
  `https://yehudakogan770.github.io/Livestreamingapp/` redirects there).
- Planner: https://lumoraproduction.com/planner/
- Titler (web): https://lumoraproduction.com/titler/
- Photo (web): https://lumoraproduction.com/photo/
- Privacy / terms: `/privacy.html`, `/terms.html`.
- Admin pages: there is no separate web admin. The **owner controls**
  (approving accounts, which apps each account gets, sign-in settings) are
  inside the Lumora desktop app, signed in as the first/team account.
  Database admin = Supabase dashboard.

### Domain
- **lumoraproduction.com**, registered and DNS-managed at **Northwest
  Registered Agent** (nameservers `ns1/ns2.hosting.businessidentity.llc`).
  Records: A `185.199.110.153` (only 1 of GitHub's 4), CNAME
  `www → yehudakogan770.github.io`. HTTPS certificate by GitHub (Let's Encrypt).

### Database and storage
- **Supabase** project ref `vtlrrhctnwktnaxtdopz`
  (URL `https://vtlrrhctnwktnaxtdopz.supabase.co`), free plan.
  Holds accounts/profiles/approvals, Studio team collaboration, problem
  reports, Planner (plans, cues, chat, lists, versions, live show state) and a
  private Storage bucket `planner-files`. Schema: `supabase/setup.sql` +
  updates 1–10. Updates 1–9 were run by the owner; **10 is pending** (see
  Status). **Unreachable on 2026-10-19 — check if paused.**
- Publishable key (safe, in app code): `sb_publishable_SW15wnTjCrTapvBZxXA5qg_E94To1FF`.
- The owner's Supabase login: the owner's own account (UNCONFIRMED which email).
- No Google Drive / Firebase / other storage is used.

### Outside services and what they're for
| Service | Used for | Account |
|---|---|---|
| GitHub (repo, Actions, Releases, Pages) | code, builds, downloads, updates, website | `yehudakogan770` |
| Supabase | sign-in, approvals, Planner data and files | owner's Supabase account |
| Northwest Registered Agent | domain lumoraproduction.com + DNS | owner's account |
| web3forms.com | website feedback/contact form (`docs/site.js`) | owner's email (UNCONFIRMED which) |
| Google Cloud (OAuth "Desktop app" client) | going live on YouTube, YouTube upload from Studio | owner — **not set up yet** |
| Meta for Developers (app ID) | going live on Facebook | owner — **not set up yet** |
| Vimeo | upload from Studio (user signs in with their own Vimeo token) | each user |
| Cloudflare quick tunnels (trycloudflare.com) | remote guest/audience links without port forwarding | none (anonymous) |
| VDO.Ninja | remote guest cameras option | none |
| Hugging Face | downloads Whisper caption models at runtime | none |
| Google storage (MediaPipe models) | background removal/face models at runtime | none |
| Sefaria | source of the built-in verse text (script `scripts/fetch_tanach.py`) | none |
| Google Fonts | fonts fetched by `scripts/fetch_fonts.py` (bundled) | none |
| Elgato Stream Deck / Bitfocus Companion | the plugin and module (distributed as files) | none |
| Microsoft (SmartScreen / Smart App Control) | installers are unsigned (no paid code-signing); owner asked Microsoft to clear Studio | owner |

### Environment variables / keys (names only — never commit values)
| Name | Where it's set | Value comes from |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | GitHub repo secret | the updater signing key made on 2026-10-01 (`lumora-updates.key`, minisign); its public key is in each `tauri.conf.json`. **Must not be lost**: installed apps only accept updates signed with it. |
| `SUPABASE_DB_URL` | GitHub repo secret | Supabase → Connect → Session pooler connection string (with DB password) — used by db-backup (failing auth) |
| `BACKUP_PASSPHRASE` | GitHub repo secret | chosen by the owner; encrypts backups |
| `LUMORA_YT_CLIENT_ID` | GitHub repo **variable** | Google Cloud OAuth client (not set yet) |
| `LUMORA_YT_CLIENT_SECRET` | repo variable or secret | same Google client (not set yet) |
| `LUMORA_FB_APP_ID` | GitHub repo variable | Meta app (not set yet) |
| `LUMORA_VERSION` | set by CI | `0.1.<run number>` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | CI (empty) | key has no password |
| Supabase publishable key + URL | in code (`app/src`, planner, etc.) | Supabase → API settings (public by design) |
| web3forms access key | in `docs/site.js` | web3forms (public by design) |

### Files outside the repo
- The updater **private** signing key `lumora-updates.key` existed only in
  the old cloud container (scratchpad `updater/`) and in the GitHub secret.
  It was **deliberately not committed**. If the owner didn't save a copy, the
  GitHub secret is the only copy (it can't be read back, but CI keeps
  working as long as the secret stays). UNCONFIRMED whether the owner kept a copy.
- The owner's original idea notes/pictures were pasted/imported at the very
  start of the chat (2026-09-23); they live in the chat, not as files. The
  structured result is `docs/SPEC.md`.
- Uploaded: `stage-visuals-project.zip` (copied to `handoff-files/uploads/`).
- Large generated test files not copied: see §8.

---

## 7. Detailed history of the conversation

**Sep 23 — design.** Owner imported notes/drawings for a live-event app (out
of order, with numbers that aren't final). Claude organized them into a spec.
Names were proposed; owner picked **Lumora**. Owner wanted it designed first
in Claude, then built as a real offline PC app. Corrections: parts about a
singer were from another program; the monitor shows text to people on stage;
the look must be professional like vMix (not sci-fi/hacker, no yellow
sliders, less crowded but keep every control); the operator selects which
screen they control; the clock is a hype countdown for the main screen.
Logo rounds (owner chose options 2/b, then 5) and a unique font. Bugs: the
T-bar fader, "add time" in the last 10 seconds, Take not fading. Owner asked
how to build it as a real app; Claude chose Tauri and wrote all the code,
step-by-step guidance; "make everything perfect", "add every feature",
"best out there".

**Sep 24–30 — building Lumora.** Built the real app (owner used WSL on
Windows). Features added on request: send live to the back screen, all three
screens open with basic controls each, more controls for important things,
no wasted space, stage-visuals loops imported from the owner's zip, imports go
to Preview not Live, timers wait in Next until live and fade at zero, blank
screen instead of panic, phone/audience features that work even without
shared Wi-Fi (Lumora makes its own way to connect), 300+ built-in fonts,
Pesukim (verses) with side-by-side translation, text always fading, a full
app test. Owner insisted it be the best on the market.

**Oct 1–2 — website, accounts, releases.** Website built, redesigned several
times ("plain/AI-looking", "like a newspaper" → went back to the earlier
"Meet Lumora." design, which is now approved), loading page centered,
feedback form with web3forms, GitHub Pages, public installer, in-app updates
(signed). Supabase set up for sign-in with owner approval; owner admin
account created. Owner asked how to keep code safe; repo stays public with no
secrets. Mac build skipped. Website wording: catchy but not cringy, no limits
listed.

**Oct 5–6 — Lumora Studio.** Owner wanted a full editor on the level of
Premiere/Resolve; built Lumora Edit → renamed **Lumora Studio** (amber look).
American spelling only. "Don't ask questions unless big", "always give a %".
Smart App Control blocked the Studio installer → guided owner to submit it to
Microsoft. Accounts: one account for both apps, owner chooses access, exact
no-access message. Added: system check on install, self-test that runs a full
fake event and streams to virtual screens with a detailed report, Stream Deck
plugin, Lumora Planner (teammates don't need approval, chat, calendar,
schedules, works as a phone app, no religious content, owner's logo
everywhere), camera failover lineup, sign-in settings controlled from the
app, second-device slideshow control, less blue ("blue only where
necessary"), the Unified GPU engine. Domain search → owner bought
**lumoraproduction.com**.

**Oct 7–9 — protect approved designs, engine phase 2, ops.** Owner: "stuff
I told you was good, leave it" (sign-in page restored; `docs/APPROVED.md`
created). Everything stays free. Supabase updates 9 run. Scheduled workflows
moved to `main` with permission (keep-awake works; backup skipped after DB
password auth failed). Added: two operators on one show (seats), ATEM,
DeckLink, live accounts (YouTube/Facebook/Vimeo), Titler as a full pro
designer, Planner pro features (update 10). Competitor research docs written
for every app; owner: look at every competitor and have all their tools
"doubled plus one". Domain at Northwest: guided the owner to get the GitHub
records added.

**Oct 9–11 — domain live, polish.** DNS worked → site moved to
lumoraproduction.com with HTTPS. Owner asked: Planner chat like texting,
calendar as a real calendar, very professional look everywhere, Studio and
Titler best on the market and the Titler working perfectly, "everything I
told you", and a **new Photoshop-class app** with Claude making all
decisions → Lumora Photo. Four parallel work streams ran and were merged
(Planner, Titler, Studio, Lumora/Deck/Audience); Photo was built across
usage-limit interruptions.

**Oct 19 — handoff.** Photo work merged and pushed; Rust formatting fix
pushed; Supabase found unreachable; owner is moving to a new Claude account
and asked for this handoff (CLAUDE.md, HANDOFF.md, handoff-files).

### Last thing being worked on
Lumora Photo final polish (its competitor doc was the last step) and getting
CI green on `e56a9b5`. Next steps for the new session:
1. Check CI on the latest commit of `claude/festive-curie-637ic2`; fix
   anything red (`gh api repos/yehudakogan770/Livestreamingapp/actions/runs?branch=claude/festive-curie-637ic2`).
2. Ask the owner whether Supabase was restored; then have them run update 10
   and verify the tables via REST.
3. Review Lumora Photo end to end in a browser (`npm run photo:dev`) and polish.
4. Continue closing the gaps in §2 "Still left", keeping the standing rules.

---

## 8. Files in `handoff-files/`

- `handoff-files/uploads/stage-visuals-project.zip` — the owner's uploaded
  stage-visuals loops project (Sep 28); its content was added to Lumora.
- `handoff-files/session-work/` — everything Claude made outside the repo
  during the chat (the old container's scratchpad), minus build outputs,
  `node_modules` and secrets. By folder:
  - `final/` — Planner chat/calendar/pages screenshots (desktop, tablet, phone, dark).
  - `before/`, `cur/`, `prev/`, `prod/`, `s1/`–`s6/`, `v3/`, `shots/`,
    `full/`, `ref/`, `site/`, `siteimg/`, `sicons/` — screenshots of app and
    website rounds (before/after comparisons, reference shots, site images, icons).
  - `pw/`, `smoke/`, `shot/`, `sd/`, `sd-build/`, `mjs/`, `*.cjs/*.js` at
    top level — Playwright screenshot/test scripts.
  - `py/`, `big/`, `real/`, `studio/`, `lumora/`, `pwa/`, `grade-a56/` and
    top-level `*.py` — one-off code-edit and checking scripts used while
    building (history only; the results are in the repo).
  - `render/`, `live/`, `svt/`, `vt/`, `pi/`, `artifact-files/` — HTML render
    tests and mockups.
  - `sq/` — copies of the SQL files used to test update 10 locally.
  - `dev/`, `gfonts/` — font files and CSS used for site/app font tests.
  - `demo2/`, `edit/` — short demo/test videos (webm/mp4) for Studio.
  - `photos/` — sample photos for tests.
  - `mt/`, `noblue/`, `plm/`, `ograf/`, `rnn/`, `rs/`, `qr/`, `dl/` —
    notes, logs and small experiments (motion tracking, the "less blue"
    sweep, Planner mark, OGraf notes, RNNoise notes, Rust experiments, QR,
    DeckLink IDL headers).
  - `updater/lumora-updates.key.pub` — the updater **public** key only.
  - `*.log`, `*.txt` — test and build logs.
  The complete file-by-file list is in the appendix below.

**Not copied** (too big, binaries, or secret):
- `lumora-updates.key` — updater **private** key (secret; see §6).
- `edit/wide.mkv` (18 MB) — generated test video.
- `*.tflite` MediaPipe models (selfie_multiclass 16 MB, selfie_segmenter,
  efficientdet_lite0, blaze_face, magic_touch) — public downloads from
  Google's MediaPipe model storage.
- `*.so`, `*.clap`, shellcheck binary, VST test plug-ins — downloaded tools.
- `perf/`, `lume/`, `dist*` (build outputs), `node_modules/`.
- A private notes file with the owner's chat messages (contains the pasted
  token/password).
No file over 100 MB exists.

---

## Appendix: every file in handoff-files

<details><summary>Show all files</summary>

```
     28K  handoff-files/session-work/BC.new
     32K  handoff-files/session-work/F.md
      8K  handoff-files/session-work/Gate.new
      4K  handoff-files/session-work/SG.new
     16K  handoff-files/session-work/a.flv
      4K  handoff-files/session-work/addg.js
      4K  handoff-files/session-work/addin.py
      4K  handoff-files/session-work/addin2.py
      4K  handoff-files/session-work/adj.js
      8K  handoff-files/session-work/al.py
      4K  handoff-files/session-work/al2.py
      4K  handoff-files/session-work/allview.js
      4K  handoff-files/session-work/allview2.js
      4K  handoff-files/session-work/american.js
      4K  handoff-files/session-work/anim.cjs
      4K  handoff-files/session-work/ap1.py
      4K  handoff-files/session-work/ap2.py
      4K  handoff-files/session-work/app.log
     36K  handoff-files/session-work/apt.log
      8K  handoff-files/session-work/args.rs
    184K  handoff-files/session-work/artifact-files/3909fe1c-75bd-44d9-acc8-0f46e4609ed3/artifact-type/dc-runtime.js
     36K  handoff-files/session-work/artifact-files/3909fe1c-75bd-44d9-acc8-0f46e4609ed3/index.html
     24K  handoff-files/session-work/artifact-files/3909fe1c-75bd-44d9-acc8-0f46e4609ed3/project/BackLoops.dc.html
     12K  handoff-files/session-work/artifact-files/3909fe1c-75bd-44d9-acc8-0f46e4609ed3/project/canvas.json
     16K  handoff-files/session-work/assets.mjs
      4K  handoff-files/session-work/auc.js
      4K  handoff-files/session-work/aucphone.js
      4K  handoff-files/session-work/aucrec.js
      4K  handoff-files/session-work/aud.js
    204K  handoff-files/session-work/audience.jpg
      4K  handoff-files/session-work/audio_patch.py
      8K  handoff-files/session-work/avtest.rs
      4K  handoff-files/session-work/back.js
      4K  handoff-files/session-work/bar.js
      8K  handoff-files/session-work/barcss.py
     12K  handoff-files/session-work/base.js
      8K  handoff-files/session-work/bc.patch
      4K  handoff-files/session-work/bc.py
      8K  handoff-files/session-work/bc1.txt
     96K  handoff-files/session-work/before/calendar-agenda-desktop.png
     96K  handoff-files/session-work/before/calendar-day-desktop.png
     96K  handoff-files/session-work/before/calendar-month-dark.png
     96K  handoff-files/session-work/before/calendar-month-desktop.png
    116K  handoff-files/session-work/before/calendar-phone.png
     84K  handoff-files/session-work/before/calendar-week-desktop.png
    172K  handoff-files/session-work/before/chat-dark.png
    172K  handoff-files/session-work/before/chat-desktop.png
    164K  handoff-files/session-work/before/chat-phone-dark.png
    160K  handoff-files/session-work/before/chat-phone.png
    136K  handoff-files/session-work/before/plan-desktop.png
    120K  handoff-files/session-work/before/plan-phone.png
    136K  handoff-files/session-work/before/plans-desktop.png
    140K  handoff-files/session-work/before/plans-phone.png
     12K  handoff-files/session-work/behave.sql
      4K  handoff-files/session-work/big/cap/encode.py
      8K  handoff-files/session-work/big/cap/fake-devices.js
      8K  handoff-files/session-work/big/cap/fake-devices.js.bak
      8K  handoff-files/session-work/big/cap/lumora.js
      8K  handoff-files/session-work/big/cap/lumora.js.bak
      4K  handoff-files/session-work/big/cap/og.html
      4K  handoff-files/session-work/big/cap/og.js
    132K  handoff-files/session-work/big/cap/out/hall.jpg
      4K  handoff-files/session-work/big/cap/studio.js
      4K  handoff-files/session-work/big/cap/vite-app.log
      4K  handoff-files/session-work/big/cap/vite-st.log
      4K  handoff-files/session-work/big/cap/vite.app.config.ts
      4K  handoff-files/session-work/big/cap/vite.st.config.ts
      4K  handoff-files/session-work/big/tonight.html
    632K  handoff-files/session-work/big/tonight.png
      4K  handoff-files/session-work/big/tools/find.py
      4K  handoff-files/session-work/big/tools/get.py
      4K  handoff-files/session-work/big/tools/grab.py
      4K  handoff-files/session-work/big/tools/grid.py
      4K  handoff-files/session-work/big/tools/hall.py
      8K  handoff-files/session-work/big/tools/make_media.py
      4K  handoff-files/session-work/big/tools/patch_cap.py
      4K  handoff-files/session-work/big/tools/peek.py
      4K  handoff-files/session-work/big/tools/photos.py
      4K  handoff-files/session-work/big/tools/prep.py
      4K  handoff-files/session-work/big/tools/sheet2.py
      4K  handoff-files/session-work/big/tools/sitecheck.js
      4K  handoff-files/session-work/big/tools/sticker.py
      4K  handoff-files/session-work/big/tools/thumbs.py
      4K  handoff-files/session-work/big/tools/tonight.js
      4K  handoff-files/session-work/blades.py
      4K  handoff-files/session-work/both.js
      4K  handoff-files/session-work/brand.js
      8K  handoff-files/session-work/brand.py
      4K  handoff-files/session-work/brand_images.py
     16K  handoff-files/session-work/browser.py
      4K  handoff-files/session-work/build_site.js
      8K  handoff-files/session-work/caltest.py
      4K  handoff-files/session-work/cams.js
      4K  handoff-files/session-work/cap.js
     12K  handoff-files/session-work/cap.patch
      4K  handoff-files/session-work/caps.py
      4K  handoff-files/session-work/captest.rs
      4K  handoff-files/session-work/cd.py
      4K  handoff-files/session-work/cd2.js
      4K  handoff-files/session-work/changed.txt
      8K  handoff-files/session-work/chat.css
      4K  handoff-files/session-work/chat.js
      4K  handoff-files/session-work/chattest.py
      4K  handoff-files/session-work/check.js
      4K  handoff-files/session-work/check.py
      4K  handoff-files/session-work/ci.py
      8K  handoff-files/session-work/ci_edit.py
      4K  handoff-files/session-work/client.patch
      4K  handoff-files/session-work/clippy-all.txt
      4K  handoff-files/session-work/clippy-photo.txt
      4K  handoff-files/session-work/clippy.log
      4K  handoff-files/session-work/clippy1.log
      4K  handoff-files/session-work/closecm.py
      4K  handoff-files/session-work/color.js
      4K  handoff-files/session-work/color_edit.py
      8K  handoff-files/session-work/comp.patch
      8K  handoff-files/session-work/comp_patch.py
      8K  handoff-files/session-work/competitors.py
      4K  handoff-files/session-work/cons.py
      4K  handoff-files/session-work/count.py
      4K  handoff-files/session-work/count2.py
      4K  handoff-files/session-work/cp.py
      4K  handoff-files/session-work/cr.js
     20K  handoff-files/session-work/css.diff
     12K  handoff-files/session-work/css1.py
     24K  handoff-files/session-work/css2.py
      4K  handoff-files/session-work/css3.py
      4K  handoff-files/session-work/css4.py
      4K  handoff-files/session-work/css5.py
      4K  handoff-files/session-work/ct.txt
      4K  handoff-files/session-work/ctx.js
    136K  handoff-files/session-work/cur/audio-1920x1040.png
    196K  handoff-files/session-work/cur/color-1920x1040.png
    196K  handoff-files/session-work/cur/edit-1920x1040.png
    184K  handoff-files/session-work/cur/export-1920x1040.png
     44K  handoff-files/session-work/cur/start-1920x1040.png
     64K  handoff-files/session-work/cur/start-recent-1920x1040.png
      4K  handoff-files/session-work/dat.js
      4K  handoff-files/session-work/dbg.js
      4K  handoff-files/session-work/dbg.mjs
     72K  handoff-files/session-work/dbg.png
      4K  handoff-files/session-work/dbg2.js
      4K  handoff-files/session-work/dbg3.js
     16K  handoff-files/session-work/deck.pdf
      4K  handoff-files/session-work/delay.js
    724K  handoff-files/session-work/demo2/close.webm
   1368K  handoff-files/session-work/demo2/hand.webm
   1908K  handoff-files/session-work/demo2/live.webm
   1304K  handoff-files/session-work/demo2/podium.webm
    704K  handoff-files/session-work/demo2/side.webm
    824K  handoff-files/session-work/demo2/wide.webm
      4K  handoff-files/session-work/dev/cssx.py
     12K  handoff-files/session-work/dev/dev.js
     12K  handoff-files/session-work/dev/devices.css
     16K  handoff-files/session-work/dev/gfonts/fonts.css
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iAq129k.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iEq129k.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iIq129k.woff2
     12K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1isq129k.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl1FgtIU.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgtIU.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl9FgtIU.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2
     12K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwlRFgtIU.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl1FgtIU.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgtIU.woff2
      8K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl9FgtIU.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2
     12K  handoff-files/session-work/dev/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwlRFgtIU.woff2
     32K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbABA.woff2
     16K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxRKYbABA.woff2
     24K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxTKYbABA.woff2
     32K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxaKYbABA.woff2
     20K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxdKYbABA.woff2
     48K  handoff-files/session-work/dev/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2
      8K  handoff-files/session-work/dialog.spec
     64K  handoff-files/session-work/dl/api.idl
     16K  handoff-files/session-work/dl/config.idl
     16K  handoff-files/session-work/dl/modes.idl
      8K  handoff-files/session-work/dl/types.idl
     12K  handoff-files/session-work/dlg.py
      4K  handoff-files/session-work/doc.py
      4K  handoff-files/session-work/doc1.py
     24K  handoff-files/session-work/doc1.txt
      4K  handoff-files/session-work/doc2.py
     12K  handoff-files/session-work/doc2.spec
      4K  handoff-files/session-work/doc3.spec
     12K  handoff-files/session-work/doc_phase2.md
      4K  handoff-files/session-work/doc_update.py
      4K  handoff-files/session-work/doc_update2.py
      4K  handoff-files/session-work/doc_update3.py
      4K  handoff-files/session-work/dom.cjs
      4K  handoff-files/session-work/dom.js
      4K  handoff-files/session-work/dr.py
      4K  handoff-files/session-work/dr2.py
      4K  handoff-files/session-work/dr3.py
      4K  handoff-files/session-work/drag.js
      4K  handoff-files/session-work/drawn_anim.py
      4K  handoff-files/session-work/drawn_ui.py
      4K  handoff-files/session-work/drawn_wire.py
      8K  handoff-files/session-work/e1.py
      4K  handoff-files/session-work/e10.py
      4K  handoff-files/session-work/e11.py
      4K  handoff-files/session-work/e12.py
      4K  handoff-files/session-work/e13.py
     12K  handoff-files/session-work/e14.py
      8K  handoff-files/session-work/e15.py
      4K  handoff-files/session-work/e16.py
      4K  handoff-files/session-work/e17.py
      4K  handoff-files/session-work/e18.py
      4K  handoff-files/session-work/e19.py
      4K  handoff-files/session-work/e2.py
     12K  handoff-files/session-work/e20.py
      4K  handoff-files/session-work/e21.py
      4K  handoff-files/session-work/e22.py
     12K  handoff-files/session-work/e23.py
      8K  handoff-files/session-work/e24.py
      4K  handoff-files/session-work/e25.py
      4K  handoff-files/session-work/e26.py
      4K  handoff-files/session-work/e27.py
      4K  handoff-files/session-work/e28.py
      8K  handoff-files/session-work/e29.py
      8K  handoff-files/session-work/e3.py
      8K  handoff-files/session-work/e30.py
      4K  handoff-files/session-work/e31.py
      8K  handoff-files/session-work/e32.py
      4K  handoff-files/session-work/e33.py
      4K  handoff-files/session-work/e34.py
      4K  handoff-files/session-work/e35.py
      4K  handoff-files/session-work/e36.py
      8K  handoff-files/session-work/e37.py
      4K  handoff-files/session-work/e38.py
     12K  handoff-files/session-work/e39.py
      4K  handoff-files/session-work/e4.py
      4K  handoff-files/session-work/e40.py
      8K  handoff-files/session-work/e41.py
     16K  handoff-files/session-work/e42.py
      8K  handoff-files/session-work/e43.py
      4K  handoff-files/session-work/e44.py
      4K  handoff-files/session-work/e45.py
      8K  handoff-files/session-work/e5.py
      4K  handoff-files/session-work/e6.py
      4K  handoff-files/session-work/e7.py
      4K  handoff-files/session-work/e8.py
      4K  handoff-files/session-work/e9.py
      8K  handoff-files/session-work/ed1.py
      4K  handoff-files/session-work/ed10.py
      8K  handoff-files/session-work/ed11.py
      4K  handoff-files/session-work/ed12.py
      4K  handoff-files/session-work/ed13.py
     16K  handoff-files/session-work/ed14.py
      4K  handoff-files/session-work/ed15.py
      4K  handoff-files/session-work/ed16.py
      8K  handoff-files/session-work/ed17.py
      4K  handoff-files/session-work/ed18.py
      8K  handoff-files/session-work/ed19.py
      8K  handoff-files/session-work/ed2.py
      4K  handoff-files/session-work/ed20.py
      4K  handoff-files/session-work/ed21.py
      4K  handoff-files/session-work/ed22.py
      4K  handoff-files/session-work/ed23.py
      4K  handoff-files/session-work/ed24.py
      4K  handoff-files/session-work/ed25.py
      4K  handoff-files/session-work/ed26.py
     12K  handoff-files/session-work/ed27.py
      4K  handoff-files/session-work/ed28.py
      4K  handoff-files/session-work/ed29.py
      4K  handoff-files/session-work/ed3.py
      8K  handoff-files/session-work/ed30.py
      4K  handoff-files/session-work/ed31.py
      8K  handoff-files/session-work/ed32.py
      8K  handoff-files/session-work/ed33.py
      4K  handoff-files/session-work/ed34.py
      4K  handoff-files/session-work/ed35.py
     12K  handoff-files/session-work/ed36.py
      8K  handoff-files/session-work/ed36rest.py
      4K  handoff-files/session-work/ed37.py
     12K  handoff-files/session-work/ed38.py
      8K  handoff-files/session-work/ed39.py
      4K  handoff-files/session-work/ed4.py
      4K  handoff-files/session-work/ed40.py
      4K  handoff-files/session-work/ed41.py
      4K  handoff-files/session-work/ed42.py
     12K  handoff-files/session-work/ed5.py
      8K  handoff-files/session-work/ed6.py
      4K  handoff-files/session-work/ed7.py
      8K  handoff-files/session-work/ed8.py
      8K  handoff-files/session-work/ed9.py
      8K  handoff-files/session-work/edhead.css
      4K  handoff-files/session-work/edit-icon.html
    632K  handoff-files/session-work/edit/close.webm
    208K  handoff-files/session-work/edit/podium.webm
    728K  handoff-files/session-work/edit/program.mp4
     88K  handoff-files/session-work/edit/strip.png
     44K  handoff-files/session-work/edit/title.png
      4K  handoff-files/session-work/edit_editor.py
      4K  handoff-files/session-work/edit_engine.py
      4K  handoff-files/session-work/edit_engine2.py
      8K  handoff-files/session-work/edit_formats.py
      4K  handoff-files/session-work/edit_frames.py
      8K  handoff-files/session-work/edit_hw2.py
      4K  handoff-files/session-work/edit_importer.py
      4K  handoff-files/session-work/edit_lib.py
      8K  handoff-files/session-work/edit_media.py
      4K  handoff-files/session-work/editlog.txt
     16K  handoff-files/session-work/elib.txt
      8K  handoff-files/session-work/emails.py
      8K  handoff-files/session-work/encoded.rs
     12K  handoff-files/session-work/eng.py
     12K  handoff-files/session-work/eng1.txt
      4K  handoff-files/session-work/eng2.py
      4K  handoff-files/session-work/eng2.txt
      4K  handoff-files/session-work/eng3.txt
      4K  handoff-files/session-work/eng4.txt
      4K  handoff-files/session-work/eng5.txt
      4K  handoff-files/session-work/eng_patch.py
      8K  handoff-files/session-work/engine1.spec
     12K  handoff-files/session-work/engine_doc_section.md
      4K  handoff-files/session-work/engtest.rs
      4K  handoff-files/session-work/er.txt
      4K  handoff-files/session-work/ertest.ts
      8K  handoff-files/session-work/ev.py
      4K  handoff-files/session-work/evs.js
      4K  handoff-files/session-work/evs2.js
      4K  handoff-files/session-work/exp_patch.py
      4K  handoff-files/session-work/expr_btn.py
      4K  handoff-files/session-work/expr_edit.py
      8K  handoff-files/session-work/expr_ui.py
      4K  handoff-files/session-work/fader.js
      4K  handoff-files/session-work/fake.sh
      4K  handoff-files/session-work/fav.js
      4K  handoff-files/session-work/fav.txt
      4K  handoff-files/session-work/fb.js
      8K  handoff-files/session-work/fb.py
      4K  handoff-files/session-work/fb2.py
      8K  handoff-files/session-work/fb3.py
      4K  handoff-files/session-work/fb4.py
      4K  handoff-files/session-work/fb5.py
      4K  handoff-files/session-work/fbtest.ts
      4K  handoff-files/session-work/feat.md
      4K  handoff-files/session-work/feat.py
      4K  handoff-files/session-work/features.py
     12K  handoff-files/session-work/feeds.spec
      4K  handoff-files/session-work/feeds1.txt
      4K  handoff-files/session-work/files.txt
     96K  handoff-files/session-work/final/account-phone.png
     96K  handoff-files/session-work/final/calendar-agenda-desktop.png
     84K  handoff-files/session-work/final/calendar-day-desktop.png
     88K  handoff-files/session-work/final/calendar-month-dark.png
     88K  handoff-files/session-work/final/calendar-month-desktop.png
    104K  handoff-files/session-work/final/calendar-phone-dark.png
    100K  handoff-files/session-work/final/calendar-phone.png
     92K  handoff-files/session-work/final/calendar-week-dark.png
     88K  handoff-files/session-work/final/calendar-week-desktop.png
    160K  handoff-files/session-work/final/chat-dark.png
    156K  handoff-files/session-work/final/chat-desktop.png
    140K  handoff-files/session-work/final/chat-phone-dark.png
    140K  handoff-files/session-work/final/chat-phone.png
    136K  handoff-files/session-work/final/chatx-long-phone.png
    160K  handoff-files/session-work/final/chatx-mention-desktop.png
    140K  handoff-files/session-work/final/chatx-picked-phone.png
    136K  handoff-files/session-work/final/chatx-scrolled-phone.png
     56K  handoff-files/session-work/final/compact-calendar.png
     92K  handoff-files/session-work/final/crew-desktop.png
    128K  handoff-files/session-work/final/empty-chat-desktop.png
     92K  handoff-files/session-work/final/files-desktop.png
    140K  handoff-files/session-work/final/newplan-desktop.png
    136K  handoff-files/session-work/final/plan-desktop.png
    120K  handoff-files/session-work/final/plan-phone.png
    136K  handoff-files/session-work/final/plans-desktop.png
    136K  handoff-files/session-work/final/plans-phone.png
    100K  handoff-files/session-work/final/schedule-desktop.png
     84K  handoff-files/session-work/final/schedule-phone.png
    168K  handoff-files/session-work/final/share-desktop.png
     76K  handoff-files/session-work/final/tablet-calendar.png
     92K  handoff-files/session-work/final/tasks-desktop.png
      4K  handoff-files/session-work/find66.js
      8K  handoff-files/session-work/finish.rs
      4K  handoff-files/session-work/finish_publish.py
      4K  handoff-files/session-work/fit.js
      4K  handoff-files/session-work/fix1.py
      4K  handoff-files/session-work/fix10.py
      4K  handoff-files/session-work/fix11.py
      4K  handoff-files/session-work/fix12.py
      4K  handoff-files/session-work/fix13.py
      4K  handoff-files/session-work/fix14.py
      4K  handoff-files/session-work/fix15.py
      8K  handoff-files/session-work/fix16.py
      8K  handoff-files/session-work/fix17.py
      8K  handoff-files/session-work/fix18.py
      4K  handoff-files/session-work/fix19.py
      4K  handoff-files/session-work/fix2.py
      8K  handoff-files/session-work/fix20.py
      4K  handoff-files/session-work/fix21.py
      4K  handoff-files/session-work/fix22.py
      4K  handoff-files/session-work/fix23.py
      8K  handoff-files/session-work/fix24.py
      4K  handoff-files/session-work/fix25.py
      8K  handoff-files/session-work/fix26.py
      8K  handoff-files/session-work/fix27.py
      4K  handoff-files/session-work/fix28.py
      8K  handoff-files/session-work/fix29.py
      4K  handoff-files/session-work/fix3.py
      4K  handoff-files/session-work/fix30.py
      8K  handoff-files/session-work/fix31.py
      8K  handoff-files/session-work/fix32.py
      4K  handoff-files/session-work/fix33.py
      4K  handoff-files/session-work/fix34.py
      4K  handoff-files/session-work/fix35.py
      4K  handoff-files/session-work/fix36.py
      4K  handoff-files/session-work/fix37.py
      4K  handoff-files/session-work/fix4.py
      8K  handoff-files/session-work/fix5.py
      4K  handoff-files/session-work/fix6.py
      4K  handoff-files/session-work/fix7.py
      4K  handoff-files/session-work/fix8.py
      8K  handoff-files/session-work/fix9.py
      4K  handoff-files/session-work/fix_tdz.py
     12K  handoff-files/session-work/fixtures.py
      4K  handoff-files/session-work/flow.cjs
      4K  handoff-files/session-work/flow2.cjs
      4K  handoff-files/session-work/flow3.cjs
     12K  handoff-files/session-work/flows.js
      4K  handoff-files/session-work/fmt.txt
      4K  handoff-files/session-work/follow.js
      4K  handoff-files/session-work/font_ui.py
      4K  handoff-files/session-work/fonts.js
     12K  handoff-files/session-work/fonts.py
     12K  handoff-files/session-work/fonts2.py
      4K  handoff-files/session-work/formats_add.ts
      4K  handoff-files/session-work/formats_edit.py
      8K  handoff-files/session-work/formats_ui.py
      4K  handoff-files/session-work/four.js
      4K  handoff-files/session-work/frame.spec
      8K  handoff-files/session-work/frame_patch.py
      8K  handoff-files/session-work/frames_ts.py
      4K  handoff-files/session-work/full.cjs
     84K  handoff-files/session-work/full/00-first-run.png
    180K  handoff-files/session-work/full/f-Audiencepoll.png
    124K  handoff-files/session-work/full/f-Microphone.png
    128K  handoff-files/session-work/full/f-Screencapture.png
    144K  handoff-files/session-work/full/f-Songlyrics.png
    132K  handoff-files/session-work/full/f-Webpage.png
    104K  handoff-files/session-work/full/f-end.png
    160K  handoff-files/session-work/full/flows-end.png
     96K  handoff-files/session-work/full/k-0-Camera.png
    136K  handoff-files/session-work/full/k-1-Videofile.png
    140K  handoff-files/session-work/full/k-10-Slideshow.png
    144K  handoff-files/session-work/full/k-11-StreamIPcamera.png
    148K  handoff-files/session-work/full/k-12-Raffle.png
    172K  handoff-files/session-work/full/k-13-Fundraiser.png
    156K  handoff-files/session-work/full/k-14-Designedtitle.png
    160K  handoff-files/session-work/full/k-15-Tablefinder.png
    168K  handoff-files/session-work/full/k-16-Triviagame.png
    180K  handoff-files/session-work/full/k-17-TanachTehillim.png
    184K  handoff-files/session-work/full/k-18-Hebrewdatezmanim.png
    188K  handoff-files/session-work/full/k-19-Liveauction.png
    156K  handoff-files/session-work/full/k-2-Picture.png
    168K  handoff-files/session-work/full/k-20-Messageswall.png
    156K  handoff-files/session-work/full/k-21-Guestbylink.png
    124K  handoff-files/session-work/full/k-22-Chatcomments.png
    136K  handoff-files/session-work/full/k-23-blocked.png
    128K  handoff-files/session-work/full/k-24-blocked.png
    124K  handoff-files/session-work/full/k-25-blocked.png
    124K  handoff-files/session-work/full/k-26-Scoreboard.png
    132K  handoff-files/session-work/full/k-27-blocked.png
    172K  handoff-files/session-work/full/k-29-Stagevisuals.png
    120K  handoff-files/session-work/full/k-3-Colour.png
    148K  handoff-files/session-work/full/k-30-blocked.png
    168K  handoff-files/session-work/full/k-31-Soundmusicfile.png
    104K  handoff-files/session-work/full/k-4-Testpattern.png
    176K  handoff-files/session-work/full/k-5-Countdown.png
    168K  handoff-files/session-work/full/k-6-12Pesukim.png
    140K  handoff-files/session-work/full/k-7-Texttitle.png
    136K  handoff-files/session-work/full/k-8-Creditsthankyou.png
    128K  handoff-files/session-work/full/k-9-Splitscreen.png
      8K  handoff-files/session-work/full/kinds.json
    108K  handoff-files/session-work/full/m-12Pesukim-0.png
     72K  handoff-files/session-work/full/m-Cues-0.png
     52K  handoff-files/session-work/full/m-Cues-1.png
     92K  handoff-files/session-work/full/m-Cues-2.png
     84K  handoff-files/session-work/full/m-Cues-3.png
     84K  handoff-files/session-work/full/m-Event-0.png
    184K  handoff-files/session-work/full/m-Event-1.png
     96K  handoff-files/session-work/full/m-Event-2.png
    180K  handoff-files/session-work/full/m-Help-0.png
    140K  handoff-files/session-work/full/m-Help-1.png
    120K  handoff-files/session-work/full/m-Inputs-0.png
    108K  handoff-files/session-work/full/m-Inputs-1.png
     60K  handoff-files/session-work/full/m-Library-0.png
    124K  handoff-files/session-work/full/m-Overlays-0.png
     92K  handoff-files/session-work/full/m-Overlays-1.png
     96K  handoff-files/session-work/full/m-Presets-0.png
     88K  handoff-files/session-work/full/m-Presets-1.png
     84K  handoff-files/session-work/full/m-Presets-2.png
    132K  handoff-files/session-work/full/m-Settings-0.png
    112K  handoff-files/session-work/full/m-Settings-1.png
    132K  handoff-files/session-work/full/m-Settings-2.png
    144K  handoff-files/session-work/full/m-Slideshow-0.png
    128K  handoff-files/session-work/full/m-Text-0.png
    132K  handoff-files/session-work/full/m-Text-1.png
    132K  handoff-files/session-work/full/m-Text-2.png
    136K  handoff-files/session-work/full/m-Text-3.png
     92K  handoff-files/session-work/full/m-Text-4.png
     96K  handoff-files/session-work/full/m-Text-5.png
    192K  handoff-files/session-work/full/m-Timer-0.png
    412K  handoff-files/session-work/full/m-Visuals-0.png
    108K  handoff-files/session-work/full/m-Visuals-1.png
    108K  handoff-files/session-work/full/m-Visuals-2.png
    108K  handoff-files/session-work/full/m-Visuals-3.png
      8K  handoff-files/session-work/full/menus.json
      8K  handoff-files/session-work/full/out-back.png
      8K  handoff-files/session-work/full/out-live.png
     20K  handoff-files/session-work/full/out-monitor.png
     12K  handoff-files/session-work/full/out-multiview.png
    152K  handoff-files/session-work/full/panic.png
    108K  handoff-files/session-work/full/preset-1.png
    160K  handoff-files/session-work/full/rec-1.png
     88K  handoff-files/session-work/full/rec-after.png
     88K  handoff-files/session-work/full/rec-stop.png
    180K  handoff-files/session-work/full/sheet1.png
     52K  handoff-files/session-work/full/sheet2.png
    120K  handoff-files/session-work/full/slides-air-sample.pdf.png
    120K  handoff-files/session-work/full/slides-air-sample.png.png
    140K  handoff-files/session-work/full/slides-sample.pdf.png
    152K  handoff-files/session-work/full/slides-sample.png.png
      4K  handoff-files/session-work/full1.js
      8K  handoff-files/session-work/full2.js
      4K  handoff-files/session-work/full3.js
      4K  handoff-files/session-work/fv.spec
      4K  handoff-files/session-work/fx.js
      8K  handoff-files/session-work/fx.ts
     16K  handoff-files/session-work/fx_edit.py
     40K  handoff-files/session-work/g.rs
      0K  handoff-files/session-work/g.test.ts
      4K  handoff-files/session-work/gate.js
      4K  handoff-files/session-work/gate.py
      4K  handoff-files/session-work/gatecss.py
      4K  handoff-files/session-work/gen.py
     16K  handoff-files/session-work/gfonts/fonts.css
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iAq129k.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iEq129k.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1iIq129k.woff2
     12K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F63fjptAgt5VM-kVkqdyU8n1isq129k.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl1FgtIU.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl5FgtIU.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwl9FgtIU.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2
     12K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3twJwlRFgtIU.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl1FgtIU.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl5FgtIU.woff2
      8K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwl9FgtIU.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2
     12K  handoff-files/session-work/gfonts/s_ibmplexmono_v20_-F6qfjptAgt5VM-kVkqdyU8n3vAOwlRFgtIU.woff2
     32K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxQKYbABA.woff2
     16K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxRKYbABA.woff2
     24K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxTKYbABA.woff2
     32K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxaKYbABA.woff2
     20K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxdKYbABA.woff2
     48K  handoff-files/session-work/gfonts/s_ibmplexsans_v23_zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2
      4K  handoff-files/session-work/gpgtest.sh
      8K  handoff-files/session-work/gpu1.spec
     16K  handoff-files/session-work/gpu1.txt
      8K  handoff-files/session-work/gpu2.spec
      4K  handoff-files/session-work/gpu3.spec
     12K  handoff-files/session-work/gpu4.spec
      4K  handoff-files/session-work/gpu5.spec
    212K  handoff-files/session-work/grade-a56/color-1.png
    140K  handoff-files/session-work/grade-a56/color-2.png
    220K  handoff-files/session-work/grade-a56/color-3.png
     24K  handoff-files/session-work/grade-a56/colorpanel.tsx
     24K  handoff-files/session-work/grade-a56/fixture.json
     20K  handoff-files/session-work/grade-a56/fixture.mjs
      4K  handoff-files/session-work/grade-a56/fixture.ts
      4K  handoff-files/session-work/grade-a56/glcheck.py
      4K  handoff-files/session-work/grade-a56/migcheck.py
     12K  handoff-files/session-work/grade-a56/migfix.json
     24K  handoff-files/session-work/grade-a56/migfix.mjs
      4K  handoff-files/session-work/grade-a56/migfix.ts
     36K  handoff-files/session-work/grade-a56/old_shaders.json
     24K  handoff-files/session-work/grade-a56/old_shaders.ts
      4K  handoff-files/session-work/grade-a56/powcheck.py
     48K  handoff-files/session-work/grade-a56/shaders.json
      4K  handoff-files/session-work/grade-a56/ui.js
      4K  handoff-files/session-work/grade-a56/vite.log
      8K  handoff-files/session-work/graph.ts
      4K  handoff-files/session-work/grc.js
      4K  handoff-files/session-work/gs.js
      4K  handoff-files/session-work/gs2.js
      4K  handoff-files/session-work/guest.js
     28K  handoff-files/session-work/hd2.bmp
      4K  handoff-files/session-work/hdr.js
      4K  handoff-files/session-work/head.md
      4K  handoff-files/session-work/heads.py
      8K  handoff-files/session-work/hebcal.ts
      4K  handoff-files/session-work/help.js
      4K  handoff-files/session-work/help.py
      4K  handoff-files/session-work/help2.py
    400K  handoff-files/session-work/hero.jpg
      4K  handoff-files/session-work/hero.js
      4K  handoff-files/session-work/hl.js
      4K  handoff-files/session-work/hook1.py
      4K  handoff-files/session-work/hook2.py
      4K  handoff-files/session-work/hook3.py
      4K  handoff-files/session-work/hook4.py
      8K  handoff-files/session-work/hook5.py
      4K  handoff-files/session-work/hook6.py
      4K  handoff-files/session-work/hook7.py
    140K  handoff-files/session-work/http.log
      4K  handoff-files/session-work/icon.cjs
      4K  handoff-files/session-work/icons_lib.py
      4K  handoff-files/session-work/inarea.py
      4K  handoff-files/session-work/inputs.py
      4K  handoff-files/session-work/insp_typo.py
      4K  handoff-files/session-work/inspect.mjs
      4K  handoff-files/session-work/join.js
      4K  handoff-files/session-work/jt.js
      4K  handoff-files/session-work/jump.js
      8K  handoff-files/session-work/key.bak
      8K  handoff-files/session-work/keys_ui.py
      4K  handoff-files/session-work/l3d.js
      4K  handoff-files/session-work/l3dz.js
      4K  handoff-files/session-work/lay.js
      4K  handoff-files/session-work/lib.js
      4K  handoff-files/session-work/lib.py
      4K  handoff-files/session-work/libtest.py
      4K  handoff-files/session-work/lit.js
      4K  handoff-files/session-work/live.spec
     20K  handoff-files/session-work/live/project/Brand.dc.html
     28K  handoff-files/session-work/live/project/LogoMaker.dc.html
     60K  handoff-files/session-work/live/project/LogoRound3.dc.html
    100K  handoff-files/session-work/live/project/Main.dc.html
     20K  handoff-files/session-work/live/project/Manual.dc.html
     28K  handoff-files/session-work/live/project/Pesukim.dc.html
     16K  handoff-files/session-work/live/project/PhoneRemote.dc.html
     24K  handoff-files/session-work/live/project/Scene.dc.html
     28K  handoff-files/session-work/live/project/TabletRemote.dc.html
     24K  handoff-files/session-work/live/project/Timer.dc.html
     24K  handoff-files/session-work/live/project/Website.dc.html
      8K  handoff-files/session-work/live/project/canvas.json
      8K  handoff-files/session-work/live1.txt
      8K  handoff-files/session-work/live2.spec
      4K  handoff-files/session-work/live2.txt
      8K  handoff-files/session-work/live3.txt
     16K  handoff-files/session-work/live_capture.rs
      4K  handoff-files/session-work/lm.js
      4K  handoff-files/session-work/lm2.js
      4K  handoff-files/session-work/logo.js
      4K  handoff-files/session-work/logo.svg
    268K  handoff-files/session-work/look-laptop.jpg
      4K  handoff-files/session-work/lum-harness.log
      4K  handoff-files/session-work/luma.js
      8K  handoff-files/session-work/lumora/STYLE.md
      4K  handoff-files/session-work/lumora/calm.py
      4K  handoff-files/session-work/lumora/files.json
     16K  handoff-files/session-work/lumora/logos.py
     16K  handoff-files/session-work/lumora/logos2.py
     16K  handoff-files/session-work/lumora/logos3.py
      4K  handoff-files/session-work/lumora/polish.css
     48K  handoff-files/session-work/lumora/project/AddInput.dc.html
     16K  handoff-files/session-work/lumora/project/AddPreset.dc.html
     44K  handoff-files/session-work/lumora/project/BackLoops.dc.html
     20K  handoff-files/session-work/lumora/project/Brand.dc.html
     24K  handoff-files/session-work/lumora/project/BrowserSource.dc.html
     24K  handoff-files/session-work/lumora/project/Credits.dc.html
     32K  handoff-files/session-work/lumora/project/Cues.dc.html
     12K  handoff-files/session-work/lumora/project/Devices.dc.html
     12K  handoff-files/session-work/lumora/project/EventEnd.dc.html
     24K  handoff-files/session-work/lumora/project/FontOptions.dc.html
     40K  handoff-files/session-work/lumora/project/FontRound2.dc.html
     16K  handoff-files/session-work/lumora/project/GoLive.dc.html
     36K  handoff-files/session-work/lumora/project/GreenScreen.dc.html
     40K  handoff-files/session-work/lumora/project/InputSettings.dc.html
     12K  handoff-files/session-work/lumora/project/Library.dc.html
     28K  handoff-files/session-work/lumora/project/LogoMaker.dc.html
     44K  handoff-files/session-work/lumora/project/LogoOptions.dc.html
     60K  handoff-files/session-work/lumora/project/LogoRound2.dc.html
     60K  handoff-files/session-work/lumora/project/LogoRound3.dc.html
    112K  handoff-files/session-work/lumora/project/Main.dc.html
     24K  handoff-files/session-work/lumora/project/Manual.dc.html
     20K  handoff-files/session-work/lumora/project/MonitorLayout.dc.html
     12K  handoff-files/session-work/lumora/project/MonitorOutput.dc.html
     36K  handoff-files/session-work/lumora/project/OverlayEditor.dc.html
     28K  handoff-files/session-work/lumora/project/Pesukim.dc.html
     12K  handoff-files/session-work/lumora/project/PhoneCamera.dc.html
     16K  handoff-files/session-work/lumora/project/PhoneRemote.dc.html
     24K  handoff-files/session-work/lumora/project/Scene.dc.html
     16K  handoff-files/session-work/lumora/project/Settings.dc.html
     32K  handoff-files/session-work/lumora/project/Slideshow.dc.html
     24K  handoff-files/session-work/lumora/project/SplitScreen.dc.html
     20K  handoff-files/session-work/lumora/project/StreamPage.dc.html
     28K  handoff-files/session-work/lumora/project/TabletRemote.dc.html
     44K  handoff-files/session-work/lumora/project/TextEditor.dc.html
     24K  handoff-files/session-work/lumora/project/Timer.dc.html
     24K  handoff-files/session-work/lumora/project/Website.dc.html
     12K  handoff-files/session-work/lumora/project/canvas.json
      8K  handoff-files/session-work/lumora/scenes.py
      8K  handoff-files/session-work/lumora/scenes2.py
      4K  handoff-files/session-work/lvl.mjs
      4K  handoff-files/session-work/main.js
      4K  handoff-files/session-work/main3.js
      4K  handoff-files/session-work/mainsv.js
      8K  handoff-files/session-work/mainsv.py
     12K  handoff-files/session-work/manifest.orig.json
      4K  handoff-files/session-work/mark_test.ts
      4K  handoff-files/session-work/measure.sh
      4K  handoff-files/session-work/melt.mjs
      4K  handoff-files/session-work/menu.js
      4K  handoff-files/session-work/merge.py
      0K  handoff-files/session-work/meta.err
      4K  handoff-files/session-work/mf.spec
      4K  handoff-files/session-work/mic.js
      4K  handoff-files/session-work/mix.js
      8K  handoff-files/session-work/mixcss.py
      4K  handoff-files/session-work/mixer.py
      8K  handoff-files/session-work/mixer_auto.py
      8K  handoff-files/session-work/mjs/moonshine.js
     12K  handoff-files/session-work/mjs/whisper.js
      4K  handoff-files/session-work/mkpdf.js
      4K  handoff-files/session-work/mkpsd.py
    376K  handoff-files/session-work/mlk.flac
      4K  handoff-files/session-work/mock-auth.sql
      8K  handoff-files/session-work/mock-slides.mjs
      4K  handoff-files/session-work/mock.sql
      4K  handoff-files/session-work/modal.py
      4K  handoff-files/session-work/montage.py
      4K  handoff-files/session-work/mpp.sql
      4K  handoff-files/session-work/msg.txt
      4K  handoff-files/session-work/mt/clippy.log
      4K  handoff-files/session-work/mt/config.json
      4K  handoff-files/session-work/mt/ed1.py
      8K  handoff-files/session-work/mt/marian.mts
      4K  handoff-files/session-work/mt/run.mjs
     28K  handoff-files/session-work/mt/test.log
   5372K  handoff-files/session-work/mt/tokenizer.json
      4K  handoff-files/session-work/mv.js
      4K  handoff-files/session-work/mv.py
      4K  handoff-files/session-work/mv1.txt
      4K  handoff-files/session-work/mv2.py
      4K  handoff-files/session-work/mvl.txt
      4K  handoff-files/session-work/mz.bin
      4K  handoff-files/session-work/neutral.py
     84K  handoff-files/session-work/new.rs
      4K  handoff-files/session-work/noblue/cf.txt
      4K  handoff-files/session-work/noblue/changed.txt
      4K  handoff-files/session-work/noblue/chrome-files.txt
      8K  handoff-files/session-work/noblue/css-now.txt
     20K  handoff-files/session-work/noblue/css-scan.txt
      4K  handoff-files/session-work/noblue/cssfiles.txt
      4K  handoff-files/session-work/noblue/fmt.txt
      4K  handoff-files/session-work/noblue/mock-remote.mjs
      4K  handoff-files/session-work/noblue/scan.py
      4K  handoff-files/session-work/noblue/sd.txt
      8K  handoff-files/session-work/noblue/shoot.cjs
     20K  handoff-files/session-work/noblue/show.json
     20K  handoff-files/session-work/noblue/ts-now.txt
     20K  handoff-files/session-work/noblue/ts-scan.txt
     16K  handoff-files/session-work/noblue/ts.txt
     16K  handoff-files/session-work/noblue/tsfiles.txt
      4K  handoff-files/session-work/noblue/v1.log
      4K  handoff-files/session-work/noblue/v2.log
      4K  handoff-files/session-work/noblue/vite.auth.mjs
      4K  handoff-files/session-work/noblue/vite.config.mjs
      4K  handoff-files/session-work/noblue/vite.me.mjs
      4K  handoff-files/session-work/noblue/vite.meauth.mjs
      4K  handoff-files/session-work/notes.spec
      8K  handoff-files/session-work/notes_edit.py
      4K  handoff-files/session-work/notes_edit2.py
     36K  handoff-files/session-work/ograf/spec.md
     76K  handoff-files/session-work/old-setup.sql
     32K  handoff-files/session-work/old-tl.webp
      4K  handoff-files/session-work/old.cjs
      4K  handoff-files/session-work/old.txt
      8K  handoff-files/session-work/old3.sql
      8K  handoff-files/session-work/oldcal.css
      0K  handoff-files/session-work/olddeps.txt
     76K  handoff-files/session-work/oldsetup.sql
     12K  handoff-files/session-work/open.rs
     68K  handoff-files/session-work/orig-setup.sql
     16K  handoff-files/session-work/ours.js
   3904K  handoff-files/session-work/out-a.flv
   3904K  handoff-files/session-work/out-b.flv
      4K  handoff-files/session-work/ov.js
      4K  handoff-files/session-work/ovbar.py
     12K  handoff-files/session-work/ovr.txt
      8K  handoff-files/session-work/ovrtest.ts
      4K  handoff-files/session-work/ovrtest2.ts
      4K  handoff-files/session-work/p.py
      4K  handoff-files/session-work/p_app.py
     16K  handoff-files/session-work/p_control.py
      4K  handoff-files/session-work/p_lib.py
      4K  handoff-files/session-work/p_remote.py
      4K  handoff-files/session-work/package-lock.json
      4K  handoff-files/session-work/package.json
      4K  handoff-files/session-work/pass1.py
      4K  handoff-files/session-work/pass10.py
      4K  handoff-files/session-work/pass11.py
      4K  handoff-files/session-work/pass12.py
      4K  handoff-files/session-work/pass2.py
      8K  handoff-files/session-work/pass3.py
      8K  handoff-files/session-work/pass4.py
      4K  handoff-files/session-work/pass5.py
      4K  handoff-files/session-work/pass6.py
      4K  handoff-files/session-work/pass7.py
      4K  handoff-files/session-work/pass8.py
      4K  handoff-files/session-work/pass9.py
      4K  handoff-files/session-work/patch_chat.py
      4K  handoff-files/session-work/patch_client.py
      4K  handoff-files/session-work/patch_comp.py
      4K  handoff-files/session-work/patch_control.py
     12K  handoff-files/session-work/patch_docs.py
      8K  handoff-files/session-work/patch_remote_react.py
      8K  handoff-files/session-work/patch_vote_react.py
      4K  handoff-files/session-work/pbar.js
      4K  handoff-files/session-work/pcard.js
      4K  handoff-files/session-work/pcm.js
      8K  handoff-files/session-work/pd.diff
      4K  handoff-files/session-work/peek.js
      4K  handoff-files/session-work/perf.py
      4K  handoff-files/session-work/pes.js
      4K  handoff-files/session-work/pesrec.js
      4K  handoff-files/session-work/pesui.js
      4K  handoff-files/session-work/pgstart.sh
      4K  handoff-files/session-work/pgstop.sh
      4K  handoff-files/session-work/phone-pes.js
      4K  handoff-files/session-work/phone.js
      8K  handoff-files/session-work/photos/0O0gux4OZX4.jpg
      8K  handoff-files/session-work/photos/5MUw_NHo5i4.jpg
      8K  handoff-files/session-work/photos/63Md7MbwXPg.jpg
      8K  handoff-files/session-work/photos/DqmXihYx5UE.jpg
      8K  handoff-files/session-work/photos/Dy6a8sLrVl4.jpg
      8K  handoff-files/session-work/photos/I-nd-LSCY04.jpg
      8K  handoff-files/session-work/photos/b5V2bZ8USO0.jpg
      8K  handoff-files/session-work/photos/qJgW5ewKCO8.jpg
      4K  handoff-files/session-work/pi/inspector.css
      4K  handoff-files/session-work/pi/inspector.html
     12K  handoff-files/session-work/pi/inspector.js
     28K  handoff-files/session-work/pi/pi.png
      4K  handoff-files/session-work/pk2.js
      4K  handoff-files/session-work/plain.js
      4K  handoff-files/session-work/planes1.txt
      4K  handoff-files/session-work/planestest.ts
     16K  handoff-files/session-work/plm/add.css
      4K  handoff-files/session-work/plm/h/vite.harness.mjs
      4K  handoff-files/session-work/plm/icon-maskable.svg
      4K  handoff-files/session-work/plm/icon-square.svg
      4K  handoff-files/session-work/plm/icons.mjs
      8K  handoff-files/session-work/plm/mock/api.ts
      4K  handoff-files/session-work/plm/mock/session.ts
     12K  handoff-files/session-work/plm/shots.mjs
      4K  handoff-files/session-work/poll.js
      8K  handoff-files/session-work/poll.ts.txt
      4K  handoff-files/session-work/pop_fix.py
      4K  handoff-files/session-work/pr.js
      4K  handoff-files/session-work/pre.js
      4K  handoff-files/session-work/present.spec
      8K  handoff-files/session-work/presets.py
      4K  handoff-files/session-work/pretty.py
     12K  handoff-files/session-work/prev/nsis.png
      4K  handoff-files/session-work/prev/sd-category.png
      8K  handoff-files/session-work/prev/sd-icon.png
      4K  handoff-files/session-work/prob.js
      4K  handoff-files/session-work/prob.py
      4K  handoff-files/session-work/probe.cjs
      4K  handoff-files/session-work/probe.mjs
     88K  handoff-files/session-work/prod/calendar-month-desktop.png
    140K  handoff-files/session-work/prod/chat-phone-dark.png
    140K  handoff-files/session-work/prod/chat-phone.png
    140K  handoff-files/session-work/prod/newplan-desktop.png
      4K  handoff-files/session-work/prog.txt
      4K  handoff-files/session-work/pshot.sh
      4K  handoff-files/session-work/psound.js
      4K  handoff-files/session-work/ptz.js
      4K  handoff-files/session-work/pw.cjs
      4K  handoff-files/session-work/pw/all.cjs
      4K  handoff-files/session-work/pw/lib.cjs
      4K  handoff-files/session-work/pw/package-lock.json
      4K  handoff-files/session-work/pw/package.json
      4K  handoff-files/session-work/pw/s1.cjs
      4K  handoff-files/session-work/pw/s10.cjs
      4K  handoff-files/session-work/pw/s11.cjs
      4K  handoff-files/session-work/pw/s12.cjs
      4K  handoff-files/session-work/pw/s13.cjs
      4K  handoff-files/session-work/pw/s14.cjs
      4K  handoff-files/session-work/pw/s15.cjs
      4K  handoff-files/session-work/pw/s16.cjs
      4K  handoff-files/session-work/pw/s2.cjs
      4K  handoff-files/session-work/pw/s3.cjs
      4K  handoff-files/session-work/pw/s4.cjs
      4K  handoff-files/session-work/pw/s5.cjs
      4K  handoff-files/session-work/pw/s6.cjs
      4K  handoff-files/session-work/pw/s7.cjs
      4K  handoff-files/session-work/pw/s8.cjs
      4K  handoff-files/session-work/pw/s9.cjs
     16K  handoff-files/session-work/pw/shoot.cjs
      4K  handoff-files/session-work/pw/shot.js
      4K  handoff-files/session-work/pw2.cjs
     12K  handoff-files/session-work/pwa/app_edit.py
      4K  handoff-files/session-work/pwa/idx.py
      4K  handoff-files/session-work/pwa/installable.js
      8K  handoff-files/session-work/pwa/links.txt
      4K  handoff-files/session-work/pwa/list.py
    144K  handoff-files/session-work/pwa/m-phone-list.png
    140K  handoff-files/session-work/pwa/m-phone-plan.png
    164K  handoff-files/session-work/pwa/m-plan.png
      4K  handoff-files/session-work/pwa/opt.py
      4K  handoff-files/session-work/pwa/serve.js
      4K  handoff-files/session-work/pwa/sess.py
      4K  handoff-files/session-work/pwa/splash.js
     16K  handoff-files/session-work/pwa/test.js
     12K  handoff-files/session-work/py/app1.py
      8K  handoff-files/session-work/py/comp.py
      4K  handoff-files/session-work/py/count.py
      8K  handoff-files/session-work/py/insp.py
      8K  handoff-files/session-work/py/lum.py
     16K  handoff-files/session-work/py/m1.py
      4K  handoff-files/session-work/py/off.py
      8K  handoff-files/session-work/py/ph1.py
      4K  handoff-files/session-work/py/pl1.py
     12K  handoff-files/session-work/py/pv1.py
     12K  handoff-files/session-work/py/pv2.py
      8K  handoff-files/session-work/py/pv3.py
      4K  handoff-files/session-work/py/pv4.py
      8K  handoff-files/session-work/py/pv5.py
      4K  handoff-files/session-work/py/pv6.py
      4K  handoff-files/session-work/py/rep.py
      4K  handoff-files/session-work/py/sd1.py
      8K  handoff-files/session-work/py/sd2.py
      4K  handoff-files/session-work/py/sd3.py
      4K  handoff-files/session-work/py/sd4.py
      4K  handoff-files/session-work/py/sd5.py
      4K  handoff-files/session-work/py/sd6.py
      4K  handoff-files/session-work/py/setup_append.py
      4K  handoff-files/session-work/py/sv1.py
      4K  handoff-files/session-work/py/t1.py
      4K  handoff-files/session-work/qna.js
      4K  handoff-files/session-work/qp.js
      0K  handoff-files/session-work/qr.err
      4K  handoff-files/session-work/qr.py
      4K  handoff-files/session-work/qr/Cargo.lock
      4K  handoff-files/session-work/qr/Cargo.toml
      4K  handoff-files/session-work/qr/src/main.rs
      8K  handoff-files/session-work/questions.tsx.txt
      8K  handoff-files/session-work/r.html
      4K  handoff-files/session-work/r.mjs
     12K  handoff-files/session-work/r.mp4
    208K  handoff-files/session-work/r1.jpg
     12K  handoff-files/session-work/r3.mp4
      4K  handoff-files/session-work/r404.js
      4K  handoff-files/session-work/raf.js
     84K  handoff-files/session-work/real/_f.png
      4K  handoff-files/session-work/real/dl.sh
      4K  handoff-files/session-work/real/dlhd.py
      4K  handoff-files/session-work/real/encode.py
      4K  handoff-files/session-work/real/encode_all.py
      8K  handoff-files/session-work/real/fake-devices.js
      4K  handoff-files/session-work/real/frames.py
      4K  handoff-files/session-work/real/hall.py
      4K  handoff-files/session-work/real/head.js
      8K  handoff-files/session-work/real/lumora.js
     52K  handoff-files/session-work/real/media/podium-still.jpg
    100K  handoff-files/session-work/real/media/slides.png
      4K  handoff-files/session-work/real/og.html
      4K  handoff-files/session-work/real/og.js
    452K  handoff-files/session-work/real/out/crop.png
    112K  handoff-files/session-work/real/out/hall.jpg
     68K  handoff-files/session-work/real/out/live-check.jpg
    564K  handoff-files/session-work/real/out/look.png
    736K  handoff-files/session-work/real/out/main-good.png
    736K  handoff-files/session-work/real/out/main.png
    408K  handoff-files/session-work/real/out/manual.png
    360K  handoff-files/session-work/real/out/og.png
    800K  handoff-files/session-work/real/out/probe.png
    544K  handoff-files/session-work/real/out/s-audio.png
    724K  handoff-files/session-work/real/out/s-color.png
    580K  handoff-files/session-work/real/out/s-edit.png
      4K  handoff-files/session-work/real/patch_l.py
      4K  handoff-files/session-work/real/patch_m.py
      4K  handoff-files/session-work/real/patch_site.py
      4K  handoff-files/session-work/real/previews.py
      4K  handoff-files/session-work/real/probe.py
      4K  handoff-files/session-work/real/sheet.py
     16K  handoff-files/session-work/real/site.new.js
      4K  handoff-files/session-work/real/site_media.py
      4K  handoff-files/session-work/real/site_webm.py
      4K  handoff-files/session-work/real/sitecheck.js
      4K  handoff-files/session-work/real/slide.html
      4K  handoff-files/session-work/real/slide.js
      4K  handoff-files/session-work/real/studio.js
      8K  handoff-files/session-work/real/studio_media.py
      4K  handoff-files/session-work/real/towebm.py
      4K  handoff-files/session-work/real/vite-app.log
      4K  handoff-files/session-work/real/vite-st.log
      4K  handoff-files/session-work/real/vite.app.config.ts
      4K  handoff-files/session-work/real/vite.st.config.ts
     12K  handoff-files/session-work/rec.bak
      4K  handoff-files/session-work/rec.js
      4K  handoff-files/session-work/rec2.js
      4K  handoff-files/session-work/rec3.js
      4K  handoff-files/session-work/ref.js
    712K  handoff-files/session-work/ref/ecamm-0.png
     80K  handoff-files/session-work/ref/ecamm-1.png
    392K  handoff-files/session-work/ref/ecamm-2.png
     96K  handoff-files/session-work/ref/ecamm-3.png
    584K  handoff-files/session-work/ref/ecamm.png
     20K  handoff-files/session-work/ref/propresenter-0.png
     40K  handoff-files/session-work/ref/propresenter-1.png
     16K  handoff-files/session-work/ref/propresenter-2.png
    240K  handoff-files/session-work/ref/propresenter-3.png
    172K  handoff-files/session-work/ref/propresenter.png
     84K  handoff-files/session-work/ref/restream-0.png
    104K  handoff-files/session-work/ref/restream-1.png
    104K  handoff-files/session-work/ref/restream-2.png
    104K  handoff-files/session-work/ref/restream-3.png
    160K  handoff-files/session-work/ref/restream.png
     12K  handoff-files/session-work/ref/riverside-0.png
    472K  handoff-files/session-work/ref/riverside-1.png
     44K  handoff-files/session-work/ref/riverside-2.png
     72K  handoff-files/session-work/ref/riverside-3.png
    356K  handoff-files/session-work/ref/riverside.png
    272K  handoff-files/session-work/ref/streamyard-0.png
    276K  handoff-files/session-work/ref/streamyard-1.png
    124K  handoff-files/session-work/ref/streamyard-2.png
    124K  handoff-files/session-work/ref/streamyard-3.png
    292K  handoff-files/session-work/ref/streamyard.png
    104K  handoff-files/session-work/ref/vmix-0.png
    268K  handoff-files/session-work/ref/vmix-1.png
    224K  handoff-files/session-work/ref/vmix-2.png
    100K  handoff-files/session-work/ref/vmix-3.png
    424K  handoff-files/session-work/ref/vmix.png
      4K  handoff-files/session-work/remote.patch
      8K  handoff-files/session-work/remote.py
      4K  handoff-files/session-work/remote2.py
      4K  handoff-files/session-work/rend.js
     48K  handoff-files/session-work/render/AddInput.dc.html
     16K  handoff-files/session-work/render/AddPreset.dc.html
     44K  handoff-files/session-work/render/BackLoops.dc.html
     20K  handoff-files/session-work/render/Brand.dc.html
     24K  handoff-files/session-work/render/BrowserSource.dc.html
     24K  handoff-files/session-work/render/Credits.dc.html
     32K  handoff-files/session-work/render/Cues.dc.html
     12K  handoff-files/session-work/render/Devices.dc.html
     12K  handoff-files/session-work/render/EventEnd.dc.html
     24K  handoff-files/session-work/render/FontOptions.dc.html
     40K  handoff-files/session-work/render/FontRound2.dc.html
     24K  handoff-files/session-work/render/FontTest.dc.html
     40K  handoff-files/session-work/render/FontTest2.dc.html
     16K  handoff-files/session-work/render/GoLive.dc.html
     36K  handoff-files/session-work/render/GreenScreen.dc.html
     40K  handoff-files/session-work/render/InputSettings.dc.html
     12K  handoff-files/session-work/render/Library.dc.html
     28K  handoff-files/session-work/render/LogoMaker.dc.html
     44K  handoff-files/session-work/render/LogoOptions.dc.html
     60K  handoff-files/session-work/render/LogoRound2.dc.html
     60K  handoff-files/session-work/render/LogoRound3.dc.html
    112K  handoff-files/session-work/render/Main.dc.html
     24K  handoff-files/session-work/render/Manual.dc.html
     20K  handoff-files/session-work/render/MonitorLayout.dc.html
     12K  handoff-files/session-work/render/MonitorOutput.dc.html
     36K  handoff-files/session-work/render/OverlayEditor.dc.html
     28K  handoff-files/session-work/render/Pesukim.dc.html
     12K  handoff-files/session-work/render/PhoneCamera.dc.html
     16K  handoff-files/session-work/render/PhoneRemote.dc.html
     24K  handoff-files/session-work/render/Scene.dc.html
     16K  handoff-files/session-work/render/Settings.dc.html
     32K  handoff-files/session-work/render/Slideshow.dc.html
     24K  handoff-files/session-work/render/SplitScreen.dc.html
     20K  handoff-files/session-work/render/StreamPage.dc.html
     28K  handoff-files/session-work/render/TR_old.dc.html
     28K  handoff-files/session-work/render/TabletRemote.dc.html
     44K  handoff-files/session-work/render/TextEditor.dc.html
     24K  handoff-files/session-work/render/Timer.dc.html
     24K  handoff-files/session-work/render/Website.dc.html
      8K  handoff-files/session-work/render/blades.html
     24K  handoff-files/session-work/render/gf/119499074936374206.woff2
     16K  handoff-files/session-work/render/gf/1631124403877560148.woff2
     12K  handoff-files/session-work/render/gf/2607041564230303830.woff2
     20K  handoff-files/session-work/render/gf/2796866647478001556.woff2
     16K  handoff-files/session-work/render/gf/3499628028568211577.woff2
     16K  handoff-files/session-work/render/gf/4110801811493177791.woff2
     20K  handoff-files/session-work/render/gf/4370684454892000222.woff2
     16K  handoff-files/session-work/render/gf/5353420851524355584.woff2
     16K  handoff-files/session-work/render/gf/6106061176712773495.woff2
     16K  handoff-files/session-work/render/gf/6247825187195062877.woff2
     16K  handoff-files/session-work/render/gf/7662894558909725578.woff2
     40K  handoff-files/session-work/render/gf/986897069628928222.woff2
      4K  handoff-files/session-work/render/gf/local.css
      4K  handoff-files/session-work/render/gf/local2.css
      8K  handoff-files/session-work/render/gf/raw.css
    120K  handoff-files/session-work/render/gf/raw2.css
      4K  handoff-files/session-work/render/icon.html
     20K  handoff-files/session-work/render/laptop.html
    136K  handoff-files/session-work/render/look.jpg
    212K  handoff-files/session-work/render/main.jpg
     72K  handoff-files/session-work/render/stage.jpg
    184K  handoff-files/session-work/render/support.js
    104K  handoff-files/session-work/render/sv/index.html
      4K  handoff-files/session-work/rep.py
      4K  handoff-files/session-work/replay.js
      4K  handoff-files/session-work/replay.spec
      4K  handoff-files/session-work/replaytest.rs
      4K  handoff-files/session-work/report.spec
      4K  handoff-files/session-work/res1.py
      4K  handoff-files/session-work/res2.py
      4K  handoff-files/session-work/res3.py
      4K  handoff-files/session-work/resolve.py
      4K  handoff-files/session-work/resolve2.py
      4K  handoff-files/session-work/reveal.py
     12K  handoff-files/session-work/ring.py
      4K  handoff-files/session-work/rnn/README.md
      4K  handoff-files/session-work/ros.js
      4K  handoff-files/session-work/rs/Cargo.lock
      4K  handoff-files/session-work/rs/Cargo.toml
      4K  handoff-files/session-work/rs/extract.py
     12K  handoff-files/session-work/rs/src/lib.rs
      8K  handoff-files/session-work/rs1.py
      8K  handoff-files/session-work/rs2.py
      4K  handoff-files/session-work/rs3.py
     12K  handoff-files/session-work/rules.py
      4K  handoff-files/session-work/run.mjs
      4K  handoff-files/session-work/run1.txt
      4K  handoff-files/session-work/runsql.sh
      4K  handoff-files/session-work/runw.mjs
      4K  handoff-files/session-work/rust.py
      4K  handoff-files/session-work/rust_edit.py
    160K  handoff-files/session-work/s1/chat-dark.png
    156K  handoff-files/session-work/s1/chat-desktop.png
    140K  handoff-files/session-work/s1/chat-phone-dark.png
    140K  handoff-files/session-work/s1/chat-phone.png
     96K  handoff-files/session-work/s2/calendar-agenda-desktop.png
     80K  handoff-files/session-work/s2/calendar-day-desktop.png
     88K  handoff-files/session-work/s2/calendar-month-dark.png
     88K  handoff-files/session-work/s2/calendar-month-desktop.png
    100K  handoff-files/session-work/s2/calendar-phone.png
     92K  handoff-files/session-work/s2/calendar-week-desktop.png
     96K  handoff-files/session-work/s3/account-phone.png
     96K  handoff-files/session-work/s3/calendar-agenda-desktop.png
     84K  handoff-files/session-work/s3/calendar-day-desktop.png
     88K  handoff-files/session-work/s3/calendar-month-dark.png
     88K  handoff-files/session-work/s3/calendar-month-desktop.png
    100K  handoff-files/session-work/s3/calendar-phone.png
     88K  handoff-files/session-work/s3/calendar-week-desktop.png
    160K  handoff-files/session-work/s3/chat-dark.png
    156K  handoff-files/session-work/s3/chat-desktop.png
    140K  handoff-files/session-work/s3/chat-phone-dark.png
    140K  handoff-files/session-work/s3/chat-phone.png
     56K  handoff-files/session-work/s3/compact-calendar.png
     88K  handoff-files/session-work/s3/crew-desktop.png
    128K  handoff-files/session-work/s3/empty-chat-desktop.png
     92K  handoff-files/session-work/s3/files-desktop.png
    136K  handoff-files/session-work/s3/newplan-desktop.png
    136K  handoff-files/session-work/s3/plan-desktop.png
    120K  handoff-files/session-work/s3/plan-phone.png
    136K  handoff-files/session-work/s3/plans-desktop.png
    136K  handoff-files/session-work/s3/plans-phone.png
    100K  handoff-files/session-work/s3/schedule-desktop.png
     84K  handoff-files/session-work/s3/schedule-phone.png
    168K  handoff-files/session-work/s3/share-desktop.png
     76K  handoff-files/session-work/s3/tablet-calendar.png
     88K  handoff-files/session-work/s3/tasks-desktop.png
     96K  handoff-files/session-work/s4/account-phone.png
     96K  handoff-files/session-work/s4/crew-desktop.png
    136K  handoff-files/session-work/s4/newplan-desktop.png
    136K  handoff-files/session-work/s4/plans-phone.png
    168K  handoff-files/session-work/s4/share-desktop.png
     76K  handoff-files/session-work/s4/tablet-calendar.png
    140K  handoff-files/session-work/s5/chatx-long-phone.png
    160K  handoff-files/session-work/s5/chatx-mention-desktop.png
    140K  handoff-files/session-work/s5/chatx-picked-phone.png
    136K  handoff-files/session-work/s5/chatx-scrolled-phone.png
     96K  handoff-files/session-work/s6/account-phone.png
     96K  handoff-files/session-work/s6/calendar-agenda-desktop.png
     84K  handoff-files/session-work/s6/calendar-day-desktop.png
     88K  handoff-files/session-work/s6/calendar-month-dark.png
     88K  handoff-files/session-work/s6/calendar-month-desktop.png
    100K  handoff-files/session-work/s6/calendar-phone.png
     88K  handoff-files/session-work/s6/calendar-week-desktop.png
    160K  handoff-files/session-work/s6/chat-dark.png
    156K  handoff-files/session-work/s6/chat-desktop.png
    140K  handoff-files/session-work/s6/chat-phone-dark.png
    140K  handoff-files/session-work/s6/chat-phone.png
    136K  handoff-files/session-work/s6/chatx-long-phone.png
    160K  handoff-files/session-work/s6/chatx-mention-desktop.png
    140K  handoff-files/session-work/s6/chatx-picked-phone.png
    136K  handoff-files/session-work/s6/chatx-scrolled-phone.png
     56K  handoff-files/session-work/s6/compact-calendar.png
     92K  handoff-files/session-work/s6/crew-desktop.png
    128K  handoff-files/session-work/s6/empty-chat-desktop.png
     92K  handoff-files/session-work/s6/files-desktop.png
    136K  handoff-files/session-work/s6/newplan-desktop.png
    136K  handoff-files/session-work/s6/plan-desktop.png
    120K  handoff-files/session-work/s6/plan-phone.png
    136K  handoff-files/session-work/s6/plans-desktop.png
    136K  handoff-files/session-work/s6/plans-phone.png
    100K  handoff-files/session-work/s6/schedule-desktop.png
     84K  handoff-files/session-work/s6/schedule-phone.png
    168K  handoff-files/session-work/s6/share-desktop.png
     76K  handoff-files/session-work/s6/tablet-calendar.png
     92K  handoff-files/session-work/s6/tasks-desktop.png
      4K  handoff-files/session-work/sample.pdf
      4K  handoff-files/session-work/sc_edit.py
      8K  handoff-files/session-work/scenario.sql
      4K  handoff-files/session-work/scene.spec
      4K  handoff-files/session-work/scene2.txt
      4K  handoff-files/session-work/scene3.txt
      4K  handoff-files/session-work/scene4.txt
      8K  handoff-files/session-work/scene_draws.rs
      4K  handoff-files/session-work/scope_edit.py
      4K  handoff-files/session-work/sct.ts
     20K  handoff-files/session-work/sd-build/assets.mjs
     16K  handoff-files/session-work/sd/assets.mjs
      4K  handoff-files/session-work/sd/gen.mjs
      8K  handoff-files/session-work/sd_edit.py
      4K  handoff-files/session-work/sdassets.mjs
      4K  handoff-files/session-work/seat.js
      4K  handoff-files/session-work/seat.py
      4K  handoff-files/session-work/sep.js
      4K  handoff-files/session-work/setup_sync.py
      4K  handoff-files/session-work/shadow.spec
      4K  handoff-files/session-work/shadow2.spec
      8K  handoff-files/session-work/shape_edit.py
      8K  handoff-files/session-work/shape_ui.py
      4K  handoff-files/session-work/shoot-dialog.cjs
      4K  handoff-files/session-work/shoot-slides.cjs
      4K  handoff-files/session-work/shot.cjs
      8K  handoff-files/session-work/shot/scenes.mjs
      4K  handoff-files/session-work/shot/shot.mjs
      4K  handoff-files/session-work/shot1.js
      4K  handoff-files/session-work/shot16.cjs
      4K  handoff-files/session-work/shot2.js
      4K  handoff-files/session-work/shotp.js
      8K  handoff-files/session-work/shots-pro.js
     12K  handoff-files/session-work/shots-v3.js
      4K  handoff-files/session-work/shots.cjs
      8K  handoff-files/session-work/shots.js
      4K  handoff-files/session-work/shots.mjs
     40K  handoff-files/session-work/shots/01-start.png
    208K  handoff-files/session-work/shots/02-workspace.png
    196K  handoff-files/session-work/shots/03-layer-style.png
    212K  handoff-files/session-work/shots/04-filter.png
    216K  handoff-files/session-work/shots/05-psd.png
     96K  handoff-files/session-work/shots/06-menu.png
     80K  handoff-files/session-work/shots/07-light.png
    144K  handoff-files/session-work/shots/08-camera-raw.png
    180K  handoff-files/session-work/shots/09-export.png
     80K  handoff-files/session-work/shots/10-tools.png
     12K  handoff-files/session-work/sicons/128x128.png
     20K  handoff-files/session-work/sicons/128x128@2x.png
      4K  handoff-files/session-work/sicons/32x32.png
      8K  handoff-files/session-work/sicons/64x64.png
      8K  handoff-files/session-work/sicons/Square107x107Logo.png
     12K  handoff-files/session-work/sicons/Square142x142Logo.png
     12K  handoff-files/session-work/sicons/Square150x150Logo.png
     24K  handoff-files/session-work/sicons/Square284x284Logo.png
      4K  handoff-files/session-work/sicons/Square30x30Logo.png
     24K  handoff-files/session-work/sicons/Square310x310Logo.png
      4K  handoff-files/session-work/sicons/Square44x44Logo.png
      8K  handoff-files/session-work/sicons/Square71x71Logo.png
      8K  handoff-files/session-work/sicons/Square89x89Logo.png
      4K  handoff-files/session-work/sicons/StoreLogo.png
      4K  handoff-files/session-work/sicons/android/mipmap-anydpi-v26/ic_launcher.xml
      4K  handoff-files/session-work/sicons/android/mipmap-hdpi/ic_launcher.png
     12K  handoff-files/session-work/sicons/android/mipmap-hdpi/ic_launcher_foreground.png
      4K  handoff-files/session-work/sicons/android/mipmap-hdpi/ic_launcher_round.png
      4K  handoff-files/session-work/sicons/android/mipmap-mdpi/ic_launcher.png
      8K  handoff-files/session-work/sicons/android/mipmap-mdpi/ic_launcher_foreground.png
      4K  handoff-files/session-work/sicons/android/mipmap-mdpi/ic_launcher_round.png
      8K  handoff-files/session-work/sicons/android/mipmap-xhdpi/ic_launcher.png
     16K  handoff-files/session-work/sicons/android/mipmap-xhdpi/ic_launcher_foreground.png
      8K  handoff-files/session-work/sicons/android/mipmap-xhdpi/ic_launcher_round.png
     12K  handoff-files/session-work/sicons/android/mipmap-xxhdpi/ic_launcher.png
     24K  handoff-files/session-work/sicons/android/mipmap-xxhdpi/ic_launcher_foreground.png
     12K  handoff-files/session-work/sicons/android/mipmap-xxhdpi/ic_launcher_round.png
     16K  handoff-files/session-work/sicons/android/mipmap-xxxhdpi/ic_launcher.png
     36K  handoff-files/session-work/sicons/android/mipmap-xxxhdpi/ic_launcher_foreground.png
     12K  handoff-files/session-work/sicons/android/mipmap-xxxhdpi/ic_launcher_round.png
      4K  handoff-files/session-work/sicons/android/values/ic_launcher_background.xml
    188K  handoff-files/session-work/sicons/icon.icns
     32K  handoff-files/session-work/sicons/icon.ico
     40K  handoff-files/session-work/sicons/icon.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-20x20@1x.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-20x20@2x-1.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-20x20@2x.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-20x20@3x.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-29x29@1x.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-29x29@2x-1.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-29x29@2x.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-29x29@3x.png
      4K  handoff-files/session-work/sicons/ios/AppIcon-40x40@1x.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-40x40@2x-1.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-40x40@2x.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-40x40@3x.png
     56K  handoff-files/session-work/sicons/ios/AppIcon-512@2x.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-60x60@2x.png
     12K  handoff-files/session-work/sicons/ios/AppIcon-60x60@3x.png
      8K  handoff-files/session-work/sicons/ios/AppIcon-76x76@1x.png
     12K  handoff-files/session-work/sicons/ios/AppIcon-76x76@2x.png
     12K  handoff-files/session-work/sicons/ios/AppIcon-83.5x83.5@2x.png
    928K  handoff-files/session-work/site-download.png
    620K  handoff-files/session-work/site-photo.png
      4K  handoff-files/session-work/site.cjs
      4K  handoff-files/session-work/site.mjs
    256K  handoff-files/session-work/site/look.png
    428K  handoff-files/session-work/site/main.png
    304K  handoff-files/session-work/site/manual.png
    296K  handoff-files/session-work/site/pesukim-next.png
    268K  handoff-files/session-work/site/pesukim.png
     68K  handoff-files/session-work/site/screen-name.jpg
     52K  handoff-files/session-work/site/screen-plain.jpg
     60K  handoff-files/session-work/site/screen-word.jpg
      8K  handoff-files/session-work/site_edit.py
     24K  handoff-files/session-work/site_src.bak.html
     24K  handoff-files/session-work/site_src.html
      4K  handoff-files/session-work/sitecheck.js
      4K  handoff-files/session-work/sitecheck2.js
    140K  handoff-files/session-work/siteimg/lumora-inputs.png
    440K  handoff-files/session-work/siteimg/lumora-main.png
    480K  handoff-files/session-work/siteimg/lumora-visuals.png
    128K  handoff-files/session-work/siteimg/studio-color.png
     48K  handoff-files/session-work/siteimg/studio-silence.png
    140K  handoff-files/session-work/siteimg/studio-timeline.png
      4K  handoff-files/session-work/siteshot2.cjs
      4K  handoff-files/session-work/siteshots.js
      4K  handoff-files/session-work/sl.js
      8K  handoff-files/session-work/slides-qr.svg
      4K  handoff-files/session-work/slides.js
      4K  handoff-files/session-work/smoke/build-sheet.mjs
     20K  handoff-files/session-work/smoke/sheet.html
     20K  handoff-files/session-work/smoke/sheet.mjs
    100K  handoff-files/session-work/smoke/sheet.png
      4K  handoff-files/session-work/smoke/sheet.ts
      4K  handoff-files/session-work/smoke/smoke.mjs
      4K  handoff-files/session-work/smooth.js
      8K  handoff-files/session-work/smooth.py
      4K  handoff-files/session-work/smooth2.js
      4K  handoff-files/session-work/snap.js
      4K  handoff-files/session-work/snd.js
      4K  handoff-files/session-work/song.js
      4K  handoff-files/session-work/source.spec
      4K  handoff-files/session-work/sp.js
      8K  handoff-files/session-work/sp.py
      4K  handoff-files/session-work/speaker_media.py
      4K  handoff-files/session-work/speakers.csv
      4K  handoff-files/session-work/splash.js
      4K  handoff-files/session-work/splice.py
      4K  handoff-files/session-work/split.py
      4K  handoff-files/session-work/sq/mock-auth.sql
    104K  handoff-files/session-work/sq/setup-old.sql
      4K  handoff-files/session-work/sq/update-1-names.sql
     56K  handoff-files/session-work/sq/update-10-planner-pro.sql
     24K  handoff-files/session-work/sq/update-2-editor-collab.sql
      8K  handoff-files/session-work/sq/update-3-reports.sql
      8K  handoff-files/session-work/sq/update-4-app-access.sql
     20K  handoff-files/session-work/sq/update-5-planner.sql
     28K  handoff-files/session-work/sq/update-6-security.sql
      4K  handoff-files/session-work/sq/update-7-optional-two-step.sql
      8K  handoff-files/session-work/sq/update-8-planner.sql
     36K  handoff-files/session-work/sq/update-9-sign-in-settings.sql
      4K  handoff-files/session-work/sqltest.sh
      8K  handoff-files/session-work/src1.txt
      4K  handoff-files/session-work/srctest.txt
     40K  handoff-files/session-work/sst/all.png
      4K  handoff-files/session-work/sst/cap.js
     16K  handoff-files/session-work/sst/close.png
    160K  handoff-files/session-work/sst/color.png
    332K  handoff-files/session-work/sst/dl.png
    168K  handoff-files/session-work/sst/feat.png
      4K  handoff-files/session-work/sst/frames.sh
     12K  handoff-files/session-work/sst/live.png
    188K  handoff-files/session-work/sst/phone-dl.png
    272K  handoff-files/session-work/sst/phone-hero.png
     76K  handoff-files/session-work/sst/phone-together.png
    124K  handoff-files/session-work/sst/s-audio.png
    164K  handoff-files/session-work/sst/s-color.png
    152K  handoff-files/session-work/sst/s-edit.png
     12K  handoff-files/session-work/sst/side.png
      4K  handoff-files/session-work/sst/site.js
      4K  handoff-files/session-work/sst/splice.py
     12K  handoff-files/session-work/sst/studio.html
     72K  handoff-files/session-work/sst/together.png
      4K  handoff-files/session-work/sst/vite.log
      4K  handoff-files/session-work/sst/vite.st.config.ts
     12K  handoff-files/session-work/sst/wide.png
      4K  handoff-files/session-work/st.py
      4K  handoff-files/session-work/st2.py
     16K  handoff-files/session-work/stage.css
     32K  handoff-files/session-work/stagevis.py
      4K  handoff-files/session-work/step0.sh
      4K  handoff-files/session-work/step1.sh
      4K  handoff-files/session-work/step2.sh
      4K  handoff-files/session-work/store.patch
      4K  handoff-files/session-work/stub.sql
      4K  handoff-files/session-work/studio-icon.svg
      8K  handoff-files/session-work/studio.py
    292K  handoff-files/session-work/studio/a:b c'd,e[f]/sh.rnnn
     92K  handoff-files/session-work/studio/audio-page.png
      4K  handoff-files/session-work/studio/audio.mjs
     56K  handoff-files/session-work/studio/comp-0.png
     72K  handoff-files/session-work/studio/comp-1.png
     84K  handoff-files/session-work/studio/comp-2.png
    120K  handoff-files/session-work/studio/comp-3.png
    116K  handoff-files/session-work/studio/comp-4.png
      4K  handoff-files/session-work/studio/comp.mjs
      4K  handoff-files/session-work/studio/comp2.mjs
      8K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyEarlyReflections.lv2/DragonflyEarlyReflections_dsp.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyEarlyReflections.lv2/DragonflyEarlyReflections_ui.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyEarlyReflections.lv2/manifest.ttl
     12K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyHallReverb.lv2/DragonflyHallReverb_dsp.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyHallReverb.lv2/DragonflyHallReverb_ui.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyHallReverb.lv2/manifest.ttl
      8K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyPlateReverb.lv2/DragonflyPlateReverb_dsp.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyPlateReverb.lv2/DragonflyPlateReverb_ui.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyPlateReverb.lv2/manifest.ttl
      8K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyRoomReverb.lv2/DragonflyRoomReverb_dsp.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyRoomReverb.lv2/DragonflyRoomReverb_ui.ttl
      4K  handoff-files/session-work/studio/dl-dragonfly/dragonfly-reverb-3.2.10/DragonflyRoomReverb.lv2/manifest.ttl
      4K  handoff-files/session-work/studio/dl.mjs
      4K  handoff-files/session-work/studio/e1.py
      4K  handoff-files/session-work/studio/e10.py
      8K  handoff-files/session-work/studio/e11.py
      4K  handoff-files/session-work/studio/e12.py
      4K  handoff-files/session-work/studio/e13.py
      4K  handoff-files/session-work/studio/e14.py
      4K  handoff-files/session-work/studio/e15.py
      8K  handoff-files/session-work/studio/e16.py
      8K  handoff-files/session-work/studio/e17.py
      4K  handoff-files/session-work/studio/e18.py
      4K  handoff-files/session-work/studio/e19.py
      8K  handoff-files/session-work/studio/e2.py
      8K  handoff-files/session-work/studio/e20.py
      4K  handoff-files/session-work/studio/e21.py
      4K  handoff-files/session-work/studio/e21b.py
      4K  handoff-files/session-work/studio/e22.py
      8K  handoff-files/session-work/studio/e3.py
      4K  handoff-files/session-work/studio/e30.py
      8K  handoff-files/session-work/studio/e4.py
     12K  handoff-files/session-work/studio/e5.py
      4K  handoff-files/session-work/studio/e6.py
      8K  handoff-files/session-work/studio/e7.py
      8K  handoff-files/session-work/studio/e8.py
      4K  handoff-files/session-work/studio/e8b.py
      4K  handoff-files/session-work/studio/e9.py
     20K  handoff-files/session-work/studio/effects.orig.ts
      4K  handoff-files/session-work/studio/esc.mjs
      4K  handoff-files/session-work/studio/fetchsdk.mjs
      4K  handoff-files/session-work/studio/glsl.mjs
    132K  handoff-files/session-work/studio/hdr-dialog.png
    116K  handoff-files/session-work/studio/hdr-edit.png
      4K  handoff-files/session-work/studio/hdr.mjs
    140K  handoff-files/session-work/studio/mag-after.png
    144K  handoff-files/session-work/studio/mag-delete.png
    140K  handoff-files/session-work/studio/mag-drag.png
      4K  handoff-files/session-work/studio/mag.mjs
      4K  handoff-files/session-work/studio/pfiles.txt
      4K  handoff-files/session-work/studio/rel.mjs
      4K  handoff-files/session-work/studio/rel2.mjs
    112K  handoff-files/session-work/studio/s1.png
    292K  handoff-files/session-work/studio/sh.rnnn
      4K  handoff-files/session-work/studio/shot.mjs
     68K  handoff-files/session-work/studio/stale.txt
      4K  handoff-files/session-work/studio/tour.mjs
    100K  handoff-files/session-work/studio/tour/1100-b01-text-tab.png
    100K  handoff-files/session-work/studio/tour/1100-b02-publish.png
    104K  handoff-files/session-work/studio/tour/1100-b03-trim.png
    132K  handoff-files/session-work/studio/tour/1100-b04-export.png
     48K  handoff-files/session-work/studio/tour/1100-c01-composite.png
     96K  handoff-files/session-work/studio/tour/1100-c02-color.png
     76K  handoff-files/session-work/studio/tour/1100-c03-audio.png
    116K  handoff-files/session-work/studio/tour/1600-01-start.png
    128K  handoff-files/session-work/studio/tour/1600-02-menu-file.png
    140K  handoff-files/session-work/studio/tour/1600-03-menu-sequence.png
    140K  handoff-files/session-work/studio/tour/1600-04-menu-ai.png
    152K  handoff-files/session-work/studio/tour/1600-05-select-clip.png
    156K  handoff-files/session-work/studio/tour/1600-06-razor.png
    156K  handoff-files/session-work/studio/tour/1600-07-transition.png
    156K  handoff-files/session-work/studio/tour/1600-08-inspector.png
    156K  handoff-files/session-work/studio/tour/1600-09-effects-tab.png
    156K  handoff-files/session-work/studio/tour/1600-10-text-tab.png
    180K  handoff-files/session-work/studio/tour/1600-11-color.png
    120K  handoff-files/session-work/studio/tour/1600-12-audio.png
     96K  handoff-files/session-work/studio/tour/1600-13-composite.png
    156K  handoff-files/session-work/studio/tour/1600-14-edit.png
    172K  handoff-files/session-work/studio/tour/1600-15-export.png
    152K  handoff-files/session-work/studio/tour/1600-16-transcript.png
    156K  handoff-files/session-work/studio/tour/1600-17-magnetic.png
    168K  handoff-files/session-work/studio/tour/1600-18-help.png
    116K  handoff-files/session-work/studio/tour/1600-b01-text-tab.png
    116K  handoff-files/session-work/studio/tour/1600-b02-publish.png
    132K  handoff-files/session-work/studio/tour/1600-b03-trim.png
    172K  handoff-files/session-work/studio/tour/1600-b04-export.png
      4K  handoff-files/session-work/studio/tour2.mjs
      4K  handoff-files/session-work/studio/tour3.mjs
     24K  handoff-files/session-work/studio/vite.log
      4K  handoff-files/session-work/studio/vite.studio.mjs
      4K  handoff-files/session-work/studio/vst3sdk/base_falignpush.h
     12K  handoff-files/session-work/studio/vst3sdk/base_fplatform.h
      8K  handoff-files/session-work/studio/vst3sdk/base_ftypes.h
     24K  handoff-files/session-work/studio/vst3sdk/base_funknown.h
      4K  handoff-files/session-work/studio/vst3sdk/base_ibstream.h
     20K  handoff-files/session-work/studio/vst3sdk/base_ipluginbase.h
     16K  handoff-files/session-work/studio/vst3sdk/gui_iplugview.h
      8K  handoff-files/session-work/studio/vst3sdk/vst_ivstattributes.h
     24K  handoff-files/session-work/studio/vst3sdk/vst_ivstaudioprocessor.h
     12K  handoff-files/session-work/studio/vst3sdk/vst_ivstcomponent.h
     32K  handoff-files/session-work/studio/vst3sdk/vst_ivsteditcontroller.h
     12K  handoff-files/session-work/studio/vst3sdk/vst_ivstevents.h
      8K  handoff-files/session-work/studio/vst3sdk/vst_ivsthostapplication.h
      4K  handoff-files/session-work/studio/vst3sdk/vst_ivstmessage.h
      8K  handoff-files/session-work/studio/vst3sdk/vst_ivstparameterchanges.h
      8K  handoff-files/session-work/studio/vst3sdk/vst_ivstprocesscontext.h
      4K  handoff-files/session-work/studio/vst3sdk/vst_vstpshpack4.h
     64K  handoff-files/session-work/studio/vst3sdk/vst_vstspeaker.h
      8K  handoff-files/session-work/studio/vst3sdk/vst_vsttypes.h
      4K  handoff-files/session-work/studio/wclippy.txt
      4K  handoff-files/session-work/studio2.py
      4K  handoff-files/session-work/studio3.py
      8K  handoff-files/session-work/studio_block.tsx
      4K  handoff-files/session-work/studio_win.py
    104K  handoff-files/session-work/sv-index.orig.html
     12K  handoff-files/session-work/svdata.json
      4K  handoff-files/session-work/svload.js
      4K  handoff-files/session-work/svsmooth.js
      4K  handoff-files/session-work/svsmooth2.js
    104K  handoff-files/session-work/svt/new.html
    104K  handoff-files/session-work/svt/old.html
      4K  handoff-files/session-work/svtest.js
     12K  handoff-files/session-work/sw.py
      8K  handoff-files/session-work/swatch_edit.py
      4K  handoff-files/session-work/sweep.js
      4K  handoff-files/session-work/sweep2.js
      8K  handoff-files/session-work/t.js
      4K  handoff-files/session-work/t.mjs
      4K  handoff-files/session-work/t.patch
      4K  handoff-files/session-work/t.rs
      4K  handoff-files/session-work/t.ts
    244K  handoff-files/session-work/t9.log
    252K  handoff-files/session-work/t9o.log
      8K  handoff-files/session-work/table.md
      4K  handoff-files/session-work/tabs.js
      4K  handoff-files/session-work/tail.md
      4K  handoff-files/session-work/take.js
      4K  handoff-files/session-work/tan.js
      4K  handoff-files/session-work/tanrec.js
      4K  handoff-files/session-work/tb.cjs
      4K  handoff-files/session-work/tb.js
      4K  handoff-files/session-work/tbar.js
      8K  handoff-files/session-work/te.py
     36K  handoff-files/session-work/test.log
    260K  handoff-files/session-work/test.wav
      8K  handoff-files/session-work/tests.py
      4K  handoff-files/session-work/text_patch.py
     12K  handoff-files/session-work/theirs.js
      4K  handoff-files/session-work/tile.js
      8K  handoff-files/session-work/tilecss.py
      4K  handoff-files/session-work/tiles.py
      0K  handoff-files/session-work/tl.txt
      4K  handoff-files/session-work/tl_perf.py
    132K  handoff-files/session-work/tone.wav
      4K  handoff-files/session-work/transport.py
      4K  handoff-files/session-work/trg.js
      4K  handoff-files/session-work/trig_tests.rs
      8K  handoff-files/session-work/trimkeys.py
      4K  handoff-files/session-work/trv.js
      4K  handoff-files/session-work/trvphone.js
      4K  handoff-files/session-work/ts1.py
      8K  handoff-files/session-work/ts2.py
      4K  handoff-files/session-work/ts3.py
     12K  handoff-files/session-work/ts4.py
      4K  handoff-files/session-work/ts5.py
      4K  handoff-files/session-work/ts6.py
      4K  handoff-files/session-work/ts_types.py
      4K  handoff-files/session-work/tscript.css
      4K  handoff-files/session-work/tw.js
      4K  handoff-files/session-work/txt.js
     12K  handoff-files/session-work/typo_edit.py
    108K  handoff-files/session-work/ui-after.png
    120K  handoff-files/session-work/ui-export.png
      4K  handoff-files/session-work/ui1.js
      4K  handoff-files/session-work/ui1.py
      4K  handoff-files/session-work/ui2.js
      4K  handoff-files/session-work/ui2.py
      8K  handoff-files/session-work/ui3.js
      4K  handoff-files/session-work/ui3.py
      4K  handoff-files/session-work/ui5.js
      4K  handoff-files/session-work/ui6.js
      4K  handoff-files/session-work/unified.spec
      4K  handoff-files/session-work/updater/lumora-updates.key.pub
      8K  handoff-files/session-work/us.json
     20K  handoff-files/session-work/v3-app.css
      4K  handoff-files/session-work/v3-append.py
      4K  handoff-files/session-work/v3-icons.js
      4K  handoff-files/session-work/v3-sql.sh
     76K  handoff-files/session-work/v3/calendar.png
    172K  handoff-files/session-work/v3/chat.png
     76K  handoff-files/session-work/v3/dark-calendar.png
    172K  handoff-files/session-work/v3/dark-plan.png
     92K  handoff-files/session-work/v3/list.png
    124K  handoff-files/session-work/v3/phone-calendar.png
    140K  handoff-files/session-work/v3/phone-chat.png
    144K  handoff-files/session-work/v3/phone-list.png
    140K  handoff-files/session-work/v3/phone-plan.png
    144K  handoff-files/session-work/v3/phone-schedule.png
     76K  handoff-files/session-work/v3/phone-signin.png
    168K  handoff-files/session-work/v3/plan.png
    108K  handoff-files/session-work/v3/print.png
    112K  handoff-files/session-work/v3/schedule.png
     88K  handoff-files/session-work/v3/signin.png
     56K  handoff-files/session-work/v3/week.png
      4K  handoff-files/session-work/vd.py
      4K  handoff-files/session-work/vedweb.log
    368K  handoff-files/session-work/venue.jpg
      4K  handoff-files/session-work/view_bmp.py
      4K  handoff-files/session-work/vimeo_docs.py
      4K  handoff-files/session-work/vimeo_open.py
     12K  handoff-files/session-work/vimeo_ts.py
      4K  handoff-files/session-work/vis.js
      8K  handoff-files/session-work/vis.py
      4K  handoff-files/session-work/vis2.js
      4K  handoff-files/session-work/vis2.py
      4K  handoff-files/session-work/vis3.js
      4K  handoff-files/session-work/vis4.js
      4K  handoff-files/session-work/vision.spec
      4K  handoff-files/session-work/vite-edit.log
      4K  handoff-files/session-work/vite.edweb.config.ts
     28K  handoff-files/session-work/vite.log
      4K  handoff-files/session-work/vite.shot.config.ts
      4K  handoff-files/session-work/vite.shots.config.ts
      4K  handoff-files/session-work/vite.web.config.ts
   1560K  handoff-files/session-work/vitest.log
     12K  handoff-files/session-work/vitest2.txt
      4K  handoff-files/session-work/vt/index.html
    176K  handoff-files/session-work/vt/portrait.jpg
     44K  handoff-files/session-work/vt/pose.jpg
      4K  handoff-files/session-work/vt/vertical.js
    192K  handoff-files/session-work/vt/wide.jpg
      8K  handoff-files/session-work/vweb.log
      4K  handoff-files/session-work/wall.js
      4K  handoff-files/session-work/wallphone.js
      4K  handoff-files/session-work/wallrec.js
      4K  handoff-files/session-work/wc.cjs
      4K  handoff-files/session-work/web.js
      4K  handoff-files/session-work/web2.js
      4K  handoff-files/session-work/web3.js
      4K  handoff-files/session-work/wf.py
      4K  handoff-files/session-work/wgsl.spec
      8K  handoff-files/session-work/wgsl1.txt
      4K  handoff-files/session-work/whole.js
    132K  handoff-files/session-work/wholerec-5.jpg
    100K  handoff-files/session-work/wholerec-9.jpg
      4K  handoff-files/session-work/wholerec.js
      4K  handoff-files/session-work/wide.js
     12K  handoff-files/session-work/wire.py
      4K  handoff-files/session-work/ws1.js
      4K  handoff-files/session-work/ws2.js
      4K  handoff-files/session-work/ws3.js
      4K  handoff-files/session-work/ws4.js
      8K  handoff-files/session-work/ws5.js
      8K  handoff-files/session-work/ws6.js
      4K  handoff-files/session-work/ws7.js
      8K  handoff-files/session-work/ws_edit.py
      4K  handoff-files/session-work/zm.js
      4K  handoff-files/session-work/zmout.txt
      4K  handoff-files/session-work/zmrec.js
      4K  handoff-files/session-work/zoom.js
     40K  handoff-files/uploads/stage-visuals-project.zip
```

</details>
