# Catálogo do robô testador

O robô testador (`index.html?robo=1`) joga partidas inteiras sozinho pela interface de verdade,
como uma pessoa: 2 jogadores no mesmo aparelho, contra o computador (níveis 1 a 4) e online
(servidor simulado, contra um robô adversário). No meio das partidas ele também:

- troca a câmera, dá zoom de pinça, desfaz lances, abre e fecha Menu, Regras e o painel de Som,
  toca em lugares aleatórios (inclusive inválidos) e para no meio de capturas em cadeia;
- no online: cria a sala pela interface (pública ou privada, com ou sem apelido) ou entra pela
  **lista de salas abertas**; derruba a própria internet e volta; fecha o app e volta pelo cartão
  "Voltar para a sala"; faz o adversário sair da tela e voltar (tem que aparecer "Esperando…" e
  sumir na volta); e no fim sai da sala: com a partida terminada sai de vez, sem terminar a saída
  é temporária (dá para voltar). No fim nada pode ficar guardado no servidor nem na lista de salas.

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
| 23/11/2026 11:13 | 143542 | ? | ? | **não terminou** | relatório ilegível |
| 23/11/2026 11:19 | 684940 | ? | ? | **não terminou** | relatório ilegível |
| 23/11/2026 11:19 | 444399 | 9 | 490 | passou | — |
| 23/11/2026 11:21 | 49796 | 9 | 420 | passou | — |
| 23/11/2026 11:23 | 301327 | 3 | 89 | passou | — |
| 23/11/2026 11:24 | 848178 | 3 | 115 | passou | — |
| 23/11/2026 11:25 | 987309 | 3 | 161 | passou | — |
| 23/11/2026 11:26 | 577490 | 3 | 191 | passou | — |
| 23/11/2026 11:28 | 115964 | 3 | 445 | passou | — |
| 23/11/2026 11:29 | 832133 | 3 | 94 | passou | — |
| 23/11/2026 11:30 | 416432 | 3 | 365 | passou | — |
| 23/11/2026 11:31 | 974438 | 3 | 114 | passou | — |
| 23/11/2026 11:32 | 352769 | 2 | 334 | passou | — |
| 23/11/2026 11:33 | 527227 | 2 | 31 | passou | — |
| 23/11/2026 11:34 | 422344 | 2 | 344 | passou | — |
| 23/11/2026 11:34 | 532517 | 2 | 28 | passou | — |
| 23/11/2026 11:35 | 89597 | 2 | 86 | passou | — |
| 23/11/2026 11:38 | 704300 | 9 | 721 | passou | — |
