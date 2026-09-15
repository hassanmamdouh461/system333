' Engaz POS (system333) - kept for backwards compatibility.
'
' The real launcher now lives in launcher\launch.vbs, which resolves Node from
' PATH, waits for the dev server to actually answer, and reports failures instead
' of dying silently. This file just forwards to it.

Option Explicit

Dim shell, fso, scriptDir, target, args, i

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(fso.GetFile(WScript.ScriptFullName))
target = fso.BuildPath(fso.BuildPath(scriptDir, "launcher"), "launch.vbs")

If Not fso.FileExists(target) Then
    MsgBox "Cannot find the launcher:" & vbCrLf & target, 16, "Engaz POS"
    WScript.Quit 1
End If

args = ""
For i = 0 To WScript.Arguments.Count - 1
    args = args & " " & WScript.Arguments(i)
Next

shell.Run "wscript.exe """ & target & """" & args, 0, False
