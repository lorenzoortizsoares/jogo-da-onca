# =====================================================================
# Jogo da Onça — roda TODOS os testes (back end = regras/IA, front end = tela/3D)
#   powershell -ExecutionPolicy Bypass -File testes\rodar-testes.ps1 [-SemPrints] [-Completo]
# Saída: testes\relatorios\ultimo-relatorio.md (+ prints em testes\relatorios\prints)
# Código de saída: 0 = tudo passou, 1 = alguma falha.
# =====================================================================
param([switch]$SemPrints, [switch]$Completo, [switch]$ServidorReal, [int]$RoboPartidas = 9, [int]$EsperaMin = 15)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$raiz = Split-Path -Parent $PSScriptRoot
$rel  = Join-Path $raiz 'testes\relatorios'
$prints = Join-Path $rel 'prints'
New-Item -ItemType Directory -Force $prints | Out-Null

# REG-016: duas rodadas ao mesmo tempo (o gancho automático e uma rodada manual) usavam o mesmo perfil
# do Chrome e o mesmo arquivo temporário, e uma derrubava a outra ("sem resultado" em tudo).
# Agora as rodadas entram numa fila (a 2ª espera a 1ª terminar) e cada uma tem os seus próprios arquivos.
$fila = New-Object System.Threading.Mutex($false, 'Local\JogoDaOncaTestes')
$naVez = $false
try { $naVez = $fila.WaitOne([TimeSpan]::FromMinutes($EsperaMin)) } catch [System.Threading.AbandonedMutexException] { $naVez = $true }
if (-not $naVez) { Write-Output 'OCUPADO: outra rodada de testes ainda está rodando (espere ela terminar).'; exit 3 }
$perfil = Join-Path $env:TEMP "onca-testes-chrome-$PID"
function Limpar-Rodada {
  Remove-Item $perfil -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $tmpOut, $tmpErr -Force -ErrorAction SilentlyContinue
  try { $fila.ReleaseMutex() } catch { }
}

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
$tmpOut = Join-Path $env:TEMP "onca-testes-saida-$PID.txt"   # REG-016: arquivo próprio de cada rodada
$tmpErr = Join-Path $env:TEMP "onca-testes-erros-$PID.txt"
function Rodar-Chrome([string[]]$argumentos) {
  $base = @('--headless=new', "--user-data-dir=$perfil", '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist')
  $todos = ($base + $argumentos) | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }
  if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }
  Start-Process -FilePath $chrome -ArgumentList $todos -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr -Wait -WindowStyle Hidden | Out-Null
  if (Test-Path $tmpOut) { return [System.IO.File]::ReadAllText($tmpOut, [System.Text.Encoding]::UTF8) }
  return ''
}
function Chrome-Dom($url, $janela, $tempo) { Rodar-Chrome @("--window-size=$janela", "--virtual-time-budget=$tempo", '--dump-dom', $url) }

