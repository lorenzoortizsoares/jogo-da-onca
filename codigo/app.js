// =====================================================================
// Jogo da Onça — aplicação (cena 3D, telas, fluxo da partida, autoteste)
// Usa os módulos globais: OncaLogic (logica.js), createOncaModels
// (modelos3d.js) e createOncaAudio (audio.js).
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const L = window.OncaLogic;
const qs = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const SELFTEST = qs.get('selftest') === '1';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const NOME = { J: 'Onça', D: 'Cachorros' };

// ---------------------------------------------------------------- preferências
const guardar = {
  ler(k, padrao) { try { const v = localStorage.getItem('onca.' + k); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } },
  gravar(k, v) { try { localStorage.setItem('onca.' + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
};
const cfg = {
  mode: 'ai',
  humanSide: guardar.ler('lado', 'D') === 'J' ? 'J' : 'D',
  level: [1, 2, 3, 4].includes(guardar.ler('nivel', 2)) ? guardar.ler('nivel', 2) : 2,
  oncaPlayer: 1,
};

// ---------------------------------------------------------------- áudio
let audio = null;
try { audio = window.createOncaAudio ? window.createOncaAudio() : null; } catch (e) { audio = null; }
const som = (nome, ...a) => { try { if (audio && audio[nome]) audio[nome](...a); } catch (e) { /* som nunca derruba o jogo */ } };

// ---------------------------------------------------------------- cena 3D
const api = window.createOncaModels(THREE);
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: SELFTEST || qs.has('shot') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.environment = api.makeEnvironment(renderer);
scene.add(api.makeLights().group);
const board = api.makeBoard();
scene.add(board.group);

// chão invisível que só recebe a sombra do tabuleiro
const chao = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.32 }));
chao.rotation.x = -Math.PI / 2;
chao.position.y = board.bounds.min.y - 0.002;
chao.receiveShadow = true;
scene.add(chao);

const pos = (i) => api.pointToWorld(i).clone();
const marcarPeca = (g) => { g.userData.isPiece = true; g.userData.point = -1; return g; };
const puma = marcarPeca(api.makePuma());
scene.add(puma);
const caes = [];
for (let k = 0; k < 14; k++) { const d = marcarPeca(api.makeDog()); scene.add(d); caes.push(d); }
const pecas = [puma, ...caes];
let caoEm = new Array(L.N).fill(null);   // ponto -> objeto do cachorro
const ROT_BANDEJA = -Math.PI / 2;        // cachorros capturados olham para o tabuleiro

// ---------------------------------------------------------------- câmera
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const controls = new OrbitControls(cam, canvas);
// pedido do usuário: só 3 visões fixas (botão Câmera), sem girar arrastando e sem zoom
controls.enabled = false;
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;

const centro = new THREE.Box3().setFromPoints(board.fitPoints).getCenter(new THREE.Vector3());
let sujo = true;
const pedirRender = () => { sujo = true; };
controls.addEventListener('change', pedirRender);

function tamanhoPalco() {
  const r = stage.getBoundingClientRect();
  return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
}
// espaço ocupado pela barra de cima e pela de baixo (o tabuleiro fica no meio livre)
function margens() {
  const hud = document.querySelector('.hud'), barra = document.querySelector('.barra');
  const h = tamanhoPalco().h;
  const topo = hud ? hud.getBoundingClientRect().height : 0;
  const baixo = barra ? Math.max(0, h - barra.getBoundingClientRect().top + stage.getBoundingClientRect().top) : 0;
  return { topo, baixo };
}
// As 3 visões (pedido do usuário): "normal" = isométrico clássico da imagem de referência
// (losango, quina apontando para quem joga); "oposta" = a mesma, do outro lado; "cima" = de cima.
const VISTAS = ['normal', 'oposta', 'cima'];
const NOME_VISTA = { normal: 'Visão normal', oposta: 'Visão do lado oposto', cima: 'Visão de cima' };
let vistaAtual = 'normal';
function caesPertoDoJogador() {
  return (cfg.mode === 'ai' && cfg.humanSide === 'D') || (cfg.mode === 'online' && !!sala && sala.meuLado === 'D');
}
function anguloDaVista(nome) {
  const perto = caesPertoDoJogador(), base = perto ? 225 : 45;
  if (nome === 'oposta') return { az: base + 180, el: 35.264 };
  if (nome === 'cima') return { az: perto ? 180 : 0, el: 89.9 };   // o lado de quem joga fica embaixo na tela
  return { az: base, el: 35.264 };
}
function vistaPadrao() { return anguloDaVista(vistaAtual); }
function direcao(az, el) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}
function anguloAtual() {
  const v = cam.position.clone().sub(controls.target).normalize();
  return { az: THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)), el: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(v.y, -1, 1))) };
}
// enquadra o tabuleiro: ocupa ~92% do espaço livre entre as barras
function enquadrar(dir) {
  const { w, h } = tamanhoPalco();
  const { topo, baixo } = margens();
  const livre = Math.max(80, h - topo - baixo);
  controls.target.copy(centro);
  cam.position.copy(centro).addScaledVector(dir, 40);
  cam.up.set(0, 1, 0);
  cam.lookAt(centro);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of board.fitPoints) {
    const v = p.clone().applyMatrix4(inv);
    x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
  }
  const FILL = w < 600 ? 0.98 : 0.92;   // no celular o losango usa quase toda a largura
  const s = Math.max((x1 - x0) / (w * FILL), (y1 - y0) / (livre * FILL));   // unidades por pixel
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  cam.left = cx - (w * s) / 2; cam.right = cx + (w * s) / 2;
  cam.top = cy + (topo + livre / 2) * s; cam.bottom = cam.top - h * s;
  cam.near = 0.1; cam.far = 200;
  cam.updateProjectionMatrix();
  controls.update();
  pedirRender();
}
let animCam = null;
function recentrar(suave) {
  const v = vistaPadrao();
  if (!suave) { cam.zoom = 1; enquadrar(direcao(v.az, v.el)); return; }
  const a = anguloAtual();
  let daz = v.az - a.az; daz = ((daz + 540) % 360) - 180;   // caminho mais curto
  const anim = { t0: performance.now(), dur: 650, az0: a.az, el0: a.el, daz, del: v.el - a.el, z0: cam.zoom };
  animCam = anim;
  // mesma garantia da REG-001: sem quadros de animação, a câmera chega à visão mesmo assim
  setTimeout(() => { if (animCam === anim) { animCam = null; cam.zoom = 1; enquadrar(direcao(v.az, v.el)); } }, anim.dur + 150);
}
function passoAnimCam(t) {
  if (!animCam) return false;
  const k = Math.min(1, (t - animCam.t0) / animCam.dur), e = suavizar(k);
  const az = animCam.az0 + animCam.daz * e, el = animCam.el0 + animCam.del * e;
  cam.zoom = animCam.z0 + (1 - animCam.z0) * e;
  enquadrar(direcao(az, el));
  if (k >= 1) animCam = null;
  return true;
}
const suavizar = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);   // easeInOutCubic

function aoRedimensionar() {
  const { w, h } = tamanhoPalco();
  renderer.setSize(w, h, false);
  const a = anguloAtual();
  enquadrar(direcao(a.az, a.el));
}
new ResizeObserver(() => { if (!$('telaPartida').hidden) aoRedimensionar(); }).observe(stage);

// ---------------------------------------------------------------- animação (só deslizar)
const tweens = [];
function deslizar(obj, alvo, dur = 420, rotFinal = null) {
  return new Promise((resolve) => {
    const de = obj.position.clone();
    const d = alvo.clone().sub(de);
    const r0 = obj.rotation.y;
    let r1 = rotFinal != null ? rotFinal : (d.lengthSq() > 1e-6 ? Math.atan2(d.x, d.z) : r0);
    let dr = r1 - r0; dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    const tw = { obj, de, para: alvo.clone(), r0, r1: r0 + dr, t0: performance.now(), dur, resolve };
    tweens.push(tw);
    pedirRender();
    // garantia: se o navegador pausar os quadros (aba em segundo plano), o deslize termina mesmo assim
    setTimeout(() => {
      const i = tweens.indexOf(tw);
      if (i < 0) return;
      tweens.splice(i, 1);
      obj.position.copy(tw.para); obj.rotation.y = tw.r1;
      pedirRender(); resolve();
    }, dur + 120);
  });
}
function passoTweens(t) {
  if (!tweens.length) return false;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    const k = Math.min(1, (t - tw.t0) / tw.dur), e = suavizar(k);
    tw.obj.position.lerpVectors(tw.de, tw.para, e);
    const kr = Math.min(1, k * 1.6);   // vira para a direção no começo do deslize
    tw.obj.rotation.y = tw.r0 + (tw.r1 - tw.r0) * suavizar(kr);
    if (k >= 1) { tweens.splice(i, 1); tw.resolve(); }
  }
  return true;
}

// ---------------------------------------------------------------- marcadores
const marcadores = new THREE.Group();
scene.add(marcadores);
const poolMarc = {};
function marcador(tipo, ponto) {
  poolMarc[tipo] = poolMarc[tipo] || [];
  let m = poolMarc[tipo].find((x) => !x.visible);
  if (!m) { m = api.makeMarker(tipo); poolMarc[tipo].push(m); marcadores.add(m); }
  m.visible = true;
  m.position.copy(pos(ponto));
  return m;
}
function limparMarcadores() { marcadores.children.forEach((m) => { m.visible = false; }); }

// ---------------------------------------------------------------- estado da partida
let S = L.initialState();
let hist = [];          // fotos antes de cada turno: { S, nChaves }
let chaves = [];        // positionKey de cada posição (para a IA evitar repetição)
let sel = -1;           // ponto selecionado
let cadeia = false;     // a onça está no meio de uma sequência de capturas
let fim = null;         // 'J' | 'D' quando a partida termina
let ocupado = false;    // animando ou computador jogando
let pedido = 0;         // invalida respostas antigas do computador
let hover = -1;

let sala = null;        // sessão online (OncaOnline) quando cfg.mode === 'online'
let lanceTurno = null;  // lance do turno do jogador local, enviado ao adversário no fim do turno (online)
let partidaOnline = 0, seqOnline = 0;
const humano = (lado) => cfg.mode === 'pvp' || (cfg.mode === 'online' ? !!sala && sala.meuLado === lado : cfg.humanSide === lado);
const jogadorDe = (lado) => (lado === 'J' ? cfg.oncaPlayer : 3 - cfg.oncaPlayer);

