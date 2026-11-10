# Build status

Every phase updates this file. "Fixture-verified" means automated tests with
synthetic data. "Live" means a real account or device, observed by the owner.

## Phase 1: private repo, auth, Today screen (2026-11-10)

### Commands

| Purpose | Command |
|---|---|
| Install (Windows) | `powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1` |
| Start (after setup) | `uv run studyctl serve`, or `.\scripts\start.ps1` |
| Autostart at sign-in | `.\scripts\install-autostart.ps1` |
| Demo | `uv run studyctl enroll --demo`, then `uv run studyctl serve --demo` (port 8766) |
| Enroll / recover owner | `uv run studyctl enroll` / `uv run studyctl enroll --reset` |
| Health check | `uv run studyctl doctor` |
| Backend tests | `uv run pytest` |
| Browser tests (demo, temp data) | `npm --prefix frontend run e2e` (first time on a new machine: `npx --prefix frontend playwright install chromium`) |
| Private-data scan | `uv run python scripts/check_tracked_files.py` |
| Private-remote check | `uv run studyctl check-remote` |

### Stack

Python 3.13 (uv, `requires-python >=3.12,<3.14`), FastAPI 0.162.2, uvicorn
0.54.0, SQLAlchemy 2.1.8 + Alembic 1.20.1, SQLite in WAL mode, pwdlib
(Argon2id), keyring, PyNaCl. React 19.3.1 + TypeScript 7.0.2 + Vite
8.3.7. PWA manifest + service worker that caches only the public shell.

### Migrations

| Revision | Contents |
|---|---|
| `0001_initial` | profile_meta, owner, bootstrap_code, auth_session, course, course_meeting, task |

### Checks passed (fixture-verified, Linux cloud container, 2026-11-10)

- `uv run pytest`: **38 passed** (40 after the ARM fix below). Covers: anonymous `/api` calls return 401
  with `no-store`; no sign-up without a bootstrap code; code is single-use,
  expires, burns after 5 guesses; cookie flags (`__Host-`, Secure, HttpOnly,
  SameSite=Strict); CSRF and Origin enforcement; untrusted Host rejected;
  identity headers ignored; persistent login lockout; logout and device
  revocation; owner reset; idle expiry; only token hashes stored; real profile
  opens empty after the demo runs; demo seeding refuses the real profile;
  profile marker blocks swapping databases; WAL mode; data directory refused
  inside a Git tree; next class across the DST change; encrypted backup
  round-trip into a fresh profile (wrong key, wrong profile, overwrite all
  refused); remote check fails closed for public/internal/unverifiable/non-GitHub
  remotes; tracked-file scan catches planted sentinels.
- `npm --prefix frontend run e2e`: **3 passed** (Chromium, demo profile):
  anonymous API refused; enroll and see Today at **390×844** with no horizontal
  scroll; passphrase sign-in at **1280×800** (three-column layout), Devices
  list, sign out → API returns 401.
- `studyctl serve` (real profile) **refused to start** in the container because
  disk encryption couldn't be confirmed, as designed. `backup create` refused
  without an OS key store. A data root inside the checkout was refused.
- `studyctl check-remote`: `StanleyCahyono/study-dashboard` verified **PRIVATE**
  via `gh api`.

### Not verified yet: needs the owner

| Item | Owner action | Pass condition |
|---|---|---|
| Windows host install | Run `docs/SETUP-WINDOWS.md` steps 1–6 | `studyctl doctor` shows no FAIL; app opens at http://127.0.0.1:8765/ |
| Disk encryption on host | Turn on Device Encryption / BitLocker | `studyctl doctor` → `[PASS] Disk encryption` |
| Credential Manager key store | (automatic on Windows) | `studyctl doctor` → `[PASS] OS key store reachable`; `studyctl backup create` succeeds |
| Autostart after reboot | `install-autostart.ps1`, then reboot | OWNER-TESTS T2 |
| Tailscale + Serve + policy | `docs/TAILSCALE.md` | `tailscale serve status` shows tailnet-only; `tailscale funnel status` is empty |
| **Cellular test, Tailscale off/on** | `docs/OWNER-TESTS.md` T1 | Off: no connection. On: sign-in page over HTTPS; `/api/today` = 401 before sign-in; only the enrolled owner sees data |
| iPhone layout / Add to Home Screen | OWNER-TESTS T3 | Readable, no sideways scroll, installs as app |

Physical test results (owner-reported, 2026-11-10; do not mark passed without an observation):

- Host install: `setup.ps1` finished green on the Windows ARM64 host (after the ARM fix below).
- Owner enrolled on the host at http://127.0.0.1:8765/ and reached Today.
- Tailscale: host named `desklaptop`; `tailscale serve --bg 8765` configured
  (owner initially saw "No serve config" and re-ran it); `studyctl config
  add-host` done; access policy replaced with the tcp:443-only grant and saved.
- Phone signed in through the tailnet address and reached Today.
- T1 cellular, Tailscale **off**: **PASS**. The phone showed the app's cached
  offline screen ("Can't reach your study computer"); no private data shown.
- T1 cellular, Tailscale **on**, and `/api/today` = `not_authenticated` in a
  private tab: owner replied "ok next". **Not explicitly confirmed**; re-check.
