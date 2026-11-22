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
- Início → "Jogar online" → **Criar sala** (quem cria escolhe Onça ou Cachorros) ou
  **Entrar numa sala** (código de 6 caracteres, como `ABC-234`, ou link de convite).
- Quem entra vê o lado de cada um e toca em **"Aceitar e começar"**.
- Convite pelo botão "Enviar convite" (compartilhar do celular / copiar link).
- Uma terceira pessoa vê "Essa sala já tem 2 jogadores".
- **Sem desfazer** no online. Revanche e "Trocar lados" precisam do aceite do outro.
- Avisos: adversário desconectado (na faixa da vez) e "Seu adversário saiu".
- Recarregar a página volta para a mesma sala e partida.
- Conexão sem conta: servidor MQTT público gratuito (HiveMQ) com reserva (EMQX);
  só os lances trafegam.
- Chat só no online: caixinha com as 2 últimas mensagens (canto inferior esquerdo), toque abre o chat completo; criptografia de ponta a ponta (ECDH + AES-GCM); apagado ao sair da sala.
- Segurança (REG-010): o servidor nunca vê o código da sala (o canal é um resumo PBKDF2) e toda mensagem é assinada (HMAC) com chave tirada do código. Dados guardados no servidor expiram em 6 h e são apagados ao sair.

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
