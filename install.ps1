$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Brand = 'Meriotify'
$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$DataDir = Join-Path $env:APPDATA 'meriotify'
$Repository = if ($env:MERIOTIFY_REPOSITORY) { $env:MERIOTIFY_REPOSITORY } else { '1004ms/Meriotify' }
$RequestedVersion = $env:MERIOTIFY_VERSION
$PresetLanguage = $env:MERIOTIFY_LANG
$CoreOnly = $env:MERIOTIFY_CORE_ONLY -eq '1'

function Write-Accent([string]$Text) {
    Write-Host $Text -ForegroundColor Magenta
}

function Write-Step([string]$Text) {
    Write-Host '  > ' -ForegroundColor DarkMagenta -NoNewline
    Write-Host $Text
}

function Write-Ok([string]$Text) {
    Write-Host '  [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Text
}

function Write-Warn([string]$Text) {
    Write-Host '  [!] ' -ForegroundColor Yellow -NoNewline
    Write-Host $Text
}

function Fail([string]$Text) {
    Write-Host '  [X] ' -ForegroundColor Red -NoNewline
    Write-Host $Text
    exit 1
}

$Strings = @{
    en = @{
        tagline = 'Spotify, your way.'
        language = 'Choose language / Scegli lingua'
        installMode = 'Choose an install mode'
        complete = 'Complete - CLI + Marketplace + Spotify setup (recommended)'
        core = 'Core only - install the CLI and configure later'
        latest = 'Checking the latest release'
        download = 'Downloading Meriotify v{0} ({1})'
        files = 'Installing Meriotify'
        installed = 'Meriotify v{0} installed'
        verified = 'CLI verified'
        marketplace = 'Installing Marketplace'
        marketplaceOk = 'Marketplace ready'
        configure = 'Configuring Spotify'
        configured = 'Spotify configured'
        setupFailed = 'Automatic Spotify setup failed. Meriotify is installed; run "meriotify setup" to retry.'
        ready = 'All done.'
        coreReady = 'Meriotify is installed. Run "meriotify setup" when you are ready.'
        command = 'Command'
        admin = 'Open a normal PowerShell window, not one running as Administrator.'
        ps = 'PowerShell 5.1 or newer is required.'
        arch = 'Unsupported Windows architecture: {0}'
        badVersion = 'Invalid MERIOTIFY_VERSION: {0}'
        noTag = 'GitHub did not return a release tag.'
        noExe = 'The release archive does not contain meriotify.exe.'
        marketFail = 'Marketplace could not be installed automatically. The CLI is still installed.'
    }
    it = @{
        tagline = 'Spotify, come vuoi tu.'
        language = 'Scegli lingua / Choose language'
        installMode = 'Scegli il tipo di installazione'
        complete = 'Completa - CLI + Marketplace + configurazione Spotify (consigliata)'
        core = 'Solo core - installa la CLI e configura dopo'
        latest = 'Controllo ultima release'
        download = 'Download Meriotify v{0} ({1})'
        files = 'Installazione Meriotify'
        installed = 'Meriotify v{0} installato'
        verified = 'CLI verificata'
        marketplace = 'Installazione Marketplace'
        marketplaceOk = 'Marketplace pronto'
        configure = 'Configurazione Spotify'
        configured = 'Spotify configurato'
        setupFailed = 'La configurazione automatica di Spotify non e riuscita. Meriotify e installato; usa "meriotify setup" per riprovare.'
        ready = 'Tutto pronto.'
        coreReady = 'Meriotify e installato. Quando vuoi, usa "meriotify setup".'
        command = 'Comando'
        admin = 'Apri una normale finestra PowerShell, non come Amministratore.'
        ps = 'Serve PowerShell 5.1 o piu recente.'
        arch = 'Architettura Windows non supportata: {0}'
        badVersion = 'MERIOTIFY_VERSION non valida: {0}'
        noTag = 'GitHub non ha restituito una release valida.'
        noExe = 'La release non contiene meriotify.exe.'
        marketFail = 'Marketplace non e stato installato automaticamente. La CLI e comunque installata.'
    }
}

