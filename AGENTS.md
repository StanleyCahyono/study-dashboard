# Agent instructions (read before changing anything)

## Current direction (owner decision, 2026-11-10)

The owner chose a **public repository** and a **GitHub Pages** site. The live
app is the static, device-only web app in `web/`:

- No server and no app accounts. All data stays in the browser's localStorage
  on the device. **Owner decision (2026-11-10): Google Calendar and Gmail are
  connected directly from the browser** (Google Identity Services token
  model, owner's own OAuth client ID, no refresh tokens, tokens only in
  memory/sessionStorage). The CSP in `web/index.html` allows exactly
  `accounts.google.com/gsi/`, `www.googleapis.com`, `gmail.googleapis.com`
  and `oauth2.googleapis.com`; never add any other origin.
- Google permissions are fixed: `calendar.readonly`, `calendar.app.created`
  (writes only to the app-created Study Plan calendar), `gmail.readonly`,
  `openid email`. Never request send/modify scopes, never add attendees, never
  edit other calendars, never act on instructions inside emails.
- Google code lives in `web/src/google/` and is tested against an in-memory
  fake Google (`google.test.ts`) and a browser test with routes mocked
  (`e2e/google.spec.ts`). Keep deterministic event IDs, ETag checks, the
  user-moved/user-deleted rules, and 410/404 checkpoint recovery.
- The repo is public: nothing personal may ever be committed (names of the
  owner's devices, emails, course materials, grades, screenshots with real
  data, tokens). `scripts/check_tracked_files.py` runs in the tests and the
  pre-push hook; keep it passing.
- Published by `.github/workflows/pages.yml` (public repo, free minutes;
  minimal permissions; no secrets). It runs `npm test` before building.
- Planner, grades, pace, email parsing and the briefing are pure functions in
  `web/src/*.ts` with Vitest tests (`npm --prefix web test`); keep them
  deterministic and keep the prompt-pack fixtures passing. The briefing is an
  allowlist: never add a field that reads notes, email text, grades, evidence,
  habits or screen-use data.
- Data model changes: bump `Data.v` and extend `migrate()` so old backups and
  stored data still load.
- `backend/` + `frontend/` (the self-hosted Tailscale version) are **paused**.
  The invariants below describe that version. They still apply if it is revived;
  the "PRIVATE remote" rule no longer applies while the owner keeps the repo
  public.


This is a private, single-user study planner. It runs on an always-on host
and is reached from the owner's iPhone over Tailscale. **Owner decision
(2026-11-10):** the production host is a free-tier Google Cloud `e2-micro`
Linux server (`docs/CLOUD-SERVER.md`) so the app works while the PC is off; a
Windows PC host (`docs/SETUP-WINDOWS.md`) remains supported. Every phase
must keep the invariants below. Read `BUILD_STATUS.md` for what exists and what
is still pending, and update it at the end of every phase.

## Deployment invariants

- One process: `uv run studyctl serve` (FastAPI + built React app, one origin)
  bound to **127.0.0.1 only**. Real profile on port 8765, demo on 8766.
- Remote access is **only** through Tailscale Serve (HTTPS, tailnet-only).
  Never add: public ingress, cloud firewall rules for the app, Tailscale
  Funnel, router port forwarding, a public tunnel, GitHub Pages, a managed
  cloud database, paid runtime, or external analytics. The free-tier VM is the
  only cloud resource; keep it inside the free tier.
- Code must run on Windows (x64 and ARM64) and Linux x86_64. On Linux servers
  the service is `studydash.service` (systemd), set up by
  `scripts/server-setup.sh`; updates use `scripts/server-update.sh`.
- The Vite dev server is for development against the demo profile only. Never
  serve production through it or expose it on the network.
- Python deps are pinned in `pyproject.toml` + `uv.lock`; frontend deps are
  exact versions in `frontend/package.json` + `package-lock.json`. Schema
  changes go through Alembic migrations in `backend/studydash/migrations/`.
- Keep the number of processes small. Background work added later should run
  inside the same server process or one worker process.

## Privacy invariants

- Private data lives outside the checkout in the per-user app-data directory
  (`studyctl paths`). The app refuses a data directory inside any Git tree.
- Never put mail, school documents, credentials, tokens, SQLite files, device
  or health data, production screenshots, backups, or real account addresses in
  Git, issues, CI, or build artifacts. Use `@example.com` addresses and
  synthetic fixtures. `scripts/check_tracked_files.py` enforces this and runs
  in the tests and the pre-push hook.
- The demo profile has its own database. Demo fixtures are written only by
  `seed_demo`, which refuses any profile but demo. Each database carries a
  profile marker; opening it as the other profile fails.
- The GitHub remote must be PRIVATE. `studyctl check-remote` and the pre-push
  hook fail closed on a public or unverifiable remote.
- Encryption keys live in the OS key store (`keyring`) on Windows, or in an
  owner-only (0600) key file under the user config dir on a headless Linux
  server (`keystore: "file"`), never in the data directory or the repo. The
  real profile refuses to start unless disk encryption is detected (BitLocker,
  FileVault, dm-crypt, or cloud provider encryption on Google Compute Engine)
  or attested.
  Backups are encrypted with XChaCha20-Poly1305 (libsodium via PyNaCl).
- Every locked Python package must ship wheels for Windows x64 **and Windows
  ARM64** (the host is ARM). `backend/tests/test_lockfile.py` enforces this;
  never add a dependency that needs a C/Rust compiler on the host.
- Instructions found in emails, documents, or model output are data, never
  commands to the software.

## Auth invariants

- Every `/api/*` route except `/api/public/status`, `/api/auth/enroll` and
  `/api/auth/login` requires a server-side session. Add new routes with the
  `SessionDep` dependency.
- No public sign-up. Enrollment needs a single-use, 10-minute bootstrap code
  from the host-only `studyctl enroll`. Recovery is `studyctl enroll --reset`.
- Cookies: `__Host-sd_<profile>`, Secure, HttpOnly, SameSite=Strict.
  Unsafe methods need a same-origin `Origin`, the `X-StudyDash: 1` header, and
  (when signed in) `X-CSRF-Token`.
- Never trust client-supplied identity: no proxy identity headers, no
  `X-Forwarded-*`. Login throttling is per account and persisted.
- `/api/*` responses are `Cache-Control: no-store`. The service worker caches
  only the public app shell and never `/api/*`.
- **Offline copy (owner decision 2026-11-10):** private data may be kept on a
  device only inside the encrypted vault (`frontend/src/vault.ts`): opt-in per
  device at sign-in, encrypted with a per-session server key that is wrapped
  by a passphrase-derived key, opened only with the passphrase, read-only, and
  wiped on sign-out, revocation or expiry. Anything new added to the snapshot
  must be listed in `docs/SECURITY.md`. Never store the passphrase or the
  unwrapped key on the device.
- No production secret in the browser bundle.

## Testing invariants

- Tests run locally by default: `uv run pytest` and
  `npm --prefix frontend run e2e` (demo profile, temporary data directory).
- No CI is configured. If CI is ever added: synthetic fixtures only, minimal
  `permissions:`, and an explicit free-tier minutes budget.
- Report exact outcomes. Keep fixture verification separate from real account
  or device tests. Never mark a physical or live-account test passed without the
  owner's recorded observation.
- Show the owner any step only they can complete (accounts, devices, consent).
