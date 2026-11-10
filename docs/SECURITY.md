# Security, recovery and backups

## How sign-in works

- **No sign-up.** The only way to create the owner account is a one-time code
  from `studyctl enroll`, which can only be run on the host. The code is 144
  random bits, works once, expires in 10 minutes, and is burned after 5 wrong
  guesses. Only its SHA-256 hash is stored.
- **Passphrase** of 12+ characters, hashed with Argon2id (`pwdlib`).
- **Sessions** are stored on the server. The browser holds a random 256-bit
  token in a `__Host-` cookie (Secure, HttpOnly, SameSite=Strict). The
  database keeps only the token's hash, so a copied database can't be used to
  sign in. Sessions end after 14 days without use or 30 days in total, and you
  can revoke any of them.
- **CSRF:** every change request needs a same-origin `Origin`, a custom
  `X-StudyDash` header, and a per-session CSRF token.
- **Throttling:** after 5 wrong passphrases the account locks for 1 minute,
  doubling each further failure up to 1 hour. The counter is stored on disk,
  so restarting doesn't reset it.
- **No trusted identity headers.** The app never reads `Tailscale-User-*`,
  `X-Forwarded-*` or similar headers to decide who you are. Being on the
  tailnet is not enough; you still need the passphrase.
- **No caching of private data.** Every `/api` response is `no-store`. The
  offline cache holds only the public app shell (HTML, JS, CSS, icons).
- Security headers: strict Content-Security-Policy, no framing, no referrer.

## Saved copy on the phone

If you leave **Keep a locked copy on this device** ticked when signing in, the
phone stores your latest Today screen so you can read it when the server can't
be reached.

- What is saved: the Today data (next class, next task, overdue count, sync
  status). Nothing else yet. Later phases will list anything they add here.
- How it's protected: encrypted (AES-256-GCM) with a random key that the
  server creates for that one signed-in device. That key is itself encrypted
  with a key derived from your passphrase (PBKDF2-SHA256, 600,000 rounds).
  Opening the copy offline needs your passphrase. The passphrase is never
  stored.
- It's read-only and clearly marked **Saved copy · not live**.
- It's deleted when you sign out, when the device is signed out from the
  Devices page or `studyctl sessions revoke`, when the session expires (the
  next time the phone reaches the server), or with **Delete saved copy**.
- Limits: someone who had your unlocked phone *and* your passphrase could read
  it. If a phone is lost while offline, its copy stays on it until it next
  reaches the server; iPhone storage encryption and your passphrase protect
  it until then.

## Recovering access (forgot passphrase)

On the server (cloud SSH window, inside `study-dashboard`) or the Windows host:

```bash
uv run studyctl enroll --reset
```

This clears the passphrase, signs out every device, and prints a new one-time
code. Your study data is kept. Open the app and enroll again with the code.

## Signing out a lost or old device

- In the app: **Devices** → **Sign out** next to the device.
- On the host: `uv run studyctl sessions list`, then
  `uv run studyctl sessions revoke <id>` or `uv run studyctl sessions revoke-all`.
- Also remove the device from the tailnet: Tailscale admin console →
  Machines → device → **Remove**.

## Disk encryption

The real profile refuses to start unless the data drive is encrypted
(BitLocker / Device Encryption on Windows; FileVault on macOS; dm-crypt on
Linux; on a Google Cloud server, Google's at-rest disk encryption, which uses
keys Google manages). If detection can't confirm it but you know the drive is encrypted, run
`uv run studyctl attest-disk-encryption`; the attestation and date are saved
in the profile config. The demo profile holds only synthetic data and skips
this check.

## Keys

Keys are kept in the OS key store (Windows Credential Manager) under
`StudyDashboard/<profile>`. A cloud server has no such store, so there they
live in `~/.config/StudyDashboard/keys/<profile>.json`, readable only by the
service account (the app refuses to use the file if its permissions are
looser). Never in the repository, the database, or the browser bundle.

## Encrypted backups

```powershell
uv run studyctl backup create                 # writes to <data dir>\real\backups\
uv run studyctl backup create --out E:\study-backup.sdbk
```

Backups are encrypted (XChaCha20-Poly1305) with a random key stored in the
key store. To restore on another computer you need the **recovery key**. Show it
once and store it **apart from the backups** (paper is fine):

```powershell
uv run studyctl backup recovery-key
```

Restore (only into an empty profile; the current database must not exist):

```powershell
uv run studyctl backup restore E:\study-backup.sdbk                 # same computer
uv run studyctl backup restore E:\study-backup.sdbk --recovery-key  # new computer
```

A backup from the demo profile can't be restored into the real profile, and
the reverse. Retention and automatic scheduling come in a later phase; for
now, delete old backup files yourself. Deleting data later does not change
backups you already made, so delete old backups too if you want that data gone.