- Autostart: `install-autostart.ps1` + `Start-ScheduledTask` worked; phone
  reached the app with no PowerShell window open. **PASS**.
- T2 reboot: _not run_
- T3 phone layout: _not run_
- Disk encryption / key store on host: `studyctl serve` started for the real
  profile, so the disk-encryption gate passed or was attested; `studyctl
  doctor` output not yet reviewed. `backup create` not yet tried on the host.

### Known limits and decisions

- Sign-in uses a passphrase. Passkeys (WebAuthn) are a possible later upgrade.
- Throttling is per account, not per client address: every request reaches
  the app from loopback (directly or via Tailscale Serve), so addresses
  aren't meaningful.
- Tailscale Serve's Host header handling: the app accepts loopback names and
  any name added with `studyctl config add-host`. If the phone gets "Invalid
  host header", add the exact `*.ts.net` name shown by `tailscale serve status`.
- No CI. Tests run locally.
- The Windows-specific pieces (PowerShell scripts, BitLocker detection,
  Credential Manager, Task Scheduler) were written but **not executed** here;
  the container is Linux.
- Sync status is a placeholder ("No sources connected yet") until phase 2.

## Phase 1 fix: Windows on ARM host (2026-11-10)

Owner's first `setup.ps1` run on the host failed: the host is **Windows ARM64**
and `cryptography` 50.x publishes no `win_arm64` wheel, so uv tried to compile
it and stopped with "linker `link.exe` not found". `setup.ps1` also carried on
after the failure.

- Backup encryption moved from `cryptography` (AES-256-GCM) to **PyNaCl 1.6.2**
  (libsodium XChaCha20-Poly1305), which ships `win_arm64` wheels. No backups
  existed yet, so nothing needs migrating.
- New `backend/tests/test_lockfile.py` walks `uv.lock` with Windows markers
  and fails if any package Windows would install lacks a `win_arm64` or
  `win_amd64` wheel. Checked against the old lock: it flags `cryptography`.
  (`cryptography` remains in the lock only as a Linux-only keyring dependency.)
- Frontend native parts (rolldown, lightningcss, TypeScript) have
  `win32-arm64` packages in `package-lock.json`.
- `setup.ps1` now checks every exit code and stops at the first failure.
- `uv run pytest`: **40 passed** (Linux container). Not yet re-run on the host.
- Smart App Control was turned off on the host by the owner while installing
  developer tools. Defender Antivirus remains on.

## Phase 1b: always-on cloud host + encrypted phone copy (2026-11-10)

**Owner decisions:** the app must work while the PC is off → production host
moves to a **free-tier Google Cloud e2-micro** Linux VM (owner accepted that
data then sits on Google-managed encrypted disks). The phone keeps an
**encrypted saved copy** of the latest Today data, opened offline with the
passphrase.

What changed:
- `keystore: "file"`: owner-only (0600 file, 0700 dir) key file under
  `~/.config/StudyDashboard/keys/` for headless Linux; refuses loose
  permissions. `studyctl config set-keystore file|os`.
- Disk check recognises Google Compute Engine (`/sys/class/dmi/id/product_name`)
  as provider-encrypted.
- `scripts/server-setup.sh` (Debian 12: swap, uv, Node 22, build, tests,
  file key store, systemd unit `studydash.service`) and
  `scripts/server-update.sh`.
- `docs/CLOUD-SERVER.md`: account + $1 budget alert, e2-micro in a free
  region with a Standard disk, no HTTP/HTTPS firewall rules, Tailscale, a
  read-only deploy key, install, Serve, enroll, access policy, retiring the PC.
- Migration `0002_snapshot_key`: each session gets a random key, destroyed on
  logout/revoke/expiry/reset; returned by login, enroll and `/api/auth/session`.
- Frontend vault (`vault.ts`): "Keep a locked copy" checkbox (default on);
  snapshot AES-GCM encrypted with the session key; key wrapped with
  PBKDF2-SHA256 (600k) from the passphrase; offline unlock screen; read-only
  "Saved copy · not live" view; wiped on sign-out, 401 (revoked/expired),
  profile mismatch, or "Delete saved copy".
- Service worker v2 precaches the hashed JS/CSS so the offline screen opens
  even on the first visit.
- `studyctl enroll` now prints the tailnet address too (servers have no browser).

Checks (fixture-verified, Linux container, 2026-11-10):
- `uv run pytest`: **47 passed** (adds snapshot-key lifecycle and file key
  store tests).
- `npm --prefix frontend run e2e`: **5 passed**, including: copy saved after
  load, stored record contains no course names or passphrase, offline reload
  shows the unlock screen, wrong passphrase rejected, right passphrase shows
  the saved copy at 390 px, reconnect works, sign-out wipes it, and unticking
  the box stores nothing.
- Simulated server run (real profile, `keystore=file`, attested disk):
  `doctor` all PASS; anonymous `/api/today` 401; unknown Host 400; encrypted
  backup written; key file mode 0600.

Not verified (owner): creating the Google Cloud VM, `server-setup.sh` on the
real VM, Tailscale on the VM, OWNER-TESTS T4 (PC off) and T5 (saved copy on
the iPhone). The Windows PC host from Phase 1 still runs until step 10 of
CLOUD-SERVER.md retires it.

## Next phase

Phase 2: data model, sync worker, freshness. Preserve everything above.
