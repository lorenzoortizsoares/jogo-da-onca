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
| REG-006 | Online: logo ao entrar na sala aparecia "Adversário desconectado" por até 8 s (a primeira batida de presença saía antes de os dois estarem na partida e era ignorada). | `codigo/app.js` → autoteste "REG-006 …" (criador e convidado) e `testes/online/testes-online.html` → "REG-006: os dois se veem conectados logo ao entrar" |
| REG-008 | Um caractere invisível (separador de linha U+2028) dentro de uma expressão regular no código do chat derrubava o módulo online inteiro (erro de sintaxe). | `testes/rodar-testes.ps1` → etapa "Varredura do código" (falha se algum arquivo de `codigo/` tiver U+2028/U+2029) e `testes/online/testes-online.html` → aviso "REG-008: codigo/online.js não carregou" |
| REG-007 | Teste com o servidor real falhava com "connack timeout": no "tempo virtual" do Chrome o relógio corre mais rápido que a internet. | `testes/rodar-testes.ps1` → função `Chrome-TempoReal` (controle por depuração remota, tempo real); etapa "Online: servidores públicos reais" (`-ServidorReal` ou `-Completo`) |
