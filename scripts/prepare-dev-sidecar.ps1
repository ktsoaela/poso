$ErrorActionPreference = "Stop"
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root "desktop\engine-launcher"
$binaries = Join-Path $root "desktop\src-tauri\binaries"
$hostLine = rustc -vV | Select-String "^host:"
if (-not $hostLine) { throw "rustc is not on PATH" }
$triple = ($hostLine.ToString() -replace "^host:\s*", "").Trim()
Push-Location $launcher
cargo build --release
Pop-Location
New-Item -ItemType Directory -Force -Path $binaries | Out-Null
$built = Join-Path $launcher "target\release\session-mail-engine.exe"
$dest = Join-Path $binaries "session-mail-engine-$triple.exe"
Copy-Item $built $dest -Force
Write-Output "Sidecar launcher: $dest"
