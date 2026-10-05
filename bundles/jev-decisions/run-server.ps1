$ErrorActionPreference = 'Stop'
try {
    $taskUserKey = [Environment]::GetEnvironmentVariable('TYPESAFE_API_KEY', 'User')
    if ($taskUserKey) { $env:TYPESAFE_API_KEY = $taskUserKey.Trim() }
    $taskNodePath = if ($env:CODEX_MCP_NODE_PATH -and (Test-Path -LiteralPath $env:CODEX_MCP_NODE_PATH)) {
        $env:CODEX_MCP_NODE_PATH
    } else { (Get-Command node.exe -ErrorAction Stop).Source }
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    & $taskNodePath (Join-Path $PSScriptRoot 'server.mjs')
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Jev decisions could not start. Check Node.js and the installed wrapper.')
    exit 1
}