function alvosAtuais() {
  if (fim || ocupado || !humano(S.turn) || sel < 0) return { moves: [], caps: [] };
  if (S.turn === 'J') {
    const caps = L.jaguarCaptures(S);
    return { moves: cadeia ? [] : L.jaguarSteps(S), caps };
  }
  return { moves: L.dogMoves(S).filter((m) => m.from === sel).map((m) => m.to), caps: [] };
}
function desenharMarcadores() {
  limparMarcadores();
  const a = alvosAtuais();
  if (sel >= 0 && !fim && !ocupado) marcador('select', sel);
  a.moves.forEach((p) => marcador('move', p));
  a.caps.forEach((c) => { marcador('capture', c.to); marcador('victim', c.over); });
  if (hover >= 0 && hover !== sel && !ocupado && !fim) marcador('hover', hover);
  pedirRender();
}

// coloca todas as peças exatamente onde o estado manda (novo jogo, desfazer)
function sincronizar() {
  tweens.splice(0, tweens.length);
  const prox = new Array(L.N).fill(null), sobra = [];
  for (const d of caes) {
    const p = d.userData.point;
    if (p >= 0 && S.board[p] === 1 && !prox[p]) prox[p] = d; else sobra.push(d);
  }
  for (let i = 0; i < L.N; i++) if (S.board[i] === 1 && !prox[i]) { const d = sobra.shift(); prox[i] = d; d.rotation.y = 0; }
  prox.forEach((d, i) => { if (d) { d.userData.point = i; d.position.copy(pos(i)); d.visible = true; } });
  sobra.forEach((d, k) => {
    d.userData.point = -1;
    d.visible = k < board.captureSlots.length;
    d.position.copy(board.captureSlots[Math.min(k, board.captureSlots.length - 1)]);
    d.rotation.y = ROT_BANDEJA;
  });
  caoEm = prox;
  puma.userData.point = S.jaguar;
  puma.position.copy(pos(S.jaguar));
  pedirRender();
}

function foto() { hist.push({ S, nChaves: chaves.length }); }
function podeDesfazer() {
  if (ocupado || cfg.mode === 'online') return false;   // online: sem desfazer (combinado com o usuário)
  if (cfg.mode === 'pvp') return hist.length > 0;
  return hist.some((h) => h.S.turn === cfg.humanSide);
}

// ---------------------------------------------------------------- HUD
function atualizarHud() {
  const vez = $('vez');
  vez.dataset.lado = S.turn;
  let txt, estado = 'turno';
  if (fim) { txt = fim === 'J' ? 'A Onça venceu!' : 'Os Cachorros venceram!'; estado = 'fim'; vez.dataset.lado = fim; }
  else if (cadeia) { txt = 'Continue capturando ou pare'; estado = 'cadeia'; }
  else if (cfg.mode === 'online') {
    if (sala && !sala.conectado) { txt = 'Reconectando'; estado = 'pensando'; }
    else if (humano(S.turn)) txt = `Sua vez (${NOME[S.turn]})`;
    else if (sala && !sala.adversarioOnline) { txt = 'Adversário desconectado'; estado = 'pensando'; }
    else { txt = `Vez do adversário (${NOME[S.turn]})`; estado = 'pensando'; }
  } else if (cfg.mode === 'ai') {
    if (humano(S.turn)) txt = `Sua vez (${NOME[S.turn]})`;
    else { txt = 'Computador pensando'; estado = 'pensando'; }
  } else txt = `Vez do Jogador ${jogadorDe(S.turn)} (${NOME[S.turn]})`;
  vez.dataset.estado = estado;
  vez.dataset.rede = cfg.mode === 'online' && sala && (!sala.conectado || !sala.adversarioOnline) ? 'off' : 'on';
  $('status').textContent = txt;
  $('btnParar').hidden = !cadeia || ocupado;
  $('btnDesfazer').disabled = !podeDesfazer();
  $('btnDesfazer').hidden = cfg.mode === 'online';
  $('miniChat').hidden = cfg.mode !== 'online';
  $('telaPartida').classList.toggle('online', cfg.mode === 'online');
  $('btnReiniciar').hidden = cfg.mode === 'online';
  $('btnSairSala').hidden = cfg.mode !== 'online';
  const n = S.captured;
  $('capNum').textContent = n;
  $('placar').setAttribute('aria-label', `${n} de 5 cachorros capturados`);
  [...$('slots').children].forEach((s, k) => s.classList.toggle('on', k < n));
}

// ---------------------------------------------------------------- jogadas
async function animarCaptura(over, to) {
  const d = caoEm[over];
  caoEm[over] = null;
  await deslizar(puma, pos(to), 460);
  puma.userData.point = to;
  som('toc', 1);
  if (d) {
    d.userData.point = -1;
    const slot = board.captureSlots[Math.min(S.captured - 1, board.captureSlots.length - 1)];
    som('bark');
    await deslizar(d, slot, 620, ROT_BANDEJA);
    som('toc', 0.5);
  }
}

async function passoOnca(to) {
  foto(); ocupado = true; sel = -1; desenharMarcadores(); atualizarHud();
  lanceTurno = { type: 'step', from: S.jaguar, to };
  S = L.applyJaguarStep(S, to);
  await deslizar(puma, pos(to));
  puma.userData.point = to; som('toc', 1);
  ocupado = false; fimDoTurno();
}
async function moverCao(from, to) {
  foto(); ocupado = true; sel = -1; desenharMarcadores(); atualizarHud();
  const d = caoEm[from];
  lanceTurno = { type: 'dog', from, to };
  S = L.applyDogMove(S, from, to);
  caoEm[to] = d; caoEm[from] = null; d.userData.point = to;
  await deslizar(d, pos(to));
  som('toc', 1);
  ocupado = false; fimDoTurno();
}
async function capturarHumano(c) {
  if (!cadeia) { foto(); lanceTurno = { type: 'capture', path: [S.jaguar], captured: [] }; }
  ocupado = true; sel = -1; desenharMarcadores(); atualizarHud();
  if (lanceTurno && lanceTurno.type === 'capture') { lanceTurno.path.push(c.to); lanceTurno.captured.push(c.over); }
  S = L.applyJaguarCapture(S, c.over, c.to);
  await animarCaptura(c.over, c.to);
  ocupado = false;
  if (S.captured < L.CAPTURES_TO_WIN && L.jaguarCaptures(S).length) {
    cadeia = true; sel = S.jaguar; desenharMarcadores(); atualizarHud();
    return;
  }
  S = L.endJaguarTurn(S);
  fimDoTurno();
}
function encerrarCadeia() {
  if (!cadeia || ocupado) return;
  S = L.endJaguarTurn(S);
  fimDoTurno();
}

function fimDoTurno() {
  cadeia = false; sel = -1;
  chaves.push(L.positionKey(S));
  // online: o lance que eu acabei de fazer vai para o adversário
  if (cfg.mode === 'online' && lanceTurno && sala) {
    const m = sala.jogar(lanceTurno, S);
    partidaOnline = m.partida; seqOnline = m.seq;
  }
  lanceTurno = null;
  const w = L.winner(S);
  desenharMarcadores();
  if (w) { terminar(w); return; }
  atualizarHud();
  if (cfg.mode === 'ai' && !humano(S.turn)) jogarComputador();
}

async function jogarComputador() {
  const meu = ++pedido;
  ocupado = true; atualizarHud(); desenharMarcadores();
  const t0 = performance.now();
  let r = null;
  try { r = await L.chooseMoveAsync(S, cfg.level, { history: chaves.slice() }); } catch (e) { r = null; }
  const falta = 450 - (performance.now() - t0);
  if (falta > 0) await dormir(falta);
  if (meu !== pedido) return;                       // resposta velha (desfez / nova partida)
  const m = r && r.move;
  if (!m) { ocupado = false; atualizarHud(); return; }
  foto();
  if (!(await executarLance(m, meu))) return;
  ocupado = false;
  fimDoTurno();
}

// aplica e anima um lance completo (computador ou adversário online). false = foi interrompido
async function executarLance(m, meu) {
  if (m.type === 'dog') {
    const d = caoEm[m.from];
    S = L.applyDogMove(S, m.from, m.to);
    caoEm[m.to] = d; caoEm[m.from] = null; d.userData.point = m.to;
    await deslizar(d, pos(m.to)); som('toc', 1);
  } else if (m.type === 'step') {
    S = L.applyJaguarStep(S, m.to);
    await deslizar(puma, pos(m.to)); puma.userData.point = m.to; som('toc', 1);
  } else {
    for (let k = 0; k < m.captured.length; k++) {
      S = L.applyJaguarCapture(S, m.captured[k], m.path[k + 1]);
      atualizarHud();
      await animarCaptura(m.captured[k], m.path[k + 1]);
      if (meu !== pedido) return false;
      if (k < m.captured.length - 1) await dormir(160);
    }
    S = L.endJaguarTurn(S);
  }
  return meu === pedido;
}

function terminar(w) {
  fim = w; ocupado = false; sel = -1;
  desenharMarcadores(); atualizarHud();
  $('vitoria').dataset.lado = w;
  $('vitIco').innerHTML = w === 'J' ? '<use href="#ico-onca"/>' : '<use href="#ico-cao"/>';
  $('vitIco').setAttribute('viewBox', w === 'J' ? '0 0 64 36' : '0 0 48 36');
  $('vitTitulo').textContent = w === 'J' ? 'A Onça venceu!' : 'Os Cachorros encurralaram a Onça!';
  $('vitSub').textContent = cfg.mode === 'ai'
    ? (humano(w) ? 'Você venceu!' : 'O computador venceu.')
    : cfg.mode === 'online' ? (humano(w) ? 'Você venceu!' : 'Seu adversário venceu.')
    : `Parabéns, Jogador ${jogadorDe(w)}!`;
  $('btnTrocar').hidden = cfg.mode === 'ai';
  if (w === 'J') som('roar'); else som('dogsWin');
  setTimeout(() => { if (fim) $('vitoria').hidden = false; }, 700);
}

