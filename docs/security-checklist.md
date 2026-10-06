# Security checklist (Supabase dashboard)

Settings the Lumora team sets once in the Supabase dashboard
(<https://supabase.com/dashboard> → the Lumora project). All of them are on the
free plan. The apps and `supabase/*.sql` can't set them; without them, the
rules in the SQL still hold, but sign-up and sign-in are weaker.

Menu names change now and then; if one is not where it says, use the
dashboard's search (Ctrl+K) for the setting's name.

## 1. Run the SQL first

- [ ] **SQL Editor → New query** → paste all of `supabase/update-6-security.sql` → **Run**.
      It is safe to run again. (A new project runs `setup.sql`, then
      `update-3-reports.sql`, instead.)
- [ ] Then, in Lumora: **Settings → People and approvals**. It asks you to turn
      on two-step sign-in (scan a QR code with an authenticator app on your
      phone). From now on the Lumora team's actions need it.

## 2. Email sign-up: confirm the email

- [ ] **Authentication → Sign In / Providers → Email** (older dashboards:
      Authentication → Providers → Email):
  - **Enable Email provider**: on.
  - **Confirm email**: **on**. Without it, anyone could make an account with
    someone else's email address (the Planner gives shared plans to an email
    address, and the team approves accounts by email).
  - **Secure email change**: on (the default).
  - **Save**.

## 3. Passwords: at least 10 characters, letters and digits

- [ ] Same page (**Authentication → Sign In / Providers → Email**), the
      password settings:
  - **Minimum password length**: **10**.
  - **Password requirements**: **Letters and digits** (or stricter).
  - **Save**.
  - ("Prevent use of leaked passwords" is a paid feature: leave it.)

The apps already ask for 10 characters with letters and numbers for new
passwords; this makes the server insist too.

## 4. Rate limits: keep the defaults

- [ ] **Authentication → Rate Limits**: leave every limit at its default (do
      not raise them). They slow down password guessing, sign-up floods and
      email sending. The database limits Lumora adds (reports, invitations,
      shared projects, comments) are in `update-6-security.sql`.

## 5. Two-step sign-in (MFA, authenticator apps)

- [ ] **Authentication → Multi-Factor** (older dashboards: Authentication →
      Providers → or Settings → Multi-Factor Authentication):
  - **TOTP (App Authenticator)**: **Enabled**.
  - Phone (SMS) MFA: leave off (it costs money and is weaker).
  - **Maximum number of MFA factors per user**: the default (10) is fine.
  - **Save**.

People turn it on themselves in Lumora or Lumora Studio: **My account →
Two-step sign-in**. The Lumora team's accounts must have it.

**Someone lost their phone:** Lumora → Settings → People and approvals →
their row → **Reset two-step** (click twice). They then sign in with their
password alone and can turn it on again. If Lumora says the account server
does not allow it, do it here instead: **SQL Editor → New query**:

```sql
delete from auth.mfa_factors
where user_id = (select id from auth.users where email = 'their.email@example.org');
```

## 6. Addresses (Site URL and redirects)

The link in a confirmation email leads here.

- [ ] **Authentication → URL Configuration**:
  - **Site URL**: `https://yehudakogan770.github.io/Livestreamingapp/planner/`
  - **Redirect URLs** → **Add URL**:
    `https://yehudakogan770.github.io/Livestreamingapp/**`
    (only Lumora's own site; never `*` or someone else's address).
  - **Save**.

## 7. Check

- [ ] **Advisors → Security Advisor** → **Refresh**: no errors. (Warnings about
      "leaked password protection" are the paid feature above.)
- [ ] **Table Editor**: every table shows **RLS enabled** (running the SQL
      warns about any that does not).
- [ ] **Project Settings → API Keys**: only the **publishable** key is in the
      apps (`app/src/auth/config.ts`). The **secret** (service_role) key must
      never be put in the apps, the Planner, GitHub or a chat.
- [ ] GitHub → the repository → **Settings → Secrets and variables → Actions**:
      `TAURI_SIGNING_PRIVATE_KEY` is there (it signs updates; the apps only
      install updates signed with it). Keep a copy offline; never commit it.

## What the apps do (for reference)

- Each time Lumora or Lumora Studio starts with internet, it checks the
  account with the server (still there, approved, not blocked, set up for that
  app, the two-step code given). Without internet it opens for up to **7
  days** after the last check.
- An app that is already open is never closed (an event may be live). If the
  account is blocked or loses the app, a note says "Your access has changed;
  Lumora will close the next time it starts."
- Planner teammates need only an account (no approval) and see only the plans
  shared with them; making plans needs an approved account with Lumora.
