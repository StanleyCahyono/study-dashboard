# Study

A study planner that runs as a website on your phone:
**https://stanleycahyono.github.io/study-dashboard/**

- **Today:** one justified next action (Start / Swap / Snooze, “Why this
  now?”, “What would change this?”), study timer with check-ins, energy level,
  next fixed commitment, rest of today, habits, copyable study briefing.
- **Plan:** 7-day capacity, deadlines that don't fit (and by how much),
  “30 fewer minutes” and “prioritize this” previews, course priority, export
  the plan as a calendar file.
- **Tasks:** estimates (low/typical/high), importance, needs a computer or
  not, project steps with teammates, handoffs, dependencies, critical path.
- **Courses:** weekly schedule, gradebook (weighted groups or points, drops,
  excused vs missing, extra credit, what-if, needed score, CSV import),
  notes with search, source-coverage checklist, AI-use setting.
- **More:** deadlines from pasted emails (review before adding, duplicates
  merged), calendar (.ics) import, planner settings, pace learning, habits,
  manual screen-use check-in, backup/restore, demo data.
- Your data is stored **only in your browser on your device**. Nothing is
  uploaded; the page blocks requests to other sites. The website is public, but
  everyone who opens it sees only their own data.
- Works offline once opened. On iPhone: Safari → Share → **Add to Home Screen**.
- **Google Calendar and Gmail** (optional): connect from More. Your browser
  talks to Google directly. Calendars feed your free time and deadlines; the
  plan can be published to a private **Study Plan** calendar (preview, undo,
  your own edits kept). Gmail is read-only and filtered. One-time setup:
  [docs/GOOGLE-SETUP.md](docs/GOOGLE-SETUP.md).
- **Grades**: per-course cutoffs, credits, Cornell 4.3 GPA, pass/fail,
  better-of-two schemes, tentative scores, term GPA; import a gradebook file.

The app lives in [`web/`](web/) and is published by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push.

```bash
cd web
npm ci
npm run dev        # http://127.0.0.1:5173/study-dashboard/
npm test           # unit tests (planner, grades, email, briefing…)
npm run e2e        # browser tests
```

---

## Paused: self-hosted server version

`backend/` and `frontend/` hold an earlier self-hosted version (FastAPI server
reached over Tailscale). It's not deployed. Its notes are below and in
`docs/`; read [AGENTS.md](AGENTS.md) before reviving it.


A private, single-user study planner. It runs on an always-on free Google
Cloud server (or your own PC) and you open it from your iPhone over Tailscale.
Nothing is public: no open ports, sign-in required, and the phone can keep an
encrypted copy for when the server can't be reached.

- **Cloud server setup (recommended):** [docs/CLOUD-SERVER.md](docs/CLOUD-SERVER.md)
- Windows PC setup: below and [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md)

- **Phase 1 (this build):** sign-in, a Today screen (time, next class, next
  task, sync status), a labeled demo profile with made-up data, and an empty
  real profile.
- Agents: read [AGENTS.md](AGENTS.md) and [BUILD_STATUS.md](BUILD_STATUS.md).

## Quick start (Windows PowerShell)

Full steps, including installing the tools: [docs/SETUP-WINDOWS.md](docs/SETUP-WINDOWS.md).

```powershell
cd $HOME\code\study-dashboard
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
uv run studyctl enroll
uv run studyctl serve
```

Then open http://127.0.0.1:8765/ on the same computer and enroll with the code.

**One command to start after setup:** `uv run studyctl serve` (or
`.\scripts\start.ps1`). To start automatically after a reboot, run
`.\scripts\install-autostart.ps1` once.

Try the demo (synthetic data, separate database, port 8766):

```powershell
uv run studyctl enroll --demo
uv run studyctl serve --demo
```

## Phone access

[docs/TAILSCALE.md](docs/TAILSCALE.md): install Tailscale, lock down the access
policy, and serve the app over HTTPS inside your tailnet only.

## Security, recovery, backups

[docs/SECURITY.md](docs/SECURITY.md): how sign-in works, recovering access,
signing out a lost phone, disk encryption, and encrypted backups.

## Tests

```powershell
uv run pytest
npm --prefix frontend run e2e
```

Owner-run physical checks: [docs/OWNER-TESTS.md](docs/OWNER-TESTS.md).
