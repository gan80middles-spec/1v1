$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$exportLock = Get-Content -LiteralPath (Join-Path $projectRoot 'content/export-toolchain.json') -Raw | ConvertFrom-Json
$exportTools = Join-Path $projectRoot '.tools'
New-Item -ItemType Directory -Path $exportTools -Force | Out-Null
$exportArchive = Join-Path $exportTools 'ffmpeg-9.0.2-essentials_build.zip'
if (!(Test-Path -LiteralPath $exportArchive)) { Invoke-WebRequest -Uri $exportLock.archive.url -OutFile $exportArchive -TimeoutSec 300 }
if ((Get-FileHash -LiteralPath $exportArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $exportLock.archive.sha256) { throw 'FFmpeg 压缩包 hash 不匹配，停止安装。' }
$exportDestination = Join-Path $exportTools 'ffmpeg-9.0.2'
Expand-Archive -LiteralPath $exportArchive -DestinationPath $exportDestination -Force
foreach ($exportBinary in @($exportLock.ffmpeg, $exportLock.ffprobe, $exportLock.font)) {
    $exportBinaryPath = Join-Path $projectRoot $exportBinary.path
    if ((Get-FileHash -LiteralPath $exportBinaryPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $exportBinary.sha256) { throw "资源 hash 不匹配：$exportBinaryPath" }
}
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.cache/ms-playwright'
Push-Location $projectRoot
try { npx playwright install chromium; if ($LASTEXITCODE -ne 0) { throw 'Chromium 安装失败。' } }
finally { Pop-Location }
Write-Output 'FFmpeg/ffprobe/font hashes verified; locked Playwright Chromium installed.'
