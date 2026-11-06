$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root "desktop"
$python = Join-Path $root "engine\.venv\Scripts\python.exe"

function Test-Url([string]$url) {
  try {
    Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Url "http://127.0.0.1:8765/health")) {
  if (-not (Test-Path $python)) {
    throw "The mail engine is not running. Start it with .\scripts\dev.ps1"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -File `"$(Join-Path $PSScriptRoot 'run-engine-dev.ps1')`""
  $up = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Url "http://127.0.0.1:8765/health") { $up = $true; break }
  }
  if (-not $up) { throw "The mail engine did not start." }
}

Push-Location $desktop
if (-not (Test-Path "node_modules\electron")) {
  npm install
}
if (-not (Test-Url "http://localhost:1420")) {
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -Command `"Set-Location -LiteralPath '$desktop'; npm run dev`""
  $up = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Url "http://localhost:1420") { $up = $true; break }
  }
  if (-not $up) { throw "The Poso UI did not start." }
}
$exe = @(
  (Join-Path $desktop "release-poso\win-unpacked\Poso.exe"),
  (Join-Path $desktop "release\win-unpacked\Poso.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$ico = Join-Path $desktop "electron\icon.ico"
if ((Test-Path $exe) -and (Test-Path $ico)) {
  $programs = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $previous = Join-Path $programs "Session.lnk"
  if (Test-Path $previous) { Remove-Item $previous -Force }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $programs "Poso.lnk"))
  $shortcut.TargetPath = $exe
  $shortcut.WorkingDirectory = Split-Path $exe
  $shortcut.IconLocation = "$exe,0"
  $shortcut.Description = "Poso mail"
  $shortcut.Save()
}
npm run electron
Pop-Location