function clicar(i) {
  if (i < 0 || fim || ocupado || !humano(S.turn)) return;
  if (S.turn === 'J') {
    const c = L.jaguarCaptures(S).find((x) => x.to === i);
    if ((sel === S.jaguar || cadeia) && c) { capturarHumano(c); return; }
    if (cadeia) { if (i === S.jaguar) encerrarCadeia(); return; }
    if (sel === S.jaguar && L.jaguarSteps(S).includes(i)) { passoOnca(i); return; }
    sel = (i === S.jaguar && sel !== i) ? i : -1;
    desenharMarcadores();
    return;
  }
  if (S.board[i] === 1) { sel = sel === i ? -1 : i; desenharMarcadores(); return; }
  if (sel >= 0 && L.dogMoves(S).some((m) => m.from === sel && m.to === i)) { moverCao(sel, i); return; }
  sel = -1; desenharMarcadores();
}

function desfazer() {
  if (!podeDesfazer()) return;
  pedido++;
  let idx = hist.length - 1;
  if (cfg.mode === 'ai') while (idx >= 0 && hist[idx].S.turn !== cfg.humanSide) idx--;
  if (idx < 0) return;
  const h = hist[idx];
  hist = hist.slice(0, idx);
  S = h.S; chaves.length = h.nChaves;
  cadeia = false; sel = -1; fim = null; ocupado = false;
  $('vitoria').hidden = true;
  sincronizar(); desenharMarcadores(); atualizarHud();
  som('toc', 0.5);
}

function novaPartida(estado) {
  pedido++;
  S = estado || L.initialState();
  hist = []; chaves = [L.positionKey(S)];
  sel = -1; cadeia = false; fim = null; ocupado = false; hover = -1; lanceTurno = null;
  $('vitoria').hidden = true;
  caes.forEach((d) => { d.userData.point = -1; });
  sincronizar(); desenharMarcadores(); atualizarHud();
  const w = L.winner(S);
  if (w) { terminar(w); return; }
  if (cfg.mode === 'ai' && !humano(S.turn)) jogarComputador();
}

// ---------------------------------------------------------------- toque / clique
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pontoSob(x, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  // ponto do tabuleiro mais próximo
  let noPlano = -1;
  const p = new THREE.Vector3();
  if (ray.ray.intersectPlane(plano, p)) {
    let melhor = 0.45 * 0.45;
    for (let i = 0; i < L.N; i++) { const w = pos(i); const d = (w.x - p.x) ** 2 + (w.z - p.z) ** 2; if (d < melhor) { melhor = d; noPlano = i; } }
  }
  // um alvo destacado tem prioridade (mesmo que uma peça na frente o cubra)
  const a = alvosAtuais();
  if (noPlano >= 0 && (a.moves.includes(noPlano) || a.caps.some((c) => c.to === noPlano))) return noPlano;
  const hits = ray.intersectObjects(pecas.filter((o) => o.visible && o.userData.point >= 0), true);
  for (const h of hits) { let o = h.object; while (o && !o.userData.isPiece) o = o.parent; if (o) return o.userData.point; }
  return noPlano;
}
let toque = null, dedos = 0;
canvas.addEventListener('pointerdown', (e) => {
  dedos++;
  toque = dedos > 1 ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
  som('unlock');
});
const soltar = (e) => {
  dedos = Math.max(0, dedos - 1);
  if (!toque) return;
  const moveu = Math.hypot(e.clientX - toque.x, e.clientY - toque.y), dt = performance.now() - toque.t;
  toque = null;
  if (moveu < 8 && dt < 900) clicar(pontoSob(e.clientX, e.clientY));
};
canvas.addEventListener('pointerup', soltar);
canvas.addEventListener('pointercancel', () => { dedos = Math.max(0, dedos - 1); toque = null; });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || toque) return;
  const i = pontoSob(e.clientX, e.clientY);
  const a = alvosAtuais();
  const acionavel = i >= 0 && humano(S.turn) && !fim && !ocupado &&
    (a.moves.includes(i) || a.caps.some((c) => c.to === i) || (S.turn === 'J' ? i === S.jaguar : S.board[i] === 1));
  canvas.style.cursor = acionavel ? 'pointer' : 'grab';
  const novo = acionavel ? i : -1;
  if (novo !== hover) { hover = novo; desenharMarcadores(); }
});

// ---------------------------------------------------------------- laço de desenho
let quadrosPausados = false;   // usado pelo teste REG-001 (simula aba em segundo plano)
function laco(t) {
  requestAnimationFrame(laco);
  if (quadrosPausados || $('telaPartida').hidden) return;
  const a = passoTweens(t), b = passoAnimCam(t), c = controls.update();
  if (sujo || a || b || c) { renderer.render(scene, cam); sujo = false; }
}
requestAnimationFrame(laco);

// ---------------------------------------------------------------- telas e botões
const slots = $('slots');
for (let k = 0; k < 5; k++) slots.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 48 36" aria-hidden="true"><use href="#ico-cao"/></svg>');

function mostrarTela(id) {
  for (const t of ['telaInicio', 'telaEscolha', 'telaOnline', 'telaPartida']) $(t).hidden = t !== id;
  if (id === 'telaPartida') { const { w, h } = tamanhoPalco(); renderer.setSize(w, h, false); }
  if (id === 'telaInicio') $('btnRetomar').hidden = !sessaoSalva();
}
function marcarRadios(seletor, ativo) {
  document.querySelectorAll(seletor).forEach((b) => b.setAttribute('aria-checked', String(ativo(b))));
}
function atualizarEscolha() {
  $('escolhaIA').hidden = cfg.mode !== 'ai';
  $('escolha2J').hidden = cfg.mode !== 'pvp';
  $('tituloEscolha').textContent = 'Contra o computador';
  marcarRadios('#escolhaIA .lado', (b) => b.dataset.lado === cfg.humanSide);
  marcarRadios('.nivel', (b) => Number(b.dataset.nivel) === cfg.level);
  marcarRadios('#escolha2J .lado', (b) => Number(b.dataset.onca) === cfg.oncaPlayer);
  $('nota2J').textContent = `O Jogador ${3 - cfg.oncaPlayer} fica com os Cachorros.`;
}
function irParaEscolha(modo) { cfg.mode = modo; atualizarEscolha(); mostrarTela('telaEscolha'); }
function comecar(estado) {
  mostrarTela('telaPartida');
  cam.zoom = 1; vistaAtual = 'normal';
  recentrar(false);
  novaPartida(estado);
}
function trocarVista() {
  vistaAtual = VISTAS[(VISTAS.indexOf(vistaAtual) + 1) % VISTAS.length];
  recentrar(true);
  toast(NOME_VISTA[vistaAtual]);
}
function abrir(id) { $(id).hidden = false; const b = $(id).querySelector('button'); if (b) b.focus(); }
function fecharSobreposicoes() { ['menu', 'regras', 'chat', 'painelSom'].forEach((id) => { $(id).hidden = true; }); }
function irParaInicio() {
  pedido++; ocupado = false; fecharSobreposicoes(); fecharAviso(); $('vitoria').hidden = true;
  if (sala) { sala.sair(); sala = null; esquecerSessao(); }
  limparChat();   // privacidade: o chat some do aparelho quando a sala acaba
  mostrarTela('telaInicio');
}

// ---------------------------------------------------------------- online (2 celulares)
const ON = window.OncaOnline;
let fabricaTransporte = (i) => ON.criarTransporteMqtt(ON.SERVIDORES[i]);
let opcoesSala = {};                       // o autoteste troca por intervalos curtos
let meuId = guardar.ler('id', null);
if (typeof meuId !== 'string' || meuId.length < 6) { meuId = ON.gerarId(); guardar.gravar('id', meuId); }
let ladoOnline = 'J';
const NOME_ART = { J: 'a Onça', D: 'os Cachorros' };

function sessaoSalva() { const s = guardar.ler('sessao', null); return s && ON.codigoValido(s.codigo) ? s : null; }
function guardarSessao() { if (sala && sala.codigo) guardar.gravar('sessao', { codigo: sala.codigo, servidor: sala.servidor }); }
function esquecerSessao() { guardar.gravar('sessao', null); try { const u = new URL(location.href); if (u.searchParams.has('sala')) { u.searchParams.delete('sala'); history.replaceState(null, '', u.toString()); } } catch (e) { /* file:// */ } }
function linkDaSala() { const u = new URL(location.href); u.search = '?sala=' + sala.codigo + (sala.servidor ? '&s=' + sala.servidor : ''); u.hash = ''; return u.toString(); }
function marcarUrlSala() { try { history.replaceState(null, '', linkDaSala()); } catch (e) { /* file:// */ } }

let timerToast = 0;
function toast(txt) { const t = $('toast'); t.textContent = txt; t.hidden = false; clearTimeout(timerToast); timerToast = setTimeout(() => { t.hidden = true; }, 2600); }
let avisoAcoes = {};
function mostrarAviso({ titulo, texto, sim = 'OK', nao = null, aoSim = null, aoNao = null }) {
  $('avisoTitulo').textContent = titulo; $('avisoTexto').textContent = texto || '';
  $('avisoSim').textContent = sim; $('avisoNao').hidden = !nao; if (nao) $('avisoNao').textContent = nao;
  avisoAcoes = { aoSim, aoNao };
  $('avisoOnline').hidden = false;
}
function fecharAviso() { $('avisoOnline').hidden = true; avisoAcoes = {}; }
$('avisoSim').onclick = () => { const f = avisoAcoes.aoSim; fecharAviso(); if (f) f(); };
$('avisoNao').onclick = () => { const f = avisoAcoes.aoNao; fecharAviso(); if (f) f(); };

function etapaOnline(nome, texto) {
  document.querySelectorAll('#telaOnline [data-etapa]').forEach((d) => { d.hidden = d.dataset.etapa !== nome; });
  $('telaOnline').dataset.etapa = nome;
  if (texto) $('textoConectando').textContent = texto;
  $('erroOnline').hidden = true;
}
function erroOnline(txt, etapa) { if (etapa) etapaOnline(etapa); $('erroOnline').textContent = txt; $('erroOnline').hidden = false; }
function irParaOnline(etapa = 'menu') {
  cfg.mode = 'online';
  marcarRadios('[data-lado-online]', (b) => b.dataset.ladoOnline === ladoOnline);
  mostrarTela('telaOnline'); etapaOnline(etapa);
}

