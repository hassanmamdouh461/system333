<#
.SYNOPSIS
    One-click launcher for Engaz POS (system333).

.DESCRIPTION
    Starts the Vite dev server, waits until it really answers on the local port,
    then opens the app - as the Electron desktop window by default, or in the
    default browser when Electron is not usable. Installs npm dependencies on
    first run and writes everything it does to logs\launcher.log.

.PARAMETER Mode
    Electron - always open the Electron window.
    Browser  - always open the default browser on the local URL.
    Auto     - Electron when its binary is present, otherwise Browser (default).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File launcher\launch.ps1 -Mode Browser
#>
[CmdletBinding()]
param(
    [ValidateSet('Auto', 'Electron', 'Browser')]
    [string]$Mode = 'Auto',

    [int]$Port = 5173,

    [int]$ReadyTimeoutSeconds = 180,

    [switch]$KeepDevServer
)

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$LogDir     = Join-Path $RepoRoot 'logs'
$LogFile    = Join-Path $LogDir 'launcher.log'
$ViteOutLog = Join-Path $LogDir 'vite.out.log'
$ViteErrLog = Join-Path $LogDir 'vite.err.log'
$ElecOutLog = Join-Path $LogDir 'electron.out.log'
$ElecErrLog = Join-Path $LogDir 'electron.err.log'
$InstallLog = Join-Path $LogDir 'npm-install.log'
$Url        = "http://localhost:$Port/"

if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

function Show-Problem {
    param([string]$Message)
    Write-Log $Message 'ERROR'
    $text = "$Message`n`nFull log:`n$LogFile"
    try {
        $shell = New-Object -ComObject WScript.Shell
        # 0x10 = error icon; the dialog auto-closes after 120s so nothing hangs forever.
        [void]$shell.Popup($text, 120, 'Engaz POS - startup failed', 0x10)
    } catch {
        Write-Host $text
    }
}

function Test-AppReady {
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Method = 'HEAD'
        $request.Timeout = 2000
        $response = $request.GetResponse()
        $response.Close()
        return $true
    } catch [System.Net.WebException] {
        # A served 404/500 still proves something is listening and speaking HTTP.
        if ($_.Exception.Response) { return $true }
        return $false
    } catch {
        return $false
    }
}

