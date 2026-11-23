# =====================================================================
# Gancho automático (hook "Stop" do Claude Code): quando o Claude termina
# uma resposta, se algum arquivo do jogo mudou desde a última aprovação,
# roda TODOS os testes. Se algo falhar, bloqueia (código 2) e devolve o
# resumo das falhas para o Claude corrigir antes de terminar.
# =====================================================================
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$raiz = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $raiz 'testes\relatorios'
New-Item -ItemType Directory -Force $rel | Out-Null
$aprovado = Join-Path $rel '.impressao-aprovada'
$falhado  = Join-Path $rel '.impressao-falhou'

# entrada do hook (JSON no stdin): stop_hook_active = o Claude já está corrigindo por causa deste gancho
$entrada = ''
try { $entrada = [Console]::In.ReadToEnd() } catch { }
$ativo = $false
try { if ($entrada) { $ativo = [bool](ConvertFrom-Json $entrada).stop_hook_active } } catch { }

# "impressão digital" dos arquivos do jogo (o index.html é gerado, então fica de fora)
$arquivos = @()
$arquivos += Get-ChildItem (Join-Path $raiz 'codigo') -Recurse -File -ErrorAction SilentlyContinue
$arquivos += Get-ChildItem (Join-Path $raiz 'testes') -File -Include *.html, *.ps1, *.js -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike "$rel*" }
$arquivos += Get-ChildItem (Join-Path $raiz 'ferramentas') -File -ErrorAction SilentlyContinue
$arquivos += Get-ChildItem (Join-Path $raiz 'assets') -Recurse -File -ErrorAction SilentlyContinue
$texto = ($arquivos | Sort-Object FullName | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" }) -join "`n"
$sha = [System.Security.Cryptography.SHA256]::Create()
$impressao = [BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($texto))) -replace '-', ''

function Ler($f) { if (Test-Path $f) { (Get-Content $f -Raw -Encoding UTF8).Trim() } else { '' } }
if ((Ler $aprovado) -eq $impressao) { exit 0 }                 # nada mudou desde a última aprovação
if ($ativo -and (Ler $falhado) -eq $impressao) {                # já avisou e nada mudou: não prende o Claude em laço
  Write-Output '{"systemMessage": "Jogo da Onça: ainda há testes falhando (veja testes/relatorios/ultimo-relatorio.md)."}'
  exit 0
}

# REG-016: se já houver uma rodada de testes em andamento (ex.: uma rodada manual), não atropela:
# avisa e deixa para a próxima vez (sem aprovar). O robô roda 4 partidas aqui para caber no tempo do gancho.
$saida = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'testes\rodar-testes.ps1') -SemPrints -RoboPartidas 4 -EsperaMin 0 2>&1
if ($LASTEXITCODE -eq 3) {
  Write-Output '{"systemMessage": "Jogo da Onça: outra rodada de testes já está rodando; o gancho testa de novo na próxima vez."}'
  exit 0
}
if ($LASTEXITCODE -eq 0) {
  Set-Content -Path $aprovado -Value $impressao -Encoding ASCII
  if (Test-Path $falhado) { Remove-Item $falhado -Force }
  Write-Output '{"systemMessage": "Jogo da Onça: todos os testes passaram."}'
  exit 0
}

Set-Content -Path $falhado -Value $impressao -Encoding ASCII
$relatorio = Ler (Join-Path $rel 'ultimo-relatorio.md')
[Console]::Error.WriteLine("Os testes automáticos do Jogo da Onça FALHARAM depois das últimas mudanças. Corrija as falhas (e crie um teste de regressão para cada falha nova) antes de terminar.`n`n" + ($saida -join "`n") + "`n`n" + $relatorio)
exit 2
