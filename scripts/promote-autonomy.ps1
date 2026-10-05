param(
    [string]$InstalledRoot = (Join-Path $env:USERPROFILE '.codex/tools/jev-mission-control'),
    [string]$DataRoot = (Join-Path $env:USERPROFILE '.codex/mission-control'),
    [int]$ApiPort = 18792,
    # Optional and explicit, for example '3/3/3' (planning/implementation/review). Not applied unless given.
    [string]$SchedulerLimits = '',
    [switch]$SkipTests,
    [switch]$NoRestart,
    [switch]$DryRun
)
# Run it as: powershell -ExecutionPolicy Bypass -File scripts/promote-autonomy.ps1 [-DryRun] [-SchedulerLimits 3/3/3]
# Promotes this repository to the installed copy: tests first, backup, controlled restart, health checks, automatic rollback.
# It refuses to run while executors are active (a restart would turn their work into unconfirmed attempts) and never touches
# credentials, hook trust, Codex configuration or the user's saved scheduler limits unless -SchedulerLimits is given.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskParts = @('src', 'public', 'scripts', 'docs', 'bundles', 'evals', 'package.json', 'CONTEXT.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'CLA.md', 'CONTRIBUTING.md', 'GOVERNANCE.md', 'installation.json')
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskBackup = Join-Path $DataRoot ("backups/autonomy-no-stall-$taskStamp")
$taskApi = "http://127.0.0.1:$ApiPort"
function Say([string]$message) { Write-Output ("[promote] " + $message) }
function Get-State { try { Invoke-RestMethod "$taskApi/api/state" -TimeoutSec 5 } catch { $null } }
function Get-Listener {
    $taskConnection = Get-NetTCPConnection -LocalPort $ApiPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($taskConnection) { Get-CimInstance Win32_Process -Filter "ProcessId=$($taskConnection.OwningProcess)" } else { $null }
}
function Copy-Parts([string]$from, [string]$to) {
    foreach ($taskPart in $taskParts) {
        $taskSource = Join-Path $from $taskPart
        if (Test-Path -LiteralPath $taskSource) { Copy-Item -LiteralPath $taskSource -Destination $to -Recurse -Force }
    }
}
function Stop-Server($taskListener) {
    if ($taskListener) { Stop-Process -Id $taskListener.ProcessId -Force; Start-Sleep -Seconds 2 }
}

if ($SchedulerLimits -and $SchedulerLimits -notmatch '^\d{1,2}/\d{1,2}/\d{1,2}$') { throw "SchedulerLimits must look like 3/3/3." }
& $taskNode (Join-Path $PSScriptRoot 'record-installation.mjs') --verify-evals $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'Evaluation fixture verification failed; promotion stopped.' }

# 1. Validation comes first: nothing is promoted from a failing tree.
if (-not $SkipTests -and -not $DryRun) {
    Say 'running the Node suite and the installer test'
    & $taskNode (Join-Path $PSScriptRoot 'check-runtime.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native SQLite runtime check failed; promotion stopped.' }
    Push-Location $taskRoot
    try { & $taskNode --test --test-concurrency=2 'tests/*.test.mjs' 'tests/acceptance/*.test.mjs' 'bundles/jev-decisions/*.test.mjs' } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw 'Validation failed; promotion stopped.' }
    $taskPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($taskPython) { & $taskPython.Source (Join-Path $taskRoot 'tests/configure_test.py'); if ($LASTEXITCODE -ne 0) { throw 'Installer validation failed; promotion stopped.' } }
}

# 2. Preflight against the live server.
$taskBefore = Get-State
$taskListener = $null
$taskIdentities = @()
if ($taskBefore) {
    $taskRunning = @($taskBefore.scheduler.running.psobject.Properties | Where-Object Value -gt 0)
    if ($taskRunning.Count) { throw 'Active executors found; promotion refused. Wait for them to finish or stop them from the panel.' }
    $taskReservations = @($taskBefore.tasks | Where-Object {
        $_.external_work.status -eq 'active' -or
        ($_.desktop_review.status -eq 'active' -and [DateTimeOffset]::Parse($_.desktop_review.expires_at) -gt [DateTimeOffset]::UtcNow) -or
        ($_.attempt -and $_.attempt.state -ne 'terminal')
    })
    if ($taskReservations.Count) { throw 'Active or unconfirmed session reservations found; promotion refused.' }
    $taskListener = Get-Listener
    $taskExpected = (Join-Path $InstalledRoot 'src/server.mjs')
    if ($taskListener -and $taskListener.CommandLine -notlike "*$taskExpected*" -and -not $DryRun) { throw "The server on port $ApiPort is not the installed copy ($taskExpected); promotion refused." }
    $taskIdentities = @($taskBefore.tasks | Select-Object id, status)
    Say ("live server found: {0} missions, no active executors" -f $taskIdentities.Count)
} else { Say 'no live server found on the port; files only' }

