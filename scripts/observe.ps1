$ErrorActionPreference = 'Stop'
try {
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    $taskScript = Join-Path $PSScriptRoot 'observe.mjs'
    $taskInput = [Console]::In.ReadToEnd()
    $taskInput | & $taskNode $taskScript
} catch { }
exit 0
