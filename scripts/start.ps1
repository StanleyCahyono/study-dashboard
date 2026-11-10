# Start the app (real profile) on 127.0.0.1:8765. Add -Demo for the synthetic demo on 8766.
param([switch]$Demo)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($Demo) {
    uv run --locked studyctl serve --demo
} else {
    uv run --locked studyctl serve
}