function Resolve-Command {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$devServerProcess = $null

function Stop-DevServer {
    if ($null -eq $devServerProcess) { return }
    if ($KeepDevServer) {
        Write-Log "Leaving the dev server running (PID $($devServerProcess.Id)) because -KeepDevServer was passed."
        return
    }
    if ($devServerProcess.HasExited) { return }
    Write-Log "Stopping the dev server process tree (PID $($devServerProcess.Id))."
    # npm.cmd spawns node as a child, so the whole tree has to go, not just the shim.
    & taskkill.exe /PID $devServerProcess.Id /T /F 2>&1 | Out-Null
}

try {
    Write-Log "=== Launcher started (Mode=$Mode, Port=$Port, Repo=$RepoRoot) ==="

    $npm = Resolve-Command 'npm.cmd'
    if (-not $npm) { $npm = Resolve-Command 'npm' }
    $node = Resolve-Command 'node.exe'
    if (-not $node) { $node = Resolve-Command 'node' }

    if (-not $node -or -not $npm) {
        Show-Problem "Node.js was not found on this computer (neither 'node' nor 'npm' is on PATH).`n`nInstall the LTS version from https://nodejs.org and run this shortcut again."
        exit 1
    }
    Write-Log "node: $node ($(& $node -v))"
    Write-Log "npm:  $npm"

    if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules'))) {
        Write-Log 'node_modules is missing - running the first-time dependency install. This can take several minutes.'
        Write-Host ''
        Write-Host '  Installing dependencies for the first time. Please leave this window open.'
        Write-Host "  Progress is also written to: $InstallLog"
        Write-Host ''
        $install = Start-Process -FilePath $npm -ArgumentList 'install' -WorkingDirectory $RepoRoot `
            -NoNewWindow -Wait -PassThru -RedirectStandardOutput $InstallLog -RedirectStandardError "$InstallLog.err"
        if ($install.ExitCode -ne 0) {
            Show-Problem "'npm install' failed with exit code $($install.ExitCode).`n`nSee $InstallLog and $InstallLog.err"
            exit $install.ExitCode
        }
        Write-Log 'Dependency install finished successfully.'
    } else {
        Write-Log 'node_modules already present - skipping install.'
    }

    $electronBin = Join-Path $RepoRoot 'node_modules\electron\dist\electron.exe'
    $electronCli = Join-Path $RepoRoot 'node_modules\.bin\electron.cmd'
    $electronAvailable = (Test-Path -LiteralPath $electronBin) -and (Test-Path -LiteralPath $electronCli)

    # Fast path: the production build (dist/) loads instantly with no dev server, no
    # port wait, and no first-compile delay. We only fall back to the Vite dev server
    # when the build is missing.
    $distIndex = Join-Path $RepoRoot 'dist\index.html'
    $buildAvailable = Test-Path -LiteralPath $distIndex
    Write-Log "Production build present: $buildAvailable."

    $effectiveMode = $Mode
    if ($effectiveMode -eq 'Auto') {
        if ($electronAvailable -and $buildAvailable) { $effectiveMode = 'FastElectron' }
        elseif ($electronAvailable) { $effectiveMode = 'Electron' }
        else { $effectiveMode = 'Browser' }
        Write-Log "Mode Auto resolved to $effectiveMode (electron binary: $electronAvailable, build: $buildAvailable)."
    } elseif ($effectiveMode -eq 'Electron' -and -not $electronAvailable) {
        Write-Log 'Electron was requested but its binary is missing - falling back to the browser.' 'WARN'
        $effectiveMode = 'Browser'
    }

    # FastElectron loads straight from dist/ and never needs a dev server. Only Electron
    # (no build) and Browser modes start Vite.
    if ($effectiveMode -ne 'FastElectron' -and (Test-AppReady)) {
        Write-Log "Something is already serving $Url - reusing it instead of starting a second dev server."
    } elseif ($effectiveMode -ne 'FastElectron') {
        Write-Log "Starting the Vite dev server on port $Port."
        $devServerProcess = Start-Process -FilePath $npm -ArgumentList 'run', 'dev', '--', '--port', "$Port", '--strictPort' `
            -WorkingDirectory $RepoRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $ViteOutLog -RedirectStandardError $ViteErrLog
        Write-Log "Dev server PID: $($devServerProcess.Id)"

        $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            if ($devServerProcess.HasExited) {
                $tail = ''
                foreach ($f in @($ViteErrLog, $ViteOutLog)) {
                    if (Test-Path -LiteralPath $f) {
                        $tail += (Get-Content -LiteralPath $f -Tail 15 | Out-String)
                    }
                }
                Show-Problem "The dev server exited immediately (code $($devServerProcess.ExitCode)).`n`n$tail"
                exit 1
            }
            if (Test-AppReady) { $ready = $true; break }
            Start-Sleep -Milliseconds 500
        }

        if (-not $ready) {
            Show-Problem "The dev server did not answer on $Url within $ReadyTimeoutSeconds seconds.`n`nSee $ViteOutLog and $ViteErrLog"
            Stop-DevServer
            exit 1
        }
        Write-Log "Dev server is answering on $Url."
    }

    if ($effectiveMode -eq 'Electron' -or $effectiveMode -eq 'FastElectron') {
        Write-Log "Opening the Electron desktop window ($effectiveMode)."
        # electron.exe directly, not the .cmd shim: the shim wraps everything in a
        # cmd.exe whose exit code hides Electron's own. -NoNewWindow (not
        # -WindowStyle Hidden) because the style would apply to the app's own
        # window and hide the UI.
        #
        # FastElectron serves the prebuilt dist/ (instant). Electron (dev) needs the
        # Vite server, so pass ENGAZ_DEV + the URL so main.cjs loads from it. Start-Process
        # inherits the current PowerShell env, so set it before and clear after. FastElectron
        # explicitly clears both so a leftover value from an earlier dev launch never leaks in.
        if ($effectiveMode -eq 'Electron') {
            $env:ENGAZ_DEV = '1'
            $env:ENGAZ_DEV_LOAD_URL = $Url
        } else {
            Remove-Item Env:ENGAZ_DEV -ErrorAction SilentlyContinue
            Remove-Item Env:ENGAZ_DEV_LOAD_URL -ErrorAction SilentlyContinue
        }
        $electron = Start-Process -FilePath $electronBin -ArgumentList '.' -WorkingDirectory $RepoRoot `
            -NoNewWindow -PassThru -RedirectStandardOutput $ElecOutLog -RedirectStandardError $ElecErrLog
        Write-Log "Electron PID: $($electron.Id)"

        # Touching Handle caches it, which is what makes ExitCode readable after
        # the process ends. Without this it comes back empty and a clean exit
        # looks like a crash.
        [void]$electron.Handle

        # Electron owns the session: when its window closes, the dev server goes with it.
        $electron.WaitForExit()
        $electronExit = $electron.ExitCode
        Write-Log "Electron exited with code $electronExit."

        if ($null -ne $electronExit -and $electronExit -ne 0) {
            $tail = ''
            if (Test-Path -LiteralPath $ElecErrLog) {
                $tail = (Get-Content -LiteralPath $ElecErrLog -Tail 20 | Out-String)
            }
            Show-Problem "Electron exited with code $electronExit.`n`n$tail"
            Stop-DevServer
            exit $electronExit
        }
        Stop-DevServer
    } else {
        Write-Log "Opening the default browser on $Url."
        Start-Process $Url | Out-Null
        Write-Log 'Browser mode: the dev server stays running until you close it (see logs\vite.out.log).'
        # No Stop-DevServer here - killing it would close the page the user just opened.
        $devServerProcess = $null
    }

    Write-Log '=== Launcher finished successfully ==='
    exit 0
} catch {
    $detail = $_ | Out-String
    Show-Problem "Unexpected launcher error:`n$detail"
    Stop-DevServer
    exit 1
}
