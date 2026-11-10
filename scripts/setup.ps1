# One-time setup on the Windows host. Run from the repository root:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

foreach ($tool in @("git", "uv", "node", "npm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "Missing '$tool'. Install it first (see docs/SETUP-WINDOWS.md), then open a new PowerShell window."
    }
}

Write-Host "Installing pinned Python dependencies..."
uv sync --locked
Write-Host "Installing pinned frontend dependencies and building..."
npm --prefix frontend ci
npm --prefix frontend run build

Write-Host "Enabling the pre-push privacy hook..."
git config core.hooksPath .githooks

Write-Host "Running tests (synthetic data only)..."
uv run pytest

Write-Host ""
Write-Host "Data locations (outside this repository):"
uv run studyctl paths
Write-Host ""
uv run studyctl doctor
Write-Host ""
Write-Host "Next: uv run studyctl enroll    (then open http://127.0.0.1:8765/)"
