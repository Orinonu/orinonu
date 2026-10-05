$ErrorActionPreference = 'Stop'
try {
    $taskNode = (Get-Command node.exe -ErrorAction Stop).Source
    $taskInput = [Console]::In.ReadToEnd()
    $taskInput | & $taskNode (Join-Path $PSScriptRoot 'consult.mjs')
} catch { }
exit 0
