$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "engine"
$desktop = Join-Path $root "desktop"
$python = Join-Path $engine ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  python -m venv (Join-Path $engine ".venv")
}

Push-Location $engine
& .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
Pop-Location

$runner = Join-Path $PSScriptRoot "run-engine-dev.ps1"
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -File `"$runner`""

Push-Location $desktop
if (-not (Test-Path "node_modules")) {
  npm install
}
npm run dev
Pop-Location
