# Build status

## Current: Google Calendar + Gmail, gradebook upgrade (2026-11-10)

**Owner requests:** “use Google Calendar and everything”, “link it to my
gcal”; owner shared their grade-tracker spreadsheet (kept private: not in Git;
a converted gradebook JSON was sent to the owner directly).

Google (browser-direct, no server; `web/src/google/`):
- Sign-in with Google Identity Services using the owner's own OAuth client ID
  (stored on device). Identity checked against the intended address and the
  stable Google id; tokens ~1 h, memory/sessionStorage only; revoke on
  disconnect. Scopes: calendar.readonly, calendar.app.created, gmail.readonly,
  openid email.
- Calendar read: calendar list with per-calendar role (classes / fixed / busy
  with hidden titles / deadlines→tasks / ignore); paginated full sync
  (−7 d…+120 d, singleEvents), incremental with syncToken, 410 → full resync,
  checkpoint saved only after all pages; cancelled and declined (owner
  preference) removed; all-day and “free” events don't block; owner edits on
  synced tasks preserved, due-date changes logged as evidence.
- Gmail: owner-editable search filter + lookback; history id for “anything
  new?”, 404 → bounded search; ≤30 messages per sync; text/plain preferred;
  only a quote + link kept; candidates go to the review inbox; duplicates
  across inboxes merged as evidence.
