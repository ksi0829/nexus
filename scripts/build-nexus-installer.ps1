$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot "NexusInstaller.cs"
$clientSource = Join-Path $PSScriptRoot "NexusClient.cs"
$icon = Join-Path $projectRoot "public\nexus.ico"
$outputDirectory = Join-Path $projectRoot "dist"
$clientOutput = Join-Path $outputDirectory "NEXUS.exe"
$output = Join-Path $outputDirectory "NEXUS-Setup.exe"
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$webViewPackage = Join-Path $PSScriptRoot "vendor\webview2\package"
$webViewCore = Join-Path $webViewPackage "lib\net462\Microsoft.Web.WebView2.Core.dll"
$webViewWinForms = Join-Path $webViewPackage "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$webViewLoader = Join-Path $webViewPackage "runtimes\win-x64\native\WebView2Loader.dll"

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
if (Test-Path -LiteralPath $clientOutput) {
  Remove-Item -LiteralPath $clientOutput -Force
}

if (-not (Test-Path -LiteralPath $compiler)) {
  throw "Windows C# 컴파일러를 찾을 수 없습니다."
}

& $compiler `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /optimize+ `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.Web.Extensions.dll `
  "/reference:$webViewCore" `
  "/reference:$webViewWinForms" `
  "/win32icon:$icon" `
  "/out:$clientOutput" `
  $clientSource

if ($LASTEXITCODE -ne 0) {
  throw "NEXUS 클라이언트 빌드에 실패했습니다."
}

& $compiler `
  /nologo `
  /target:winexe `
  /optimize+ `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:Microsoft.CSharp.dll `
  "/win32icon:$icon" `
  "/resource:$clientOutput,NexusClient" `
  "/resource:$webViewCore,WebView2Core" `
  "/resource:$webViewWinForms,WebView2WinForms" `
  "/resource:$webViewLoader,WebView2Loader" `
  "/resource:$icon,NexusIcon" `
  "/out:$output" `
  $source

if ($LASTEXITCODE -ne 0) {
  throw "NEXUS 설치 프로그램 빌드에 실패했습니다."
}

Get-Item -LiteralPath $output | Select-Object FullName, Length, LastWriteTime
