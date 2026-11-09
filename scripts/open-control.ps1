param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$stewardData = if ($env:TG_STEWARD_DATA_DIR) { [IO.Path]::GetFullPath($env:TG_STEWARD_DATA_DIR) } else { Join-Path $projectRoot 'data' }
$stewardPort = if ($env:TG_STEWARD_PORT) { [int]$env:TG_STEWARD_PORT } else { 8788 }
$stewardHost = if ($env:TG_STEWARD_HOST -and $env:TG_STEWARD_HOST -notin @('0.0.0.0','::')) { $env:TG_STEWARD_HOST } else { '127.0.0.1' }
$address = 'http://{0}:{1}' -f $stewardHost, $stewardPort
$tokenPath = Join-Path $stewardData '.admin-token'
function Test-Steward {
  try { return (Invoke-RestMethod "$address/healthz" -TimeoutSec 2).ok -eq $true } catch { return $false }
}
function Get-StewardHealth { return Invoke-RestMethod "$address/healthz" -TimeoutSec 2 }
if (-not (Test-Steward)) {
  $nodeCommand = (Get-Command node -ErrorAction Stop).Source
  New-Item -ItemType Directory -Path $stewardData -Force | Out-Null
  $serverPath = Join-Path $projectRoot 'src/server.mjs'
  Start-Process -FilePath $nodeCommand -ArgumentList @(('"{0}"' -f $serverPath)) -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $stewardData 'local-server.log') -RedirectStandardError (Join-Path $stewardData 'local-server-error.log') | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  do { Start-Sleep -Milliseconds 250; $ready = Test-Steward } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
  if (-not $ready) { throw "Could not start TG Steward. See $stewardData/local-server-error.log" }
}
$health = Get-StewardHealth
$authRequired = $health.authRequired -ne $false
$adminToken = if ($env:TG_STEWARD_ADMIN_PASSWORD) { $env:TG_STEWARD_ADMIN_PASSWORD } elseif ($env:TG_STEWARD_ADMIN_TOKEN) { $env:TG_STEWARD_ADMIN_TOKEN } elseif (Test-Path -LiteralPath $tokenPath) { (Get-Content -LiteralPath $tokenPath -Raw).Trim() } else { '' }
if ($authRequired -and -not $adminToken) { throw "No admin password found. Check TG_STEWARD_ADMIN_PASSWORD or the running server's data directory." }
try { $headers = if ($authRequired) { @{ Authorization = "Bearer $adminToken" } } else { @{} }; $null = Invoke-RestMethod "$address/api/control-plane" -Headers $headers -TimeoutSec 5 }
catch { throw 'The running server did not accept this management password. Check its data directory or startup environment.' }
if (-not $NoBrowser) {
  $loginAddress = if ($authRequired) { "$address/#token=$([Uri]::EscapeDataString($adminToken))" } else { "$address/" }
  Start-Process $loginAddress
}
Write-Output "TG Steward ready: $address"
if ($authRequired) { Write-Output "Management password file: $tokenPath (unless overridden by the environment)." } else { Write-Output 'Management password disabled for local-only access.' }