function novaSessao() {
  if (sala) { sala.fechar(); sala = null; }
  partidaOnline = 0; seqOnline = 0;
  const s = ON.criarSala(Object.assign({ id: meuId, criarTransporte: (i) => fabricaTransporte(i), initialState: () => L.initialState() }, opcoesSala));
  s.on('estado', aoEstadoOnline);
  s.on('sala', () => { if (s === sala && s.meuLado && s.estado && s.estado.partida !== partidaOnline) aoEstadoOnline({ msg: s.estado }); });
  s.on('conexao', () => { if (s === sala) atualizarHud(); });
  s.on('presenca', () => { if (s === sala) atualizarHud(); });
  s.on('pedido-revanche', ({ trocar }) => {
    if (s !== sala) return;
    mostrarAviso({
      titulo: 'Revanche?', texto: trocar ? 'Seu adversário quer jogar de novo, trocando de lado.' : 'Seu adversário quer jogar de novo.',
      sim: 'Aceitar', nao: 'Recusar', aoSim: () => s.responderRevanche(true, trocar), aoNao: () => s.responderRevanche(false),
    });
  });
  s.on('resposta-revanche', ({ aceitar }) => { if (s === sala && !aceitar) mostrarAviso({ titulo: 'Sem revanche', texto: 'Seu adversário não quis jogar de novo agora.' }); });
  s.on('saiu', () => { if (s === sala) mostrarAviso({ titulo: 'Seu adversário saiu', texto: 'A partida online terminou.', sim: 'Ir para o início', aoSim: irParaInicio }); });
  s.on('chat', (m) => { if (s === sala) adicionarChat(m); });
  limparChat();
  sala = s;
  return s;
}

// chegou um estado da partida (meu eco, lance do adversário, nova partida ou reconexão)
async function aoEstadoOnline({ msg }) {
  if (cfg.mode !== 'online' || !sala || !sala.meuLado || !msg || !estadoValido(msg.estado)) return;   // REG-011
  if (!Number.isInteger(msg.partida) || !Number.isInteger(msg.seq)) return;
  if (msg.partida !== partidaOnline) {                  // primeira partida, revanche ou volta à sala
    partidaOnline = msg.partida; seqOnline = msg.seq;
    fecharAviso(); $('vitoria').hidden = true;
    guardarSessao(); marcarUrlSala();
    if ($('telaPartida').hidden) { mostrarTela('telaPartida'); cam.zoom = 1; vistaAtual = 'normal'; recentrar(false); }
    else { vistaAtual = 'normal'; recentrar(true); }
    novaPartida(L.cloneState(msg.estado));
    return;
  }
  if (msg.seq <= seqOnline) return;                     // eco do meu lance (ou repetido)
  const esperado = msg.seq === seqOnline + 1 && msg.lance && !ocupado && !cadeia && lanceConfere(S, msg.lance, msg.estado);
  seqOnline = msg.seq;
  if (!esperado) {                                      // fora de ordem: sincroniza direto
    pedido++; S = L.cloneState(msg.estado); ocupado = false; cadeia = false; sel = -1;
    lanceTurno = null;                                  // nunca reenviar um lance meu que ficou pela metade
    sincronizar(); fimDoTurno();
    return;
  }
  const meu = ++pedido;
  ocupado = true; sel = -1; desenharMarcadores(); atualizarHud();
  if (!(await executarLance(msg.lance, meu))) return;
  ocupado = false;
  fimDoTurno();
}
// REG-011: um estado vindo da rede precisa ser um tabuleiro possível (senão o jogo quebraria ao desenhar)
function estadoValido(e) {
  if (!e || typeof e !== 'object' || !Array.isArray(e.board) || e.board.length !== L.N) return false;
  if (e.turn !== 'J' && e.turn !== 'D') return false;
  if (!Number.isInteger(e.captured) || e.captured < 0 || e.captured > 14) return false;
  if (!Number.isInteger(e.jaguar) || e.jaguar < 0 || e.jaguar >= L.N || e.board[e.jaguar] !== 2) return false;
  let caes = 0, oncas = 0;
  for (const v of e.board) { if (v === 1) caes++; else if (v === 2) oncas++; else if (v !== 0) return false; }
  return oncas === 1 && caes === 14 - e.captured;
}
function lanceConfere(estado, lance, alvo) {
  try { const r = L.applyMove(estado, lance); return L.positionKey(r) === L.positionKey(alvo) && r.captured === alvo.captured; } catch (e) { return false; }
}

