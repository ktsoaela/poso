$ErrorActionPreference = "Stop"
# Cursor's sandbox sets this, which would hide the launcher outside the project tree.
Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "engine"
$desktop = Join-Path $root "desktop"
$python = Join-Path $engine ".venv\Scripts\python.exe"

if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) {
  throw "Install Rust with the MSVC toolchain, then run this script again."
}
if (-not (Test-Path $python)) {
  python -m venv (Join-Path $engine ".venv")
}

Push-Location $engine
& .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
& .\.venv\Scripts\python.exe -m pip install pyinstaller
& .\.venv\Scripts\pyinstaller.exe --noconfirm --clean --onedir --noconsole --name session-mail-engine --paths . --collect-all uvicorn --collect-all keyring --collect-all imapclient --collect-submodules session_mail --hidden-import keyring.backends.Windows run_engine.py
Pop-Location

$dist = Join-Path $engine "dist\session-mail-engine"
$target = Join-Path $desktop "src-tauri\engine-dist"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $dist "*") $target -Recurse -Force

& (Join-Path $root "scripts\prepare-dev-sidecar.ps1")

Push-Location $desktop
if (-not (Test-Path "node_modules")) { npm install }
& $python (Join-Path $root "scripts\make_icon.py")
npx tauri icon (Join-Path $root "docs\icon.png")
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE" }
Pop-Location

Write-Output "Installer is under desktop\src-tauri\target\release\bundle\nsis"
