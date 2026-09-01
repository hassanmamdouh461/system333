<#
  Engaz Reports Portal — one-shot deploy script
  ─────────────────────────────────────────────────────────────
  Creates the isolated D1 database (engaz-reports-db), sets the shared secret,
  deploys the reports worker to api-reports.engaz.tech, builds + deploys the
  reports portal to reporting.engaz.tech.

  Prereq (once):
    $env:CLOUDFLARE_API_TOKEN = '...'   # token with Workers, D1, Pages perms on engaz.tech
    # OR run: npx wrangler login

  Usage:
    powershell -ExecutionPolicy Bypass -File deploy-reports.ps1 [-ReportsKey 'your-key']

  Three secrets are configured on the worker:
    REPORTS_API_KEY          — write key, held only by the desktop POS
    REPORTS_VIEWER_PASSWORD  — password a portal visitor signs in with
    REPORTS_TOKEN_SECRET     — signs the short-lived read-only tokens

  The portal itself ships with no key: it is a static site, so anything in its bundle is
  public. Each value is read from the root .env unless passed as a parameter.
#>
param(
  [string]$ReportsKey = '',
  [string]$ViewerPassword = '',
  [string]$TokenSecret = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Step([string]$msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# $ErrorActionPreference does not apply to native commands: wrangler, npm and curl signal
# failure through $LASTEXITCODE only, so piping their output to Write-Host let a failed
# build carry on and deploy the previous dist/ under a "Deploy complete" banner.
function Invoke-Native([string]$what, [scriptblock]$cmd) {
  & $cmd 2>&1 | Write-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host "$what failed with exit code $LASTEXITCODE. Aborting." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

# ── 0. Authentication check ────────────────────────────────────────────────
Step '0/5 Checking Cloudflare authentication'
# Load CLOUDFLARE_API_TOKEN from .env if it is not already in the environment.
if (-not $env:CLOUDFLARE_API_TOKEN) {
  $envToken = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue | Where-Object { $_ -match '^CLOUDFLARE_API_TOKEN=' } | Select-Object -First 1
  if ($envToken) { $env:CLOUDFLARE_API_TOKEN = ($envToken -split '=', 2)[1].Trim() }
}
$who = npx wrangler whoami 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $who -match 'not authenticated') {
  Write-Host $who
  Write-Host 'Not authenticated. Put your token in .env as CLOUDFLARE_API_TOKEN=... or run `npx wrangler login`.' -ForegroundColor Yellow
  exit 1
}
Write-Host 'Authenticated to Cloudflare.'

# ── 1. Create the isolated reports database (idempotent) ──────────────────
Step '1/5 Creating isolated D1 database: engaz-reports-db'
$createOut = npx wrangler d1 create engaz-reports-db 2>&1
$dbId = ''
if ($createOut -match 'database_id.*?([0-9a-f-]{20,})') {
  $dbId = $Matches[1]
  Write-Host "Created database with id: $dbId"
} elseif ($createOut -match 'already exists') {
  # Fetch existing id
  $listOut = npx wrangler d1 list --json 2>&1 | Out-String
  $db = $listOut | ConvertFrom-Json | Where-Object { $_.name -eq 'engaz-reports-db' } | Select-Object -First 1
  if ($db) { $dbId = $db.uuid; Write-Host "Found existing database id: $dbId" }
} else {
  Write-Host $createOut
  Write-Host 'Could not determine database id. Fill it manually in wrangler-reports.toml.' -ForegroundColor Yellow
}

if ($dbId) {
  # Stamp the resolved id into wrangler-reports.toml. Matching only the placeholder was
  # a silent no-op once a real id was present, so a recreated database left the config
  # pointing at the old one while the script reported success.
  $tomlPath = Join-Path $root 'wrangler-reports.toml'
  $toml = Get-Content $tomlPath -Raw
  $updated = [regex]::Replace(
    $toml,
    '(?m)^(\s*database_id\s*=\s*)".*"',
    ('${1}"' + $dbId + '"')
  )
  if ($updated -eq $toml) {
    Write-Host "database_id already set to $dbId; no change needed."
  } else {
    Set-Content $tomlPath $updated -NoNewline
    Write-Host "Wrote database_id $dbId into wrangler-reports.toml."
  }
} else {
  Write-Host 'No database id resolved; leaving wrangler-reports.toml untouched.' -ForegroundColor Yellow
}

# ── 2. Set the worker secrets ─────────────────────────────────────────────
Step '2/5 Setting worker secrets'

# Reads a value from the root .env when it was not passed in.
function Get-EnvValue([string]$name) {
  $line = Get-Content (Join-Path $root '.env') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if ($line) { return ($line -split '=', 2)[1].Trim() }
  return ''
}

# Pipes the value to wrangler on stdin. Passing a secret as an argument would put it in the
# Windows process command line, where any local process can read it.
function Set-WorkerSecret([string]$name, [string]$value) {
  if (-not $value) {
    Write-Host "No $name provided. Set it later with:" -ForegroundColor Yellow
    Write-Host "  npx wrangler secret put $name -c wrangler-reports.toml"
    return
  }
  $value | npx wrangler secret put $name -c wrangler-reports.toml 2>&1 | Out-String | Write-Host
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Setting $name failed with exit code $LASTEXITCODE. Aborting." -ForegroundColor Red
    exit $LASTEXITCODE
  }
  Write-Host "Set $name."
}

if (-not $ReportsKey)     { $ReportsKey     = Get-EnvValue 'VITE_REPORTS_API_KEY' }
if (-not $ViewerPassword) { $ViewerPassword = Get-EnvValue 'REPORTS_VIEWER_PASSWORD' }
if (-not $TokenSecret)    { $TokenSecret    = Get-EnvValue 'REPORTS_TOKEN_SECRET' }

Set-WorkerSecret 'REPORTS_API_KEY' $ReportsKey
Set-WorkerSecret 'REPORTS_VIEWER_PASSWORD' $ViewerPassword
Set-WorkerSecret 'REPORTS_TOKEN_SECRET' $TokenSecret

# Without these two the portal cannot be signed into at all, so say so before deploying.
if (-not $ViewerPassword -or -not $TokenSecret) {
  Write-Host 'Portal sign-in is not configured; visitors will get "Viewer access is not configured".' -ForegroundColor Yellow
}

# ── 3. Deploy the reports worker (isolated DB) ────────────────────────────
Step '3/5 Deploying reports worker to api-reports.engaz.tech'
Invoke-Native 'Reports worker deploy' { npx wrangler deploy -c wrangler-reports.toml }

# ── 4. Build + deploy the reports portal to reporting.engaz.tech ──────────
Step '4/5 Building reports portal'
Set-Location (Join-Path $root 'reports-site')
Invoke-Native 'npm install (reports-site)' { npm install --silent }
Invoke-Native 'Reports portal build' { npm run build }
Set-Location $root

Step 'Deploying reports portal to reporting.engaz.tech'
Invoke-Native 'Reports portal deploy' { npx wrangler deploy -c wrangler-reports-site.toml }

# ── 5. Schema migration on the new database ───────────────────────────────
Step '5/5 Running schema migration on engaz-reports-db'
if ($ReportsKey) {
  # -f makes curl exit non-zero on an HTTP error status; without it a 401 or 500 was
  # printed as if it were a successful migration.
  $mig = curl.exe -sS -f -X POST 'https://api-reports.engaz.tech/migrate' `
    -H "Content-Type: application/json" -H "X-API-Key: $ReportsKey" -d '{}' 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Migration request failed: $mig" -ForegroundColor Red
    exit 1
  }
  Write-Host "Migrate response: $mig"
  # The worker reports per-statement results; a non-empty failure list is not a success.
  if ($mig -match '"success"\s*:\s*false') {
    Write-Host 'Migration reported failed statements. Review the response above.' -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host 'Skipped migrate (no key).'
}

Write-Host "`n✅ Deploy complete. Portal: https://reporting.engaz.tech" -ForegroundColor Green
