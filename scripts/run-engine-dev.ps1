$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
Set-Location -LiteralPath $engine
$env:SESSION_DEV = "1"
$env:SESSION_TOKEN = "dev-session-token"
$env:SESSION_PORT = "8765"
$env:SESSION_HOST = "127.0.0.1"
& $python -m session_mail
