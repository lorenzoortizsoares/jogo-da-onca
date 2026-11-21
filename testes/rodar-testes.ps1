# =====================================================================
# Jogo da Onça — roda TODOS os testes (back end = regras/IA, front end = tela/3D)
#   powershell -ExecutionPolicy Bypass -File testes\rodar-testes.ps1 [-SemPrints] [-Completo]
# Saída: testes\relatorios\ultimo-relatorio.md (+ prints em testes\relatorios\prints)
# Código de saída: 0 = tudo passou, 1 = alguma falha.
# =====================================================================
param([switch]$SemPrints, [switch]$Completo)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$raiz = Split-Path -Parent $PSScriptRoot
$rel  = Join-Path $raiz 'testes\relatorios'
$prints = Join-Path $rel 'prints'
New-Item -ItemType Directory -Force $prints | Out-Null
$perfil = Join-Path $env:TEMP 'onca-testes-chrome'

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Output 'ERRO: Chrome ou Edge não encontrado.'; exit 1 }

function Url($caminho) { 'file:///' + ((Join-Path $raiz $caminho) -replace '\\', '/') }
# O Chrome é um programa "de janela": chamado direto pelo PowerShell ele não devolve a saída
# (falha REG-004). Por isso roda via Start-Process, esperando terminar e gravando a saída em arquivo.
$tmpOut = Join-Path $env:TEMP 'onca-testes-saida.txt'
$tmpErr = Join-Path $env:TEMP 'onca-testes-erros.txt'
function Rodar-Chrome([string[]]$argumentos) {
  $base = @('--headless=new', "--user-data-dir=$perfil", '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist')
  $todos = ($base + $argumentos) | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }
  Start-Process -FilePath $chrome -ArgumentList $todos -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr -Wait -WindowStyle Hidden | Out-Null
  if (Test-Path $tmpOut) { return [System.IO.File]::ReadAllText($tmpOut, [System.Text.Encoding]::UTF8) }
  return ''
}
function Chrome-Dom($url, $janela, $tempo) { Rodar-Chrome @("--window-size=$janela", "--virtual-time-budget=$tempo", '--dump-dom', $url) }
function Chrome-Print($url, $janela, $arquivo) { Rodar-Chrome @('--hide-scrollbars', "--window-size=$janela", '--virtual-time-budget=20000', "--screenshot=$arquivo", $url) | Out-Null }
function Decodificar($t) { [System.Net.WebUtility]::HtmlDecode(($t -replace '<[^>]+>', '')) }

$resultados = New-Object System.Collections.Generic.List[object]
function Registrar($nome, $ok, $detalhe) {
  $resultados.Add([pscustomobject]@{ Nome = $nome; Ok = $ok; Detalhe = $detalhe })
  $marca = if ($ok) { 'OK   ' } else { 'FALHA' }
  Write-Output "[$marca] $nome"
}
$inicio = Get-Date

# 1) montar o index.html a partir de codigo/
$m = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $raiz 'ferramentas\montar.ps1') 2>&1
Registrar 'Montagem do index.html' ($LASTEXITCODE -eq 0) ($m -join ' ')

# 2) back end: regras + computador (IA)
# REG-005: no "tempo virtual" do Chrome sem janela o relógio dispara quando a página fica ociosa;
# com orçamento pequeno os testes do Worker não terminavam. 4.000.000 ms virtuais ≈ 25 s reais.
$dom = Chrome-Dom (Url 'testes\logica\testes-logica.html') '1000,800' 4000000
$txt = Decodificar ([regex]::Match($dom, '(?s)<pre id="out"[^>]*>(.*?)</pre>').Groups[1].Value)
$res = [regex]::Match($txt, 'SUMMARY: (\d+) passed, (\d+) failed')
$falhasLogica = ($txt -split "`n" | Where-Object { $_ -match '^FAIL' }) -join "`n"
$terminou = $txt -match 'done in'
$okLogica = $res.Success -and ([int]$res.Groups[2].Value -eq 0) -and $terminou
$det = if ($res.Success) { "$($res.Groups[1].Value) passaram, $($res.Groups[2].Value) falharam" + $(if (-not $terminou) { ' (testes assíncronos não terminaram)' } else { '' }) } else { 'sem resultado (a página não rodou)' }
if ($falhasLogica) { $det += "`n$falhasLogica" }
Registrar 'Back end: regras e computador (testes-logica.html)' $okLogica $det

