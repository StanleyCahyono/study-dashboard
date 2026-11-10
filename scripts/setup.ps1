# One-time setup on the Windows host. Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# Windows PowerShell does not stop when an external program fails, so check
# every exit code ourselves and stop at the first failure.
function Invoke-Step([string]$Label, [scriptblock]$Command) {
    Write-Host ""
    Write-Host "== $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "SETUP STOPPED: '$Label' failed (exit code $LASTEXITCODE)." -ForegroundColor Red
        Write-Host "Copy the error above and ask for help. Nothing after this step was run."
        exit 1
    }
}

foreach ($tool in @("git", "uv", "node", "npm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Missing '$tool'. Install it first (see docs/SETUP-WINDOWS.md), then open a new PowerShell window."
    }
}

Invoke-Step "Install pinned Python dependencies" { uv sync --locked }
Invoke-Step "Install pinned frontend dependencies" { npm --prefix frontend ci }
Invoke-Step "Build the frontend" { npm --prefix frontend run build }
Invoke-Step "Enable the pre-push privacy hook" { git config core.hooksPath .githooks }
Invoke-Step "Run tests (synthetic data only)" { uv run pytest }
Invoke-Step "Show data locations (outside this repository)" { uv run studyctl paths }

Write-Host ""
Write-Host "== Health check"
uv run studyctl doctor
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Setup finished, but the health check found something to fix (see FAIL lines above)." -ForegroundColor Yellow
    Write-Host "The demo still works: uv run studyctl enroll --demo ; uv run studyctl serve --demo"
    exit 0
}
Write-Host ""
Write-Host "Setup complete. Next: uv run studyctl enroll    (then open http://127.0.0.1:8765/)" -ForegroundColor Green
