$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$DataDir = Join-Path $env:APPDATA 'meriotify'
$Repository = if ($env:MERIOTIFY_REPOSITORY) { $env:MERIOTIFY_REPOSITORY } else { '1004ms/Meriotify' }
$RequestedVersion = $env:MERIOTIFY_VERSION
$PresetLanguage = $env:MERIOTIFY_LANG

$Strings = @{
    en = @{
        choose = 'Choose language / Scegli lingua'
        tagline = 'Spotify, your way.'
        download = 'Full download (Meriotify + Marketplace)'
        meriotify = 'Meriotify v{0}'
        marketplace = 'Marketplace'
        spotify = 'Spotify'
        done = 'Done.'
        failed = 'Installation failed.'
        spotifyFailed = 'Spotify setup failed. Close Spotify and run the installer again.'
        admin = 'Open PowerShell normally, not as Administrator.'
        noExe = 'Meriotify could not be installed.'
    }
    it = @{
        choose = 'Scegli lingua / Choose language'
        tagline = 'Spotify, come vuoi tu.'
        download = 'Download completo (Meriotify + Marketplace)'
        meriotify = 'Meriotify v{0}'
        marketplace = 'Marketplace'
        spotify = 'Spotify'
        done = 'Fatto.'
        failed = 'Installazione non riuscita.'
        spotifyFailed = 'Configurazione Spotify non riuscita. Chiudi Spotify e rilancia il download.'
        admin = 'Apri PowerShell normalmente, non come Amministratore.'
        noExe = 'Meriotify non e stato installato.'
    }
}

function Select-Language {
    if ($PresetLanguage) {
        $candidate = $PresetLanguage.ToLowerInvariant()
        if ($Strings.ContainsKey($candidate)) { return $candidate }
    }

    $default = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'it') { 'it' } else { 'en' }
    Write-Host ''
    Write-Host '  MERIOTIFY' -ForegroundColor Magenta
    Write-Host '  [1] Italiano'
    Write-Host '  [2] English'
    Write-Host ''
    $choice = Read-Host "  $($Strings[$default].choose) [1/2]"
    if ($choice.Trim() -eq '2' -or $choice.Trim().ToLowerInvariant() -eq 'en') { return 'en' }
    if ($choice.Trim() -eq '1' -or $choice.Trim().ToLowerInvariant() -eq 'it') { return 'it' }
    return $default
}

$script:Lang = Select-Language
function T([string]$Key) { return $Strings[$script:Lang][$Key] }

function Ok([string]$Text) {
    Write-Host '  [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Text
}

function Fail([string]$Text) {
    throw $Text
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($arch) {
        switch ($arch.ToUpperInvariant()) {
            'AMD64' { return 'x64' }
            'ARM64' { return 'arm64' }
            'X86' { return 'x32' }
        }
    }
    if ([Environment]::Is64BitOperatingSystem) { return 'x64' }
    return 'x32'
}

function Get-Version {
    if ($RequestedVersion) { return $RequestedVersion.TrimStart('v') }
    $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri "https://api.github.com/repos/$Repository/releases/latest"
    return ([string]$release.tag_name).TrimStart('v')
}

function Add-ToUserPath([string]$Directory) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
    $parts = @($userPath -split ';' | Where-Object { $_ })
    if ($parts -notcontains $Directory) {
        [Environment]::SetEnvironmentVariable('Path', (($parts + $Directory) -join ';').Trim(';'), [EnvironmentVariableTarget]::User)
    }
    if (($env:Path -split ';') -notcontains $Directory) { $env:Path = "$Directory;$env:Path" }
}

function Run-Meriotify([string[]]$Arguments) {
    & $script:Exe @Arguments *> $null
    return $LASTEXITCODE
}

function Install-Marketplace([string]$TempRoot) {
    $marketAppPath = Join-Path $DataDir 'CustomApps\marketplace'
    $marketThemePath = Join-Path $DataDir 'Themes\marketplace'
    $marketTemp = Join-Path $TempRoot 'marketplace'
    $marketZip = Join-Path $TempRoot 'marketplace.zip'

    New-Item -ItemType Directory -Path $marketTemp -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri 'https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip' -OutFile $marketZip
    Expand-Archive -LiteralPath $marketZip -DestinationPath $marketTemp -Force

    $payload = Join-Path $marketTemp 'marketplace-dist'
    if (-not (Test-Path -LiteralPath $payload -PathType Container)) { $payload = $marketTemp }

    Remove-Item -LiteralPath $marketAppPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marketThemePath -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $marketAppPath, $marketThemePath -Force | Out-Null
    Copy-Item -Path (Join-Path $payload '*') -Destination $marketAppPath -Recurse -Force

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini' -OutFile (Join-Path $marketThemePath 'color.ini')

    Run-Meriotify @('config', 'custom_apps', 'spicetify-marketplace-') | Out-Null
    Run-Meriotify @('config', 'custom_apps', 'marketplace') | Out-Null
    Run-Meriotify @('config', 'inject_css', '1', 'replace_colors', '1') | Out-Null

    $currentTheme = & $script:Exe config current_theme 2>$null
    if ([string]::IsNullOrWhiteSpace(($currentTheme | Out-String).Trim())) {
        Run-Meriotify @('config', 'current_theme', 'MeriotifyDefault', 'color_scheme', 'meriotify') | Out-Null
    }
}

if ($PSVersionTable.PSVersion -lt [version]'5.1') { Write-Host "  [X] $(T 'failed')" -ForegroundColor Red; return }
if (Test-IsAdmin) { Write-Host "  [X] $(T 'admin')" -ForegroundColor Red; return }

Write-Host ''
Write-Host '  MERIOTIFY' -ForegroundColor Magenta
Write-Host "  $(T 'tagline')" -ForegroundColor DarkGray
Write-Host ''
Write-Host "  $(T 'download')" -ForegroundColor White
Write-Host ''

$architecture = Get-Architecture
$version = Get-Version
$asset = "meriotify-$version-windows-$architecture.zip"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("meriotify-" + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot $asset
$extract = Join-Path $tempRoot 'extract'

try {
    New-Item -ItemType Directory -Path $tempRoot, $extract -Force | Out-Null
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri "https://github.com/$Repository/releases/download/v$version/$asset" -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $extract '*') -Destination $InstallDir -Recurse -Force

    $script:Exe = Join-Path $InstallDir 'meriotify.exe'
    if (-not (Test-Path -LiteralPath $script:Exe -PathType Leaf)) { Fail (T 'noExe') }

    '@echo off' + "`r`n" + '"%~dp0meriotify.exe" %*' + "`r`n" | Set-Content -LiteralPath (Join-Path $InstallDir 'spicetify.cmd') -Encoding Ascii
    Add-ToUserPath $InstallDir
    [Environment]::SetEnvironmentVariable('MERIOTIFY_LANG', $script:Lang, [EnvironmentVariableTarget]::User)
    $env:MERIOTIFY_LANG = $script:Lang
    Ok ((T 'meriotify') -f $version)

    Install-Marketplace $tempRoot
    Ok (T 'marketplace')

    $setupExit = Run-Meriotify @('-q', 'setup')
    if ($setupExit -eq 0) {
        Ok (T 'spotify')
    } else {
        Fail (T 'spotifyFailed')
    }

    Write-Host ''
    Write-Host "  $(T 'done')" -ForegroundColor Green
    Write-Host ''
}
catch {
    Write-Host ''
    Write-Host '  [X] ' -ForegroundColor Red -NoNewline
    Write-Host (T 'failed')
    if ($_.Exception.Message) { Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
    Write-Host ''
    return
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
