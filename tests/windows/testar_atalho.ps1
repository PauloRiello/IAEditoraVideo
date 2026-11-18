param([string]$Arquivo)
# Decodifica como o PowerShell faz com -EncodedCommand e executa com um WScript.Shell de mentira.
$comando = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String((Get-Content -Raw $Arquivo).Trim()))
$erros = $null; $marcas = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($comando, [ref]$marcas, [ref]$erros)
if ($erros.Count) { $erros | ForEach-Object { "ERRO DE SINTAXE: $($_.Message)" }; exit 1 }
"sintaxe do comando: ok"
$global:criados = New-Object System.Collections.ArrayList
function New-Object {
  if ($args -notcontains "-ComObject") { throw "uso inesperado de New-Object: $args" }
  $shell = [pscustomobject]@{}
  $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
    param($caminho)
    $a = [pscustomobject]@{ Caminho = $caminho; TargetPath = ""; Arguments = ""; WorkingDirectory = ""; IconLocation = ""; Description = ""; WindowStyle = 0; Salvo = $false }
    $a | Add-Member -MemberType ScriptMethod -Name Save -Value { $this.Salvo = $true }
    [void]$global:criados.Add($a)
    return $a
  }
  return $shell
}
Invoke-Expression $comando
"pastas: Desktop='$([Environment]::GetFolderPath('Desktop'))' Programs='$([Environment]::GetFolderPath('Programs'))'"
"atalhos criados: $($global:criados.Count)"
$global:criados | ForEach-Object { $_ | Select-Object Caminho, TargetPath, Arguments, WorkingDirectory, IconLocation, WindowStyle, Salvo | ConvertTo-Json -Compress }
