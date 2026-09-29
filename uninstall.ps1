$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$DataDir = Join-Path $env:APPDATA 'meriotify'
$Lang = if ($env:MERIOTIFY_LANG -eq 'it') { 'it' } else { 'en' }

$Text = @{
    en = @{ title='Uninstalling Meriotify'; spotify='Spotify restored'; removed='Meriotify removed'; done='Done.' }
    it = @{ title='Disinstallazione Meriotify'; spotify='Spotify ripristinato'; removed='Meriotify rimosso'; done='Fatto.' }
}
function T([string]$Key) { return $Text[$Lang][$Key] }
function Ok([string]$Value) { Write-Host '  [OK] ' -ForegroundColor Green -NoNewline; Write-Host $Value }

Write-Host ''
Write-Host '  MERIOTIFY' -ForegroundColor Magenta
Write-Host "  $(T 'title')" -ForegroundColor DarkGray
Write-Host ''

$exe = Join-Path $InstallDir 'meriotify.exe'
if (Test-Path -LiteralPath $exe -PathType Leaf) {
    & $exe -q restore *> $null
    if ($LASTEXITCODE -eq 0) { Ok (T 'spotify') }
}

$userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
if ($userPath) {
    $parts = @($userPath -split ';' | Where-Object { $_ -and $_ -ne $InstallDir })
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), [EnvironmentVariableTarget]::User)
}

Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue
[Environment]::SetEnvironmentVariable('MERIOTIFY_LANG', $null, [EnvironmentVariableTarget]::User)
Ok (T 'removed')
Write-Host ''
Write-Host "  $(T 'done')" -ForegroundColor Green
Write-Host ''
