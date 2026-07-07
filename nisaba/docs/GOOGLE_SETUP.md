# One-time Google setup (~15 minutes)

Nisaba syncs through **your own Google Drive** — there is no Nisaba server.
For that, Google requires the app to identify itself with an OAuth **Client
ID** that you create in your own Google account. You do this once; both your
phone and desktop then use it.

Nothing you create here is secret: a browser app's Client ID is public by
design. You will never paste a password or secret key into Nisaba.

> **On a phone?** The whole setup works in a mobile browser. Use the direct
> links in each step below (the console's mobile layout hides some buttons,
> e.g. "New project"), and if a page renders oddly, enable **Request desktop
> site** in the browser menu. The Google Cloud mobile *app* cannot create
> OAuth credentials — use the browser.

## Step 1 — Create a Google Cloud project

1. Sign in with the Google account whose Drive should hold your notes and
   open the New Project form directly:
   **https://console.cloud.google.com/projectcreate**
   (If you get a welcome/terms page first, accept and open the link again.)
2. Name: `Nisaba` → **Create** → wait a few seconds, then make sure the new
   project is selected in the top bar.

No billing setup is needed — everything used here is free.

## Step 2 — Enable the Drive API

1. Open **https://console.cloud.google.com/apis/library/drive.googleapis.com**
   (or menu ☰ → APIs & Services → Library → search "Google Drive API").
2. Check `Nisaba` is the selected project in the top bar → **Enable**.

## Step 3 — Configure the consent screen

1. Open **https://console.cloud.google.com/apis/credentials/consent**
   (or menu ☰ → APIs & Services → OAuth consent screen; Google is migrating
   this UI to "Google Auth Platform" — same settings, slightly different
   navigation; if asked, click **Get started**).
2. App name: `Nisaba`. User support email: your email. Audience/User type:
   **External**. Developer contact: your email. Save through the steps —
   you do NOT need to add scopes or test users here.
3. **Important — publish the app:** on the consent screen (or "Audience")
   page, change Publishing status from *Testing* to **In production**
   (button: "Publish app").
   *Why:* while an app is in Testing, Google kills its sign-ins every 7 days —
   you'd be re-logging in weekly forever. Publishing removes that. Because
   Nisaba only uses the `drive.file` scope (it can only see files it created,
   never your whole Drive), publishing does not require any Google review.

## Step 4 — Create the Client ID

1. Open **https://console.cloud.google.com/apis/credentials/oauthclient**
   (or menu ☰ → APIs & Services → Credentials → + Create credentials →
   OAuth client ID).
2. Application type: **Web application**. Name: `Nisaba`.
3. Under **Authorized JavaScript origins**, add every URL you'll open the app
   from:
   - `http://localhost:5173` (local development)
   - `https://<your-github-username>.github.io` (once the PWA is hosted there)
4. **Create**, then copy the **Client ID** — it looks like
   `1234567890-abcdefg.apps.googleusercontent.com`.

## Step 5 — Paste it into Nisaba

Open Nisaba; the first-run screen asks for the Client ID. Paste it, save, and
hit **Connect Google Drive**. Google will show a consent popup for
"See, edit, create and delete only the specific Google Drive files that you
use with this app" — that's the `drive.file` scope doing its job.

After that, a `Nisaba/` folder appears in your Drive containing your notes as
readable JSON files and your images as ordinary files. That folder *is* your
data — back it up, inspect it, or take it elsewhere anytime.

## Troubleshooting

- **"Access blocked: authorization error / origin mismatch"** — the URL in
  your browser isn't in Authorized JavaScript origins (step 4.3). Add it
  exactly (scheme + host + port, no trailing slash) and retry after a minute.
- **Sign-in works but stops after a week** — you skipped step 3.3 (app still
  in Testing). Publish to production.
- **Consent screen shows "unverified app" warning** — can happen briefly
  after publishing; click "Advanced → continue". With only the `drive.file`
  scope it does not require verification and typically disappears.
