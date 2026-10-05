param([switch]$Start, [switch]$ReinstallCompaction)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskCodex = Join-Path $env:USERPROFILE '.codex'
$taskCli = if ($env:CODEX_CLI_PATH -and (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) { $env:CODEX_CLI_PATH } else { (Get-Command codex.exe -ErrorAction Stop).Source }
$taskPython = (Get-Command python.exe -ErrorAction Stop).Source
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
& $taskNode (Join-Path $PSScriptRoot 'check-runtime.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Native SQLite runtime check failed; installation stopped.' }
& $taskNode (Join-Path $PSScriptRoot 'record-installation.mjs') --verify-evals $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'Evaluation fixture verification failed; installation stopped.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'public/ui/index.html'))) { throw 'Execute npm run build:ui antes de instalar a interface Orinonu.' }
Push-Location $taskRoot
try { & $taskNode --test 'tests/*.test.mjs' 'tests/acceptance/*.test.mjs' 'bundles/jev-decisions/*.test.mjs' } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Validation failed; installation stopped.' }
& $taskPython (Join-Path $taskRoot 'tests/configure_test.py')
if ($LASTEXITCODE -ne 0) { throw 'Installer validation failed.' }
foreach ($taskComponent in @('jev-decisions', 'jev-mission-control')) {
    $taskDestination = Join-Path $taskCodex "tools/$taskComponent"
    New-Item -ItemType Directory -Path $taskDestination -Force | Out-Null
    if ($taskComponent -eq 'jev-decisions') {
        Get-ChildItem -LiteralPath (Join-Path $taskRoot 'bundles/jev-decisions') -Force | Copy-Item -Destination $taskDestination -Recurse -Force
    } else {
        foreach ($taskPart in @('src','public','scripts','docs','bundles','evals','package.json','CONTEXT.md')) {
            Copy-Item -LiteralPath (Join-Path $taskRoot $taskPart) -Destination $taskDestination -Recurse -Force
        }
    }
    foreach ($taskLegalPart in @('LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CLA.md','CONTRIBUTING.md','GOVERNANCE.md')) {
        Copy-Item -LiteralPath (Join-Path $taskRoot $taskLegalPart) -Destination $taskDestination -Force
    }
    if ($taskComponent -eq 'jev-mission-control') {
        & $taskNode (Join-Path $PSScriptRoot 'record-installation.mjs') $taskRoot $taskDestination
        if ($LASTEXITCODE -ne 0) { throw 'Installation provenance could not be recorded.' }
    }
}
$taskLocalSkills = Join-Path $env:USERPROFILE '.agents/skills'
New-Item -ItemType Directory -Path $taskLocalSkills -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $taskRoot 'bundles/skills') -Directory | ForEach-Object {
    if (-not (Test-Path -LiteralPath (Join-Path $taskLocalSkills $_.Name))) { Copy-Item -LiteralPath $_.FullName -Destination $taskLocalSkills -Recurse }
}
& $taskPython (Join-Path $PSScriptRoot 'configure.py') --root $taskRoot --codex $taskCodex --user $env:USERPROFILE --cli $taskCli --devin-config (Join-Path $env:APPDATA 'devin/config.json')
if ($LASTEXITCODE -ne 0) { throw 'Global configuration failed.' }
$taskPlugin = Join-Path $taskCodex 'plugins/sources/jev-context/plugins/fast-jev-compaction-codex'
if ($ReinstallCompaction -or -not (Test-Path -LiteralPath (Join-Path $taskPlugin '.codex-plugin/plugin.json'))) {
    $taskMarketplace = Join-Path $taskCodex 'plugins/sources/jev-context'
    New-Item -ItemType Directory -Path $taskPlugin -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $taskRoot 'bundles/fast-jev-compaction-codex') -Force | Copy-Item -Destination $taskPlugin -Recurse -Force
    $taskMarketDir = Join-Path $taskMarketplace '.agents/plugins'
    New-Item -ItemType Directory -Path $taskMarketDir -Force | Out-Null
    @{name='jev-local';interface=@{displayName='Jev Local'};plugins=@(@{name='fast-jev-compaction-codex';source=@{source='local';path='./plugins/fast-jev-compaction-codex'};policy=@{installation='AVAILABLE';authentication='ON_INSTALL'};category='Developer Tools'})} | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $taskMarketDir 'marketplace.json') -Encoding utf8
    & $taskCli plugin marketplace add $taskMarketplace --json
    if ($LASTEXITCODE -ne 0) { throw 'Marketplace registration failed.' }
    & $taskCli plugin add 'fast-jev-compaction-codex@jev-local' --json
    if ($LASTEXITCODE -ne 0) { throw 'Compaction plugin installation failed.' }
}
if ($Start) { & (Join-Path $taskCodex 'tools/jev-mission-control/scripts/start.ps1') }
Write-Output 'Global installation complete. Review the new hooks in Codex; restart sessions to load the new MCP tool.'
