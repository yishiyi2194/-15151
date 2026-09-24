param(
    [string]$SourceRoot = 'M:\SillyTavern',
    [int]$PreferredPort = 8917
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $PSScriptRoot 'tavern-runtime'
$infoPath = Join-Path $PSScriptRoot 'runtime-info.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$sourcePackage = Get-Content -LiteralPath (Join-Path $SourceRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($sourcePackage.version -ne '1.13.3') { throw 'Expected SillyTavern 1.13.3.' }
if (Test-Path -LiteralPath $infoPath) { throw 'Runtime was already prepared. Preparation will not overwrite it.' }
if (Test-Path -LiteralPath (Join-Path $runtimeRoot 'data')) {
    if (@(Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'data') -Force).Count) { throw 'Runtime data is not empty. Refusing to prepare over an existing run.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot 'node_modules'))) { throw 'Source node_modules is missing.' }

function Copy-RuntimeTree([string]$FromPath, [string]$ToPath) {
    $null = New-Item -ItemType Directory -Path $ToPath -Force
    foreach ($item in Get-ChildItem -LiteralPath $FromPath -Force) {
        if ($item.Name -in @('.git', 'node_modules', 'third-party')) { continue }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $targetPath = Join-Path $ToPath $item.Name
        if ($item.PSIsContainer) {
            Copy-RuntimeTree $item.FullName $targetPath
        } else {
            Copy-Item -LiteralPath $item.FullName -Destination $targetPath -Force
        }
    }
}

$sourceFiles = @('server.js', 'package.json', 'package-lock.json', 'webpack.config.js', 'LICENSE', 'post-install.js', 'plugins.js', 'index.d.ts')
$sourceHashes = @{}
foreach ($name in $sourceFiles) {
    $sourceHashes[$name] = (Get-FileHash -LiteralPath (Join-Path $SourceRoot $name) -Algorithm SHA256).Hash
}

$null = New-Item -ItemType Directory -Path $runtimeRoot -Force
foreach ($name in @('src', 'default')) {
    Copy-RuntimeTree (Join-Path $SourceRoot $name) (Join-Path $runtimeRoot $name)
}
$publicRoot = Join-Path $runtimeRoot 'public'
$null = New-Item -ItemType Directory -Path $publicRoot -Force
foreach ($name in @('css', 'error', 'img', 'lib', 'locales', 'scripts', 'sounds', 'webfonts')) {
    Copy-RuntimeTree (Join-Path $SourceRoot ('public\' + $name)) (Join-Path $publicRoot $name)
}
foreach ($name in @('favicon.ico', 'global.d.ts', 'index.html', 'jsconfig.json', 'lib.js', 'login.html', 'manifest.json', 'robots.txt', 'script.js', 'st-launcher.ico', 'st.ico', 'style.css')) {
    Copy-Item -LiteralPath (Join-Path $SourceRoot ('public\' + $name)) -Destination (Join-Path $publicRoot $name) -Force
}
foreach ($name in $sourceFiles) {
    Copy-Item -LiteralPath (Join-Path $SourceRoot $name) -Destination (Join-Path $runtimeRoot $name) -Force
}
foreach ($name in @('data', 'plugins', 'public\scripts\extensions\third-party')) {
    $null = New-Item -ItemType Directory -Path (Join-Path $runtimeRoot $name) -Force
}
$modulesPath = Join-Path $runtimeRoot 'node_modules'
$sourceModulesPath = Join-Path $SourceRoot 'node_modules'
if (Test-Path -LiteralPath $modulesPath) {
    $existingLink = Get-Item -LiteralPath $modulesPath -Force
    if ($existingLink.LinkType -ne 'Junction' -or $existingLink.Target -ne $sourceModulesPath) { throw 'Unexpected existing node_modules path.' }
} else {
    $null = New-Item -ItemType Junction -Path $modulesPath -Target $sourceModulesPath
}

$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
$usedPorts = @($listeners | ForEach-Object { $_.Port })
$runtimePort = $PreferredPort
while ($runtimePort -in $usedPorts) { $runtimePort++ }
if ($runtimePort -gt 65535) { throw 'No usable port found.' }
$nodePath = (Get-Command node -ErrorAction Stop).Source
& $nodePath (Join-Path $runtimeRoot 'configure-runtime.mjs') $runtimePort
if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration or dependency resolution failed.' }

foreach ($name in $sourceFiles) {
    $currentHash = (Get-FileHash -LiteralPath (Join-Path $SourceRoot $name) -Algorithm SHA256).Hash
    if ($currentHash -ne $sourceHashes[$name]) { throw ('Source changed during preparation: ' + $name) }
}
$info = [ordered]@{
    state = 'prepared-not-started'
    sourceRoot = [IO.Path]::GetFullPath($SourceRoot)
    runtimeRoot = [IO.Path]::GetFullPath($runtimeRoot)
    version = $sourcePackage.version
    nodePath = $nodePath
    nodeVersion = (& $nodePath --version)
    port = $runtimePort
    url = ('http://127.0.0.1:' + $runtimePort)
    processId = $null
    processStartTime = $null
    command = $null
    preparedAt = (Get-Date).ToString('o')
    startedAt = $null
    stoppedAt = $null
    sourceTopLevelHashes = $sourceHashes
    sourceTopLevelHashesUnchanged = $true
    sourceConfigRead = $false
    sourceUserDataRead = $false
    thirdPartyExtensionsCopied = $false
    originalPluginsCopied = $false
    modulesReuse = 'junction; do not install or modify dependencies through this path'
    stdoutLog = (Join-Path $runtimeRoot 'runtime.stdout.log')
    stderrLog = (Join-Path $runtimeRoot 'runtime.stderr.log')
}
[IO.File]::WriteAllText($infoPath, ($info | ConvertTo-Json -Depth 8), $utf8)
Write-Output ('Runtime prepared: ' + $runtimeRoot)
Write-Output ('URL reserved by configuration (not listening): ' + $info.url)
Write-Output 'No server was started. Copy the test plugins before running start-runtime.ps1.'
