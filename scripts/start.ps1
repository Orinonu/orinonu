param([switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCodexRoot = Join-Path $env:USERPROFILE '.codex'
$taskData = Join-Path $taskCodexRoot 'mission-control'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
& $taskNode (Join-Path $PSScriptRoot 'check-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Native SQLite runtime check failed; startup stopped.' }
$taskKey = [Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY', 'User')
if ($taskKey) { $env:TYPESAFE_API_KEY = $taskKey.Trim() }
if (-not $env:HERMES_CLI_PATH) {
    $taskHermes = Get-Command hermes.exe -ErrorAction SilentlyContinue
    if ($taskHermes) { $env:HERMES_CLI_PATH = $taskHermes.Source }
}
if (-not $env:CODEX_CLI_PATH) {
    $taskSettings = Join-Path $taskData 'runtime.json'
    if (Test-Path -LiteralPath $taskSettings) {
        $taskRuntime = Get-Content -LiteralPath $taskSettings -Raw | ConvertFrom-Json
        if (Test-Path -LiteralPath $taskRuntime.codex_path) { $env:CODEX_CLI_PATH = $taskRuntime.codex_path }
    }
}
New-Item -ItemType Directory -Path $taskData -Force | Out-Null
$taskReady = $false
try {
    $taskHealth = Invoke-RestMethod 'http://127.0.0.1:18792/api/state' -TimeoutSec 1
    $taskReady = $taskHealth.version -eq '0.0.5' -and $taskHealth.persistence.schema -eq 1 -and $null -ne $taskHealth.context
} catch { }
if ($null -ne $taskHealth -and -not $taskReady) { throw 'A legacy or incompatible server is running. Stop it and its executors before migration.' }
if (-not $taskReady) {
    $taskServer = Join-Path $taskRoot 'src/server.mjs'
    Start-Process -FilePath $taskNode -ArgumentList @(('"' + $taskServer + '"')) -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskData 'server.log') -RedirectStandardError (Join-Path $taskData 'server-error.log') | Out-Null
}
if ($OpenBrowser) { Start-Process 'http://127.0.0.1:18792/' }
