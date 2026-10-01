$ErrorActionPreference = 'Stop'
$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$DataDir = Join-Path $env:APPDATA 'meriotify'
$Lang = 'en'

if ($env:MERIOTIFY_LANG -eq 'it') {
    $Lang = 'it'
} elseif (Test-Path -LiteralPath (Join-Path $DataDir 'language')) {
    $savedLang = (Get-Content -LiteralPath (Join-Path $DataDir 'language') -Raw).Trim().ToLowerInvariant()
    if ($savedLang -eq 'it') { $Lang = 'it' }
}

$Text = @{
    en = @{
        title='Uninstalling Meriotify'
        spotify='Spotify restored'
        spotifyWarn='Spotify restore failed; continuing uninstall'
        removed='Meriotify removed'
        done='Done.'
        failed='Uninstall failed.'
    }
    it = @{
        title='Disinstallazione Meriotify'
        spotify='Spotify ripristinato'
        spotifyWarn='Ripristino Spotify non riuscito; continuo la disinstallazione'
        removed='Meriotify rimosso'
        done='Fatto.'
        failed='Disinstallazione non riuscita.'
    }
}

function T([string]$Key) { return $Text[$Lang][$Key] }
function Ok([string]$Value) {
    Write-Host '  [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Value
}
function Warn([string]$Value) {
    Write-Host '  [!] ' -ForegroundColor Yellow -NoNewline
    Write-Host $Value
}
function Normalize-PathPart([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return $Value.Trim().TrimEnd('\')
}
function Remove-DirectoryVerified([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }

    for ($attempt = 1; $attempt -le 5; $attempt++) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $Path)) { return }
        Start-Sleep -Milliseconds 250
    }

    if (Test-Path -LiteralPath $Path) {
        throw "Could not remove: $Path"
    }
}
function Remove-InstallDirFromPath {
    $normalizedInstall = Normalize-PathPart $InstallDir

    $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
    if ($userPath) {
        $parts = @($userPath -split ';' | Where-Object {
            $_ -and ((Normalize-PathPart $_) -ine $normalizedInstall)
        })
        [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), [EnvironmentVariableTarget]::User)
    }

    if ($env:Path) {
        $processParts = @($env:Path -split ';' | Where-Object {
            $_ -and ((Normalize-PathPart $_) -ine $normalizedInstall)
        })
        $env:Path = $processParts -join ';'
    }
}

Write-Host ''
Write-Host '  MERIOTIFY' -ForegroundColor Magenta
Write-Host "  $(T 'title')" -ForegroundColor DarkGray
Write-Host ''

try {
    $exe = Join-Path $InstallDir 'meriotify.exe'
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        try {
            & $exe -q restore *> $null
            if ($LASTEXITCODE -eq 0) {
                Ok (T 'spotify')
            } else {
                Warn (T 'spotifyWarn')
            }
        } catch {
            Warn (T 'spotifyWarn')
        }
    }

    try {
        Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:19473/shutdown' -TimeoutSec 1 | Out-Null
    } catch {}
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'MeriotifyGlobalHotkeys' -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 120

    Get-Process -Name 'meriotify' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-InstallDirFromPath

    [Environment]::SetEnvironmentVariable('MERIOTIFY_LANG', $null, [EnvironmentVariableTarget]::User)
    Remove-Item Env:MERIOTIFY_LANG -ErrorAction SilentlyContinue

    Remove-DirectoryVerified $InstallDir
    Remove-DirectoryVerified $DataDir

    if (Test-Path -LiteralPath $InstallDir) { throw "Meriotify install directory still exists: $InstallDir" }
    if (Test-Path -LiteralPath $DataDir) { throw "Meriotify data directory still exists: $DataDir" }

    Ok (T 'removed')
    Write-Host ''
    Write-Host "  $(T 'done')" -ForegroundColor Green
    Write-Host ''
} catch {
    Write-Host ''
    Write-Host '  [X] ' -ForegroundColor Red -NoNewline
    Write-Host (T 'failed')
    if ($_.Exception.Message) { Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
    Write-Host ''
}