- Study Plan calendar: created by the app; preview diff; publish with
  deterministic event ids (lost reply → 409 → adopt, zero duplicates); ETag
  If-Match deletes; owner-moved blocks kept (and counted by the planner as
  that task's time), owner-deleted blocks never recreated; undo last publish;
  optional auto-update after sync; never attendees, never other calendars.
- Activity log; per-account errors don't stop other accounts.
- Setup guide: `docs/GOOGLE-SETUP.md` (and in-app steps).

Gradebook: per-course cutoffs (default scale marked “assumed”), Cornell 4.3
GPA for every letter, credits, credit-weighted term GPA, Pass/Fail with
threshold, better-of alternative schemes, extra-credit groups on top of 100%,
“Tentative” scores (official vs projected), final-letter-only courses, and
More → “Add grades from a file” (merge by course code). Verified locally that
the owner's spreadsheet converts to exactly the sheet's own results (letters,
pass/fail and term GPA 3.769 over 13 credits); those values are not stored in
the repo. Noted to the owner: the sheet's GPA formulas return #N/A for B− and
below, the composite divides by a fixed 13, and cutoffs jump from C+ to F.

Checks (Linux container):
- `npm --prefix web test`: **60 passed** (42 + 18 Google tests against an
  in-memory fake Google: retries/Retry-After, 401, identity mismatch,
  multi-page sync, moved recurring class changes free time, cancelled/declined/
  all-day/free handling, busy titles hidden, deadlines→tasks keep owner edits,
  410 recovery, interrupted sync without duplicates, two accounts sharing an
  event id, Gmail incremental/expired history/quote-only/duplicate merge,
  deterministic event ids, preview without calls, lost reply → zero
  duplicates, moved block kept, deleted block not recreated, foreign event
  untouched, undo, ETag 412).
- `npm --prefix web run e2e`: **9 passed**, incl. the Google flow in Chromium
  with Google simulated by route mocks (connect, roles, sync, plan preview,
  publish, undo; only allowed origins contacted) and wrong-account refusal.

Not verified (owner): Google Cloud client setup, real sign-in on iPhone
Safari (pop-up behaviour), real calendars/Gmail, whether the Cornell account
allows the app.

---


## Current: prompts 2–12 adapted to the phone-only app (v2, 2026-11-10)

The owner asked for "everything" from the prompt pack inside the GitHub Pages
app. A static site has no server, so anything needing a sign-in to another
service, background work or native device access is replaced by the manual
route each prompt names as its fallback.

Data model v2 (`web/src/store.ts`) migrates v1 data and v1 backups
automatically. New engines are pure TypeScript with unit tests:
`plan.ts`, `grades.ts`, `pace.ts`, `email.ts`, `habits.ts`, `briefing.ts`,
`session.ts`.

| Prompt | What's in the app | Not possible here (why) |
|---|---|---|
| 2 Data model, sync, freshness | Typed v2 model, provenance (`source`, evidence quotes), UID-based re-import, source-coverage checklist per course | Sync worker, server-sent events, OAuth sources (no server) |
| 3 Inboxes and calendar | Paste email / open .eml → review inbox (accept/edit/dismiss), cross-inbox duplicates merged as extra evidence, never acts on email instructions; .ics import incl. exams as fixed commitments | Gmail/Calendar/Graph API access |
| 4 Canvas, syllabi, grades, meetings | Canvas Calendar Feed .ics import, weekly timetable editor, manual + CSV grade import with preview, coverage checklist | Canvas API (needs Cornell approval and a server) |
| 5 What to study + plan | Deterministic planner (sleep/classes/commitments/buffer/daily cap as hard constraints; EDF + bounded importance/weight; strict-EDF fallback), next action with Start/Swap/Snooze, “Why this now?”, “What would change this?”, latest sensible start, infeasibility with missing minutes and competing tasks, “30 fewer minutes” and “prioritize this” previews, 7-day capacity, ICS export of the plan | Writing to Google Calendar (export .ics instead) |
| 6 Notes from materials | Per-course notes with source field and search; per-course AI-use setting with policy reference | PDF/PPTX parsing, OCR, AI summaries (no server, no model; not sent anywhere) |
| 7 Projects, effort, collaboration | Low/typical/high estimates, original estimate kept, steps with owner (me/teammate/undecided), handoff times, dependencies, deadlines flow back through dependencies, waiting-on-teammate, critical path, handoff-at-risk, “one question” missing-fact prompt, copyable teammate message, needs-computer/campus and focus level | Shared access for teammates |
| 8 Grades and forecasts | Weighted groups / points, drops, excused vs posted zero, extra credit, pending items, secured points vs standing vs remaining, needed score with infeasibility, scenarios labelled “not a prediction”, rule-confirmation and source, course pressure comparison | Calibrated forecasts (needs history; shows “insufficient history”) |
| 9 Check-ins, pace, habits | Timer with pause/resume, active vs elapsed time, finish/partial/cancel (idempotent), check-in (4 outcomes + optional minutes/focus/confidence/blocker; skipped = missing, not failure), pace learning (median, shrunk, capped 0.5–2, n shown, reset), habits (weekdays, target, grace day, pause, 4-week trend), energy level changes block length and task choice with explicit conflict | Web Push (needs a server); in-app only |
| 10 Wellness / Screen Time | Manual screen-use check-in, iPhone App Limit instructions, connections table marking each source manual/unavailable; nothing health-related affects plans or grades | HealthKit, Google Health, Strava, FamilyControls (native/OAuth) |
| 11 Release check | Unit + browser tests below; owner runbook in README | Live account tests (no accounts) |
| 12 Briefing for an assistant | Allowlisted serializer, preview with field toggles, course labels anonymised by default, copy with select-text fallback; sentinel test proves notes, emails, grades, screen time are excluded | — |

Checks (fixture-verified, Linux container):
- `npm --prefix web test`: **34 passed** (also passes with `TZ=Asia/Jakarta`).
  Includes: prompt-8 fixture (24 secured, 80% standing, 94.29% needed for
  90%); prelim inside a 40% group counts 20%; excused vs posted zero; drop
  lowest; extra credit; hidden grade; two prelims competing for one 90-min
  evening (earlier wins, other 90 min short; reversing the due dates reverses
  it; prioritize/30-fewer-minutes deltas); extension; group handoff; teammate
  wait; deadline inheritance; phone-only filtering; low-energy choice; email
  date parsing, quoted replies dropped, injected instructions ignored,
  duplicate detection; exam → commitment; pace shrink/cap/reset; habit streak
  with grace; briefing sentinels; v1→v2 migration.
- `npm --prefix web run e2e`: **7 passed** (Chromium): add course → schedule →
  task → next action with reasons; timer pause/resume, double-tap finish
  records one session, check-in corrects minutes; .ics twice without
  duplicates; email paste → accept → second inbox merged as a second source;
  demo grades banner shows 94.29%; plan what-if; briefing excludes course
  names; every tab fits 390 px; backup incl. a v1 backup; offline after first
  visit; **no requests to other origins** in the checked flows.
- Fixed during testing: bottom tab bar could cover focused controls (added
  scroll padding); Swap now snoozes everything ranked above the chosen task;
  default daily cap 6 h (a day was planned at ~10 h); fixed commitments show
  real times rather than buffered ones.
- Publish workflow now runs the unit tests before building.

Not verified (owner): the new version on the iPhone.

---

## Earlier: phone-only web app v1 on GitHub Pages (2026-11-10)

**Owner decision:** stop the self-hosted/cloud server setup; make the repo
public and publish a static app at `https://<owner>.github.io/study-dashboard/`.
The Google Cloud VM was created but never served the app; it should be deleted
(owner action). The self-hosted code (`backend/`, `frontend/`) is kept but paused.

`web/` (React 19 + TypeScript + Vite, no server):
- Today (time, next class, next task, overdue count), Tasks (add, due date,
  estimate, done, delete), Classes (courses, weekly class times), More (.ics
  import, JSON backup export/restore, demo data, delete all, privacy note).
- Data in localStorage only; CSP meta tag blocks any network requests to other
  origins. Service worker caches only the site's own files for offline use.
- .ics import: weekly RRULE → class times; other events → tasks; all-day →
  11:59 PM "time not given"; course code from title/brackets; re-import updates
  by UID; cancelled events skipped.

Checks (fixture-verified, Linux container, Chromium):
- `npm --prefix web run e2e`: **5 passed**: add course/times/task at 390 px,
  persists across reload, mark done, **no requests to other origins**; .ics
  import twice → no duplicates (2 tasks, 2 class times, 2 courses, cancelled
  skipped); backup export/delete/restore and bad file rejected; works offline
  after first visit (fixed: cache lookups needed `ignoreVary`); desktop
  three-column layout.
- `uv run pytest`: 47 passed (paused server code still green).

Owner-reported (2026-11-10): repo switched to **public** (confirmed via the
GitHub API), Pages source set to GitHub Actions, "Publish to GitHub Pages"
workflow run finished green. The live site couldn't be fetched from the
agent's sandbox (network policy), so it hasn't been checked independently yet.
Not yet reported: the site on the iPhone, Add to Home Screen, offline use on
the phone, and cleanup of the old VM, deploy key, Tailscale node and PC autostart.

Not possible with a static site: Gmail/Calendar/Canvas background sync,
notifications, sharing data between phone and PC (use backup export/restore).

---

## Earlier: self-hosted version (paused)

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
- Tailscale: host renamed to a neutral name; `tailscale serve --bg 8765` configured
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
