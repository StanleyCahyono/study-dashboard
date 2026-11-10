# Register a per-user scheduled task that starts the app when you sign in to
# Windows (so it comes back after a reboot). Does not need administrator rights.
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1 -Remove
param([switch]$Remove)
$ErrorActionPreference = "Stop"
$TaskName = "StudyDashboard"
$Repo = Split-Path $PSScriptRoot -Parent

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName'."
    exit 0
}

$Start = Join-Path $Repo "scripts\start.ps1"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Start`"" `
    -WorkingDirectory $Repo
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Principal $Principal -Description "Private study dashboard on 127.0.0.1:8765" -Force | Out-Null
Write-Host "Registered '$TaskName'. It starts at sign-in. Start it now with:"
Write-Host "  Start-ScheduledTask -TaskName $TaskName"
