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
        rollback = 'Partial installation removed'
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
        rollback = 'Installazione parziale rimossa'
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
function Fail([string]$Text) { throw $Text }
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
function Normalize-PathPart([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    return $Value.Trim().TrimEnd('\')
}
function Add-ToUserPath([string]$Directory) {
    $normalized = Normalize-PathPart $Directory
    $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
    $parts = @($userPath -split ';' | Where-Object { $_ })
    $exists = @($parts | Where-Object { (Normalize-PathPart $_) -ieq $normalized }).Count -gt 0
    if (-not $exists) {
        [Environment]::SetEnvironmentVariable('Path', (($parts + $Directory) -join ';').Trim(';'), [EnvironmentVariableTarget]::User)
    }

    $processExists = @($env:Path -split ';' | Where-Object { (Normalize-PathPart $_) -ieq $normalized }).Count -gt 0
    if (-not $processExists) { $env:Path = "$Directory;$env:Path" }
}
function Restore-Path([string]$UserPath, [string]$ProcessPath) {
    [Environment]::SetEnvironmentVariable('Path', $UserPath, [EnvironmentVariableTarget]::User)
    $env:Path = $ProcessPath
}
function Get-ReleaseInfo {
    $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri "https://api.github.com/repos/$Repository/releases/latest"
    if ($RequestedVersion) {
        $wanted = $RequestedVersion.Trim().TrimStart('v')
        if (([string]$release.tag_name).TrimStart('v') -ne $wanted) {
            $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri "https://api.github.com/repos/$Repository/releases/tags/v$wanted"
        }
    }
    return $release
}
function Invoke-Meriotify {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    $output = (& $script:Exe @Arguments 2>&1 | Out-String).Trim()
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $detail = if ($output) { "`n$output" } else { '' }
        throw "Meriotify command failed ($exitCode): meriotify $($Arguments -join ' ')$detail"
    }
    return $output
}
function Install-Marketplace([string]$TempRoot) {
    $marketAppPath = Join-Path $DataDir 'CustomApps\marketplace'
    $marketThemePath = Join-Path $DataDir 'Themes\marketplace'
    $marketZip = Join-Path $TempRoot 'marketplace.zip'

    Remove-Item -LiteralPath $marketAppPath -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $marketThemePath -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $marketAppPath, $marketThemePath -Force | Out-Null

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri 'https://github.com/spicetify/marketplace/releases/latest/download/marketplace.zip' -OutFile $marketZip
    Expand-Archive -LiteralPath $marketZip -DestinationPath $marketAppPath -Force

    $unpacked = Join-Path $marketAppPath 'marketplace-dist'
    if (-not (Test-Path -LiteralPath $unpacked -PathType Container)) {
        throw 'Marketplace archive does not contain marketplace-dist.'
    }

    Get-ChildItem -LiteralPath $unpacked -Force | Move-Item -Destination $marketAppPath -Force
    Remove-Item -LiteralPath $unpacked -Recurse -Force
    Remove-Item -LiteralPath $marketZip -Force -ErrorAction SilentlyContinue

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri 'https://raw.githubusercontent.com/spicetify/marketplace/main/resources/color.ini' -OutFile (Join-Path $marketThemePath 'color.ini')

    Invoke-Meriotify 'config' 'custom_apps' 'spicetify-marketplace-' '-q' | Out-Null
    Invoke-Meriotify 'config' 'custom_apps' 'marketplace' | Out-Null
    Invoke-Meriotify 'config' 'inject_css' '1' 'replace_colors' '1' | Out-Null

    $currentTheme = (Invoke-Meriotify 'config' 'current_theme').Trim()
    if ([string]::IsNullOrWhiteSpace($currentTheme)) {
        Invoke-Meriotify 'config' 'current_theme' 'marketplace' | Out-Null
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
$release = Get-ReleaseInfo
$version = ([string]$release.tag_name).TrimStart('v')
$assetName = "meriotify-$version-windows-$architecture.zip"
$assetObject = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
if (-not $assetObject) {
    Write-Host '  [X] ' -ForegroundColor Red -NoNewline
    Write-Host (T 'failed')
    Write-Host "      Release asset not found: $assetName" -ForegroundColor DarkGray
    Write-Host ''
    return
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("meriotify-" + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot $assetName
$extract = Join-Path $tempRoot 'extract'
$backupInstall = Join-Path $tempRoot 'previous-install'
$hadInstall = Test-Path -LiteralPath $InstallDir -PathType Container
$oldUserPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
$oldProcessPath = $env:Path
$oldUserLang = [Environment]::GetEnvironmentVariable('MERIOTIFY_LANG', [EnvironmentVariableTarget]::User)
$oldProcessLang = $env:MERIOTIFY_LANG

try {
    New-Item -ItemType Directory -Path $tempRoot, $extract -Force | Out-Null

    if ($hadInstall) {
        Copy-Item -LiteralPath $InstallDir -Destination $backupInstall -Recurse -Force
    }

    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri ([string]$assetObject.browser_download_url) -OutFile $archive
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
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $DataDir 'language') -Value $script:Lang -Encoding Ascii -NoNewline
    Ok ((T 'meriotify') -f $version)

    Install-Marketplace $tempRoot
    Ok (T 'marketplace')

    Invoke-Meriotify '-q' 'setup' | Out-Null
    Ok (T 'spotify')

    Write-Host ''
    Write-Host "  $(T 'done')" -ForegroundColor Green
    Write-Host ''
} catch {
    try {
        Get-Process -Name 'meriotify' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        if ($hadInstall -and (Test-Path -LiteralPath $backupInstall -PathType Container)) {
            Copy-Item -LiteralPath $backupInstall -Destination $InstallDir -Recurse -Force
        }
        Restore-Path $oldUserPath $oldProcessPath
        [Environment]::SetEnvironmentVariable('MERIOTIFY_LANG', $oldUserLang, [EnvironmentVariableTarget]::User)
        if ($null -eq $oldProcessLang) {
            Remove-Item Env:MERIOTIFY_LANG -ErrorAction SilentlyContinue
        } else {
            $env:MERIOTIFY_LANG = $oldProcessLang
        }
    } catch {
        # Keep the original installation error below.
    }

    Write-Host ''
    Write-Host '  [X] ' -ForegroundColor Red -NoNewline
    Write-Host (T 'failed')
    if ($_.Exception.Message) { Write-Host "      $($_.Exception.Message)" -ForegroundColor DarkGray }
    Ok (T 'rollback')
    Write-Host ''
    return
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
