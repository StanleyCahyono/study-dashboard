# Create or select a PRIVATE GitHub repository as 'origin' and verify it before
# the first push. Fails closed if visibility is public or cannot be verified.
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-remote.ps1 -Repo OWNER/NAME [-Create]
param(
    [Parameter(Mandatory = $true)][string]$Repo,
    [switch]$Create
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "Install the GitHub CLI: winget install --id GitHub.cli -e" }
gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Run 'gh auth login' first." }

if ($Create) {
    gh repo create $Repo --private --disable-wiki --disable-issues
    if ($LASTEXITCODE -ne 0) { throw "Could not create $Repo." }
}

$visibility = (gh api "repos/$Repo" --jq .visibility)
if ($LASTEXITCODE -ne 0 -or $visibility -ne "private") {
    throw "Refusing: $Repo visibility is '$visibility' (must be PRIVATE)."
}

$url = "https://github.com/$Repo.git"
if ((git remote) -contains "origin") { git remote set-url origin $url } else { git remote add origin $url }
git config core.hooksPath .githooks

uv run studyctl check-remote --remote origin
if ($LASTEXITCODE -ne 0) { throw "Remote check failed; not pushing." }
Write-Host "origin -> $url (PRIVATE). The pre-push hook re-checks visibility on every push."
