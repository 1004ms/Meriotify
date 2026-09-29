$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Brand = 'Meriotify'
$Command = 'meriotify'
$InstallDir = Join-Path $env:LOCALAPPDATA 'meriotify'
$Repository = if ($env:MERIOTIFY_REPOSITORY) { $env:MERIOTIFY_REPOSITORY } else { '1004ms/Meriotify' }
$RequestedVersion = $env:MERIOTIFY_VERSION
$SkipMarketplace = $env:MERIOTIFY_SKIP_MARKETPLACE -eq '1'

function Write-Step([string]$Message) {
    Write-Host '  > ' -ForegroundColor DarkMagenta -NoNewline
    Write-Host $Message
}

function Write-Ok([string]$Message) {
    Write-Host '  [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Fail([string]$Message) {
    Write-Host '  [ERROR] ' -ForegroundColor Red -NoNewline
    Write-Host $Message
    exit 1
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    switch ($arch) {
        'x64'   { return 'x64' }
        'arm64' { return 'arm64' }
        'x86'   { return 'x32' }
        default { Fail "Unsupported architecture: $arch" }
    }
}

function Get-Version {
    if ($RequestedVersion) {
        if ($RequestedVersion -notmatch '^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
            Fail "Invalid MERIOTIFY_VERSION: $RequestedVersion"
        }
        return $RequestedVersion.TrimStart('v')
    }

    Write-Step "Finding latest $Brand release"
    $headers = @{ 'User-Agent' = 'Meriotify-Installer' }
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repository/releases/latest"
    if (-not $release.tag_name) { Fail 'GitHub did not return a release tag.' }
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

if ($PSVersionTable.PSVersion -lt [version]'5.1') {
    Fail 'PowerShell 5.1 or newer is required.'
}

if (Test-IsAdmin) {
    Fail 'Run this installer in a normal PowerShell window, not as Administrator.'
}

Write-Host ''
Write-Host '  MERIOTIFY' -ForegroundColor Magenta
Write-Host '  Fast Spotify customization CLI' -ForegroundColor DarkGray
Write-Host ''

$architecture = Get-Architecture
$version = Get-Version
$asset = "meriotify-$version-windows-$architecture.zip"
$url = "https://github.com/$Repository/releases/download/v$version/$asset"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("meriotify-" + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $tempRoot $asset
$extract = Join-Path $tempRoot 'extract'

try {
    New-Item -ItemType Directory -Path $tempRoot, $extract -Force | Out-Null
    Write-Step "Downloading $Brand v$version ($architecture)"
    Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'Meriotify-Installer' } -Uri $url -OutFile $archive

    Write-Step 'Installing files'
    Expand-Archive -LiteralPath $archive -DestinationPath $extract -Force
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

    # Keep user-owned config outside LOCALAPPDATA; replacing this directory is therefore safe.
    Get-ChildItem -LiteralPath $InstallDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $extract '*') -Destination $InstallDir -Recurse -Force

    $exe = Join-Path $InstallDir 'meriotify.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        Fail "Release archive does not contain meriotify.exe"
    }

    # Compatibility shim: Marketplace and older scripts may still invoke `spicetify`.
    $shim = Join-Path $InstallDir 'spicetify.cmd'
    '@echo off' + "`r`n" + '"%~dp0meriotify.exe" %*' + "`r`n" | Set-Content -LiteralPath $shim -Encoding Ascii

    Add-ToUserPath $InstallDir
    Write-Ok "$Brand v$version installed"

    & $exe --version | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "$Brand executable verification failed." }
    Write-Ok 'CLI verified'

    if (-not $SkipMarketplace) {
        Write-Step 'Installing Spicetify Marketplace compatibility layer'
        try {
            $marketplace = Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/spicetify/spicetify-marketplace/main/resources/install.ps1'
            Invoke-Expression $marketplace.Content
            Write-Ok 'Marketplace installed'
        }
        catch {
            Write-Host '  ! Marketplace install skipped/failed; Meriotify itself is installed.' -ForegroundColor Yellow
            Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkGray
        }
    }

    Write-Host ''
    Write-Host '  Ready.' -ForegroundColor Green
    Write-Host '  Run: ' -NoNewline
    Write-Host 'meriotify setup' -ForegroundColor Cyan
    Write-Host '  Help: ' -NoNewline
    Write-Host 'meriotify -h' -ForegroundColor Cyan
    Write-Host ''
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
