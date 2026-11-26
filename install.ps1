# Forever Companion installer for Windows. Paste this line into PowerShell:
#
#   irm https://raw.githubusercontent.com/biokraft/wow-forever-companion/main/install.ps1 | iex
#
# It checks for Node.js (and offers to install it with winget), puts Forever Companion into
# the folder wow-forever-companion in your user folder and starts setup, which asks the rest.
# Running it again updates what is there.
#
#   $env:FC_DIR = 'D:\some\folder'    install into another folder
#   $env:FC_NO_GIT = '1'              download the files even when git is installed
#   $env:FC_SETUP_ARGS = '--yes'      options for setup (see docs/SETUP.md)
#
# Everything runs inside Install-ForeverCompanion, so a download that stops half-way runs
# nothing. Written for Windows PowerShell 5.1 and newer.

$RepoUrl = 'https://github.com/biokraft/wow-forever-companion'
$NodeMin = 22

function Test-Tool([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Node {
  if (-not (Test-Tool 'node')) { return $false }
  $major = & node -p 'process.versions.node.split(".")[0]' 2>$null
  if ($LASTEXITCODE -ne 0) { return $false }
  return ([int]$major -ge $NodeMin)
}

# A program installed a moment ago is found only after PATH is read again.
function Update-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Confirm-Step([string]$Question) {
  if (-not [Environment]::UserInteractive) { return $false }
  try { $answer = Read-Host "$Question [Y/n]" } catch { return $false } # no console to ask on
  return ($answer -eq '' -or $answer -match '^(y|yes)$')
}

function Assert-Node {
  if (Test-Node) { return }
  if (Test-Tool 'node') {
    Write-Host "Node.js $(& node --version) is too old: Forever Companion needs $NodeMin or newer."
  } else {
    Write-Host "Node.js is not installed: Forever Companion needs version $NodeMin or newer."
  }
  if ((Test-Tool 'winget') -and (Confirm-Step 'Install it with winget now?')) {
    & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Update-Path
    if (Test-Node) { return }
  }
  throw "Install Node.js: open https://nodejs.org, download the LTS installer and run it with the default options. Then open a new PowerShell window and paste the install line again."
}

function Get-CodeByDownload([string]$Dir) {
  # Windows PowerShell 5.1 defaults to old TLS versions that GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("forever-companion-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    $zip = Join-Path $tmp 'forever-companion.zip'
    $oldProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue' # the progress bar makes the download very slow
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$RepoUrl/archive/refs/heads/main.zip" -OutFile $zip
    } finally {
      $ProgressPreference = $oldProgress
    }
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp
    $tree = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    if (-not $tree -or -not (Test-Path -LiteralPath (Join-Path $tree.FullName 'bin\wowf'))) {
      throw 'The download does not look like Forever Companion.'
    }
    $parent = Split-Path -Parent $Dir
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    if (Test-Path -LiteralPath $Dir) { Remove-Item -LiteralPath $Dir -Recurse -Force } # empty, checked by the caller
    Move-Item -LiteralPath $tree.FullName -Destination $Dir
  } catch {
    throw "The download from GitHub failed ($($_.Exception.Message)). Check your internet connection and paste the install line again."
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Get-Code([string]$Dir) {
  if (Test-Path -LiteralPath (Join-Path $Dir 'bin\wowf')) {
    Write-Host "Forever Companion is already in $Dir. Updating it..."
    Push-Location -LiteralPath $Dir
    try {
      & node bin\wowf update
      if ($LASTEXITCODE -ne 0) { Write-Host 'The update did not finish (see above). Going on with the version that is there.' }
    } finally {
      Pop-Location
    }
    return
  }
  if ((Test-Path -LiteralPath $Dir) -and (Get-ChildItem -LiteralPath $Dir -Force | Select-Object -First 1)) {
    throw "$Dir exists and holds something else. Move it away, or pick another folder first: `$env:FC_DIR = 'D:\another-folder'"
  }
  if (-not $env:FC_NO_GIT -and (Test-Tool 'git')) {
    Write-Host "Getting Forever Companion with git into $Dir..."
    & git clone "$RepoUrl.git" $Dir
    if ($LASTEXITCODE -ne 0) { throw 'git clone failed (see above).' }
  } else {
    Write-Host "Downloading Forever Companion into $Dir..."
    Get-CodeByDownload $Dir
  }
}

function Install-ForeverCompanion {
  $dir = $env:FC_DIR
  if (-not $dir) { $dir = Join-Path $env:USERPROFILE 'wow-forever-companion' }
  $setupArgs = @()
  if ($env:FC_SETUP_ARGS) { $setupArgs = $env:FC_SETUP_ARGS -split '\s+' | Where-Object { $_ } }

  Assert-Node
  Get-Code $dir
  Push-Location -LiteralPath $dir
  try {
    & node bin\wowf setup @setupArgs
    if ($LASTEXITCODE -ne 0) { throw "Setup did not finish (see above). To run it again: cd `"$dir`"; node bin\wowf setup" }
  } finally {
    Pop-Location
  }
}

try {
  Install-ForeverCompanion
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  # No `exit`: pasted through `iex`, that would close the player's PowerShell window.
  $global:LASTEXITCODE = 1
}
