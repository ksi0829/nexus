param(
  [string]$AppUrl = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceIcon = Join-Path $projectRoot "public\nexus.ico"
$installDirectory = Join-Path $env:LOCALAPPDATA "NEXUS"
$installedIcon = Join-Path $installDirectory "nexus-client-v7.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NEXUS.lnk"
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

if ([string]::IsNullOrWhiteSpace($AppUrl)) {
  $AppUrl = Read-Host "NEXUS 배포 주소를 입력하세요"
}

if (-not [Uri]::IsWellFormedUriString($AppUrl, [UriKind]::Absolute)) {
  throw "올바른 NEXUS 배포 주소를 입력해 주세요."
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceIcon -Destination $installedIcon -Force

$browser = if (Test-Path $chrome) {
  $chrome
} elseif (Test-Path $edge) {
  $edge
} else {
  throw "Chrome 또는 Microsoft Edge가 필요합니다."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $browser
$shortcut.Arguments = "--app=`"$AppUrl`""
$shortcut.WorkingDirectory = $installDirectory
$shortcut.IconLocation = "$installedIcon,0"
$shortcut.Description = "NEXUS 업무 메신저와 전자결재"
$shortcut.Save()

Write-Output "NEXUS 설치 완료: $shortcutPath"
