# =====================================================================
# Monta o index.html (arquivo único do jogo) a partir de codigo/.
# Uso: powershell -ExecutionPolicy Bypass -File ferramentas\montar.ps1
#
# No molde codigo/interface/pagina.html:
#   {{caminho}}          -> conteúdo do arquivo (caminho relativo a codigo/)
#   {{dataurl:caminho}}  -> arquivo embutido como data: URL (ex.: assets/imagens/x.png,
#                           caminho relativo à raiz do projeto). Assim os assets
#                           funcionam até abrindo o index.html direto do computador.
# =====================================================================
$ErrorActionPreference = 'Stop'
$raiz   = Split-Path -Parent $PSScriptRoot
$codigo = Join-Path $raiz 'codigo'
$molde  = Join-Path $codigo 'interface\pagina.html'
$saida  = Join-Path $raiz 'index.html'
$utf8   = New-Object System.Text.UTF8Encoding($false)

$tipos = @{ '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml';
            '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.wav'='audio/wav'; '.glb'='model/gltf-binary';
            '.woff2'='font/woff2'; '.woff'='font/woff'; '.ttf'='font/ttf' }

$texto = [System.IO.File]::ReadAllText($molde, $utf8)
$faltando = New-Object System.Collections.Generic.List[string]

$avaliador = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  $tok = $m.Groups[1].Value.Trim()
  if ($tok.StartsWith('dataurl:')) {
    $rel = $tok.Substring(8)
    $arq = Join-Path $raiz $rel
    if (-not (Test-Path $arq)) { $faltando.Add($rel); return '' }
    $ext = [System.IO.Path]::GetExtension($arq).ToLower()
    $tipo = $tipos[$ext]; if (-not $tipo) { $tipo = 'application/octet-stream' }
    return 'data:' + $tipo + ';base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($arq))
  }
  $arq = Join-Path $codigo $tok
  if (-not (Test-Path $arq)) { $faltando.Add($tok); return '' }
  return [System.IO.File]::ReadAllText($arq, $utf8)
}

$resultado = [System.Text.RegularExpressions.Regex]::Replace($texto, '\{\{([A-Za-z0-9_./:\-]+)\}\}', $avaliador)
if ($faltando.Count -gt 0) { Write-Error ('Arquivos não encontrados: ' + ($faltando -join ', ')); exit 1 }

[System.IO.File]::WriteAllText($saida, $resultado, $utf8)
$kb = [math]::Round((Get-Item $saida).Length / 1KB)
Write-Output "index.html montado ($kb KB)"
