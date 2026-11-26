<#
.SYNOPSIS
  run-public.ps1 - Starts SyllabusSOS++ behind a Cloudflare Quick Tunnel (cloudflared).
#>
[CmdletBinding()]
param(
  [string]$AdminEmail = $env:ADMIN_EMAIL,
  [string]$AdminPassword = $env:ADMIN_PASSWORD
)

$ErrorActionPreference = "Stop"
$ROOT = $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SyllabusSOS++ Cloudflare Quick Tunnel Launcher          " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Locate cloudflared
$cloudflaredCmd = Get-Command "cloudflared" -ErrorAction SilentlyContinue
if (-not $cloudflaredCmd) {
  $candidatePaths = @(
    "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    "C:\Program Files\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Cloudflare.cloudflared*\cloudflared.exe"
  )
  foreach ($p in $candidatePaths) {
    $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
      $cloudflaredPath = $found.FullName
      $env:Path = (Split-Path $cloudflaredPath) + ";" + $env:Path
      break
    }
  }
} else {
  $cloudflaredPath = $cloudflaredCmd.Source
}

if (-not $cloudflaredPath -or -not (Test-Path $cloudflaredPath)) {
  Write-Error "cloudflared is not found. Please install it with: winget install --id Cloudflare.cloudflared"
  exit 1
}

# 2. Manage .env.local (APP_SECRET & ADMIN_EMAIL)
$envLocalPath = Join-Path $ROOT ".env.local"
$envLocal = @{}
if (Test-Path $envLocalPath) {
  Get-Content $envLocalPath | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      $envLocal[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
}

# 2a. Generate APP_SECRET once (48+ random characters) and reuse
if (-not $envLocal["APP_SECRET"] -or $envLocal["APP_SECRET"].Length -lt 32) {
  Write-Host "[*] Generating fresh persistent APP_SECRET in .env.local..." -ForegroundColor Yellow
  $bytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $appSecret = [System.Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
  $envLocal["APP_SECRET"] = $appSecret
} else {
  $appSecret = $envLocal["APP_SECRET"]
}

# 2b. ADMIN_EMAIL (ask once if not stored)
if (-not $envLocal["ADMIN_EMAIL"]) {
  if ($AdminEmail) {
    $envLocal["ADMIN_EMAIL"] = $AdminEmail
  } else {
    $inputEmail = $null
    if ([Environment]::UserInteractive) {
      try { $inputEmail = Read-Host "Enter administrator email (stored in .env.local)" } catch {}
    }
    if (-not $inputEmail) { $inputEmail = "admin@syllabus-sos.local" }
    $envLocal["ADMIN_EMAIL"] = $inputEmail
  }
}
$adminEmail = $envLocal["ADMIN_EMAIL"]

# 2c. ADMIN_PASSWORD (ask once if needed for first setup; never stored on disk)
$adminPwToUse = $AdminPassword
if (-not $adminPwToUse -and -not $envLocal["ADMIN_INITIALIZED"]) {
  if ([Environment]::UserInteractive) {
    try { $adminPwToUse = Read-Host "Enter administrator password (12+ characters)" } catch {}
  }
  if (-not $adminPwToUse) { $adminPwToUse = "Portal#Secure987!" }
}

# Save .env.local (only APP_SECRET and ADMIN_EMAIL, NEVER ADMIN_PASSWORD)
$envLocalContent = @"
# Local machine secrets - ignored by git
APP_SECRET=$appSecret
ADMIN_EMAIL=$adminEmail
ADMIN_INITIALIZED=true
"@
Set-Content -Path $envLocalPath -Value $envLocalContent -Encoding UTF8

# Ensure data directory exists
$dataDir = Join-Path $ROOT "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

# 3. Start cloudflared tunnel
$tunnelLog = Join-Path $dataDir "tunnel.log"
$tunnelOut = Join-Path $dataDir "tunnel.out"
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }
if (Test-Path $tunnelOut) { Remove-Item $tunnelOut -Force }

Write-Host "[*] Launching Cloudflare quick tunnel to http://localhost:3000..." -ForegroundColor Yellow
$tunnelProcess = Start-Process -FilePath $cloudflaredPath `
  -ArgumentList "tunnel --url http://127.0.0.1:3000" `
  -RedirectStandardError $tunnelLog `
  -RedirectStandardOutput $tunnelOut `
  -PassThru

# 4. Capture trycloudflare.com URL from output
$publicUrl = $null
$allowedHost = $null
$timeoutSeconds = 30
$sw = [System.Diagnostics.Stopwatch]::StartNew()

while ($sw.Elapsed.TotalSeconds -lt $timeoutSeconds -and -not $publicUrl) {
  Start-Sleep -Milliseconds 500
  foreach ($logFile in @($tunnelLog, $tunnelOut)) {
    if (Test-Path $logFile) {
      $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
      if ($content -match 'https://([a-zA-Z0-9-]+)\.trycloudflare\.com') {
        $publicUrl = "https://$($Matches[1]).trycloudflare.com"
        $allowedHost = "$($Matches[1]).trycloudflare.com"
        break
      }
    }
  }
}

if (-not $publicUrl) {
  Write-Error "Failed to capture Cloudflare quick tunnel URL within $timeoutSeconds seconds. Check $tunnelLog"
  if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force }
  exit 1
}

Write-Host "[✓] Tunnel established: $publicUrl" -ForegroundColor Green

# 5. Set environment variables
$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = "3000"
$env:TRUST_PROXY = "true"
$env:PUBLIC_URL = $publicUrl
$env:ALLOWED_HOSTS = $allowedHost
$env:APP_SECRET = $appSecret
$env:PAYMENTS_MODE = "test"
$env:DEMO_MODE = "true"
$env:DATABASE_PATH = "./data/syllabussos.db"
$env:ADMIN_EMAIL = $adminEmail
if ($adminPwToUse) { $env:ADMIN_PASSWORD = $adminPwToUse }

# 6. Run seed
Write-Host "[*] Seeding database if needed (npm run seed)..." -ForegroundColor Yellow
& node --disable-warning=ExperimentalWarning server/seed.js

# Remove ADMIN_PASSWORD from memory/env now that seed is complete
$env:ADMIN_PASSWORD = $null
$adminPwToUse = $null

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  SyllabusSOS++ IS LIVE ON THE PUBLIC INTERNET!           " -ForegroundColor Green
Write-Host "  Public URL   : $publicUrl" -ForegroundColor White
Write-Host "  Admin Email  : $adminEmail" -ForegroundColor White
Write-Host "  Database     : $(Join-Path $ROOT 'data\syllabussos.db')" -ForegroundColor White
Write-Host "  Local Server : http://127.0.0.1:3000" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server and tunnel.`n"

# 7. Start the Node.js server with auto-restart on unhandled exit
try {
  while ($true) {
    & node --disable-warning=ExperimentalWarning server/index.js
    if ($LASTEXITCODE -eq 0) { break }
    Write-Host "[*] Node server stopped. Restarting in 1s..." -ForegroundColor Yellow
    Start-Sleep -Seconds 1
  }
} finally {
  Write-Host "`n[*] Shutting down Cloudflare tunnel process..." -ForegroundColor Yellow
  if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
    Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
