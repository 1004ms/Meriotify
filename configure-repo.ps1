param(
    [Parameter(Mandatory = $true)]
    [string]$Repository
)

$ErrorActionPreference = 'Stop'

if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Repository must use the GitHub owner/repository format, e.g. Fredh/Meriotify.'
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$module = "github.com/$Repository"

$files = @(
    (Join-Path $root 'go.mod'),
    (Join-Path $root 'install.ps1'),
    (Join-Path $root 'install.sh'),
    (Join-Path $root 'README.md'),
    (Join-Path $root 'NOTICE.md'),
    (Join-Path $root 'src/jsHelper/spicetifyWrapper/update.js'),
    (Join-Path $root 'src/utils/vcs.go')
)
$files += Get-ChildItem -Path (Join-Path $root 'src') -Filter '*.go' -Recurse | Select-Object -ExpandProperty FullName
$files += Get-ChildItem -Path (Join-Path $root 'src') -Filter '*.js' -Recurse | Select-Object -ExpandProperty FullName
$files += Get-ChildItem -Path (Join-Path $root 'Extensions') -Filter '*.js' -Recurse | Select-Object -ExpandProperty FullName
$files += Get-ChildItem -Path (Join-Path $root 'CustomApps') -Filter '*.js' -Recurse | Select-Object -ExpandProperty FullName
$files += (Join-Path $root 'meriotify.go')
$files = $files | Select-Object -Unique

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $text = Get-Content -LiteralPath $file -Raw
    $updated = $text.Replace('github.com/meriotify/cli', $module).Replace('Meriotify/cli', $Repository)
    if ($updated -ne $text) {
        [IO.File]::WriteAllText($file, $updated, (New-Object Text.UTF8Encoding($false)))
        $relative = $file.Substring($root.Length).TrimStart([char]92, [char]47)
        Write-Host "  [OK] $relative" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host "Meriotify repository configured as $Repository" -ForegroundColor Magenta
Write-Host "Build with: .\build.ps1 -Version 1.0.0" -ForegroundColor Cyan