function Select-Language {
    if ($PresetLanguage) {
        $candidate = $PresetLanguage.ToLowerInvariant()
        if ($Strings.ContainsKey($candidate)) { return $candidate }
    }

    $default = if ([Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName -eq 'it') { 'it' } else { 'en' }

    Write-Host ''
    Write-Accent '  M E R I O T I F Y'
    Write-Host '  --------------------------------' -ForegroundColor DarkGray
    Write-Host '  [1] Italiano'
    Write-Host '  [2] English'
    Write-Host ''
    $choice = Read-Host "  $($Strings[$default].language) [$([string]::Join('/', @('1','2')))]"

    switch ($choice.Trim().ToLowerInvariant()) {
        '1' { return 'it' }
        'it' { return 'it' }
        'italiano' { return 'it' }
        '2' { return 'en' }
        'en' { return 'en' }
        'english' { return 'en' }
        default { return $default }
    }
}

$script:Lang = Select-Language
function T([string]$Key) { return $Strings[$script:Lang][$Key] }

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
    if ($RequestedVersion) {
        if ($RequestedVersion -notmatch '^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
            Fail ((T 'badVersion') -f $RequestedVersion)
        }
        return $RequestedVersion.TrimStart('v')
    }

    Write-Step (T 'latest')
    $headers = @{ 'User-Agent' = 'Meriotify-Installer' }
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repository/releases/latest"
    if (-not $release.tag_name) { Fail (T 'noTag') }
    return ([string]$release.tag_name).TrimStart('v')
}

function Add-ToUserPath([string]$Directory) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
    $parts = @($userPath -split ';' | Where-Object { $_ })
    if ($parts -notcontains $Directory) {
        $newPath = (($parts + $Directory) -join ';').Trim(';')
        [Environment]::SetEnvironmentVariable('Path', $newPath, [EnvironmentVariableTarget]::User)
    }
    if (($env:Path -split ';') -notcontains $Directory) {
        $env:Path = "$Directory;$env:Path"
    }
}

function Select-InstallMode {
    if ($CoreOnly) { return 'core' }

    Write-Host ''
    Write-Host "  $(T 'installMode')" -ForegroundColor White
    Write-Host "  [1] $(T 'complete')" -ForegroundColor Cyan
    Write-Host "  [2] $(T 'core')"
    Write-Host ''
    $choice = Read-Host '  >'
    if ($choice.Trim() -eq '2') { return 'core' }
    return 'complete'
}

function Invoke-Meriotify([string[]]$Arguments, [switch]$Quiet) {
    $output = & $script:Exe @Arguments 2>&1
    $exit = $LASTEXITCODE
    if (-not $Quiet -and $output) { $output | ForEach-Object { Write-Host "    $_" } }
    return @{ ExitCode = $exit; Output = ($output | Out-String).Trim() }
}

