# One-time, bounded wake-up check for the isolated synthetic Render MFA staging app.
# No credentials, database access, background keepalive, or production requests.
param(
  [ValidateRange(30, 300)]
  [int]$MaxSeconds = 150,
  [ValidateRange(2, 20)]
  [int]$IntervalSeconds = 5
)
$ErrorActionPreference = 'Stop'
$endpoint = 'https://newchanges-mfa-isolated-staging.onrender.com/health'
$timer = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host 'Waking The Fixer isolated MFA staging (Render free service)...'
Write-Host 'This does not prevent future idle spin-down or preserve passkeys.'
do {
  try {
    $response = Invoke-WebRequest -Uri $endpoint -TimeoutSec 20 -UseBasicParsing -Headers @{ 'Cache-Control' = 'no-cache' }
    $json = $response.Content | ConvertFrom-Json
    if ($response.StatusCode -eq 200 -and $json.ok -eq $true) {
      Write-Host ('Staging backend is ready after {0:N0} seconds.' -f $timer.Elapsed.TotalSeconds)
      Write-Host 'Open: https://newchanges-mfa-isolated-staging.onrender.com/mfa'
      exit 0
    }
    Write-Host ('Backend not ready yet (HTTP {0}).' -f $response.StatusCode)
  }
  catch {
    Write-Host 'Still waking, or network request failed.'
  }
  if ($timer.Elapsed.TotalSeconds -ge $MaxSeconds) { break }
  Start-Sleep -Seconds $IntervalSeconds
} while ($timer.Elapsed.TotalSeconds -lt $MaxSeconds)
Write-Error 'MFA staging health endpoint did not return {"ok":true}. Check the isolated Render logs. No changes were made.'
exit 1
