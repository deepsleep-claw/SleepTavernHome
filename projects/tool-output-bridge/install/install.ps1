param(
    [ValidateSet('menu', 'install', 'uninstall', 'status')][string]$Command = 'menu',
    [string]$Root = (Get-Location).Path,
    [string]$Config,
    [string]$DataRoot,
    [string]$Repository = $(if ($env:JIMI_TOOLS_REPOSITORY) { $env:JIMI_TOOLS_REPOSITORY } else { 'deepsleep-claw/SleepTavernHome' }),
    [string]$Ref = $(if ($env:JIMI_TOOLS_REF) { $env:JIMI_TOOLS_REF } else { 'main' }),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Please install Node.js 20+ first.' }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw 'Please install curl first.' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') { throw 'Cannot read the Node.js version.' }
if ([int]$Matches['major'] -lt 20) { throw 'Node.js 20+ is required.' }
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('jimi-tools-' + [guid]::NewGuid().ToString('N') + '.mjs')
$encodedRef = [Uri]::EscapeDataString($Ref)
$url = "https://raw.githubusercontent.com/$Repository/$encodedRef/projects/tool-output-bridge/dist/tool-output-bridge/installer.mjs"
try {
    Write-Host 'Downloading Jimi Tools installer...'
    & curl.exe --fail --show-error --silent --location --connect-timeout 15 --max-time 120 $url -o $temporary
    if ($LASTEXITCODE -ne 0) { throw 'Cannot download the Jimi Tools installer.' }
    $arguments = @($temporary, $Command, '--online', '--repository', $Repository, '--ref', $Ref, '--root', $Root)
    if ($Config) { $arguments += @('--config', $Config) }
    if ($DataRoot) { $arguments += @('--data-root', $DataRoot) }
    if ($DryRun) { $arguments += '--dry-run' }
    & node @arguments
    if ($LASTEXITCODE -ne 0) { throw "Jimi Tools installer failed (exit $LASTEXITCODE)." }
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
