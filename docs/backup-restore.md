# Database backups: set up and restore

Every Sunday (07:17 UTC), GitHub makes a copy of Lumora's Supabase database:
all of Lumora's tables (the `public` schema) and the accounts (the `auth`
schema). The copy is **encrypted with your passphrase** and kept for 90 days
under the repository's **Actions** tab. The workflow is
`.github/workflows/db-backup.yml`.

**The repository is public**, so anyone can see the Actions tab. That is why
every backup is encrypted: without the passphrase, a backup file is useless.
Never put the connection string or passphrase anywhere except GitHub's
secrets.

Until both secrets below are added, the weekly run does nothing and says
"Database backup skipped" (it doesn't fail).

## 1. Get the connection string from Supabase

1. Open your project at supabase.com.
2. Click **Connect** at the top (or go to **Project Settings → Database**).
3. Under **Connection string**, choose **Session pooler** (port **5432**).
   Don't use "Direct connection" (GitHub can't always reach it) or
   "Transaction pooler" (port 6543, which doesn't work for backups).
4. Copy the URI. It looks like:
   `postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
5. Replace `[YOUR-PASSWORD]` with your **database password** (not your Supabase
   sign-in password). If you don't know it, reset it on the same page under
   **Database password → Reset database password**. If the password has
   symbols like `@`, `#`, `/` or `:`, pick a new password with only letters
   and numbers, which is simplest.

## 2. Make a passphrase and keep it safe

Make a long passphrase, for example five or six random words
(`maple-orbit-candle-river-seventy-glass`).

**Keep it somewhere safe outside GitHub**: in a password manager, and/or
written on paper in a safe place. **If you lose the passphrase, no backup can
ever be opened.** Nobody, including GitHub, can recover it.

## 3. Add the two secrets to GitHub

1. On GitHub, open the repository → **Settings** → **Secrets and variables**
   → **Actions**.
2. Click **New repository secret**:
   - Name: `SUPABASE_DB_URL`. Secret: the connection string from step 1.
3. Click **New repository secret** again:
   - Name: `BACKUP_PASSPHRASE`. Secret: the passphrase from step 2.

GitHub hides secrets in logs, and the workflow never prints them.

## 4. Run it once to check

1. Open the repository's **Actions** tab.
2. On the left, click **Database backup**.
3. Click **Run workflow** → **Run workflow**.
4. After a minute or two, open the run. It should be green, and at the bottom,
   under **Artifacts**, there should be `lumora-db-backup-<date>`.

If you see the warning **"auth schema not backed up"**, the tables were backed
up but the accounts weren't. Check that the connection string uses the
`postgres` user (it starts with `postgresql://postgres.`).

## 5. Restoring a backup

You need two free tools on your computer:

- **GnuPG** to decrypt (Windows: install Gpg4win from gpg4win.org; macOS:
  `brew install gnupg`).
- **PostgreSQL 17 client tools** for `pg_restore` (Windows: the PostgreSQL
  installer from postgresql.org, "Command Line Tools" only; macOS:
  `brew install libpq`).

### Download and decrypt

1. In **Actions → Database backup**, open a run and download its artifact (a
   `.zip`). Unzip it. Inside are:
   - `lumora-<date>.dump.gz.gpg`: the full backup.
   - `lumora-<date>-schema.sql.gz.gpg`: a readable copy of just the structure.
2. Decrypt and unzip (it asks for the passphrase):

   ```sh
   gpg -d lumora-<date>.dump.gz.gpg > backup.dump.gz
   gunzip backup.dump.gz
   ```

   You now have `backup.dump`.

### Restore into a new Supabase project

Restore into a **new, empty** Supabase project first, never straight over
the live one.

1. Create the new project in Supabase and get its **Session pooler**
   connection string (as in step 1). Below it is called `NEW_DB_URL`.
2. Bring back the accounts first (so the tables that point to them work):

   ```sh
   pg_restore --dbname="NEW_DB_URL" --data-only --schema=auth --table=users --table=identities --table=mfa_factors backup.dump
   ```

3. Bring back Lumora's tables, rules and data:

   ```sh
   pg_restore --dbname="NEW_DB_URL" --no-owner --schema=public backup.dump
   ```

   Some warnings about things that "already exist" are normal.

4. In the new project's **SQL Editor**, run `supabase/setup.sql` from this
   repository once more. It is safe to run again, and it puts back the
   connections a schema-only restore can miss (like the trigger that makes a
   profile for each new account, and the live updates for Planner chat).
5. Point the apps at the new project (`app/src/auth/config.ts`), sign in, and
   check that your plans and accounts are there.

If anything goes wrong, the original backup file is unchanged, so you can
start over with a fresh project.