async function criarSalaOnline() {
  etapaOnline('conectando', 'Criando a sala…');
  const s = novaSessao();
  try {
    const r = await s.criar(ladoOnline);
    if (s !== sala) return;
    guardarSessao(); marcarUrlSala();
    $('codigoSala').textContent = ON.formatarCodigo(r.codigo);
    $('notaAguardando').textContent = `Você joga com ${NOME_ART[ladoOnline]}. Mande o convite (ou o código) para a outra pessoa.`;
    etapaOnline('aguardando');
  } catch (e) {
    erroOnline('Não consegui conectar ao servidor. Confira a internet e tente de novo.', 'criar');
  }
}
async function buscarSala(codigoDigitado, servidorDoLink) {
  const codigo = ON.normalizarCodigo(codigoDigitado);
  if (!ON.codigoValido(codigo)) { erroOnline('Código inválido. São 6 letras/números, como ABC-234.', 'entrar'); return; }
  etapaOnline('conectando', 'Procurando a sala…');
  const s = novaSessao();
  const salvo = sessaoSalva();
  const preferido = servidorDoLink === 1 ? 1 : (salvo && salvo.codigo === codigo ? salvo.servidor : undefined);
  let r;
  try { r = await s.consultar(codigo, preferido); } catch (e) { r = { existe: false, erro: true }; }
  if (s !== sala) return;
  if (!r.existe) { erroOnline(r.erro ? 'Não consegui conectar. Confira a internet.' : 'Sala não encontrada. Confira o código.', 'entrar'); return; }
  if (r.souJogador) { etapaOnline('conectando', 'Voltando para a partida…'); if (s.estado) aoEstadoOnline({ msg: s.estado }); return; }
  if (r.cheia) { erroOnline('Essa sala já tem 2 jogadores.', 'entrar'); return; }
  $('codigoConfirmar').textContent = ON.formatarCodigo(codigo);
  const outro = r.ladoCriador, eu = ON.oposto(outro);
  $('ladoOutro').textContent = NOME_ART[outro]; $('ladoMeu').textContent = NOME_ART[eu];
  $('icoLadoOutro').innerHTML = outro === 'J' ? '<use href="#ico-onca"/>' : '<use href="#ico-cao"/>';
  $('icoLadoMeu').innerHTML = eu === 'J' ? '<use href="#ico-onca"/>' : '<use href="#ico-cao"/>';
  $('icoLadoOutro').setAttribute('viewBox', outro === 'J' ? '0 0 64 36' : '0 0 48 36');
  $('icoLadoMeu').setAttribute('viewBox', eu === 'J' ? '0 0 64 36' : '0 0 48 36');
  etapaOnline('confirmar');
}
async function aceitarSala() {
  if (!sala) return;
  const s = sala;
  etapaOnline('conectando', 'Entrando na sala…');
  try { await s.entrar(); guardarSessao(); }
  catch (e) { if (s === sala) erroOnline(/cheia/.test(e.message) ? 'Essa sala já tem 2 jogadores.' : 'A sala não respondeu. Tente de novo.', 'entrar'); }
}
async function compartilharConvite() {
  if (!sala) return;
  const url = linkDaSala(), texto = `Vem jogar o Jogo da Onça comigo! Sala ${ON.formatarCodigo(sala.codigo)}`;
  try { if (navigator.share) { await navigator.share({ title: 'Jogo da Onça', text: texto, url }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${texto}: ${url}`); toast('Convite copiado! Cole no WhatsApp.'); }
  catch (e) { toast(`Código da sala: ${ON.formatarCodigo(sala.codigo)}`); }
}

// ---- chat (só no online). Histórico só na memória: some ao sair da sala ou recarregar.
let historicoChat = [];
function linhaChat(m) {
  const p = document.createElement('p');
  p.className = 'msg' + (m.meu ? ' meu' : '');
  const b = document.createElement('b');
  b.textContent = `${NOME[m.lado] || '?'}${m.meu ? ' (você)' : ''}: `;
  const t = document.createElement('span');
  t.textContent = m.texto;                         // sempre texto puro: nunca vira HTML
  p.append(b, t);
  return p;
}
function renderChat() {
  $('miniLista').replaceChildren(...historicoChat.slice(-4).map(linhaChat));
  const lista = $('chatLista');
  lista.replaceChildren(...historicoChat.map(linhaChat));
  lista.scrollTop = lista.scrollHeight;
}
function adicionarChat(m) {
  historicoChat.push(m);
  if (historicoChat.length > 300) historicoChat.shift();
  renderChat();
}
function limparChat() { historicoChat = []; $('chatTexto').value = ''; $('chatErro').hidden = true; renderChat(); }
function abrirChat() { abrir('chat'); renderChat(); setTimeout(() => $('chatTexto').focus(), 30); }
$('miniChat').onclick = abrirChat;
$('miniChat').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirChat(); } });
$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sala) return;
  const r = await sala.enviarChat($('chatTexto').value);
  const msgErro = { chave: 'O chat ainda está conectando… tente de novo em instantes.', longo: 'Mensagem muito longa (máximo 200 caracteres).', 'sem-cripto': 'Este navegador não permite chat criptografado.', erro: 'Não consegui enviar. Tente de novo.' };
  if (r.ok) { $('chatTexto').value = ''; $('chatErro').hidden = true; }
  else if (r.motivo !== 'vazio') { $('chatErro').textContent = msgErro[r.motivo] || 'Não consegui enviar.'; $('chatErro').hidden = false; }
});

$('btnModoOnline').onclick = () => irParaOnline('menu');
$('btnRetomar').onclick = () => { const s = sessaoSalva(); if (s) { irParaOnline('entrar'); $('campoCodigo').value = ON.formatarCodigo(s.codigo); buscarSala(s.codigo); } };
$('btnCriarSala').onclick = () => etapaOnline('criar');
$('btnIrEntrar').onclick = () => { etapaOnline('entrar'); setTimeout(() => $('campoCodigo').focus(), 50); };
document.querySelectorAll('[data-lado-online]').forEach((b) => { b.onclick = () => { ladoOnline = b.dataset.ladoOnline; marcarRadios('[data-lado-online]', (x) => x.dataset.ladoOnline === ladoOnline); }; });
$('btnConfirmarCriar').onclick = criarSalaOnline;
$('btnCompartilhar').onclick = compartilharConvite;
$('btnBuscarSala').onclick = () => buscarSala($('campoCodigo').value);
$('campoCodigo').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarSala($('campoCodigo').value); });
$('campoCodigo').addEventListener('input', () => {
  const c = ON.normalizarCodigo($('campoCodigo').value).slice(0, 6);
  $('campoCodigo').value = c.length > 3 ? c.slice(0, 3) + '-' + c.slice(3) : c;
});
$('btnAceitar').onclick = aceitarSala;
$('btnVoltarOnline').onclick = () => {
  const etapa = $('telaOnline').dataset.etapa;
  if (sala) { sala.sair(); sala = null; esquecerSessao(); }
  if (etapa === 'menu' || !etapa) mostrarTela('telaInicio'); else etapaOnline('menu');
};
$('btnSairSala').onclick = irParaInicio;

$('btnModoIA').onclick = () => irParaEscolha('ai');
$('btnModo2J').onclick = () => irParaEscolha('pvp');
$('btnVoltar').onclick = () => mostrarTela('telaInicio');
$('btnComecar').onclick = () => comecar();
document.querySelectorAll('#escolhaIA .lado').forEach((b) => { b.onclick = () => { cfg.humanSide = b.dataset.lado; guardar.gravar('lado', cfg.humanSide); atualizarEscolha(); }; });
document.querySelectorAll('.nivel').forEach((b) => { b.onclick = () => { cfg.level = Number(b.dataset.nivel); guardar.gravar('nivel', cfg.level); atualizarEscolha(); }; });
document.querySelectorAll('#escolha2J .lado').forEach((b) => { b.onclick = () => { cfg.oncaPlayer = Number(b.dataset.onca); atualizarEscolha(); }; });
document.querySelectorAll('[data-abrir]').forEach((b) => { b.onclick = () => abrir(b.dataset.abrir); });
document.querySelectorAll('[data-fechar]').forEach((b) => { b.onclick = () => { b.closest('.sobre').hidden = true; }; });
document.querySelectorAll('.sobre').forEach((s) => { s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'vitoria') s.hidden = true; }); });
document.addEventListener('keydown', (e) => { som('unlock'); if (e.key === 'Escape') fecharSobreposicoes(); });
$('btnMenu').onclick = () => abrir('menu');
$('btnReiniciar').onclick = () => { fecharSobreposicoes(); novaPartida(); };
$('btnInicioMenu').onclick = irParaInicio;
$('btnInicioVit').onclick = irParaInicio;
function pedirRevancheOnline(trocar) {
  if (!sala) return;
  sala.pedirRevanche(trocar);
  mostrarAviso({ titulo: 'Pedido enviado', texto: trocar ? 'Esperando seu adversário aceitar a revanche trocando de lado…' : 'Esperando seu adversário aceitar a revanche…', sim: 'OK' });
}
$('btnRevanche').onclick = () => { if (cfg.mode === 'online') pedirRevancheOnline(false); else novaPartida(); };
$('btnTrocar').onclick = () => {
  if (cfg.mode === 'online') { pedirRevancheOnline(true); return; }
  cfg.oncaPlayer = 3 - cfg.oncaPlayer; novaPartida();
};
$('btnDesfazer').onclick = desfazer;
$('btnParar').onclick = encerrarCadeia;
$('btnCamera').onclick = trocarVista;
// ---- som ambiente de floresta: "Chaguaramal aves" (Wilfredor, CC BY-SA 3.0), em assets/sons/ambiente.mp3
// Toca em laço em todas as telas, com volume próprio (painel Som: − / +); pausa com a aba escondida.
// O volume é independente dos efeitos (toc, latidos, rugido), que têm o seu liga/desliga.
const AMBIENTE_MAX = 0.44;                 // volume no 100% (50% = 0,22, o "bem baixinho" combinado)
const ambiente = new Audio();
ambiente.loop = true; ambiente.preload = 'none';
ambiente.src = 'assets/sons/ambiente.mp3';
let nivelFloresta = guardar.ler('floresta', 50);
if (typeof nivelFloresta !== 'number' || !(nivelFloresta >= 0 && nivelFloresta <= 100)) nivelFloresta = 50;
nivelFloresta = Math.round(nivelFloresta / 10) * 10;
let ambienteLiberado = false, ambienteFalhou = false, timerFade = 0, ganhoAtual = 0;
// No iPhone o volume de um <audio> não muda por código; com Web Audio (ganho) muda em todo lugar.
// Aberto direto do PC (file://) o Web Audio fica mudo com arquivo local, então lá usa o volume comum.
let ctxAmb = null, ganhoAmb = null;
function prepararGanho() {
  if (ctxAmb || !/^https?:$/.test(location.protocol)) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctxAmb = new AC();
    ganhoAmb = ctxAmb.createGain(); ganhoAmb.gain.value = 0;
    ctxAmb.createMediaElementSource(ambiente).connect(ganhoAmb).connect(ctxAmb.destination);
  } catch (e) { ctxAmb = null; ganhoAmb = null; }
}
function aplicarGanho(v) {
  ganhoAtual = v;
  if (ganhoAmb) { ganhoAmb.gain.value = v; ambiente.volume = 1; } else ambiente.volume = Math.max(0, Math.min(1, v));
}
const alvoAmbiente = () => AMBIENTE_MAX * nivelFloresta / 100;
ambiente.addEventListener('error', () => { ambienteFalhou = true; });   // sem arquivo: o jogo segue sem ambiente
function atualizarAmbiente() {
  const tocar = ambienteLiberado && !ambienteFalhou && nivelFloresta > 0 && !document.hidden;
  clearInterval(timerFade);
  if (tocar) {
    if (ctxAmb && ctxAmb.state === 'suspended') ctxAmb.resume().catch(() => {});
    if (ambiente.paused) { aplicarGanho(0); const p = ambiente.play(); if (p && p.catch) p.catch(() => {}); }
    const alvo = alvoAmbiente(), passo = AMBIENTE_MAX / 20;
    timerFade = setInterval(() => {                         // entra (ou muda de volume) devagar
      const v = ganhoAtual < alvo ? Math.min(alvo, ganhoAtual + passo) : Math.max(alvo, ganhoAtual - passo);
      aplicarGanho(v);
      if (v === alvo) clearInterval(timerFade);
    }, 60);
  } else {
    aplicarGanho(0);
    if (!ambiente.paused) ambiente.pause();
  }
}
// navegadores só deixam tocar som depois do primeiro toque do usuário
const liberarAmbiente = () => { if (!ambienteLiberado && !SELFTEST) { ambienteLiberado = true; prepararGanho(); atualizarAmbiente(); } };
document.addEventListener('pointerdown', liberarAmbiente, { capture: true });
document.addEventListener('keydown', liberarAmbiente, { capture: true });
document.addEventListener('visibilitychange', atualizarAmbiente);

function mudarFloresta(n) {
  nivelFloresta = Math.max(0, Math.min(100, Math.round(n / 10) * 10));
  guardar.gravar('floresta', nivelFloresta);
  atualizarPainelSom(); atualizarAmbiente();
}
function atualizarPainelSom() {
  const mudo = audio ? audio.isMuted() : true;
  $('btnEfeitos').setAttribute('aria-pressed', String(!mudo));
  $('btnEfeitos').textContent = mudo ? 'Efeitos desligados' : 'Efeitos ligados';
  $('btnEfeitos').disabled = !audio;
  $('volFloresta').value = String(nivelFloresta);
  $('volFlorestaTxt').textContent = nivelFloresta ? nivelFloresta + '%' : 'Sem';
  $('btnFlorestaMenos').disabled = nivelFloresta <= 0;
  $('btnFlorestaMais').disabled = nivelFloresta >= 100;
  // ícone da barra: "Sem som" só quando os efeitos E a floresta estão desligados
  const tudoMudo = mudo && nivelFloresta === 0;
  $('btnSom').setAttribute('aria-pressed', String(!tudoMudo));
  $('btnSom').querySelector('span').textContent = tudoMudo ? 'Sem som' : 'Som';
}
$('btnSom').onclick = () => { som('unlock'); atualizarPainelSom(); abrir('painelSom'); };
$('btnEfeitos').onclick = () => { if (!audio) return; som('unlock'); audio.setMuted(!audio.isMuted()); atualizarPainelSom(); if (!audio.isMuted()) som('toc', 0.8); };
$('btnFlorestaMenos').onclick = () => mudarFloresta(nivelFloresta - 10);
$('btnFlorestaMais').onclick = () => mudarFloresta(nivelFloresta + 10);
$('volFloresta').addEventListener('input', () => mudarFloresta(Number($('volFloresta').value)));
atualizarPainelSom();

// ---------------------------------------------------------------- ganchos de teste
function posTela(i) {
  const v = pos(i).project(cam), r = canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}
function clicarPonto(i) {
  const p = posTela(i);
  const o = { clientX: p.x, clientY: p.y, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
  canvas.dispatchEvent(new PointerEvent('pointerdown', o));
  canvas.dispatchEvent(new PointerEvent('pointerup', o));
}
window.__onca = {
  getState: () => S, cfg, isBusy: () => ocupado || tweens.length > 0, nodeScreenPos: posTela, clickPoint: clicarPonto,
  loadState: (s) => novaPartida(L.cloneState(s)), start: comecar, undo: desfazer, stopChain: encerrarCadeia,
  pieces: () => ({ caesNoTabuleiro: caes.filter((d) => d.userData.point >= 0).length, caesNaBandeja: caes.filter((d) => d.userData.point < 0 && d.visible).length, onca: puma.userData.point }),
  setCamera: ({ az, el, zoom }) => { if (zoom) cam.zoom = zoom; const a = anguloAtual(); enquadrar(direcao(az ?? a.az, el ?? a.el)); },
  overlayVisible: () => !$('vitoria').hidden,
  pauseFrames: (v) => { quadrosPausados = !!v; },
};

// elementos visíveis que saem da largura da tela (mobile first: nada pode vazar)
function vazamentos() {
  const W = document.documentElement.clientWidth;
  const sel = '.tela:not([hidden]) .cartao, .tela:not([hidden]) .btn, .tela:not([hidden]) .lado, .tela:not([hidden]) .nivel, .tela:not([hidden]) h1, .tela:not([hidden]) h2, .tela:not([hidden]) .credito, .tela:not([hidden]) .hud, .tela:not([hidden]) .vez, .tela:not([hidden]) .placar, .tela:not([hidden]) .barra, .tela:not([hidden]) .acao';
  const fora = [];
  document.querySelectorAll(sel).forEach((el) => {
    if (el.closest('[hidden]')) return;
    const r = el.getBoundingClientRect();
    if (r.width && (r.left < -1 || r.right > W + 1)) fora.push((el.id || el.className) + ` [${Math.round(r.left)}..${Math.round(r.right)} de ${W}]`);
  });
  if (document.documentElement.scrollWidth > W + 1) fora.push(`página mais larga que a tela (${document.documentElement.scrollWidth} > ${W})`);
  return fora;
}

// posição de exemplo (meio de partida, 2 cachorros capturados) — usada em prints e testes
function posicaoMeio() {
  const b = new Array(L.N).fill(0);
  [0, 1, 3, 4, 5, 6, 8, 9, 10, 13, 14, 15].forEach((i) => { b[i] = 1; });
  b[17] = 2;
  return Object.assign({}, L.initialState(), { board: b, jaguar: 17, captured: 2, turn: 'D', ply: 9 });
}

// ---------------------------------------------------------------- início
if (SELFTEST) {
  autoteste();
} else if (qs.has('mode')) {
  cfg.mode = qs.get('mode') === 'pvp' ? 'pvp' : 'ai';
  if (qs.get('side') === 'J' || qs.get('side') === 'D') cfg.humanSide = qs.get('side');
  if ([1, 2, 3, 4].includes(Number(qs.get('level')))) cfg.level = Number(qs.get('level'));
  comecar(qs.get('demo') === 'midgame' ? posicaoMeio() : undefined);
  if (qs.has('az') || qs.has('el') || qs.has('zoom')) {
    window.__onca.setCamera({ az: qs.has('az') ? Number(qs.get('az')) : undefined, el: qs.has('el') ? Number(qs.get('el')) : undefined, zoom: qs.has('zoom') ? Number(qs.get('zoom')) : undefined });
  }
  if (qs.get('demo') === 'win') terminar('J');
  if (qs.get('tela') === 'menu') abrir('menu');
  if (qs.get('tela') === 'regras') abrir('regras');
  if (qs.get('tela') === 'som') abrir('painelSom');
} else if (qs.has('sala')) {
  // convite: ?sala=CÓDIGO (abre direto a confirmação; se este aparelho já está na sala, volta para a partida)
  irParaOnline('entrar');
  $('campoCodigo').value = ON.formatarCodigo(ON.normalizarCodigo(qs.get('sala')));
  buscarSala(qs.get('sala'), Number(qs.get('s')) || 0);
} else if (qs.get('tela') === 'escolha-ia') irParaEscolha('ai');
else if (qs.get('tela') === 'escolha-2j') irParaEscolha('pvp');
else if (qs.get('tela') === 'online') irParaOnline(qs.get('etapa') || 'menu');
$('btnRetomar').hidden = !sessaoSalva() || SELFTEST;

// ---------------------------------------------------------------- autoteste (?selftest=1)
// Roda a interface de verdade: cliques sintéticos passam pelo mesmo caminho do toque.
async function autoteste() {
  const rel = { ok: true, checks: [], errors: [] };
  const pre = $('selftest-report');
  pre.hidden = false;
  const check = (nome, cond, info) => { rel.checks.push({ nome, ok: !!cond, info: info === undefined ? '' : info }); if (!cond) rel.ok = false; };
  const esperar = async (cond, ms = 8000) => { const t = performance.now(); while (!cond() && performance.now() - t < ms) await dormir(30); return cond(); };
  const ocioso = () => esperar(() => !window.__onca.isBusy());
  const perto = (obj, i) => obj.position.distanceTo(pos(i)) < 0.02;
  try {
    // REG-002: layout mobile first — nada pode sair da tela (início e escolhas)
    mostrarTela('telaInicio'); await dormir(50);
    check('REG-002 layout: tela inicial cabe na tela', vazamentos().length === 0, vazamentos());
    irParaEscolha('ai'); await dormir(50);
    check('REG-002 layout: escolha (computador) cabe na tela', vazamentos().length === 0, vazamentos());
    irParaEscolha('pvp'); await dormir(50);
    check('REG-002 layout: "Quem é a Onça?" cabe na tela', vazamentos().length === 0, vazamentos());

    cfg.mode = 'pvp'; cfg.oncaPlayer = 1;
    comecar();
    await dormir(200);
    check('REG-002 layout: partida (barras e placar) cabe na tela', vazamentos().length === 0, vazamentos());
    // REG-003: o texto da vez aparecia cortado no celular ("Vez do Jogador 1 (On…")
    const cortado = () => { const s = $('status'); return s.scrollWidth > s.clientWidth + 1; };
    check('REG-003 texto da vez inteiro (2 jogadores)', !cortado(), $('status').textContent);
    const pc = window.__onca.pieces();
    check('início: 14 cachorros no tabuleiro e a onça no centro', pc.caesNoTabuleiro === 14 && pc.onca === 12, pc);
    check('início: texto da vez (2 jogadores)', $('status').textContent === 'Vez do Jogador 1 (Onça)', $('status').textContent);
    check('início: canvas desenhou', renderer.info.render.calls > 0, renderer.info.render.calls);

    // câmera: só 3 visões fixas pelo botão; arrastar não gira e a roda/pinça não aproxima
    const p0 = cam.position.clone(), z0 = cam.zoom;
    const ev = (tipo, x, y, extra) => canvas.dispatchEvent(new PointerEvent(tipo, Object.assign({ clientX: x, clientY: y, bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true }, extra)));
    ev('pointerdown', 150, 300, { button: 0, buttons: 1 }); ev('pointermove', 330, 380, { buttons: 1 }); ev('pointerup', 330, 380, { button: 0 });
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, clientX: 200, clientY: 300, bubbles: true, cancelable: true }));
    await dormir(120);
    check('câmera: arrastar não gira e a roda do mouse não aproxima', cam.position.distanceTo(p0) < 1e-6 && cam.zoom === z0 && vistaAtual === 'normal');
    const vistas = [];
    for (let k = 0; k < 3; k++) { $('btnCamera').click(); await dormir(900); vistas.push([vistaAtual, Math.round(anguloAtual().el)]); }
    check('câmera: botão alterna normal → lado oposto → de cima → normal', JSON.stringify(vistas) === JSON.stringify([['oposta', 35], ['cima', 90], ['normal', 35]]), vistas);
    check('câmera: aviso com o nome da visão', !$('toast').hidden && $('toast').textContent === 'Visão normal', $('toast').textContent);

    // painel Som: efeitos liga/desliga e volume do som da floresta com − e + (pedido do usuário)
    const florestaAntes = nivelFloresta, mudoAntes = audio ? audio.isMuted() : true;
    mudarFloresta(50);
    $('btnSom').click(); await dormir(30);
    check('som: botão Som abre o painel', !$('painelSom').hidden);
    check('REG-002 layout: painel de som cabe na tela', vazamentos().length === 0 && (() => { const r = $('painelSom').querySelector('.gaveta').getBoundingClientRect(); return r.left >= -1 && r.right <= document.documentElement.clientWidth + 1; })(), vazamentos());
    $('btnFlorestaMenos').click(); $('btnFlorestaMenos').click();
    check('som: "−" diminui o som da floresta (50% → 30%) e guarda no aparelho', nivelFloresta === 30 && $('volFloresta').value === '30' && $('volFlorestaTxt').textContent === '30%' && guardar.ler('floresta', null) === 30 && Math.abs(alvoAmbiente() - AMBIENTE_MAX * 0.3) < 1e-9,
      { nivel: nivelFloresta, txt: $('volFlorestaTxt').textContent });
    $('btnFlorestaMais').click();
    check('som: "+" aumenta o som da floresta (30% → 40%)', nivelFloresta === 40);
    for (let k = 0; k < 6; k++) $('btnFlorestaMenos').click();
    check('som: no 0 a floresta desliga e o "−" fica travado', nivelFloresta === 0 && $('volFlorestaTxt').textContent === 'Sem' && $('btnFlorestaMenos').disabled && ambiente.paused && ganhoAtual === 0);
    $('volFloresta').value = '100'; $('volFloresta').dispatchEvent(new Event('input'));
    check('som: o controle deslizante também muda o volume (100%, "+" travado)', nivelFloresta === 100 && $('btnFlorestaMais').disabled && $('volFlorestaTxt').textContent === '100%');
    if (audio) {
      audio.setMuted(false); atualizarPainelSom();
      $('btnEfeitos').click();
      check('som: botão de efeitos desliga só os efeitos (a floresta continua)', audio.isMuted() && $('btnEfeitos').getAttribute('aria-pressed') === 'false' && nivelFloresta === 100 && $('btnSom').getAttribute('aria-pressed') === 'true');
      mudarFloresta(0);
      check('som: barra mostra "Sem som" só com efeitos e floresta desligados', $('btnSom').getAttribute('aria-pressed') === 'false' && $('btnSom').textContent.trim() === 'Sem som');
      $('btnEfeitos').click();
      check('som: efeitos voltam a ligar', !audio.isMuted() && $('btnSom').getAttribute('aria-pressed') === 'true');
      audio.setMuted(mudoAntes);
    }
    const credito = $('painelSom').querySelector('.credito-som');
    check('som: crédito da gravação (licença CC BY-SA 3.0) no painel e na tela inicial',
      /Wilfredor/.test(credito.textContent) && /CC BY-SA 3\.0/.test(credito.textContent) && credito.querySelector('a[href*="creativecommons.org/licenses/by-sa/3.0"]') && credito.querySelector('a[href*="Chaguaramal_aves"]') &&
      /Wilfredor.*CC BY-SA 3\.0/.test(document.querySelector('#telaInicio .credito').textContent));
    $('painelSom').querySelector('[data-fechar]').click(); await dormir(30);
    check('som: "Pronto" fecha o painel', $('painelSom').hidden);
    mudarFloresta(florestaAntes);

    // onça anda 12 -> 17
    clicarPonto(12); clicarPonto(17); await ocioso();
    check('onça anda com cliques (12 -> 17)', S.jaguar === 17 && S.turn === 'D' && perto(puma, 17), { jaguar: S.jaguar, turn: S.turn });
    // cachorro anda 11 -> 16
    clicarPonto(11); clicarPonto(16); await ocioso();
    check('cachorro anda com cliques (11 -> 16)', S.board[16] === 1 && S.board[11] === 0 && S.turn === 'J' && caoEm[16] && perto(caoEm[16], 16));
    check('clique inválido não muda nada', (() => { const k = L.positionKey(S); clicarPonto(0); clicarPonto(24); return L.positionKey(S) === k; })());
    desenharMarcadores();

    // REG-001: com os quadros de animação pausados (aba em segundo plano), o deslize
    // precisa terminar mesmo assim — antes a peça ficava parada e o jogo travava.
    window.__onca.pauseFrames(true);
    const t0 = performance.now();
    clicarPonto(17); clicarPonto(22);
    const terminou = await esperar(() => !window.__onca.isBusy(), 1500);
    window.__onca.pauseFrames(false);
    check('REG-001 deslize termina com os quadros pausados', terminou && S.jaguar === 22 && perto(puma, 22) && S.turn === 'D',
      { ms: Math.round(performance.now() - t0), jaguar: S.jaguar });
    clicarPonto(16); clicarPonto(11); await ocioso();   // devolve o cachorro (vez volta para a onça)

    // captura dupla: 22 pula 17 (cai em 12) e depois 7 (cai em 2)
    const b = new Array(L.N).fill(0);
    [17, 7, 0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14].forEach((i) => { b[i] = 1; });
    b[22] = 2;
    const posCadeia = Object.assign({}, L.initialState(),{ board: b, jaguar: 22, captured: 0, turn: 'J', ply: 10 });
    window.__onca.loadState(posCadeia); await dormir(50);
    clicarPonto(22); clicarPonto(12); await ocioso();
    check('REG-003 texto da vez inteiro (cadeia de capturas)', !cortado(), $('status').textContent);
    check('captura 1: cachorro vai para a bandeja e a cadeia continua', S.captured === 1 && cadeia && !$('btnParar').hidden && window.__onca.pieces().caesNaBandeja === 1);
    clicarPonto(2); await ocioso();
    check('captura 2: cadeia termina sozinha e a vez passa', S.captured === 2 && !cadeia && S.turn === 'D' && S.jaguar === 2 && perto(puma, 2));
    check('placar mostra 2/5', $('capNum').textContent === '2' && document.querySelectorAll('#slots svg.on').length === 2);
    check('bandeja: 2 cachorros nos encaixes', caes.filter((d) => d.userData.point < 0 && d.visible && (d.position.distanceTo(board.captureSlots[0]) < 0.02 || d.position.distanceTo(board.captureSlots[1]) < 0.02)).length === 2);

    // desfazer volta para antes da cadeia
    desfazer(); await dormir(30);
    check('desfazer restaura a posição e as peças', S.jaguar === 22 && S.captured === 0 && S.turn === 'J' && window.__onca.pieces().caesNoTabuleiro === 14 && perto(puma, 22));

    // parar de capturar no meio da cadeia
    clicarPonto(22); clicarPonto(12); await ocioso();
    $('btnParar').click(); await dormir(30);
    check('"Parar de capturar" encerra a jogada', S.captured === 1 && S.turn === 'D' && !cadeia && $('btnParar').hidden);

    // vitória dos cachorros: onça presa no canto da toca
    const b2 = new Array(L.N).fill(0);
    [25, 29, 22, 30, 0, 1, 2, 3, 4, 6, 7, 8, 9].forEach((i) => { b2[i] = 1; });
    b2[28] = 2;
    window.__onca.loadState(Object.assign({}, L.initialState(),{ board: b2, jaguar: 28, captured: 1, turn: 'D', ply: 30 }));
    await dormir(50);
    clicarPonto(0); clicarPonto(5); await ocioso();
    await esperar(() => !$('vitoria').hidden, 2000);
    check('vitória dos cachorros detectada e anunciada', fim === 'D' && !$('vitoria').hidden && /encurralaram/.test($('vitTitulo').textContent), $('vitTitulo').textContent);
    $('btnTrocar').click(); await dormir(30);
    check('"Trocar lados": Jogador 2 vira a Onça', cfg.oncaPlayer === 2 && $('status').textContent === 'Vez do Jogador 2 (Onça)', $('status').textContent);

    // contra o computador: a onça (computador) faz o primeiro lance
    cfg.mode = 'ai'; cfg.humanSide = 'D'; cfg.level = 1;
    comecar();
    await dormir(20);
    check('REG-003 texto da vez inteiro (computador pensando)', !cortado(), $('status').textContent);
    const jogou = await esperar(() => S.turn === 'D' && !window.__onca.isBusy(), 15000);
    check('computador (onça) joga primeiro quando você é os cachorros', jogou && S.ply === 1 && $('status').textContent === 'Sua vez (Cachorros)', { ply: S.ply, status: $('status').textContent });
    // humano move um cachorro -> computador responde
    const mv = L.dogMoves(S)[0];
    clicarPonto(mv.from); clicarPonto(mv.to);
    const resp = await esperar(() => S.turn === 'D' && S.ply === 3 && !window.__onca.isBusy(), 15000);
    check('computador responde ao seu lance', resp, { ply: S.ply });
    desfazer(); await dormir(30);
    check('desfazer contra o computador volta para a sua vez', S.turn === 'D' && S.ply === 1);

    // ONLINE (servidor simulado em memória + adversário robô; o caminho da tela é o real)
    const broker = ON.criarBrokerMemoria();
    fabricaTransporte = () => broker.criarTransporte();
    opcoesSala = { batidaMs: 150, ausenciaMs: 700, esperaSalaMs: 300, iteracoesSala: 1000 };   // REG-012
    const robo = (id) => ON.criarSala({ id, criarTransporte: () => broker.criarTransporte(), initialState: () => L.initialState(), batidaMs: 150, ausenciaMs: 700, esperaSalaMs: 300, iteracoesSala: 1000 });
    irParaInicio();
    $('btnModoOnline').click(); $('btnCriarSala').click();
    document.querySelector('[data-lado-online="J"]').click();
    $('btnConfirmarCriar').click();
    await esperar(() => $('telaOnline').dataset.etapa === 'aguardando', 3000);
    const codigo = sala && sala.codigo;
    check('online: criar sala mostra o código', ON.codigoValido(codigo) && $('codigoSala').textContent === ON.formatarCodigo(codigo), $('codigoSala').textContent);
    check('REG-002 layout: tela da sala criada cabe na tela', vazamentos().length === 0, vazamentos());
    const conv = robo('robo-convidado');
    const info = await conv.consultar(codigo);
    check('online: quem entra vê que a outra pessoa é a Onça e fica com os Cachorros', info.existe && info.status === 'aguardando' && info.ladoCriador === 'J' && info.meuLado === 'D', info);
    await conv.entrar(3000);
    await esperar(() => !$('telaPartida').hidden && partidaOnline === 1, 3000);
    check('online: a partida começa nos dois lados', !$('telaPartida').hidden && conv.meuLado === 'D' && sala.meuLado === 'J' && $('status').textContent === 'Sua vez (Onça)', $('status').textContent);
    // REG-006: logo ao entrar aparecia "Adversário desconectado" até a 1ª batida periódica (8 s no jogo real)
    await esperar(() => sala.adversarioOnline && conv.adversarioOnline, 100);
    check('REG-006 adversário aparece conectado logo ao começar (criador e convidado)', sala.adversarioOnline && conv.adversarioOnline && $('vez').dataset.rede === 'on',
      { eu: sala._diag(), conv: conv._diag() });
    check('online: sem botão Desfazer', $('btnDesfazer').hidden && !podeDesfazer());

    // CHAT criptografado de ponta a ponta
    await esperar(() => sala.chatPronto && conv.chatPronto, 3000);
    check('chat: chave secreta combinada nos dois celulares', sala.chatPronto && conv.chatPronto, { eu: sala._diag(), conv: conv._diag() });
    check('chat: caixinha aparece no canto inferior esquerdo', !$('miniChat').hidden && (() => { const r = $('miniChat').getBoundingClientRect(); return r.left < 40 && r.bottom > window.innerHeight * 0.6; })());
    const recebidasRobo = [];
    conv.on('chat', (m) => { if (!m.meu) recebidasRobo.push(m); });
    $('miniChat').click(); await dormir(60);
    check('chat: tocar na caixinha abre o chat completo', !$('chat').hidden);
    $('chatTexto').value = 'Boa sorte!'; $('chatForm').requestSubmit();
    await esperar(() => recebidasRobo.length === 1, 3000);
    check('chat: minha mensagem chega decifrada no outro celular', recebidasRobo.length === 1 && recebidasRobo[0].texto === 'Boa sorte!' && recebidasRobo[0].lado === 'J', recebidasRobo);
    const noServidor = broker.publicacoes.filter((p) => p.topico.endsWith('/chat'));
    check('cripto: no servidor só passa texto embaralhado (sem o texto, sem nomes)', noServidor.length >= 1 && noServidor.every((p) => {
      const bruto = JSON.stringify(p.msg);
      return !bruto.includes('Boa sorte') && Object.keys(p.msg).sort().join() === 'ct,id,iv,mac' && !p.opcoes.reter && p.opcoes.expiraSeg <= ON.EXPIRA_MSG_SEG;
    }), noServidor.map((p) => p.msg));
    await conv.enviarChat('<img src=x onerror="window.__xss=1"><b>oi</b>');
    await esperar(() => historicoChat.length === 2, 3000);
    check('segurança: texto com código vira só texto (nada é executado)', !document.querySelector('#miniChat img, #chatLista img, #chatLista b b') && !window.__xss && $('chatLista').textContent.includes('<img src=x'), $('chatLista').textContent);
    for (let k = 1; k <= 4; k++) await conv.enviarChat('msg ' + k);
    await esperar(() => historicoChat.length === 6, 3000);
    check('chat: a caixinha mostra só as últimas 4; o chat completo mostra todas', $('miniLista').children.length === 4 && $('chatLista').children.length === 6, [$('miniLista').children.length, $('chatLista').children.length]);
    check('chat: nome Onça/Cachorros em cada mensagem', $('miniLista').lastElementChild.textContent === 'Cachorros: msg 4' && $('chatLista').firstElementChild.textContent === 'Onça (você): Boa sorte!', [$('miniLista').lastElementChild.textContent, $('chatLista').firstElementChild.textContent]);
    check('chat: mensagem longa demais é recusada', (await sala.enviarChat('x'.repeat(ON.LIMITE_CHAT + 1))).motivo === 'longo');
    check('REG-002 layout: chat completo cabe na tela', vazamentos().length === 0, vazamentos());
    $('chat').querySelector('[data-fechar]').click(); await dormir(30);
    check('chat: fechar volta para o jogo com a caixinha visível', $('chat').hidden && !$('miniChat').hidden);
    check('privacidade: tudo o que fica guardado no servidor tem validade', broker.publicacoes.filter((p) => p.opcoes.reter && p.msg).every((p) => p.opcoes.expiraSeg > 0 && p.opcoes.expiraSeg <= ON.EXPIRA_RETIDO_SEG));
    check('REG-002 layout: partida online cabe na tela', vazamentos().length === 0, vazamentos());
    check('REG-003 texto da vez inteiro (online)', !cortado(), $('status').textContent);
    // meu lance chega ao adversário
    clicarPonto(12); clicarPonto(17); await ocioso();
    await esperar(() => conv.estado && conv.estado.seq === 1, 2000);
    check('online: meu lance chega ao adversário', conv.estado && conv.estado.seq === 1 && conv.estado.lance.type === 'step' && conv.estado.lance.to === 17 && conv.estado.estado.jaguar === 17, conv.estado && conv.estado.lance);
    check('online: na vez do adversário eu não mexo', (() => { const k = L.positionKey(S); clicarPonto(11); clicarPonto(16); return L.positionKey(S) === k; })());
    // lance do adversário chega e anima aqui
    conv.jogar({ type: 'dog', from: 11, to: 16 }, L.applyDogMove(conv.estado.estado, 11, 16));
    await esperar(() => S.board[16] === 1 && !window.__onca.isBusy(), 3000);
    check('online: lance do adversário aparece no meu tabuleiro', S.board[16] === 1 && S.board[11] === 0 && caoEm[16] && perto(caoEm[16], 16) && S.turn === 'J' && seqOnline === 2, { seq: seqOnline, status: $('status').textContent });
    // terceira pessoa não entra
    const intruso = robo('robo-intruso');
    const info3 = await intruso.consultar(codigo);
    check('online: só 2 pessoas (a terceira vê "sala cheia")', info3.existe && info3.cheia === true, info3);
    intruso.fechar();
    // mensagem falsa de estranho é ignorada
    const antes = L.positionKey(S);
    broker.criarTransporte().publicar(conv.topico + 'estado', { partida: 1, seq: 99, estado: L.initialState(), lance: null, autor: 'robo-intruso' }, { reter: false });
    await dormir(80);
    check('online: estado falso de estranho é ignorado', L.positionKey(S) === antes && seqOnline === 2);
    // REG-011: o adversário (com assinatura válida) manda um tabuleiro impossível: é ignorado e nada quebra
    const errosAntes = window.__errors.length;
    conv.jogar({ type: 'dog', from: 16, to: 11 }, Object.assign({}, L.initialState(), { board: [1, 2, 3], jaguar: 1 }));
    await dormir(120);
    check('REG-011 tabuleiro impossível vindo da rede é ignorado (sem travar)', L.positionKey(S) === antes && seqOnline === 2 && !ocupado && window.__errors.length === errosAntes, { seq: seqOnline, erros: window.__errors.slice(errosAntes) });
    // captura em cadeia vai inteira para o adversário (o seq 3 acima foi descartado: agora é o 4)
    const b3 = new Array(L.N).fill(0);
    [17, 7, 0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14].forEach((i) => { b3[i] = 1; });
    b3[22] = 2;
    const posC = Object.assign({}, L.initialState(), { board: b3, jaguar: 22, captured: 0, turn: 'J', ply: 10 });
    conv.jogar({ type: 'dog', from: 16, to: 11 }, posC);   // força a posição (lance não confere -> sincroniza)
    await esperar(() => S.jaguar === 22 && seqOnline === 4, 2000);
    clicarPonto(22); clicarPonto(12); await ocioso(); clicarPonto(2); await ocioso();
    await esperar(() => conv.estado && conv.estado.seq === 5, 2000);
    check('online: captura em cadeia chega inteira (2 pulos)', conv.estado && conv.estado.lance.type === 'capture' && conv.estado.lance.captured.length === 2 && conv.estado.estado.captured === 2, conv.estado && conv.estado.lance);
    // adversário cai e volta
    conv._transporte().cair();
    await esperar(() => $('vez').dataset.rede === 'off', 2000);
    check('online: aviso quando o adversário cai', $('vez').dataset.rede === 'off');
    conv._transporte().voltar();
    await esperar(() => $('vez').dataset.rede === 'on', 2000);
    check('online: aviso some quando ele volta', $('vez').dataset.rede === 'on');
    // adversário sai
    conv.sair();
    await esperar(() => !$('avisoOnline').hidden, 2000);
    check('online: aviso quando o adversário sai', !$('avisoOnline').hidden && /saiu/.test($('avisoTitulo').textContent), $('avisoTitulo').textContent);
    $('avisoSim').click(); await dormir(30);
    check('online: "Ir para o início" fecha a sala', !$('telaInicio').hidden && sala === null);
    check('privacidade: ao sair, o chat some do aparelho', historicoChat.length === 0 && $('chatLista').children.length === 0 && $('miniLista').children.length === 0);
    await dormir(50);
    const sobras = Object.keys(broker.retidos).filter((k) => k.indexOf(conv.topico) === 0);
    check('privacidade: ao sair, nada da sala fica guardado no servidor', sobras.length === 0, sobras);
    // entrar pelo código: código inválido avisa
    irParaOnline('entrar'); $('campoCodigo').value = 'XX'; $('btnBuscarSala').click(); await dormir(30);
    check('online: código inválido mostra aviso', !$('erroOnline').hidden && /inválido/.test($('erroOnline').textContent), $('erroOnline').textContent);
    // entrar numa sala criada por outro (lado do convidado + Aceitar)
    const criador = robo('robo-criador');
    const rc = await criador.criar('D');
    $('campoCodigo').value = rc.codigo.toLowerCase(); $('btnBuscarSala').click();
    await esperar(() => $('telaOnline').dataset.etapa === 'confirmar', 3000);
    check('online: confirmação mostra que eu sou a Onça', $('ladoMeu').textContent === 'a Onça' && $('ladoOutro').textContent === 'os Cachorros', [$('ladoMeu').textContent, $('ladoOutro').textContent]);
    check('REG-002 layout: confirmação cabe na tela', vazamentos().length === 0, vazamentos());
    $('btnAceitar').click();
    await esperar(() => !$('telaPartida').hidden && partidaOnline === 1, 3000);
    check('online: aceitar começa a partida (eu = Onça)', !$('telaPartida').hidden && sala && sala.meuLado === 'J' && $('status').textContent === 'Sua vez (Onça)', $('status').textContent);
    await esperar(() => sala.adversarioOnline && criador.adversarioOnline, 100);
    check('REG-006 adversário aparece conectado logo ao aceitar (convidado e criador)', sala.adversarioOnline && criador.adversarioOnline && $('vez').dataset.rede === 'on',
      { eu: sala._diag(), criador: criador._diag() });
    // revanche trocando de lado (pedido do outro, eu aceito)
    criador.pedirRevanche(true);
    await esperar(() => !$('avisoOnline').hidden, 2000);
    check('online: pedido de revanche aparece', !$('avisoOnline').hidden && /Revanche/.test($('avisoTitulo').textContent));
    $('avisoSim').click();
    await esperar(() => partidaOnline === 2 && sala.meuLado === 'D', 2000);
    check('online: revanche trocando de lado (agora eu sou os Cachorros)', partidaOnline === 2 && sala.meuLado === 'D' && criador.meuLado === 'J' && $('status').textContent === 'Vez do adversário (Onça)',
      { status: $('status').textContent, advOnline: sala.adversarioOnline, conectado: sala.conectado, papel: sala.papel, criadorConectado: criador.conectado, eu: sala._diag(), robo: criador._diag() });
    criador.fechar();
    fabricaTransporte = (i) => ON.criarTransporteMqtt(ON.SERVIDORES[i]); opcoesSala = {};

    // telas
    irParaInicio();
    check('tela inicial volta', !$('telaInicio').hidden && $('telaPartida').hidden);
    irParaEscolha('pvp');
    check('tela "Quem é a Onça?" aparece no modo 2 jogadores', !$('escolha2J').hidden && $('escolhaIA').hidden);
  } catch (e) {
    rel.ok = false;
    rel.checks.push({ nome: 'exceção no autoteste', ok: false, info: String(e && e.stack || e) });
  }
  rel.errors = window.__errors.slice();
  if (rel.errors.length) rel.ok = false;
  rel.resumo = `${rel.checks.filter((c) => c.ok).length}/${rel.checks.length} verificações ok, ${rel.errors.length} erros de JS`;
  rel.tela = `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`;
  pre.textContent = 'SELFTEST ' + (rel.ok ? 'PASSOU' : 'FALHOU') + '\n' + JSON.stringify(rel, null, 1);
  document.documentElement.setAttribute('data-selftest', rel.ok ? 'passou' : 'falhou');
  // dentro da moldura de celular (iframe), manda o relatório para a página de fora
  try { if (window.parent !== window) window.parent.postMessage({ tipo: 'selftest', rel }, '*'); } catch (e) { /* ignorar */ }
}
