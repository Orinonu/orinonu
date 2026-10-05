param([ValidateSet('Prepare','Inject','Check')][string]$Mode)
$ErrorActionPreference = 'Stop'
try {
    $taskNodePath = if ($env:CODEX_MCP_NODE_PATH -and (Test-Path -LiteralPath $env:CODEX_MCP_NODE_PATH)) {
        $env:CODEX_MCP_NODE_PATH
    } else { (Get-Command node.exe -ErrorAction Stop).Source }
    if ($Mode -ne 'Inject') {
        $taskUserKey = [Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY', 'User')
        if ($taskUserKey) { $env:TYPESAFE_API_KEY = $taskUserKey.Trim() }
    }
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $taskHookInput = if ($Mode -eq 'Check') { '{}' } else { [Console]::In.ReadToEnd() }
    $taskHookInput | & $taskNodePath (Join-Path $PSScriptRoot 'hook.mjs') $Mode
} catch {
    '{"systemMessage":"Jev hook could not start; native compaction continues."}'
}
exit 0
