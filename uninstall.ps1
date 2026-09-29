$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$DataDir = Join-Path $env:APPDATA 'meriotify'

Write-Host ''
Write-Host '  M E R I O T I F Y' -ForegroundColor Magenta
Write-Host '  Uninstaller' -ForegroundColor DarkGray
Write-Host ''

$exe = Join-Path $InstallDir 'meriotify.exe'
if (Test-Path -LiteralPath $exe -PathType Leaf) {
    $restore = Read-Host '  Restore Spotify before uninstalling? [Y/n]'
    if ($restore.Trim().ToLowerInvariant() -ne 'n') {
        Write-Host '  > Restoring Spotify'
        & $exe restore
    }
}

$removeData = Read-Host '  Remove Meriotify config, themes and extensions too? [y/N]'

$userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
if ($userPath) {
    $parts = @($userPath -split ';' | Where-Object { $_ -and $_ -ne $InstallDir })
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), [EnvironmentVariableTarget]::User)
}

Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
if ($removeData.Trim().ToLowerInvariant() -eq 'y') {
    Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host '  [OK] Meriotify removed.' -ForegroundColor Green
Write-Host '  Open a new PowerShell window to refresh PATH.' -ForegroundColor DarkGray
Write-Host ''