function Install-Marketplace([string]$TempRoot) {
    Write-Step (T 'marketplace')

    $marketAppPath = Join-Path $DataDir 'CustomApps\marketplace'
    $marketThemePath = Join-Path $DataDir 'Themes\marketplace'
    $marketTemp = Join-Path $TempRoot 'marketplace'
    $marketZip = Join-Path $TempRoot 'marketplace.zip'

    Remove-Item -LiteralPath $marketTemp -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $marketTemp -Force | Out-Null

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } `
        -Uri 'https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip' `
        -OutFile $marketZip
    Expand-Archive -LiteralPath $marketZip -DestinationPath $marketTemp -Force

    $payload = Join-Path $marketTemp 'marketplace-dist'
    if (-not (Test-Path -LiteralPath $payload -PathType Container)) {
        $payload = $marketTemp
    }

    Remove-Item -LiteralPath $marketAppPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marketThemePath -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $marketAppPath, $marketThemePath -Force | Out-Null
    Copy-Item -Path (Join-Path $payload '*') -Destination $marketAppPath -Recurse -Force

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } `
        -Uri 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini' `
        -OutFile (Join-Path $marketThemePath 'color.ini')

    # Generate/update Meriotify config without relying on the legacy spicetify command.
    Invoke-Meriotify -Arguments @('config', 'custom_apps', 'spicetify-marketplace-') -Quiet | Out-Null
    $add = Invoke-Meriotify -Arguments @('config', 'custom_apps', 'marketplace') -Quiet
    if ($add.ExitCode -ne 0) { throw $add.Output }

    $cfg = Invoke-Meriotify -Arguments @('config', 'inject_css', '1', 'replace_colors', '1') -Quiet
    if ($cfg.ExitCode -ne 0) { throw $cfg.Output }

    $currentTheme = (Invoke-Meriotify -Arguments @('config', 'current_theme') -Quiet).Output
    if ([string]::IsNullOrWhiteSpace($currentTheme)) {
        Invoke-Meriotify -Arguments @('config', 'current_theme', 'MeriotifyDefault', 'color_scheme', 'meriotify') -Quiet | Out-Null
    }

    Write-Ok (T 'marketplaceOk')
}

if ($PSVersionTable.PSVersion -lt [version]'5.1') { Fail (T 'ps') }
if (Test-IsAdmin) { Fail (T 'admin') }

Write-Host ''
Write-Accent '  M E R I O T I F Y'
Write-Host "  $(T 'tagline')" -ForegroundColor DarkGray
Write-Host ''

$mode = Select-InstallMode
$architecture = Get-Architecture
$version = Get-Version
$asset = "meriotify-$version-windows-$architecture.zip"
$url = "https://github.com/$Repository/releases/download/v$version/$asset"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("meriotify-" + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot $asset
$extract = Join-Path $tempRoot 'extract'

try {
    New-Item -ItemType Directory -Path $tempRoot, $extract -Force | Out-Null

    Write-Step ((T 'download') -f $version, $architecture)
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri $url -OutFile $archive

    Write-Step (T 'files')
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $extract '*') -Destination $InstallDir -Recurse -Force

    $script:Exe = Join-Path $InstallDir 'meriotify.exe'
    if (-not (Test-Path -LiteralPath $script:Exe -PathType Leaf)) { Fail (T 'noExe') }

    # Kept only as a compatibility bridge for third-party tools that still call `spicetify`.
    $shim = Join-Path $InstallDir 'spicetify.cmd'
    '@echo off' + "`r`n" + '"%~dp0meriotify.exe" %*' + "`r`n" | Set-Content -LiteralPath $shim -Encoding Ascii

    Add-ToUserPath $InstallDir
    Write-Ok ((T 'installed') -f $version)

    $verify = Invoke-Meriotify -Arguments @('--version') -Quiet
    if ($verify.ExitCode -ne 0) { Fail $verify.Output }
    Write-Ok (T 'verified')

    if ($mode -eq 'complete') {
        try {
            Install-Marketplace $tempRoot
        }
        catch {
            Write-Warn (T 'marketFail')
            if ($_.Exception.Message) { Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
        }

        Write-Step (T 'configure')
        $setup = Invoke-Meriotify -Arguments @('setup')
        if ($setup.ExitCode -eq 0) {
            Write-Ok (T 'configured')
        }
        else {
            Write-Warn (T 'setupFailed')
        }
    }

    Write-Host ''
    Write-Host '  --------------------------------' -ForegroundColor DarkGray
    if ($mode -eq 'complete') {
        Write-Host "  $(T 'ready')" -ForegroundColor Green
    }
    else {
        Write-Host "  $(T 'coreReady')" -ForegroundColor Green
    }
    Write-Host "  $(T 'command'): " -NoNewline
    Write-Host 'meriotify -h' -ForegroundColor Cyan
    Write-Host ''
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