# 3) front end: autoteste da interface (computador e celular)
function Autoteste($nome, $url, $janela) {
  $dom = Chrome-Dom $url $janela 150000
  $t = Decodificar ([regex]::Match($dom, '(?s)<pre id="selftest-report"[^>]*>(.*?)</pre>').Groups[1].Value)
  $ok = $t -match 'SELFTEST PASSOU'
  $resumo = [regex]::Match($t, '"resumo": "([^"]+)"').Groups[1].Value
  if (-not $t) { $resumo = 'sem relatório (o jogo não terminou o autoteste)' }
  $falhas = ''
  if (-not $ok -and $t) {
    try {
      $json = ConvertFrom-Json ($t.Substring($t.IndexOf('{')))
      $falhas = ($json.checks | Where-Object { -not $_.ok } | ForEach-Object { "- $($_.nome): $($_.info | ConvertTo-Json -Compress)" }) -join "`n"
      if ($json.errors) { $falhas += "`n- erros de JS: " + ($json.errors -join ' | ') }
    } catch { $falhas = $t }
  }
  Registrar $nome $ok ($resumo + $(if ($falhas) { "`n$falhas" } else { '' }))
}
Autoteste 'Front end: autoteste no computador (1400x900)' ((Url 'index.html') + '?selftest=1') '1400,900'
Autoteste 'Front end: autoteste no celular (390x844)' ((Url 'testes\interface\moldura-celular.html') + '?q=selftest%3D1') '600,900'

# 4) prints para conferência visual
if (-not $SemPrints) {
  $moldura = Url 'testes\interface\moldura-celular.html'
  Chrome-Print ($moldura + '?q=') '390,844' (Join-Path $prints 'celular-inicio.png')
  Chrome-Print ($moldura + '?q=tela%3Descolha-2j') '390,844' (Join-Path $prints 'celular-escolha-2j.png')
  Chrome-Print ($moldura + '?q=mode%3Dpvp%26shot%3D1') '390,844' (Join-Path $prints 'celular-partida.png')
  Chrome-Print ($moldura + '?q=mode%3Dai%26side%3DD%26demo%3Dmidgame%26shot%3D1') '390,844' (Join-Path $prints 'celular-meio-de-jogo.png')
  Chrome-Print ((Url 'index.html') + '?mode=ai&side=J&demo=midgame&shot=1') '1400,900' (Join-Path $prints 'computador-meio-de-jogo.png')
  Chrome-Print ((Url 'index.html') + '?mode=pvp&demo=win&shot=1') '1400,900' (Join-Path $prints 'computador-vitoria.png')
  $nPrints = (Get-ChildItem $prints -Filter *.png | Measure-Object).Count
  Registrar 'Prints gerados (testes\relatorios\prints)' ($nPrints -ge 6) "$nPrints imagens"
}

# 5) opcional: calibração dos níveis (lenta)
if ($Completo) {
  $dom = Chrome-Dom (Url 'testes\logica\calibracao-niveis.html') '1000,800' 600000
  $t = Decodificar ([regex]::Match($dom, '(?s)<pre id="out"[^>]*>(.*?)</pre>').Groups[1].Value)
  Registrar 'Calibração dos níveis (Básico < Intermediário < Avançado < Expert)' ($t -notmatch 'FAIL') ($t.Substring(0, [Math]::Min(1500, $t.Length)))
}

# relatório
$falhou = @($resultados | Where-Object { -not $_.Ok }).Count
$dur = [math]::Round(((Get-Date) - $inicio).TotalSeconds)
$md = New-Object System.Text.StringBuilder
[void]$md.AppendLine('# Relatório de testes — Jogo da Onça')
[void]$md.AppendLine('')
[void]$md.AppendLine("Data: $(Get-Date -Format 'dd/MM/yyyy HH:mm') · duração: ${dur}s · resultado: **$(if ($falhou -eq 0) { 'TUDO PASSOU' } else { "$falhou FALHA(S)" })**")
[void]$md.AppendLine('')
foreach ($r in $resultados) {
  [void]$md.AppendLine("## $(if ($r.Ok) { '✅' } else { '❌' }) $($r.Nome)")
  [void]$md.AppendLine('')
  [void]$md.AppendLine('```')
  [void]$md.AppendLine($r.Detalhe)
  [void]$md.AppendLine('```')
  [void]$md.AppendLine('')
}
[System.IO.File]::WriteAllText((Join-Path $rel 'ultimo-relatorio.md'), $md.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Output ''
if ($falhou -eq 0) { Write-Output "TUDO PASSOU ($($resultados.Count) etapas, ${dur}s). Relatório: testes\relatorios\ultimo-relatorio.md"; exit 0 }
Write-Output "FALHOU: $falhou etapa(s). Veja testes\relatorios\ultimo-relatorio.md"
exit 1