if ($DryRun) {
    Say "dry run: would back up to $taskBackup"
    Say ("dry run: would copy {0} into {1}" -f ($taskParts -join ', '), $InstalledRoot)
    if ($SchedulerLimits) { Say "dry run: would set scheduler limits to $SchedulerLimits" }
    if (-not $NoRestart) { Say 'dry run: would restart the server and verify /api/state, /api/flow and /api/decisions' }
    return
}

# 3. Backup of the installed copy and of the durable state.
New-Item -ItemType Directory -Path $taskBackup -Force | Out-Null
if (Test-Path -LiteralPath $InstalledRoot) { Copy-Parts $InstalledRoot (New-Item -ItemType Directory -Path (Join-Path $taskBackup 'installed') -Force).FullName }
foreach ($taskFile in @('state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'state.json', 'events.ndjson', 'pricing.json', 'currency.json', 'runtime.json')) {
    $taskPath = Join-Path $DataRoot $taskFile
    if (Test-Path -LiteralPath $taskPath) { Copy-Item -LiteralPath $taskPath -Destination (Join-Path $taskBackup $taskFile) -Force }
}
$taskIdentities | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $taskBackup 'task-identities.json')
Say "backup written to $taskBackup"

# 4. Replace the installed files, then start the new server.
function Restore-All {
    Say 'rolling back to the backup'
    Stop-Server (Get-Listener)
    if (Test-Path -LiteralPath (Join-Path $taskBackup 'installed')) { Copy-Parts (Join-Path $taskBackup 'installed') $InstalledRoot }
    if (Test-Path -LiteralPath (Join-Path $taskBackup 'installed/evals/MANIFEST.json')) {
        & $taskNode (Join-Path $PSScriptRoot 'record-installation.mjs') --verify-evals $InstalledRoot
        if ($LASTEXITCODE -ne 0) { throw 'Restored evaluation fixtures failed verification; restart refused.' }
    }
    foreach ($taskFile in @('state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'state.json', 'events.ndjson')) {
        $taskSaved = Join-Path $taskBackup $taskFile
        if (Test-Path -LiteralPath $taskSaved) { Copy-Item -LiteralPath $taskSaved -Destination (Join-Path $DataRoot $taskFile) -Force }
    }
    if (-not $NoRestart) { & (Join-Path $InstalledRoot 'scripts/start.ps1') }
}
try {
    if (-not $NoRestart) { Stop-Server $taskListener }
    New-Item -ItemType Directory -Path $InstalledRoot -Force | Out-Null
    Copy-Parts $taskRoot $InstalledRoot
    & $taskNode (Join-Path $PSScriptRoot 'record-installation.mjs') $taskRoot $InstalledRoot
    if ($LASTEXITCODE -ne 0) { throw 'Installation provenance could not be recorded.' }
    foreach ($taskCheck in @('src/server.mjs', 'src/decisions.mjs', 'src/stall.mjs', 'src/breaker.mjs', 'src/receipts.mjs', 'evals/MANIFEST.json')) {
        if ((Get-FileHash (Join-Path $taskRoot $taskCheck)).Hash -ne (Get-FileHash (Join-Path $InstalledRoot $taskCheck)).Hash) { throw "Copy verification failed for $taskCheck." }
    }
    Say 'installed copy matches the repository'
    if ($NoRestart) { Say 'restart skipped (-NoRestart); the running server still has the old code'; return }

    & (Join-Path $InstalledRoot 'scripts/start.ps1')
    $taskAfter = $null
    for ($taskTry = 0; $taskTry -lt 30 -and -not $taskAfter; $taskTry++) { Start-Sleep -Seconds 1; $taskAfter = Get-State }
    if (-not $taskAfter) { throw 'The new server did not answer; rolling back.' }
    foreach ($taskRoute in @('/api/flow', '/api/decisions')) { Invoke-RestMethod "$taskApi$taskRoute" -TimeoutSec 10 | Out-Null }
    if ($taskIdentities.Count) {
        $taskKept = @($taskAfter.tasks | Select-Object -ExpandProperty id)
        $taskLost = @($taskIdentities | Where-Object { $taskKept -notcontains $_.id })
        if ($taskLost.Count) { throw "$($taskLost.Count) missions disappeared after the restart; rolling back." }
    }
    Say ("new server healthy: {0} missions preserved" -f @($taskAfter.tasks).Count)
    if ($SchedulerLimits) {
        $taskParts3 = $SchedulerLimits -split '/'
        $taskBody = @{ planning_limit = [int]$taskParts3[0]; implementation_limit = [int]$taskParts3[1]; review_limit = [int]$taskParts3[2] } | ConvertTo-Json
        Invoke-RestMethod -Method Patch -Uri "$taskApi/api/scheduler" -ContentType 'application/json' -Body $taskBody | Out-Null
        Say "scheduler limits set to $SchedulerLimits (explicit request)"
    }
} catch {
    Say ("promotion failed: " + $_.Exception.Message)
    Restore-All
    throw
}
Say ('done. Backup: ' + $taskBackup)