# Tempo REAL (para testes que usam a internet): o "tempo virtual" corre mais rápido que a rede
# (falha REG-007). Abre o Chrome com depuração remota e lê o texto de um elemento até aparecer a marca de fim.
function Chrome-TempoReal($url, $idElemento, $marcaFim, $limiteSeg) {
  $porta = Get-Random -Minimum 9300 -Maximum 9900
  $perfilCdp = Join-Path $env:TEMP ('onca-cdp-' + $porta)
  $proc = Start-Process -FilePath $chrome -ArgumentList @('--headless=new', "--user-data-dir=$perfilCdp", "--remote-debugging-port=$porta", '--remote-allow-origins=*', 'about:blank') -PassThru -WindowStyle Hidden
  $texto = ''
  try {
    $alvo = $null
    for ($i = 0; $i -lt 60 -and -not $alvo; $i++) {
      Start-Sleep -Milliseconds 250
      try { $alvo = Invoke-RestMethod -Method Put -Uri ("http://127.0.0.1:$porta/json/new?" + $url) -TimeoutSec 2 } catch { }
    }
    if (-not $alvo) { return 'ERRO: não consegui controlar o Chrome' }
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.ConnectAsync([Uri]$alvo.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
    $fim = (Get-Date).AddSeconds($limiteSeg); $n = 0
    while ((Get-Date) -lt $fim) {
      Start-Sleep -Milliseconds 800
      $n++
      $expr = "(document.getElementById('$idElemento')||{}).textContent||''"
      $pedido = @{ id = $n; method = 'Runtime.evaluate'; params = @{ expression = $expr; returnByValue = $true } } | ConvertTo-Json -Compress -Depth 5
      $b = [System.Text.Encoding]::UTF8.GetBytes($pedido)
      $ws.SendAsync((New-Object 'System.ArraySegment[byte]' (,$b)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
      $resp = New-Object System.IO.MemoryStream
      do {
        $buf = New-Object byte[] 65536
        $r = $ws.ReceiveAsync((New-Object 'System.ArraySegment[byte]' (,$buf)), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        $resp.Write($buf, 0, $r.Count)
      } while (-not $r.EndOfMessage)
      $json = [System.Text.Encoding]::UTF8.GetString($resp.ToArray()) | ConvertFrom-Json
      if ($json.id -eq $n -and $json.result -and $json.result.result) { $texto = [string]$json.result.result.value; if ($texto -match $marcaFim) { break } }
    }
  } catch { $texto += "`nERRO: $($_.Exception.Message)" }
  finally { if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 300; Remove-Item $perfilCdp -Recurse -Force -ErrorAction SilentlyContinue }
  return $texto
}
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

# 1b) varredura do código (REG-008): caracteres invisíveis U+2028/U+2029 quebram o JavaScript
$invisiveis = @()
Get-ChildItem (Join-Path $raiz 'codigo') -Recurse -File -Include *.js, *.html, *.css | ForEach-Object {
  $t = [System.IO.File]::ReadAllText($_.FullName, (New-Object System.Text.UTF8Encoding($false)))
  if ($t.Contains([string][char]0x2028) -or $t.Contains([string][char]0x2029)) { $invisiveis += $_.FullName.Substring($raiz.Length + 1) }
}
Registrar 'Varredura do código: sem caracteres invisíveis que quebram o JavaScript' ($invisiveis.Count -eq 0) ($(if ($invisiveis.Count) { 'Arquivos com U+2028/U+2029: ' + ($invisiveis -join ', ') } else { 'ok' }))

# 1b2) REG-016: com esta rodada na vez, uma 2ª rodada ao mesmo tempo precisa esperar (aqui: desistir na hora
# com "OCUPADO", código 3) em vez de atropelar esta — e os arquivos desta rodada são só dela.
$t0Fila = Get-Date
$segunda = & powershell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -SemPrints -EsperaMin 0 2>&1
$codSegunda = $LASTEXITCODE
$okFila = $codSegunda -eq 3 -and (($segunda -join ' ') -match 'OCUPADO') -and ((Get-Date) - $t0Fila).TotalSeconds -lt 30 -and $perfil -match "$PID" -and $tmpOut -match "$PID"
Registrar 'REG-016 duas rodadas de testes ao mesmo tempo não se atropelam (fila)' $okFila ("2ª rodada: código $codSegunda, " + (($segunda | Select-Object -First 1) -join ' '))

# 1c) REG-009: o download do som ambiente chegou a salvar uma PÁGINA HTML de erro (429) como ambiente.mp3.
# Todo .mp3 em assets/sons precisa ser áudio MP3 de verdade (cabeçalho ID3 ou quadro MPEG), não texto/HTML.
$sonsRuins = @(); $sonsOk = @()
Get-ChildItem (Join-Path $raiz 'assets\sons') -File -Filter *.mp3 -ErrorAction SilentlyContinue | ForEach-Object {
  $b = [System.IO.File]::ReadAllBytes($_.FullName)
  $inicioTxt = [System.Text.Encoding]::ASCII.GetString($b, 0, [Math]::Min(512, $b.Length)).ToLower()
  $id3 = $b.Length -gt 3 -and $b[0] -eq 0x49 -and $b[1] -eq 0x44 -and $b[2] -eq 0x33
  $quadro = $b.Length -gt 2 -and $b[0] -eq 0xFF -and (($b[1] -band 0xE0) -eq 0xE0)
  if ((-not ($id3 -or $quadro)) -or $b.Length -lt 20000 -or $inicioTxt.Contains('<html') -or $inicioTxt.Contains('<!doctype')) { $sonsRuins += "$($_.Name) ($($b.Length) bytes)" }
  else { $sonsOk += "$($_.Name) ($([Math]::Round($b.Length / 1024)) KB)" }
}
$detSom = if ($sonsRuins.Count) { 'Não são MP3 de verdade: ' + ($sonsRuins -join ', ') } elseif ($sonsOk.Count) { 'ok: ' + ($sonsOk -join ', ') } else { 'nenhum .mp3 ainda (o jogo segue sem som ambiente)' }
Registrar 'REG-009 sons em assets/sons são MP3 de verdade (não página de erro)' ($sonsRuins.Count -eq 0) $detSom

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

# 2b) online: protocolo da sala com servidor simulado (sem internet)
# REG-012: com a assinatura (HMAC) e o PBKDF2 o protocolo precisa de mais "tempo virtual" (mesmo orçamento da REG-005)
$dom = Chrome-Dom (Url 'testes\online\testes-online.html') '1000,800' 4000000
$txt = Decodificar ([regex]::Match($dom, '(?s)<pre id="out"[^>]*>(.*?)</pre>').Groups[1].Value)
$res = [regex]::Match($txt, 'RESUMO: (\d+) passaram, (\d+) falharam')
$okOn = $res.Success -and ([int]$res.Groups[2].Value -eq 0) -and ($txt -match '\[FIM\]')
$det = if ($res.Success) { "$($res.Groups[1].Value) passaram, $($res.Groups[2].Value) falharam" } else { 'sem resultado (a página não rodou)' }
$falhasOn = ($txt -split "`n" | Where-Object { $_ -match '^FAIL' }) -join "`n"
if ($falhasOn) { $det += "`n$falhasOn" }
Registrar 'Online: protocolo da sala (testes-online.html, servidor simulado)' $okOn $det

# 2c) opcional: online com os servidores públicos de verdade (usa a internet, tempo real)
if ($ServidorReal -or $Completo) {
  $t = Chrome-TempoReal ((Url 'testes\online\teste-servidor-real.html')) 'out' '\[FIM' 90
  $res = [regex]::Match($t, 'RESUMO: (\d+) passaram, (\d+) falharam')
  Registrar 'Online: servidores públicos reais (principal e reserva)' ($res.Success -and [int]$res.Groups[2].Value -eq 0 -and $t -match '\[FIM') $t
}

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

# 3b) robô testador (pedido do usuário): joga partidas inteiras sozinho pela interface — 2 jogadores,
# contra o computador e online simulado (cai, volta, fecha o app, sai da sala) — e confere tudo a cada passo.
# A semente muda a cada rodada (partidas diferentes); tudo vai para o catálogo testes\robo\CATALOGO.md.
# Achou erro: a etapa falha, e o erro vira teste fixo REG-NNN (repetir: index.html?robo=1&semente=N).
$semente = Get-Random -Minimum 1 -Maximum 999999
$domRobo = Chrome-Dom ((Url 'index.html') + "?robo=1&partidas=$RoboPartidas&semente=$semente") '1400,900' 8000000
$tRobo = Decodificar ([regex]::Match($domRobo, '(?s)<pre id="selftest-report"[^>]*>(.*?)</pre>').Groups[1].Value)
$okRobo = $tRobo -match '^ROBO PASSOU'
$detRobo = 'sem relatório (o robô não terminou)'; $linhaCat = ''
try {
  $jr = ConvertFrom-Json ($tRobo.Substring($tRobo.IndexOf('{')))
  $detRobo = "semente $semente · $($jr.partidas) partidas · $($jr.lances) lances · $($jr.passos) conferências · fins: Onça $($jr.fins.J), Cachorros $($jr.fins.D), sem fim $($jr.fins.semFim)"
  if ($jr.erros) { $detRobo += "`n" + (($jr.erros | ForEach-Object { "- partida $($_.partida), $($_.onde): $($_.oque) $($_.extra | ConvertTo-Json -Compress -Depth 4)" }) -join "`n") }
  $tiposErro = if ($jr.erros) { (($jr.erros | ForEach-Object { $_.oque } | Sort-Object -Unique) -join '; ') } else { '—' }
  $linhaCat = "| $(Get-Date -Format 'dd/MM/yyyy HH:mm') | $semente | $($jr.partidas) | $($jr.lances) | $(if ($okRobo) { 'passou' } else { '**achou erros**' }) | $tiposErro |"
} catch { $linhaCat = "| $(Get-Date -Format 'dd/MM/yyyy HH:mm') | $semente | ? | ? | **não terminou** | relatório ilegível |" }
Registrar 'Robô testador: partidas inteiras em todos os modos (com quedas e reconexões)' $okRobo $detRobo
$catalogo = Join-Path $raiz 'testes\robo\CATALOGO.md'
if (Test-Path $catalogo) { [System.IO.File]::AppendAllText($catalogo, $linhaCat + "`n", (New-Object System.Text.UTF8Encoding($false))) }

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
# toda rodada que falha guarda uma cópia (falhas que aparecem "de vez em quando" não se perdem)
if (($resultados | Where-Object { -not $_.Ok }).Count -gt 0) {
  $pastaFalhas = Join-Path $rel 'falhas'
  New-Item -ItemType Directory -Force $pastaFalhas | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $pastaFalhas ('relatorio-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.md')), $md.ToString(), (New-Object System.Text.UTF8Encoding($false)))
}

Write-Output ''
Limpar-Rodada
if ($falhou -eq 0) { Write-Output "TUDO PASSOU ($($resultados.Count) etapas, ${dur}s). Relatório: testes\relatorios\ultimo-relatorio.md"; exit 0 }
Write-Output "FALHOU: $falhou etapa(s). Veja testes\relatorios\ultimo-relatorio.md"
exit 1
