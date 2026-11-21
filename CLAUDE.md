# Jogo da Onça — regras do projeto

Jogo de tabuleiro 3D (Three.js) em HTML, mobile first, interface em pt-BR.
Especificação combinada com o usuário: `docs/especificacao.md`.

## Como o projeto funciona
- `index.html` é GERADO: nunca edite à mão. Edite `codigo/` e rode
  `powershell -ExecutionPolicy Bypass -File ferramentas\montar.ps1`.
- `codigo/logica.js` regras + computador (IA) — o "back end" do jogo (não há servidor).
- `codigo/modelos3d.js` tabuleiro e bonequinhos de madeira (procedurais).
- `codigo/audio.js` sons sintetizados. `codigo/app.js` cena, telas, fluxo, autoteste.
- `codigo/interface/` molde da página (`pagina.html`), estilos, ícones e floresta.
- `assets/` arquivos do usuário. Para usar um asset no jogo: `{{dataurl:assets/...}}`
  no molde (o montar.ps1 embute o arquivo, assim funciona até abrindo direto do PC).

## Testes (obrigatório)
- Tudo: `powershell -ExecutionPolicy Bypass -File testes\rodar-testes.ps1` (ou 2 cliques em `testes\rodar-testes.cmd`).
- Um gancho "Stop" do Claude Code (`ferramentas/gancho-testes.ps1`) roda os testes sozinho
  quando arquivos do jogo mudam. Não termine uma tarefa com testes falhando.
- **Toda falha encontrada vira um teste de regressão** (prefixo `REG-NNN`) e entra em
  `testes/REGRESSOES.md`. Os testes só aumentam; nunca apague um teste de regressão.
- Prints de celular: use `testes/interface/moldura-celular.html` (o Chrome sem janela não
  fica mais estreito que ~500px; sem a moldura o print sai cortado).
