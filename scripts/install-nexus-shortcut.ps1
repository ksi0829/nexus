$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot "start-nexus.ps1"
$icon = Join-Path $projectRoot "public\nexus.ico"
$iconDirectory = Join-Path $env:LOCALAPPDATA "NEXUS"
$installedIcon = Join-Path $iconDirectory "nexus-app-v7.ico"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NEXUS.lnk"

New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
Copy-Item -LiteralPath $icon -Destination $installedIcon -Force

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$installedIcon,0"
$shortcut.Description = "NEXUS 업무 메신저와 전자결재"
$shortcut.Save()

Write-Output $shortcutPath
