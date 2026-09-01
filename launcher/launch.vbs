' Engaz POS (system333) - one-click launcher entry point.
'
' Runs launcher\launch.ps1 without leaving a black console window behind on the
' normal path. The one exception is the very first run: when node_modules is
' missing the install takes minutes, so the window is shown on purpose to prove
' that something is happening. Failures always surface as a message box from
' launch.ps1 itself, plus logs\launcher.log.
'
' Optional argument: Electron | Browser | Auto  (default Auto)

Option Explicit

Dim shell, fso, scriptDir, repoRoot, psScript, mode, showWindow, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(fso.GetFile(WScript.ScriptFullName))
repoRoot = fso.GetParentFolderName(scriptDir)
psScript = fso.BuildPath(scriptDir, "launch.ps1")

If Not fso.FileExists(psScript) Then
    MsgBox "Cannot find the launcher script:" & vbCrLf & psScript, 16, "Engaz POS"
    WScript.Quit 1
End If

mode = "Auto"
If WScript.Arguments.Count > 0 Then
    mode = WScript.Arguments(0)
End If

' First run (no dependencies yet) stays visible so the install is not silent.
If fso.FolderExists(fso.BuildPath(repoRoot, "node_modules")) Then
    showWindow = 0
Else
    showWindow = 1
End If

shell.CurrentDirectory = repoRoot

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ _
    & psScript & """ -Mode " & mode

shell.Run command, showWindow, False
