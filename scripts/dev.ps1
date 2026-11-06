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

$command = "Set-Location `"$engine`"; `$env:SESSION_DEV='1'; `$env:SESSION_TOKEN='dev-session-token'; `$env:SESSION_PORT='8765'; `$env:SESSION_HOST='127.0.0.1'; & `"$python`" -m session_mail"
Start-Process -FilePath "powershell" -ArgumentList @("-NoExit", "-Command", $command)

Push-Location $desktop
if (-not (Test-Path "node_modules")) {
  npm install
}
npm run dev
Pop-Location
