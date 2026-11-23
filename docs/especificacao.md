# Jogo da Onça — especificação combinada

## Visual
- Cena 3D (Three.js 0.160) em **visão isométrica clássica** (tabuleiro em losango, uma
  quina apontando para quem joga — imagem de referência do usuário), em todas as telas.
  Dá para girar (arrastar) e aproximar (pinça / roda do mouse); botão "Câmera" recentraliza.
- Tabuleiro grande e em evidência: tábua de madeira com **linhas pirografadas**; sem
  grafismos na tábua. Bandeja ao lado para os cachorros capturados.
- Peças: **bonequinhos de madeira caricatos**, sem pintura — 14 **vira-latas caramelo**
  (madeira clara) e 1 **suçuarana** (onça-parda, madeira escura).
- Animação: as peças **só deslizam**.
- Fundo: floresta amazônica escura e desfocada (silhuetas), discreta.
- Interface com tema indígena amazônico genérico: urucum, jenipapo, palha, verde-mata,
  faixas de grafismos geométricos (losangos, zigue-zague, grega, espinha-de-peixe).

## Telas (mobile first)
1. **Início**: "Contra o computador", "2 jogadores", "Regras".
2. **Escolha**: contra o computador → "Você joga com" (Onça/Cachorros) + nível
   (Básico, Intermediário, Avançado, Expert). 2 jogadores → "Quem é a Onça?"
   (Jogador 1 / Jogador 2, sem sorteio — decidem na vida real).
3. **Partida**: tabuleiro em tela cheia, faixa de cima (vez + cachorros capturados) e
   barra de baixo (Desfazer, Câmera, Som, Menu). "Parar de capturar" aparece durante
   uma sequência de capturas. Fim de partida: Revanche, Trocar lados (2 jogadores), Início.


## Online (cada um no seu celular, só 2 pessoas)
- Início → "Jogar online" → campo **Seu apelido** (opcional, até 12 letras, fica salvo no aparelho) e:
  **Criar sala**, **Salas abertas** (lista) ou **Entrar com código** (6 caracteres, como `ABC-234`, ou link de convite).
- Criar sala: **Nome da sala** (opcional, até 24 letras), **Pública** (aparece na lista de salas abertas)
  ou **Privada** (só com código/convite), e o lado (Onça ou Cachorros).
- Salas abertas: mostra só salas públicas esperando o 2º jogador (nome, apelido e lado de quem criou);
  tocar numa sala abre a confirmação. A sala sai da lista quando o 2º jogador entra.
- Quem entra vê o lado de cada um (com o apelido) e toca em **"Aceitar e começar"**.
- Apelidos aparecem no texto da vez ("Vez de Ana") e no chat; sem apelido, "Onça"/"Cachorros".
- Uma terceira pessoa vê "Essa sala já tem 2 jogadores".
- **Sem desfazer** no online. Revanche e "Trocar lados" precisam do aceite do outro.
- **Saiu, caiu ou saiu da tela no meio da partida:** a sala continua guardada. Quem ficou vê
  "Esperando … 0:59". Depois de 1 minuto aparece "… ainda está jogando?" com **Esperar mais 1 min** /
  **Encerrar partida**; no máximo +1 minuto. Sem volta: **partida encerrada sem vencedor** e a sala é apagada.
- **Voltar para a sala:** a tela inicial mostra o cartão "Você estava numa partida online" com
  **Voltar para a sala** (mesma partida, mesmo ponto) e **Não quero voltar**.
- **Parado na própria vez:** depois de 1 minuto aparece "Você ainda está jogando?"; sem tocar em "Sim"
  em 1 minuto, a pessoa sai da sala (pode voltar pelo cartão enquanto o outro espera).
- Partida terminada + sair: sai de vez e tudo é apagado do servidor.
- Conexão sem conta: servidor MQTT público gratuito (HiveMQ) com reserva (EMQX);
  só os lances trafegam.
- Chat só no online: caixinha com as 2 últimas mensagens (canto inferior esquerdo), toque abre o chat completo; criptografia de ponta a ponta (ECDH + AES-GCM); apagado ao sair da sala.
- Segurança (REG-010): o servidor nunca vê o código da sala (o canal é um resumo PBKDF2) e toda mensagem é assinada (HMAC) com chave tirada do código. Dados guardados no servidor expiram em 6 h e são apagados quando a partida acaba. Numa sala **pública**, o código, o nome da sala e o apelido de quem criou ficam visíveis na lista (escolha de quem cria).

## Regras
- Tabuleiro de 31 pontos: grade 5×5 (alquerque) + toca triangular.
- A onça começa no centro e joga primeiro; 14 cachorros nas 3 fileiras opostas à toca.
- Move-se uma casa por vez, seguindo as linhas.
- A onça captura pulando sobre um cachorro vizinho para a casa vazia logo atrás;
  capturar não é obrigatório; pode emendar capturas.
- Cachorros não capturam. A onça vence com 5 capturas; os cachorros vencem
  quando a onça fica sem movimentos.

## Sons
Toc de madeira ao mover, latido na captura, rugido quando a onça vence (dois latidos
quando os cachorros vencem).
Som ambiente da floresta em todas as telas: “Chaguaramal aves”, de Wilfredor (Wikimedia Commons, CC BY-SA 3.0, crédito na tela inicial e no painel Som).
Botão **Som** (barra da partida e tela inicial) abre o painel: efeitos liga/desliga e volume da floresta com − / + (0 a 100%, começa em 50%); tudo fica salvo no aparelho.

## Publicação
GitHub Pages: https://lorenzoortizsoares.github.io/jogo-da-onca/ (repositório público
`jogo-da-onca`, conta lorenzoortizsoares).

## Qualidade
Testes automáticos de back end (regras/IA) e front end (tela/3D, celular e computador),
rodando sozinhos a cada mudança; toda falha vira teste (`testes/REGRESSOES.md`).
