# Catálogo do robô testador

O robô testador (`index.html?robo=1`) joga partidas inteiras sozinho pela interface de verdade,
como uma pessoa: 2 jogadores no mesmo aparelho, contra o computador (níveis 1 a 4) e online
(servidor simulado, contra um robô adversário). No meio das partidas ele também:

- troca a câmera, dá zoom de pinça, desfaz lances, abre e fecha Menu, Regras e o painel de Som,
  toca em lugares aleatórios (inclusive inválidos) e para no meio de capturas em cadeia;
- no online: derruba a própria internet e volta, fecha o app e volta pelo botão
  "Voltar para a sala online", e no fim sai da sala (o outro precisa ser avisado e nada pode
  ficar guardado no servidor).

A cada passo ele confere: o tabuleiro 3D bate com as regras (cada cachorro e a onça no lugar
certo, bandeja = placar), a partida termina quando deve, o texto da vez está inteiro, nada sai
da tela e não há erro de JavaScript.

Ele roda sozinho em toda mudança (etapa "Robô testador" de `testes/rodar-testes.ps1`), com uma
semente nova a cada vez, ou seja, partidas diferentes. Para repetir exatamente uma rodada:
`index.html?robo=1&partidas=9&semente=N`.

**Regra:** todo erro que o robô achar vira um teste fixo `REG-NNN` em
[`testes/REGRESSOES.md`](../REGRESSOES.md). As falhas antigas (REG-001 a REG-013) continuam
sendo testadas em toda rodada pelos testes fixos, e o robô joga por cima delas.

## Erros que o robô já achou

| Data | Semente | O que achou | Virou teste |
|---|---|---|---|
| 21/11/2026 | 7 | Tocar na base de um cachorro selecionava OUTRO cachorro (o boneco da frente cobria o de trás) | REG-013 |

## Falsos alarmes (defeitos do próprio robô, já corrigidos nele)

- Tocava numa peça que já estava selecionada (isso desmarca) e em pontos fora da tela com zoom.
- O adversário simulado começava a "prestar atenção" depois do 1º lance e perdia a vez.
- Conferia o tabuleiro no meio da animação de um lance (a peça ainda deslizando).

## Rodadas

| Data | Semente | Partidas | Lances | Resultado | Erros |
|---|---|---|---|---|---|
| 21/11/2026 | 7 | 9 | — | passou | — |
| 21/11/2026 | 99 | 9 | — | passou | — |
| 21/11/2026 | 2024 | 9 | — | passou | — |
| 22/11/2026 08:53 | 361680 | 9 | 723 | passou | — |
