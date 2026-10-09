# Going live with YouTube and Facebook accounts: owner setup

Lumora can go live on YouTube and Facebook **without copying a stream key**:
the operator clicks **Connect YouTube account** (or Facebook), signs in in the
browser, and from then on Lumora makes the broadcast, fills in the server and
key, takes it live at GO LIVE and ends it at stop. Stream-key destinations keep
working exactly as before; this is an extra choice.

For this, Google and Meta need to know "Lumora" as an app. That is done once,
by the owner, for free:

1. a **Google Cloud project** with the YouTube Data API v3 and an OAuth client
   of type **Desktop app** (gives `LUMORA_YT_CLIENT_ID`, and a
   `LUMORA_YT_CLIENT_SECRET` Google asks for too);
2. a **Meta app** with Facebook Login (gives `LUMORA_FB_APP_ID`);
3. the values put in the GitHub repository's **Actions variables**, so every
   installer the CI builds carries them.

Until a value is there, the matching **Connect** button says "isn't set up in
this copy of Lumora yet", and everything else (stream keys) works as before.

**None of these values are secrets.** A desktop app can't keep a secret (anyone
can read it out of the installer), so Google and Meta protect desktop sign-ins
differently: Google with PKCE (a one-time proof made for each sign-in) and a
redirect back to `127.0.0.1` on this computer; Facebook by only sending the
sign-in back to addresses you register. Google itself says the "client secret"
of a Desktop client is not treated as a secret. That is why they go in
**Variables**, not Secrets (the repository is public; that's fine for these).
The people's own sign-ins (the tokens) never leave their computer: Lumora keeps
them in **Windows Credential Manager** (entries named "Lumora live accounts"),
never in event files or logs.

---

## 1. YouTube: Google Cloud project

Use the Google account that should own the app (it doesn't need to be the
YouTube channel's account).

### 1.1 Make the project

1. Open **console.cloud.google.com** and sign in.
2. At the top left, click the **project picker** (next to "Google Cloud") →
   **New project**.
3. **Project name**: `Lumora Live` (anything works). Leave **Location** as it
   is. Click **Create**, then select the new project in the project picker.

### 1.2 Turn on the YouTube Data API v3

1. Menu (☰) → **APIs & Services** → **Library**.
2. Search for **YouTube Data API v3**, open it, click **Enable**.

### 1.3 The consent screen (what people see when they connect)

1. Menu (☰) → **APIs & Services** → **OAuth consent screen** (it opens
   **Google Auth Platform**). Click **Get started** if asked.
2. **App information**: App name `Lumora`; User support email: yours.
   **Next**.
3. **Audience**: choose **External**. **Next**.
4. **Contact information**: your email. **Next**, tick the agreement,
   **Continue**, **Create**.
5. Left side → **Branding**: add the **App home page**
   (`https://<your site>/`), **Privacy policy** (`https://<your site>/privacy.html`)
   and **Terms of service** (`https://<your site>/terms.html`) — the website in
   `docs/` has these pages. Add your domain under **Authorized domains**.
   **Save**.
6. Left side → **Data Access** → **Add or remove scopes**. In "Manually add
   scopes" paste
   `https://www.googleapis.com/auth/youtube.force-ssl`
   → **Add to table** → tick it → **Update** → **Save**.
   This one scope is all Lumora asks for: manage the channel's live
   broadcasts and set their thumbnails.
7. Left side → **Audience** → **Test users** → **Add users**: add the Google
   accounts of the people who will connect a channel (up to 100). **Save**.

**Testing or published?** While the app is in **Testing**, only those test
users can connect, and **Google ends their connection after 7 days** (they
click Connect again). For real use, click **Publish app** on the **Audience**
page. Because `youtube.force-ssl` is a "sensitive" scope, Google then asks for
**verification** (a few days to a few weeks): your domain verified in Google
Search Console, the home page and privacy policy above, and a short screen
recording showing Lumora's Connect YouTube button, the Google consent screen
and what Lumora does with the channel (makes broadcasts, sets thumbnails, takes
them live). Until verification is done, a published app still works for up to
100 people, who see a "Google hasn't verified this app" page and click
**Advanced → Go to Lumora (unsafe)**.

### 1.4 The Desktop OAuth client

1. Left side → **Clients** → **Create client**.
2. **Application type**: **Desktop app**. **Name**: `Lumora desktop`.
   **Create**.
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the
   **Client secret** (starts with `GOCSPX-`). You can see them again later by
   opening the client.

Desktop clients need no redirect address: Lumora uses
`http://127.0.0.1:<a free port>`, which Google always allows for them.

### 1.5 Quota (how much Lumora may do each day)

Every project gets **10,000 units a day** for free, shared by everyone using
installers built with this client ID. It starts again at midnight Pacific time.
What Lumora uses:

| What                                                                       | Units  |
| -------------------------------------------------------------------------- | ------ |
| Look up the channel, list broadcasts or streams, read the stream's health  | 1 each |
| Make a broadcast (`liveBroadcasts.insert`)                                 | 50     |
| Make Lumora's reusable stream (`liveStreams.insert`, once per channel)     | 50     |
| Link the broadcast to the stream (`bind`)                                  | 50     |
| Each move: ready → testing, testing → live, live → complete (`transition`) | 50     |
| Upload a thumbnail (`thumbnails.set`)                                      | 50     |

A typical event (new broadcast, thumbnail, testing, live, complete, two hours
of health checks every 15 seconds) uses about **300 + 500 = 800 units**, so
about a dozen events a day fit. When the limit is reached, Lumora says
"YouTube's daily limit for Lumora is used up" and the operator can still add a
stream-key destination. For more, ask Google with the **YouTube API Services
— Audit and Quota Extension Form** (free; Google reviews how the app uses the
API).

### 1.6 Channels that can go live

Each channel must be allowed to live stream: **youtube.com/features → Live
streaming → Enable** (YouTube asks for a phone number). The first time, YouTube
takes **up to 24 hours**. Lumora says so plainly when a channel isn't ready.
Custom thumbnails need a **verified** account (youtube.com/verify).

---

## 2. Facebook: Meta app

Meta changes the dashboard's wording now and then; the items below are what
to look for.

### 2.1 Make the app

1. Open **developers.facebook.com** → **My Apps** → **Create app**. (Register
   as a developer first if asked.)
2. **App details**: name `Lumora`, your contact email. **Next**.
3. **Use cases**: choose **Authenticate and request data from users with
   Facebook Login**, and also **Manage everything on your Page** (if offered).
   **Next**.
4. Business portfolio: choose yours (or "I don't want to connect a business
   portfolio yet"). **Next** → **Create app**.
5. Copy the **App ID** (top of the dashboard, or **App settings → Basic**).
   On **App settings → Basic**, also fill in the **Privacy policy URL**
   (`https://<your site>/privacy.html`), **Terms of service URL**, an **App
   icon** and a **Category**, and click **Save changes**.

### 2.2 Facebook Login settings

1. **Use cases → Authenticate and request data… → Customize → Settings**
   (or **Facebook Login → Settings**).
2. **Client OAuth login**: Yes. **Web OAuth login**: Yes. **Use Strict Mode
   for redirect URIs**: Yes.
3. **Valid OAuth Redirect URIs**: add both
   - `http://localhost:47321/facebook` (Lumora's own page: the browser comes
     straight back to Lumora), and
   - `https://www.facebook.com/connect/login_success.html` (the "Connect by
     pasting the address" way, for computers where port 47321 is in use).

   If Meta refuses the `http://localhost` address, leave it out: pasting the
   address works with the second one alone.

4. **Save changes**.

### 2.3 Permissions

Under the use cases (**Customize → Permissions**), add:

- `pages_show_list` — list the Pages the person manages
- `pages_read_engagement` — read the Page's details
- `pages_read_user_content` — read the comments on the live video (Lumora's
  live chat)
- `pages_manage_posts` — post to the Page
- `publish_video` — go live (the Live Video API)

`public_profile` is always there.

### 2.4 Who can use it (App Review)

While the app is in **Development** mode, only people with a role on the app
can connect: **App roles → Roles → Add people** (as Administrator, Developer
or Tester; they accept the invitation at developers.facebook.com). That is
enough to test with your own Pages.

For everyone else, the permissions above need **Advanced Access** through
**App Review** (left side → **Review → App Review → Requests**), which needs
**Business Verification** of your business portfolio. For each permission
Meta asks how it is used and for a screen recording. Notes to give Meta:

- _Platform_: Windows desktop app; sign-in through Facebook Login in the
  person's own browser (manual login flow for desktop apps).
- _pages_show_list_: "Lumora lists the Pages the person manages so they can
  choose where to go live."
- _pages_manage_posts_, _pages_read_engagement_, _publish_video_: "When the
  person presses GO LIVE in Lumora, Lumora creates a live video on the chosen
  Page (`POST /{page-id}/live_videos`), streams to its `secure_stream_url`,
  shows its status and link, and ends it (`end_live_video`) when they stop.
  Lumora posts nothing else."
- _pages_read_user_content_: "While the live video is on, the operator can
  open Lumora's live chat and read its comments (`GET /{live-video-id}/comments`)
  to choose one to show on screen. Comments are read only, never stored or
  posted."
- _Screen recording_: Lumora → Settings → Recording and streaming → "+
  Facebook with your account" → Connect Facebook account → the Facebook
  consent → choosing the Page → GO LIVE → the live video on the Page → stop.
- _Test instructions_: how a reviewer gets the installer and a test Page.

Then switch the app to **Live** mode (top of the dashboard).

**Things to know**: Facebook gives desktop apps a sign-in that lasts **an hour
or two** (keeping it longer would need the app secret, which a desktop app
can't keep). Lumora warns when it runs out soon; the operator clicks Connect
again before the event (Facebook usually remembers them, so it's one click).
Facebook no longer lets apps go live on **personal profiles**; Lumora offers
the person's profile only in case Meta allows it for them, and says so plainly
when it doesn't. Facebook ends a live video by itself a few minutes after the
stream stops, even if Lumora couldn't end it.

---

## 3. Put the values in GitHub

1. Open the repository on github.com → **Settings** (the repository's, not
   your account's) → **Secrets and variables** → **Actions**.
2. Click the **Variables** tab → **New repository variable**, and add:

   | Name                      | Value                                                 |
   | ------------------------- | ----------------------------------------------------- |
   | `LUMORA_YT_CLIENT_ID`     | the Google Client ID (`….apps.googleusercontent.com`) |
   | `LUMORA_YT_CLIENT_SECRET` | the Google Client secret (`GOCSPX-…`)                 |
   | `LUMORA_FB_APP_ID`        | the Meta App ID (digits only)                         |

   (If you'd rather, `LUMORA_YT_CLIENT_SECRET` can be a **Secret** instead of
   a Variable; the CI reads either.)

3. Build a new installer: push a commit, or **Actions → CI → the latest run →
   Re-run all jobs**. The **Windows installer** job passes the values to the
   build (`.github/workflows/ci.yml`); `src-tauri/build.rs` makes sure a
   change rebuilds.

Leave a variable out to switch that provider off: its Connect button explains
that it isn't set up yet.

### Trying it before a new installer (owner's own computer)

Make the file `%APPDATA%\app.lumora.desktop\live-accounts.json`:

```json
{
  "youtubeClientId": "1234-abc.apps.googleusercontent.com",
  "youtubeClientSecret": "GOCSPX-…",
  "facebookAppId": "1234567890"
}
```

and start Lumora again. Values in this file win over the installer's (an
empty value switches that provider off). For development builds the same
names also work as environment variables (`LUMORA_YT_CLIENT_ID`, …).

---

## 4. How it works (for maintainers)

- `crates/live-accounts`: everything that can be tested without the network —
  PKCE, the sign-in addresses, token refresh, every YouTube and Facebook
  request and answer (tests use recorded answers in `tests/fixtures`), the
  broadcast's states (created → ready → testing → live → complete) and the
  plain-English errors.
- `src-tauri/src/accounts.rs`: the browser, the `127.0.0.1` server the
  sign-in returns to, Windows Credential Manager (`keyring`), HTTPS
  (`reqwest`), and the commands the window calls. At GO LIVE
  (`accounts_prepare`) each connected destination gets its address, key and
  YouTube backup server written into the stream settings, so the stream itself
  (`capture.rs`) works exactly as with a typed key; a drop and reconnect reuses
  them. While streaming, health and state are read every 15 seconds; when the
  operator stops, `accounts_finish` completes the YouTube broadcast (unless
  YouTube ends it by itself) and ends the Facebook live video.
- `app/src/broadcast/accounts.ts`, `AccountDestination.tsx`: the settings.
