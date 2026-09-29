param(
    [ValidateSet('x64','arm64','x32')]
    [string]$Architecture = 'x64',
    [string]$Version = 'Dev',
    [string]$UpstreamVersion = '2.45.1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Step([string]$Message) {
    Write-Host '  > ' -ForegroundColor DarkMagenta -NoNewline
    Write-Host $Message
}

function Ok([string]$Message) {
    Write-Host '  [OK] ' -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Require([string]$Command, [string]$Hint) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$Command is required. $Hint"
    }
}

Require 'go' 'Install Go 1.25+.'
Require 'node' 'Install Node.js 18+.'
Require 'corepack' 'Install a Node.js distribution that includes Corepack.'

$goVersionText = (& go version)
if ($goVersionText -notmatch 'go(\d+)\.(\d+)') {
    throw "Cannot detect Go version from: $goVersionText"
}
if ([int]$Matches[1] -lt 1 -or ([int]$Matches[1] -eq 1 -and [int]$Matches[2] -lt 25)) {
    throw "Go 1.25+ is required. Found: $goVersionText"
}

$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) { throw 'Node.js 18+ is required.' }

$goArch = switch ($Architecture) {
    'x64'   { 'amd64' }
    'arm64' { 'arm64' }
    'x32'   { '386' }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root 'dist'
$stage = Join-Path $dist "meriotify-$Version-windows-$Architecture"
$zip = Join-Path $dist "meriotify-$Version-windows-$Architecture.zip"

Set-Location $root

Step 'Installing JavaScript build dependencies'
& corepack pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed.' }

Step 'Building optimized Spotify wrapper'
& corepack pnpm build:wrapper
if ($LASTEXITCODE -ne 0) { throw 'Wrapper build failed.' }

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zip -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Step "Building Meriotify $Version for Windows $Architecture"
$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgo = $env:CGO_ENABLED
try {
    $env:GOOS = 'windows'
    $env:GOARCH = $goArch
    $env:CGO_ENABLED = '0'
    & go build -trimpath -buildvcs=false -ldflags "-s -w -X main.version=$Version -X main.upstreamVersion=$UpstreamVersion" -o (Join-Path $stage 'meriotify.exe') .
    if ($LASTEXITCODE -ne 0) { throw 'Go build failed.' }
}
finally {
    $env:GOOS = $oldGoos
    $env:GOARCH = $oldGoarch
    $env:CGO_ENABLED = $oldCgo
}

Copy-Item 'spicetify.cmd' $stage
Copy-Item 'globals.d.ts' $stage
Copy-Item 'css-map.json' $stage
Copy-Item 'CustomApps' $stage -Recurse
Copy-Item 'Extensions' $stage -Recurse
Copy-Item 'Themes' $stage -Recurse
Copy-Item 'MarketplaceBranding' $stage -Recurse
Copy-Item 'jsHelper' $stage -Recurse

Step 'Creating release ZIP'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Ok "Created $zip"
