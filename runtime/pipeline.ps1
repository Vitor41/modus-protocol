[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('status', 'doctor', 'setup', 'plan', 'role-launch', 'role-gate', 'transition-gate', 'trello', 'command')]
  [string]$Command,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CommandArgs
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$entries = @{
  'status' = 'version-status.mjs'
  'doctor' = 'doctor.mjs'
  'setup' = 'setup.mjs'
  'plan' = 'run-planner.mjs'
  'role-launch' = 'role-launcher.mjs'
  'role-gate' = 'role-gate.mjs'
  'transition-gate' = 'transition-gate.mjs'
  'trello' = 'trello-comments.mjs'
  'command' = 'command-runner.mjs'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
  throw 'Runtime Node.js da Esteira indisponível. Instale o runtime do workspace; não crie scripts substitutos.'
}

$entryPath = Join-Path (Join-Path $runtimeRoot 'src') $entries[$Command]
& $nodePath $entryPath @CommandArgs
exit $LASTEXITCODE
