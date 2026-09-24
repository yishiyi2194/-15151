param(
    [Parameter(Mandatory = $true)]
    [string]$TavernRoot
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $TavernRoot).Path
$packagePath = Join-Path $root 'package.json'
$configPath = Join-Path $root 'config.yaml'
if (-not (Test-Path -LiteralPath $packagePath) -or -not (Test-Path -LiteralPath $configPath)) {
    throw 'TavernRoot must be an existing SillyTavern installation with config.yaml.'
}
$package = Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath | ConvertFrom-Json
if ($package.name -ne 'sillytavern') { throw 'This directory is not SillyTavern.' }
if ([version]($package.version -replace '-.*$','') -lt [version]'1.13.3') {
    throw 'SillyTavern 1.13.3 or later is required.'
}
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath
if ($config -notmatch '(?m)^enableServerPlugins:\s*(true|false)\s*(?:#.*)?$') {
    throw 'Cannot safely locate enableServerPlugins in config.yaml.'
}
$plan = @(
    @{ Source='extension'; Target='public\scripts\extensions\third-party\paintai'; Files=@('manifest.json','index.js','api.js','chat.js','scene.js','style.css') },
    @{ Source='server-plugin'; Target='plugins\paintai-bridge'; Files=@('index.mjs','config.json') }
)
# Validate all sources before touching the target installation.
foreach ($item in $plan) {
    foreach ($name in $item.Files) {
        $source = Join-Path (Join-Path $PSScriptRoot $item.Source) $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing bundle file: $source" }
    }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupRoot = Join-Path $root (Join-Path 'backups' "paintai-install-$stamp")
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $configPath -Destination (Join-Path $backupRoot 'config.yaml') -Force
foreach ($item in $plan) {
    $target = [IO.Path]::GetFullPath((Join-Path $root $item.Target))
    if (-not $target.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Target escaped the installation directory.'
    }
    if (Test-Path -LiteralPath $target) {
        Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot $item.Source) -Recurse -Force
    }
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($name in $item.Files) {
        $source = Join-Path (Join-Path $PSScriptRoot $item.Source) $name
        $destination = Join-Path $target $name
        # Preserve an administrator's existing upstream allowlist on update.
        if ($name -eq 'config.json' -and (Test-Path -LiteralPath $destination)) { continue }
        Copy-Item -LiteralPath $source -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            throw "Copy verification failed: $destination"
        }
    }
}
$updated = [regex]::Replace($config, '(?m)^enableServerPlugins:\s*(true|false)\s*(?:#.*)?$', 'enableServerPlugins: true')
[IO.File]::WriteAllText($configPath, $updated, (New-Object Text.UTF8Encoding $false))
Write-Output "PaintAI installed. Backup: $backupRoot"
Write-Output 'Restart SillyTavern, then open Extensions > PaintAI. Enter URL and Token.'
