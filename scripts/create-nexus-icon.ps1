$projectRoot = Split-Path -Parent $PSScriptRoot
$icoPath = Join-Path $projectRoot "public\nexus.ico"

& node (Join-Path $PSScriptRoot "render-nexus-icon.mjs")
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $icoPath)) {
  throw "NEXUS 아이콘 렌더링에 실패했습니다."
}

Write-Output $icoPath
