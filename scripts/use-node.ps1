$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localNodePath = Join-Path $projectRoot '.tools\node-v24.21.0-win-x64'
if (Test-Path -LiteralPath (Join-Path $localNodePath 'node.exe')) {
    $env:PATH = $localNodePath + ';' + $env:PATH
}
if ((node --version) -ne 'v24.21.0') { throw '需要 Node 24.21.0。请先运行 scripts/bootstrap-node.ps1，或安装同版本 Node。' }
if ((npm.cmd --version) -ne '11.19.0') { throw '需要 npm 11.19.0。请使用已锁定的 Node 分发版本。' }
Write-Output 'Using Node 24.21.0 / npm 11.19.0'
