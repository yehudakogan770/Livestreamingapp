# Gets msedgedriver.exe for the WebView2 on this computer (tauri-driver needs
# the driver's version to match WebView2's). Prints the driver's path and, on
# GitHub Actions, sets MSEDGEDRIVER for the next steps.
#   pwsh e2e/setup-msedgedriver.ps1 <folder>
param([string]$Folder = "$env:RUNNER_TEMP\msedgedriver")
$ErrorActionPreference = 'Stop'

# The WebView2 runtime's version (machine-wide, then per-user), else Edge's.
$keys = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$version = $null
foreach ($k in $keys) {
  $v = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
  if ($v -and $v -ne '0.0.0.0') { $version = $v; break }
}
if (-not $version) {
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge) { $version = (Get-Item $edge).VersionInfo.ProductVersion }
}
if (-not $version) { throw 'No WebView2 runtime found.' }
Write-Host "WebView2 $version"

New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$zip = Join-Path $Folder 'edgedriver.zip'
$got = $false
foreach ($url in @(
    "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip",
    "https://msedgedriver.azureedge.net/$version/edgedriver_win64.zip")) {
  try {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    $got = $true
    break
  } catch {
    Write-Host "Not at $url"
  }
}
if (-not $got) {
  # The tool the Tauri docs use, which finds the matching driver itself.
  Write-Host 'Trying msedgedriver-tool'
  cargo install --git https://github.com/chippers/msedgedriver-tool --locked
  Push-Location $Folder
  & "$env:USERPROFILE\.cargo\bin\msedgedriver-tool.exe"
  Pop-Location
} else {
  Expand-Archive -Path $zip -DestinationPath $Folder -Force
}
$driver = Get-ChildItem -Path $Folder -Filter msedgedriver.exe -Recurse | Select-Object -First 1
if (-not $driver) { throw 'msedgedriver.exe could not be downloaded.' }
& $driver.FullName --version
if ($env:GITHUB_ENV) { "MSEDGEDRIVER=$($driver.FullName)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8 }
$driver.FullName
