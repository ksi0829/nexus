$ErrorActionPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3011
$url = "http://localhost:$port/worktalk?standalone=1"
$npm = "C:\Program Files\nodejs\npm.cmd"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$logOut = Join-Path $projectRoot ".nexus-app.stdout.log"
$logErr = Join-Path $projectRoot ".nexus-app.stderr.log"

$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue

if (-not $listening) {
  Start-Process `
    -FilePath $npm `
    -ArgumentList @("run", "dev", "--", "-p", "$port") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { break }
    } catch {
      continue
    }
  }
}

if (Test-Path $chrome) {
  Start-Process -FilePath $chrome -ArgumentList @(
    "--app=$url",
    "--window-size=500,920"
  )
} else {
  Start-Process $url
}
