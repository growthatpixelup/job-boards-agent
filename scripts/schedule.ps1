# Registers (or removes) a Windows Task Scheduler job that runs the /contra-scrape skill
# once a day in headless Claude Code, which fetches jobs through the Contra MCP server.
# Usage:  npm run schedule:install            (daily at 09:00)
#         powershell -File scripts/schedule.ps1 -Time 07:30
#         npm run schedule:remove
param(
  [string]$Time = "09:00",
  [string]$TaskName = "ContraJobsScraper",
  [switch]$Remove
)

$ErrorActionPreference = "Stop"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  exit 0
}

$projectDir = Split-Path -Parent $PSScriptRoot
$claude = (Get-Command claude.cmd).Source
$logDir = Join-Path $projectDir "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null

# Only the read-only Contra tools, writing raw pages, and the ingest script are pre-approved.
$allowed = "mcp__contra__whoami mcp__contra__list_job_feed mcp__contra__get_job_by_slug Write Bash(npm run scrape*)"
# cmd /c so stdout+stderr land in a log file we can inspect after unattended runs.
$cmd = "cd /d `"$projectDir`" && `"$claude`" -p `"/contra-scrape ALL`" --allowedTools `"$allowed`" >> `"$logDir\scrape.log`" 2>&1"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $cmd"
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
# StartWhenAvailable: if the PC was off/asleep at $Time, run as soon as it's back.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Daily Contra jobs scrape via Claude Code + Contra MCP ($projectDir)" -Force | Out-Null

Write-Host "Scheduled '$TaskName' daily at $Time. Logs: $logDir\scrape.log"
Write-Host "Run it now with:  Start-ScheduledTask -TaskName $TaskName"
