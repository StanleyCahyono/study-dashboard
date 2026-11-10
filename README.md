# Study Dashboard (private)

A private, single-user study planner. It runs on your own Windows computer and
you open it from your iPhone over Tailscale. Nothing is hosted in the cloud.

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
