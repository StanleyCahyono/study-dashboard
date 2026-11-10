# Connect Google Calendar and Gmail (one-time setup, ~10 minutes)

The Study app is a website with no server. To let it read your calendar and
mail, Google needs to know about it: you register a free “OAuth client” in
Google Cloud and paste its ID into the app. The ID isn't a secret.

## 1. Google Cloud project

1. Open https://console.cloud.google.com/ and sign in.
2. Pick an existing project or create one (top bar → project picker → **New
   project**, e.g. `study`). No billing is needed for these APIs.

## 2. Turn on the two APIs

**APIs & Services → Library**, search and **Enable**:

- Google Calendar API
- Gmail API

## 3. Consent screen (Google Auth Platform)

1. **Branding**: App name `Study`, user support email = your email, developer
   contact = your email. Save.
2. **Audience**: User type **External**. Leave publishing status on
   **Testing**. Under **Test users** add every Google address you'll connect
   (for example both personal Gmail accounts and, if it's on Google, your
   school account).
3. **Data access → Add or remove scopes**, add:
   - `.../auth/calendar.readonly` (read your calendars)
   - `.../auth/calendar.app.created` (manage only the Study Plan calendar the app creates)
   - `.../auth/gmail.readonly` (read mail; the app only opens messages matching your filter)
   - `openid`, `.../auth/userinfo.email` (confirm which account signed in)

## 4. Create the client

**Clients → Create client**:

- Application type: **Web application**
- Name: `Study web`
- **Authorized JavaScript origins**: `https://<your-github-user>.github.io`
  (no path, no trailing slash)
- Authorized redirect URIs: leave empty

Create, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 5. In the app

1. **More → Google Calendar and Gmail → Step 1**: paste the Client ID → Save.
2. **Add an account**: type the address, tick Calendar and/or Gmail →
   **Connect with Google**. Pick that same account in Google's window.
3. Google warns the app is unverified (normal for a personal app in Testing):
   **Continue**, then allow the permissions.
4. **Calendars**: choose how each one is used (Classes, Fixed events, Busy
   only, Deadlines → tasks, Don't use). Then **Sync now**.
5. **Plan → Google Calendar: Study Plan**: choose the account, **Preview
   changes**, then **Publish to Google**. A private calendar called
   “Study Plan” appears in Google Calendar.

Repeat step 5.2 for each account (up to as many as you like). Each account is
checked: if you pick a different account in Google's window, the app refuses.

## What to expect

- **Sync happens while the app is open**, when you tap Sync (or after signing
  in). There's no server, so nothing runs in the background.
- **Sign-ins last about an hour** and live only in that browser tab. After
  that, tap **Sign in** again (usually one tap, no password).
- **In Testing mode**, Google may ask you to approve again after 7 days.
- **School accounts**: a Google Workspace admin can block unverified apps. If
  so, the exact error shows on the account card. Keep using the .ics import
  and email paste for that account. If your school mail is Outlook /
  Microsoft 365, use .eml/.ics files.
- **Canvas deadlines**: in Canvas, Calendar → Calendar Feed → copy the link;
  in Google Calendar, Other calendars → + → From URL → paste. Then set that
  calendar to “Deadlines → tasks” in the app. Google refreshes subscribed
  calendars on its own schedule (often every few hours).

## Removing access

- In the app: **Disconnect and delete** on the account card (also revokes the
  current sign-in).
- At Google: https://myaccount.google.com/permissions → Study → Remove access.
- The Study Plan calendar stays in Google Calendar until you delete it there.
