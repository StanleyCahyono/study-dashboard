# Windows host setup (exact PowerShell steps)

Run these in **Windows PowerShell** on the computer that will host the app.
Commands that need you to sign in to something are marked **(you)**.

## 1. Install the tools (once)

```powershell
winget install --id Git.Git -e
winget install --id GitHub.cli -e
winget install --id astral-sh.uv -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Tailscale.Tailscale -e
```

Close PowerShell and open a new window so the new commands are on `PATH`, then check:

```powershell
git --version; gh --version; uv --version; node --version
```

Node must be 22.12 or newer. uv downloads the pinned Python (3.13) by itself.

## 2. Turn on disk encryption (once)

The real profile refuses to start unless the drive holding your data is
encrypted. Settings → Privacy & security → **Device encryption** (Windows Home)
or **BitLocker** (Windows Pro). Save the recovery key in your Microsoft account
or on paper, not on the same disk. Check:

```powershell
(New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection')
```

`1` means on. If your drive is encrypted but this prints something else, run
`uv run studyctl attest-disk-encryption` after setup to record that yourself.

## 3. Get the private repository (once)

**(you)** Sign in to GitHub:

```powershell
gh auth login
```

Clone the existing private repository:

```powershell
mkdir $HOME\code -Force; cd $HOME\code
gh repo clone <your-github-user>/study-dashboard
cd study-dashboard
```

If you are starting a brand-new private repo instead, from an existing local checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-remote.ps1 -Repo <your-github-user>/study-dashboard -Create
```

`setup-remote.ps1` creates it as **private**, checks the visibility with the
GitHub CLI, and stops if it is public or cannot be verified. The pre-push hook
repeats that check on every `git push`.

## 4. Install, build and test

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

This runs `uv sync --locked`, `npm ci`, the frontend build, enables the
pre-push hook, runs the test suite, and prints `studyctl doctor`.

## 5. Enroll yourself (host only)

```powershell
uv run studyctl enroll
uv run studyctl serve
```

Open http://127.0.0.1:8765/ **on this computer**, enter the one-time code and
choose a passphrase (12+ characters; a few random words works well). The code
works once and expires after 10 minutes. Never paste it into a chat.

## 6. Start automatically after a reboot

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
Start-ScheduledTask -TaskName StudyDashboard
```

The app starts when you sign in to Windows. Tailscale starts as a Windows
service, and `tailscale serve --bg` (next step) remembers its setting across
reboots. The computer must be awake and online for the phone to reach it. To
stop it from sleeping while plugged in:

```powershell
powercfg /change standby-timeout-ac 0
```

To remove autostart: `.\scripts\install-autostart.ps1 -Remove`.

## 7. Phone access

Continue with [TAILSCALE.md](TAILSCALE.md).

## Everyday commands

| What | Command |
|---|---|
| Start (real) | `uv run studyctl serve` |
| Start demo | `uv run studyctl serve --demo` |
| Health check | `uv run studyctl doctor` |
| Where data lives | `uv run studyctl paths` |
| Signed-in devices | `uv run studyctl sessions list` |
| Sign out everything | `uv run studyctl sessions revoke-all` |
| Locked out | `uv run studyctl enroll --reset` |
| Encrypted backup | `uv run studyctl backup create` |
| Update | `git pull; uv sync --locked; npm --prefix frontend ci; npm --prefix frontend run build` then restart |
