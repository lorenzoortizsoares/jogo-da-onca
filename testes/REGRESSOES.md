# Falhas que viraram teste (regressões)

Regra do projeto: **cada falha encontrada ganha um teste**, para nunca mais voltar.
Os testes rodam sozinhos a cada mudança (gancho do Claude Code) e com 2 cliques em
`testes/rodar-testes.cmd`.

| Código | Falha encontrada | Onde está o teste |
|---|---|---|
| REG-001 | Com os quadros de animação pausados (aba em segundo plano no celular), a peça não terminava de deslizar e o jogo travava. | `codigo/app.js` → autoteste "REG-001 deslize termina com os quadros pausados" |
| REG-002 | Layout mobile first: telas e barras não podem sair da largura da tela (os prints de celular saíam cortados). | `codigo/app.js` → autoteste "REG-002 layout: …" (roda a 390×844 dentro de `testes/interface/moldura-celular.html` e a 1400×900) |
| REG-003 | O texto da vez aparecia cortado no celular ("Vez do Jogador 1 (On…"). | `codigo/app.js` → autoteste "REG-003 texto da vez inteiro …" (2 jogadores, cadeia de capturas, computador pensando) |
| REG-004 | O executor de testes chamava o Chrome direto pelo PowerShell e não recebia nenhuma saída (o Chrome é um programa "de janela"), então tudo parecia falhar. | `testes/rodar-testes.ps1` → função `Rodar-Chrome` (via Start-Process); se voltar, todas as etapas acusam "sem resultado" |
| REG-005 | Os testes do Worker (computador pensando em segundo plano) não terminavam no "tempo virtual" do Chrome sem janela. | `testes/rodar-testes.ps1` → orçamento de 4.000.000 ms; a etapa de back end falha se os testes assíncronos não terminarem ("done in" ausente) |
