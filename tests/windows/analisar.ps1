param([string]$Arquivo)
$erros = $null; $marcas = $null
$arvore = [System.Management.Automation.Language.Parser]::ParseFile($Arquivo, [ref]$marcas, [ref]$erros)
if ($erros.Count -gt 0) { $erros | ForEach-Object { "ERRO linha $($_.Extent.StartLineNumber): $($_.Message)" }; exit 1 }
# Recursos que so existem no PowerShell 7 e quebram no Windows PowerShell 5.1 (o que vem no Windows).
$novos = $arvore.FindAll({ param($n) $n -is [System.Management.Automation.Language.TernaryExpressionAst] -or $n -is [System.Management.Automation.Language.PipelineChainAst] }, $true)
$coalescencia = $marcas | Where-Object { $_.Kind -in @('QuestionQuestion', 'QuestionQuestionEquals', 'QuestionDot', 'QuestionLBracket') }
if ($novos.Count -gt 0 -or $coalescencia) { "INCOMPATIVEL com 5.1: $($novos.Count) expressao(oes) nova(s), $(@($coalescencia).Count) operador(es) novo(s)"; exit 1 }
"sintaxe ok; sem recursos exclusivos do PowerShell 7 ($($marcas.Count) marcas)"
