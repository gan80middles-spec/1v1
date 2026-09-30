$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$archivePath = Join-Path $toolsRoot 'node-v24.21.0-win-x64.zip'
$expectedHash = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile $archivePath -TimeoutSec 180
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $expectedHash) { throw 'Node 分发文件 SHA-256 不匹配。停止安装。' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsRoot -Force
Write-Output 'Node 24.21.0 downloaded and SHA-256 verified. Run . ./scripts/use-node.ps1 next.'
