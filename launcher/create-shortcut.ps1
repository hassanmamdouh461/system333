<#
.SYNOPSIS
    Creates the "Engaz POS" shortcut on the current user's Desktop.

.DESCRIPTION
    Points a .lnk at launcher\launch.vbs, using the repo's electron\icon.ico and
    the repo root as the working directory. Re-running simply overwrites the
    existing shortcut, so it is safe to run any number of times.

.PARAMETER Name
    Shortcut file name without the .lnk extension. Default "Engaz POS".

.PARAMETER Mode
    Passed through to the launcher: Auto (default), Electron or Browser.

.PARAMETER Remove
    Delete the shortcut instead of creating it.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File launcher\create-shortcut.ps1
#>
[CmdletBinding()]
param(
    [string]$Name = 'Engaz POS',

    [ValidateSet('Auto', 'Electron', 'Browser')]
    [string]$Mode = 'Auto',

    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$RepoRoot     = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $PSScriptRoot 'launch.vbs'
$IconPath     = Join-Path $RepoRoot 'electron\icon.ico'
$Desktop      = [Environment]::GetFolderPath('Desktop')

if ([string]::IsNullOrWhiteSpace($Desktop)) {
    Write-Error 'Could not resolve the Desktop folder for the current user.'
    exit 1
}

$ShortcutPath = Join-Path $Desktop ($Name + '.lnk')

if ($Remove) {
    if (Test-Path -LiteralPath $ShortcutPath) {
        Remove-Item -LiteralPath $ShortcutPath -Force
        Write-Host "Removed: $ShortcutPath"
    } else {
        Write-Host "Nothing to remove: $ShortcutPath"
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $LauncherPath)) {
    Write-Error "Launcher script not found: $LauncherPath"
    exit 1
}
if (-not (Test-Path -LiteralPath $IconPath)) {
    Write-Error "Icon not found: $IconPath"
    exit 1
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
# wscript.exe (not cscript) so the VBScript host itself never shows a console.
$shortcut.TargetPath       = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments        = '"{0}" {1}' -f $LauncherPath, $Mode
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.IconLocation     = "$IconPath,0"
$shortcut.Description      = 'Start Engaz POS (system333)'
$shortcut.WindowStyle      = 7
$shortcut.Save()

if (-not (Test-Path -LiteralPath $ShortcutPath)) {
    Write-Error "Shortcut was not created: $ShortcutPath"
    exit 1
}

$check = $shell.CreateShortcut($ShortcutPath)
Write-Host 'Shortcut created:'
Write-Host "  Path             : $ShortcutPath"
Write-Host "  TargetPath       : $($check.TargetPath)"
Write-Host "  Arguments        : $($check.Arguments)"
Write-Host "  WorkingDirectory : $($check.WorkingDirectory)"
Write-Host "  IconLocation     : $($check.IconLocation)"
Write-Host "  Mode             : $Mode"
exit 0
