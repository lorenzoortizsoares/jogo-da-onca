/* =====================================================================
   Jogo da Onça — modo online (2 jogadores, cada um no seu celular)
   Sem conta: as mensagens passam por um servidor MQTT público gratuito
   (com um segundo servidor de reserva). Só os lances trafegam.

   Tópicos (PREFIXO + RESUMO-DO-CÓDIGO + '/...'; toda mensagem leva "mac", a assinatura HMAC):
     sala      (retido)  { v, criador:{id,lado}, convidado:{id}|null, status, servidor }
     estado    (retido)  { partida, seq, estado, lance, autor }
     pedido              { tipo:'entrar'|'cheia'|'revanche'|'revanche-resposta'|'sair', id, ... }
     presenca/<id>       { id, online }   (batidas periódicas + "testamento" ao cair)
   Script clássico: define window.OncaOnline.
   ===================================================================== */
(function (root) {
  'use strict';

  // v2 (REG-010): o código da sala NÃO aparece mais no servidor. O tópico é um resumo do código
  // (PBKDF2) e toda mensagem leva uma assinatura (HMAC) com chave tirada do código, que só os dois
  // jogadores conhecem. Antes, quem escutasse o servidor inteiro via o código e podia trocar a chave
  // do chat (lendo as mensagens) ou injetar um tabuleiro falso.
  var PREFIXO = 'jogodaonca-lz/v2/';
  var ITERACOES_SALA = 100000;
  var SAL_SALA = 'jogo-da-onca/sala/v2';
  var ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sem 0/O, 1/I/L (evita confusão ao digitar)
  var SERVIDORES = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var MQTT_JS = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
  // privacidade: nada fica guardado para sempre no servidor
  var EXPIRA_RETIDO_SEG = 6 * 3600;   // dados da sala somem sozinhos em 6 h (mesmo se ninguém "sair" direito)
  var EXPIRA_MSG_SEG = 120;           // mensagens de passagem (lances avisos, chat) nunca ficam guardadas
  var LIMITE_CHAT = 200;              // caracteres por mensagem
  var INFO_CHAT = 'jogo-da-onca/chat/v1';
  // lista de salas abertas (só as salas que quem criou marcou como "Pública")
  var LOBBY = PREFIXO + 'lobby/';
  var EXPIRA_LOBBY_SEG = 30 * 60;     // uma sala pública esperando some da lista em 30 min (é republicada enquanto espera)
  var LIMITE_APELIDO = 12;            // apelido do jogador (cabe no texto da vez do celular — REG-003)
  var LIMITE_NOME_SALA = 24;

  // ---------------------------------------------------------------- utilidades de criptografia
  function criptoDisponivel() { return !!(root.crypto && root.crypto.subtle && root.crypto.getRandomValues); }
  function paraB64(bytes) { var s = ''; var u = new Uint8Array(bytes); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function deB64(txt) { var s = atob(txt); var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function utf8(txt) { return new TextEncoder().encode(txt); }
  // REG-008: não usar caracteres invisíveis (U+2028/U+2029) dentro de expressões regulares no código:
  // eles contam como quebra de linha e derrubavam o módulo inteiro. Filtra por código numérico.
  function limparTexto(txt) {
    var s = String(txt == null ? '' : txt), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      out += (c < 32 || c === 127 || c === 0x2028 || c === 0x2029) ? ' ' : s.charAt(i);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function limparNome(txt, max) { return limparTexto(txt).slice(0, max || LIMITE_APELIDO).trim(); }

  function gerarCodigo(rng) {
    rng = rng || Math.random;
    var s = '';
    for (var i = 0; i < 6; i++) s += ALFABETO[Math.floor(rng() * ALFABETO.length)];
    return s;
  }
  function gerarId(rng) {
    rng = rng || Math.random;
    var s = 'j';
    for (var i = 0; i < 12; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)];
    return s;
  }
  function normalizarCodigo(txt) { return String(txt || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function codigoValido(c) {
    if (typeof c !== 'string' || c.length !== 6) return false;
    for (var i = 0; i < c.length; i++) if (ALFABETO.indexOf(c[i]) < 0) return false;
    return true;
  }
  function formatarCodigo(c) { return c ? c.slice(0, 3) + '-' + c.slice(3) : ''; }
  function oposto(lado) { return lado === 'J' ? 'D' : 'J'; }
  function copia(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  // ------------------------------------------------------------------ assinatura das mensagens (HMAC-SHA256)
  // Síncrono de propósito (JavaScript puro): assim a ordem das mensagens nunca embaralha.
  var K256 = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function ror(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(bytes) {
    var l = bytes.length, nb = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(nb), i;
    m.set(bytes); m[l] = 0x80;
    var bits = l * 8, alto = Math.floor(bits / 4294967296);
    m[nb - 8] = alto >>> 24; m[nb - 7] = (alto >>> 16) & 255; m[nb - 6] = (alto >>> 8) & 255; m[nb - 5] = alto & 255;
    m[nb - 4] = bits >>> 24; m[nb - 3] = (bits >>> 16) & 255; m[nb - 2] = (bits >>> 8) & 255; m[nb - 1] = bits & 255;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < nb; off += 64) {
      for (i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
      for (i = 16; i < 64; i++) {
        var s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        var t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = new Uint8Array(32);
    for (i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = (H[i] >>> 16) & 255; out[4 * i + 2] = (H[i] >>> 8) & 255; out[4 * i + 3] = H[i] & 255; }
    return out;
  }
  function hex(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); return s; }
  function hmacHex(chave, texto) {
    var k = new Uint8Array(64), msg = utf8(texto), i;
    k.set(chave.length > 64 ? sha256(chave) : chave);
    var dentro = new Uint8Array(64 + msg.length), fora = new Uint8Array(96);
    for (i = 0; i < 64; i++) { dentro[i] = k[i] ^ 0x36; fora[i] = k[i] ^ 0x5c; }
    dentro.set(msg, 64);
    fora.set(sha256(dentro), 64);
    return hex(sha256(fora));
  }
  // JSON com as chaves em ordem: o mesmo objeto vira sempre o mesmo texto (para assinar e conferir)
  function canonico(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
    return '{' + Object.keys(v).filter(function (k) { return v[k] !== undefined; }).sort().map(function (k) { return JSON.stringify(k) + ':' + canonico(v[k]); }).join(',') + '}';
  }
  function assinatura(chave, sufixo, dados) { return hmacHex(chave, sufixo + '\n' + canonico(dados)); }
  function iguais(a, b) {   // comparação sem atalho (tempo constante)
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }
  // código da sala -> { topico (resumo, o servidor nunca vê o código), chaveMac (assina as mensagens) }
  function derivarSala(codigo, iteracoes) {
    if (!criptoDisponivel()) return Promise.reject(new Error('navegador sem criptografia'));
    var subtle = root.crypto.subtle;
    return subtle.importKey('raw', utf8(codigo), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: utf8(SAL_SALA), iterations: iteracoes || ITERACOES_SALA }, k, 384); })
      .then(function (bits) {
        var b = new Uint8Array(bits);
        return { topico: PREFIXO + hex(b.slice(0, 16)) + '/', chaveMac: b.slice(16, 48) };
      });
  }

  // ------------------------------------------------------------------ biblioteca MQTT (carregada só quando precisa)
  var carregando = null;
  function carregarMqtt() {
    if (root.mqtt) return Promise.resolve(root.mqtt);
    if (carregando) return carregando;
    carregando = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = MQTT_JS;
      s.onload = function () { root.mqtt ? resolve(root.mqtt) : reject(new Error('biblioteca de conexão inválida')); };
      s.onerror = function () { carregando = null; reject(new Error('sem internet para carregar a conexão')); };
      document.head.appendChild(s);
    });
    return carregando;
  }

  // ------------------------------------------------------------------ transporte real (MQTT sobre WebSocket)
  function criarTransporteMqtt(url) {
    var cli = null, aoMsg = function () {}, aoEst = function () {};
    return {
      nome: url,
      conectar: function (id, opcoes) {
        return carregarMqtt().then(function (mqtt) {
          return new Promise(function (resolve, reject) {
            var feito = false;
            var will = opcoes && opcoes.will;
            cli = mqtt.connect(url, {
              clientId: id + '-' + Math.random().toString(36).slice(2, 7),
              protocolVersion: 5,          // MQTT 5: permite validade (expiração) nas mensagens guardadas
              clean: true, keepalive: 20, connectTimeout: 7000, reconnectPeriod: 2500, resubscribe: true,
              will: will ? { topic: will.topico, payload: JSON.stringify(will.dados), qos: 1, retain: false, properties: { messageExpiryInterval: EXPIRA_MSG_SEG } } : undefined
            });
            cli.on('connect', function () { aoEst(true); if (!feito) { feito = true; resolve(); } });
            cli.on('offline', function () { aoEst(false); });
            cli.on('close', function () { aoEst(false); });
            cli.on('error', function (e) { if (!feito) { feito = true; try { cli.end(true); } catch (x) { /* */ } reject(e); } });
            cli.on('message', function (t, buf) {
              var s = buf ? buf.toString() : '';
              if (!s) { aoMsg(t, null); return; }   // mensagem vazia = algo guardado foi apagado (ex.: sala saiu da lista)
              var o; try { o = JSON.parse(s); } catch (e) { return; }
              aoMsg(t, o);
            });
            setTimeout(function () { if (!feito) { feito = true; try { cli.end(true); } catch (x) { /* */ } reject(new Error('tempo esgotado')); } }, 8000);
          });
        });
      },
      publicar: function (t, obj, o) {
        if (!cli) return;
        var props = o && o.expiraSeg ? { messageExpiryInterval: o.expiraSeg } : undefined;
        cli.publish(t, obj == null ? '' : JSON.stringify(obj), { qos: 1, retain: !!(o && o.reter), properties: props });
      },
      assinar: function (filtro) { if (cli) cli.subscribe(filtro, { qos: 1 }); },
      aoMensagem: function (cb) { aoMsg = cb; },
      aoConexao: function (cb) { aoEst = cb; },
      // volta a conectar na hora (o app voltou para a tela); sem isso o celular demora até perceber
      reconectar: function () { if (cli && !cli.connected && !cli.reconnecting) { try { cli.reconnect(); } catch (e) { /* */ } } },
      desconectar: function () { if (cli) { try { cli.end(true); } catch (e) { /* */ } } cli = null; }
    };
  }

  // ------------------------------------------------------------------ servidor em memória (testes, sem internet)
  function casaTopico(filtro, topico) {
    var f = filtro.split('/'), t = topico.split('/');
    for (var i = 0; i < f.length; i++) {
      if (f[i] === '#') return true;
      if (i >= t.length) return false;
      if (f[i] !== '+' && f[i] !== t[i]) return false;
    }
    return f.length === t.length;
  }
  function criarBrokerMemoria() {
    var retidos = {}, clientes = [], publicacoes = [];   // publicacoes: tudo o que passou pelo "servidor" (para os testes de privacidade)
    var depois = function (fn) { setTimeout(fn, 0); };
    function entregar(topico, msg) {
      clientes.forEach(function (c) {
        if (!c.ligado) return;
        if (c.filtros.some(function (f) { return casaTopico(f, topico); })) depois(function () { if (c.ligado) c.aoMsg(topico, copia(msg)); });
      });
    }
    function entregarRetidos(c, filtro) {
      Object.keys(retidos).forEach(function (t) { if (casaTopico(filtro, t)) { var m = retidos[t]; depois(function () { if (c.ligado) c.aoMsg(t, copia(m)); }); } });
    }
    return {
      retidos: retidos,
      publicacoes: publicacoes,
      criarTransporte: function () {
        var c = { ligado: false, filtros: [], will: null, aoMsg: function () {}, aoEst: function () {} };
        clientes.push(c);
        var tr = {
          nome: 'memoria',
          conectar: function (id, opcoes) { c.will = opcoes && opcoes.will; c.ligado = true; depois(function () { c.aoEst(true); }); return Promise.resolve(); },
          publicar: function (t, obj, o) {
            if (c.caido) return;   // como no servidor real: quem caiu não publica nada
            var msg = copia(obj);
            publicacoes.push({ topico: t, msg: copia(msg), opcoes: copia(o || {}) });
            if (o && o.reter) { if (msg == null) delete retidos[t]; else retidos[t] = msg; }
            if (msg != null || (o && o.reter)) entregar(t, msg);   // apagar algo guardado também avisa quem está ouvindo
          },
          assinar: function (filtro) { c.filtros.push(filtro); entregarRetidos(c, filtro); },
          aoMensagem: function (cb) { c.aoMsg = cb; },
          aoConexao: function (cb) { c.aoEst = cb; },
          desconectar: function () { c.ligado = false; },
          reconectar: function () {},
          // só para testes: queda de conexão (dispara o testamento) e volta
          cair: function () { if (!c.ligado) return; c.ligado = false; c.caido = true; if (c.will) entregar(c.will.topico, c.will.dados); c.aoEst(false); },
          voltar: function () { c.ligado = true; c.caido = false; c.aoEst(true); c.filtros.forEach(function (f) { entregarRetidos(c, f); }); }
        };
        return tr;
      }
    };
  }

  // ------------------------------------------------------------------ sala (sessão de um jogador)
  // opcoes: { id, criarTransporte(indiceServidor) -> transporte, initialState() -> estado inicial,
  //           batidaMs (8000), ausenciaMs (20000), esperaSalaMs (4500) }
  function criarSala(opcoes) {
    // iteracoesSala: só os testes simulados usam menos (o "tempo virtual" do Chrome de teste não espera o PBKDF2)
    var o = Object.assign({ batidaMs: 8000, ausenciaMs: 20000, esperaSalaMs: 4500, iteracoesSala: ITERACOES_SALA }, opcoes || {});
    var eventos = {};
    var s = {
      id: o.id || gerarId(), codigo: null, servidor: 0, transporte: null,
      info: null, estado: null, conectado: false, adversarioOnline: false, ultimaBatida: 0,
      relogios: [], encerrada: false,
      // chat criptografado de ponta a ponta (ECDH P-256 -> HKDF-SHA256 -> AES-GCM 256)
      par: null, minhaPub: null, pubAdv: null, chaveChat: null, contChat: 0, ultimoN: -1,
      chatRejeitadas: 0, filaChat: Promise.resolve(), geracaoChave: 0
    };
    function emitir(nome, dado) { (eventos[nome] || []).slice().forEach(function (cb) { cb(dado); }); }
    function base() { return s.topico || ''; }
    function agora() { return Date.now(); }
    // calcula o tópico e a chave de assinatura a partir do código (o servidor nunca vê o código)
    function prepararSala() {
      var codigo = s.codigo;
      return derivarSala(codigo, o.iteracoesSala).then(function (d) {
        if (s.codigo === codigo) { s.topico = d.topico; s.chaveMac = d.chaveMac; }
      });
    }
    function assinar(sufixo, dados) {
      if (dados == null) return dados;
      var limpo = Object.assign({}, dados); delete limpo.mac;
      limpo.mac = assinatura(s.chaveMac, sufixo, limpo);
      return limpo;
    }
    // retidos (sala, estado, chaves) expiram sozinhos; o resto é só "de passagem"
    function publicar(sufixo, dados, reter) {
      if (s.transporte && s.chaveMac) s.transporte.publicar(base() + sufixo, assinar(sufixo, dados), { reter: !!reter, expiraSeg: reter ? EXPIRA_RETIDO_SEG : EXPIRA_MSG_SEG });
    }

    // ---- chaves do chat: cada aparelho gera um par só seu; a chave secreta nunca passa pelo servidor
    function prepararChave() {
      if (s.par || !criptoDisponivel() || !papel()) return;
      var subtle = root.crypto.subtle;
      s.par = subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']).then(function (par) {
        return subtle.exportKey('raw', par.publicKey).then(function (raw) {
          if (s.encerrada || s.fimSala) return par;
          s.minhaPub = paraB64(raw);
          publicar('chave/' + s.id, { id: s.id, pub: s.minhaPub }, true);
          derivar();
          return par;
        });
      });
    }
    function derivar() {
      if (!s.par || !s.pubAdv || !s.minhaPub) return;
      var subtle = root.crypto.subtle, pubAdv = s.pubAdv, geracao = ++s.geracaoChave;
      var ids = [s.id, idAdversario()].sort().join('|');
      s.par.then(function (par) {
        return subtle.importKey('raw', deB64(pubAdv), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
          .then(function (pub) { return subtle.deriveBits({ name: 'ECDH', public: pub }, par.privateKey, 256); })
          .then(function (bits) { return subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']); })
          .then(function (hk) {
            return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(s.codigo), info: utf8(INFO_CHAT + '|' + ids) },
              hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          });
      }).then(function (chave) {
        if (geracao !== s.geracaoChave || s.encerrada) return;
        s.chaveChat = chave; s.ultimoN = -1;
        emitir('chat-pronto', true);
      }, function () { s.chaveChat = null; });
    }
    function decifrarChat(msg) {
      var chave = s.chaveChat;
      if (!chave) { s.chatRejeitadas++; return Promise.resolve(); }
      var iv, ct;
      try { iv = deB64(msg.iv); ct = deB64(msg.ct); } catch (e) { s.chatRejeitadas++; return Promise.resolve(); }
      if (iv.length !== 12 || ct.length < 17 || ct.length > 2048) { s.chatRejeitadas++; return Promise.resolve(); }
      return root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(s.codigo + '|' + msg.id) }, chave, ct)
        .then(function (claro) {
          var d = JSON.parse(new TextDecoder().decode(claro));
          var texto = limparTexto(d && d.t);
          // contador crescente: mensagem repetida (replay) ou fora de ordem é descartada
          if (!texto || texto.length > LIMITE_CHAT || typeof d.n !== 'number' || !(d.n > s.ultimoN) || chave !== s.chaveChat) { s.chatRejeitadas++; return; }
          s.ultimoN = d.n;
          emitir('chat', { meu: false, lado: oposto(meuLado()), texto: texto, ts: Date.now() });
        })
        .catch(function () { s.chatRejeitadas++; });   // adulterada, chave errada ou lixo
    }

    function meuLado() {
      if (!s.info || !s.info.criador) return null;
      if (s.info.criador.id === s.id) return s.info.criador.lado;
      if (s.info.convidado && s.info.convidado.id === s.id) return oposto(s.info.criador.lado);
      return null;
    }
    function papel() {
      if (!s.info) return null;
      if (s.info.criador && s.info.criador.id === s.id) return 'criador';
      if (s.info.convidado && s.info.convidado.id === s.id) return 'convidado';
      return null;
    }
    function idAdversario() {
      if (!s.info) return null;
      if (papel() === 'criador') return s.info.convidado ? s.info.convidado.id : null;
      if (papel() === 'convidado') return s.info.criador.id;
      return null;
    }
    function ehJogador(id) { return !!s.info && ((s.info.criador && s.info.criador.id === id) || (s.info.convidado && s.info.convidado.id === id)); }

    function receber(topico, msg) {
      if (s.encerrada || !msg || typeof msg !== 'object' || !s.topico || topico.indexOf(base()) !== 0) return;
      var resto = topico.slice(base().length);
      // REG-010: sem a assinatura certa (de quem sabe o código), a mensagem é descartada
      var dados = Object.assign({}, msg); delete dados.mac;
      if (!s.chaveMac || !iguais(msg.mac, assinatura(s.chaveMac, resto, dados))) {
        s.rejeitadas = (s.rejeitadas || 0) + 1;
        if (resto === 'chat') s.chatRejeitadas++;
        return;
      }
      tratar(resto, dados);
    }
    // mensagem já conferida (assinatura ok)
    function tratar(resto, msg) {
      if (s.encerrada) return;
      if (resto === 'sala') {
        var advAntes = idAdversario();
        s.info = msg;
        // REG-006: acabei de descobrir quem é o adversário -> bato na hora (senão ele me
        // veria como "desconectado" até a próxima batida periódica)
        if (!advAntes && idAdversario()) bater();
        prepararChave();
        if (s.chavesRecebidas && idAdversario() && s.chavesRecebidas[idAdversario()] && s.pubAdv !== s.chavesRecebidas[idAdversario()]) {
          s.pubAdv = s.chavesRecebidas[idAdversario()]; derivar();
        }
        emitir('sala', msg);
        // o estado pode ter chegado antes da sala: processa agora
        if (s.estadoPendente) { var p = s.estadoPendente; s.estadoPendente = null; tratar('estado', p); }
        return;
      }
      if (resto === 'estado') {
        if (!s.info) { s.estadoPendente = msg; return; }
        if (!ehJogador(msg.autor)) return;                       // mensagem de estranho: ignora
        var ant = s.estado;
        var novo = !ant || msg.partida > ant.partida || (msg.partida === ant.partida && msg.seq > ant.seq);
        if (!novo) return;
        s.estado = msg;
        emitir('estado', { msg: msg, anterior: ant, meu: msg.autor === s.id });
        return;
      }
      if (resto === 'pedido') { if (msg.id !== s.id) tratarPedido(msg); return; }
      if (resto.indexOf('chave/') === 0) {
        // chave pública de um jogador (retida): guardo por id e derivo quando for a do adversário
        if (typeof msg.id !== 'string' || typeof msg.pub !== 'string' || msg.pub.length > 200 || msg.id === s.id || resto !== 'chave/' + msg.id) return;
        s.chavesRecebidas = s.chavesRecebidas || {};
        s.chavesRecebidas[msg.id] = msg.pub;
        if (msg.id === idAdversario() && msg.pub !== s.pubAdv) {
          s.pubAdv = msg.pub; s.chaveChat = null; derivar();
          // o adversário trocou de chave (recarregou): republico a minha, caso a guardada tenha sido apagada/sobrescrita
          if (s.minhaPub && !s.fimSala) publicar('chave/' + s.id, { id: s.id, pub: s.minhaPub }, true);
        }
        return;
      }
      if (resto === 'chat') {
        if (msg.id === s.id || msg.id !== idAdversario() || typeof msg.iv !== 'string' || typeof msg.ct !== 'string') return;
        s.filaChat = s.filaChat.then(function () { return decifrarChat(msg); });   // decifra na ordem de chegada
        return;
      }
      if (resto.indexOf('presenca/') === 0) {
        if (msg.id === s.id || msg.id !== idAdversario()) return;
        s.batidasRecebidas = (s.batidasRecebidas || 0) + 1;
        if (msg.online !== false) marcarPresenca(msg.id);
        else if (s.adversarioOnline) { s.adversarioOnline = false; emitir('presenca', false); }
      }
    }

    // sinal de vida do adversário (batida, ou qualquer pedido novo vindo dele)
    function marcarPresenca(id) {
      if (!id || id !== idAdversario()) return;
      s.ultimaBatida = agora();
      if (!s.adversarioOnline) { s.adversarioOnline = true; emitir('presenca', true); }
    }
    // fora da tela (app em segundo plano): avisa "fora" e não deixa as batidas dizerem o contrário
    function bater() { s.batidasEnviadas = (s.batidasEnviadas || 0) + 1; publicar('presenca/' + s.id, { id: s.id, online: !s.ausente }); }

    // ---- lista de salas abertas (só sala pública, só enquanto espera o 2º jogador)
    function publicarLobby() {
      if (!s.lobbyId || !s.transporte || !s.info || s.info.status !== 'aguardando') return;
      s.transporte.publicar(LOBBY + s.lobbyId, {
        codigo: s.codigo, nome: s.info.nome || '', apelido: s.info.criador.apelido || '', lado: s.info.criador.lado,
        servidor: s.servidor, t: agora()
      }, { reter: true, expiraSeg: EXPIRA_LOBBY_SEG });
    }
    function limparLobby() {
      if (!s.lobbyId || !s.transporte) return;
      s.transporte.publicar(LOBBY + s.lobbyId, null, { reter: true });
      s.lobbyId = null;
    }

    function tratarPedido(p) {
      if (p.tipo === 'entrar') {
        if (papel() !== 'criador') return;
        if (s.info.status === 'aguardando') {
          s.info = Object.assign({}, s.info, { convidado: { id: p.id, apelido: limparNome(p.apelido) }, status: 'jogando' });
          limparLobby();          // a sala encheu: sai da lista de salas abertas
          publicar('sala', s.info, true);
          publicar('estado', { partida: 1, seq: 0, estado: o.initialState(), lance: null, autor: s.id }, true);
          marcarPresenca(p.id);   // REG-006: o pedido de entrada já prova que ele está online
          bater();                // e ele recebe a minha batida logo depois da sala
          if (s.chavesRecebidas && s.chavesRecebidas[p.id]) { s.pubAdv = s.chavesRecebidas[p.id]; derivar(); }
        } else if (!s.info.convidado || s.info.convidado.id !== p.id) {
          publicar('pedido', { tipo: 'cheia', id: s.id, para: p.id });
        }
        return;
      }
      if (p.para && p.para !== s.id) return;
      if (!ehJogador(p.id) && p.tipo !== 'cheia') return;
      if (p.tipo !== 'sair') marcarPresenca(p.id);
      if (p.tipo === 'cheia') emitir('cheia', true);
      else if (p.tipo === 'revanche') emitir('pedido-revanche', { trocar: !!p.trocar });
      else if (p.tipo === 'revanche-resposta') emitir('resposta-revanche', { aceitar: !!p.aceitar });
      else if (p.tipo === 'sair') { s.adversarioOnline = false; emitir('saiu', { temporario: !!p.temporario, inativo: !!p.inativo }); }
      else if (p.tipo === 'encerrada') {
        // a partida acabou sem vencedor: apago a minha chave guardada e não publico mais nada da sala
        s.fimSala = true; s.adversarioOnline = false; publicar('chave/' + s.id, null, true); emitir('encerrada', true);
      }
    }

    function iniciarBatidas() {
      pararBatidas();
      bater();
      s.relogios.push(setInterval(bater, o.batidaMs));
      s.relogios.push(setInterval(function () {
        if (s.adversarioOnline && agora() - s.ultimaBatida > o.ausenciaMs) { s.adversarioOnline = false; emitir('presenca', false); }
      }, Math.max(250, Math.floor(o.batidaMs / 2))));
      publicarLobby();
      s.relogios.push(setInterval(publicarLobby, EXPIRA_LOBBY_SEG * 1000 / 3));   // sala pública esperando continua na lista
    }
    function pararBatidas() { s.relogios.forEach(clearInterval); s.relogios = []; }
    // privacidade: a sala acabou -> apaga tudo o que ficou guardado no servidor
    function apagarSala() {
      var adv = idAdversario();
      publicar('sala', null, true);
      publicar('estado', null, true);
      publicar('chave/' + s.id, null, true);
      if (adv) publicar('chave/' + adv, null, true);
    }

    function ligar(indice) {
      if (s.transporte) s.transporte.desconectar();
      s.servidor = indice;
      s.transporte = o.criarTransporte(indice);
      s.transporte.aoMensagem(receber);
      s.transporte.aoConexao(function (ok) {
        s.conectado = ok;
        emitir('conexao', ok);
        if (ok) iniciarBatidas();
      });
      return s.transporte.conectar(s.id, { will: { topico: base() + 'presenca/' + s.id, dados: assinar('presenca/' + s.id, { id: s.id, online: false }) } })
        .then(function () { s.transporte.assinar(base() + '#'); });
    }
    // tenta o servidor principal e, se falhar, o de reserva
    function ligarAlgum(indices) {
      var i = 0;
      var tentar = function (erroAnterior) {
        if (i >= indices.length) return Promise.reject(erroAnterior || new Error('sem conexão'));
        var idx = indices[i++];
        return ligar(idx).catch(function (e) { return tentar(e); });
      };
      return tentar();
    }
    // espera a informação da sala (mensagem retida) chegar
    function esperarSala(ms) {
      return new Promise(function (resolve) {
        if (s.info) { resolve(s.info); return; }
        var t = setTimeout(function () { desl(); resolve(null); }, ms);
        var cb = function (info) { clearTimeout(t); desl(); resolve(info); };
        var desl = function () { eventos.sala = (eventos.sala || []).filter(function (x) { return x !== cb; }); };
        (eventos.sala = eventos.sala || []).push(cb);
      });
    }

    var api = {
      get id() { return s.id; },
      get codigo() { return s.codigo; },
      get topico() { return s.topico; },     // resumo do código (é o que o servidor vê)
      get servidor() { return s.servidor; },
      get info() { return s.info; },
      get estado() { return s.estado; },
      get conectado() { return s.conectado; },
      get adversarioOnline() { return s.adversarioOnline; },
      get meuLado() { return meuLado(); },
      get papel() { return papel(); },
      get chatPronto() { return !!s.chaveChat; },
      get chatDisponivel() { return criptoDisponivel(); },
      on: function (nome, cb) { (eventos[nome] = eventos[nome] || []).push(cb); return api; },

      // chat: só sai do aparelho criptografado (AES-GCM com a chave combinada pelos dois)
      enviarChat: function (txt) {
        var texto = limparTexto(txt);
        if (!texto) return Promise.resolve({ ok: false, motivo: 'vazio' });
        if (texto.length > LIMITE_CHAT) return Promise.resolve({ ok: false, motivo: 'longo' });
        if (!criptoDisponivel()) return Promise.resolve({ ok: false, motivo: 'sem-cripto' });
        if (!s.chaveChat || !idAdversario()) return Promise.resolve({ ok: false, motivo: 'chave' });
        var chave = s.chaveChat, n = ++s.contChat;
        var iv = root.crypto.getRandomValues(new Uint8Array(12));
        var claro = utf8(JSON.stringify({ t: texto, n: n }));
        return root.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: utf8(s.codigo + '|' + s.id) }, chave, claro)
          .then(function (ct) {
            publicar('chat', { id: s.id, iv: paraB64(iv), ct: paraB64(ct) }, false);
            emitir('chat', { meu: true, lado: meuLado(), texto: texto, ts: Date.now() });
            return { ok: true };
          }, function () { return { ok: false, motivo: 'erro' }; });
      },

      // cria uma sala nova; quem cria escolhe o lado
      // extras: { apelido, nomeSala, publica } — sala pública aparece na lista de salas abertas
      criar: function (lado, codigo, extras) {
        var x = extras || {};
        s.codigo = codigo || gerarCodigo();
        return prepararSala().then(function () { return ligarAlgum([0, 1]); }).then(function () {
          s.info = {
            v: 1, nome: limparNome(x.nomeSala, LIMITE_NOME_SALA), publica: !!x.publica,
            criador: { id: s.id, lado: lado === 'J' ? 'J' : 'D', apelido: limparNome(x.apelido) },
            convidado: null, status: 'aguardando', servidor: s.servidor, t: agora()
          };
          publicar('sala', s.info, true);
          publicar('estado', null, true);   // limpa partida antiga com o mesmo código (improvável)
          prepararChave();
          if (s.info.publica) { s.lobbyId = s.topico.slice(PREFIXO.length).replace(/\/$/, ''); publicarLobby(); }
          return { codigo: s.codigo, topico: s.topico };
        });
      },
      // procura uma sala pelo código (no principal e depois no de reserva)
      consultar: function (codigo, servidorPreferido) {
        s.codigo = normalizarCodigo(codigo);
        if (!codigoValido(s.codigo)) return Promise.resolve({ existe: false, invalido: true });
        var ordem = servidorPreferido === 1 ? [1, 0] : [0, 1];
        var k = 0;
        var proximo = function () {
          if (k >= ordem.length) return Promise.resolve({ existe: false });
          var idx = ordem[k++];
          return ligar(idx).then(function () { return esperarSala(o.esperaSalaMs); }, function () { return null; })
            .then(function (info) {
              if (!info) return proximo();
              var p = papel();
              return {
                existe: true, info: info, status: info.status,
                souJogador: !!p, papel: p,
                ladoCriador: info.criador.lado, meuLado: p ? meuLado() : oposto(info.criador.lado),
                cheia: info.status !== 'aguardando' && !p
              };
            });
        };
        return prepararSala().then(proximo);
      },
      // depois de consultar: o convidado aceita e entra
      entrar: function (tempoMs, apelido) {
        return new Promise(function (resolve, reject) {
          var feito = false;
          var fim = function (fn, v) { if (!feito) { feito = true; clearTimeout(t); fn(v); } };
          var t = setTimeout(function () { fim(reject, new Error('a sala não respondeu')); }, tempoMs || 10000);
          api.on('sala', function (info) { if (info.status === 'jogando' && info.convidado && info.convidado.id === s.id) fim(resolve, info); });
          api.on('cheia', function () { fim(reject, new Error('sala cheia')); });
          if (s.info && s.info.status === 'jogando' && papel()) { fim(resolve, s.info); return; }
          publicar('pedido', { tipo: 'entrar', id: s.id, apelido: limparNome(apelido) });
        });
      },
      // volta para uma sala da qual este aparelho já faz parte (recarregou a página)
      reconectar: function (codigo, servidor) {
        return api.consultar(codigo, servidor).then(function (r) {
          if (!r.existe || !r.souJogador) return Object.assign({}, r, { ok: false });
          return Object.assign({}, r, { ok: true });
        });
      },
      // publica o estado depois de um lance meu
      jogar: function (lance, novoEstado) {
        var ant = s.estado || { partida: 1, seq: 0 };
        var msg = { partida: ant.partida, seq: ant.seq + 1, estado: copia(novoEstado), lance: copia(lance), autor: s.id };
        s.estado = msg;
        publicar('estado', msg, true);
        return msg;
      },
      pedirRevanche: function (trocar) { publicar('pedido', { tipo: 'revanche', id: s.id, trocar: !!trocar }); },
      responderRevanche: function (aceitar, trocar) {
        if (aceitar) {
          if (trocar && s.info) {
            s.info = Object.assign({}, s.info, { criador: Object.assign({}, s.info.criador, { lado: oposto(s.info.criador.lado) }) });   // mantém o apelido
            publicar('sala', s.info, true);
          }
          var ant = s.estado || { partida: 0 };
          publicar('estado', { partida: ant.partida + 1, seq: 0, estado: o.initialState(), lance: null, autor: s.id }, true);
        }
        publicar('pedido', { tipo: 'revanche-resposta', id: s.id, aceitar: !!aceitar });
      },
      // opcoes.temporario: saí no meio da partida e posso voltar (a sala continua guardada; o outro
      // espera até 1 min + 1 min). Sem isso (partida acabou / ninguém entrou): apaga tudo do servidor.
      sair: function (opcoes) {
        if (!s.transporte) return;
        var op = opcoes || {};
        var jogador = !!papel(), adv = idAdversario();
        var temporario = !!op.temporario && jogador && !!adv && !!s.info && s.info.status === 'jogando';
        publicar('pedido', { tipo: 'sair', id: s.id, temporario: temporario, inativo: !!op.inativo });
        publicar('presenca/' + s.id, { id: s.id, online: false });
        limparLobby();
        if (jogador && !temporario) apagarSala();
        api.fechar();
      },
      // fim sem vencedor (o outro não voltou a tempo): avisa e apaga tudo o que ficou no servidor
      encerrar: function () {
        if (!s.transporte) return;
        s.fimSala = true;
        publicar('pedido', { tipo: 'encerrada', id: s.id });
        limparLobby();
        if (papel()) apagarSala();
        api.fechar();
      },
      // o app saiu da tela (true) ou voltou (false)
      ausente: function (fora) {
        s.ausente = !!fora;
        if (!s.transporte) return;
        if (!fora && s.transporte.reconectar) s.transporte.reconectar();
        bater();
      },
      get apelidos() {
        var i = s.info || {}, eu = papel(), cri = (i.criador && i.criador.apelido) || '', conv = (i.convidado && i.convidado.apelido) || '';
        return { meu: eu === 'criador' ? cri : eu === 'convidado' ? conv : '', adversario: eu === 'criador' ? conv : eu === 'convidado' ? cri : '' };
      },
      fechar: function () {
        s.encerrada = true;
        pararBatidas();
        // apaga os segredos do chat da memória
        s.par = null; s.chaveChat = null; s.minhaPub = null; s.pubAdv = null; s.chavesRecebidas = null;
        if (s.chaveMac) s.chaveMac.fill(0);
        var tr = s.transporte; s.transporte = null;
        if (tr) setTimeout(function () { tr.desconectar(); }, 150);
      },
      _transporte: function () { return s.transporte; },  // testes
      _diag: function () { return { ultimaBatida: s.ultimaBatida, agora: agora(), idAdversario: idAdversario(), batidasRecebidas: s.batidasRecebidas || 0, batidasEnviadas: s.batidasEnviadas || 0, relogios: s.relogios.length, codigo: s.codigo, temTransporte: !!s.transporte, chatPronto: !!s.chaveChat, chatRejeitadas: s.chatRejeitadas }; }
    };
    return api;
  }

  // ------------------------------------------------------------------ lista de salas abertas
  // Escuta os dois servidores (a sala pode estar no de reserva). Só leitura: não publica nada.
  // opcoes: { criarTransporte(indice) }. Eventos: 'salas' (lista atualizada).
  function criarLobby(opcoes) {
    var salas = {}, cbs = [], transportes = [];
    function valida(m) {
      return m && typeof m === 'object' && codigoValido(m.codigo) && (m.lado === 'J' || m.lado === 'D') &&
        (m.servidor === 0 || m.servidor === 1) && typeof m.t === 'number' && Date.now() - m.t < EXPIRA_LOBBY_SEG * 1000 + 60000;
    }
    function lista() {
      return Object.keys(salas).map(function (k) { return salas[k]; })
        .filter(function (m) { return Date.now() - m.t < EXPIRA_LOBBY_SEG * 1000 + 60000; })
        .sort(function (a, b) { return b.t - a.t; }).slice(0, 30);
    }
    function avisar() { var l = lista(); cbs.forEach(function (cb) { cb(l); }); }
    function chegou(topico, m) {
      if (topico.indexOf(LOBBY) !== 0) return;
      var id = topico.slice(LOBBY.length);
      if (!m) { if (salas[id]) { delete salas[id]; avisar(); } return; }
      if (!valida(m)) return;
      salas[id] = { id: id, codigo: m.codigo, servidor: m.servidor, lado: m.lado, t: m.t,
        nome: limparNome(m.nome, LIMITE_NOME_SALA), apelido: limparNome(m.apelido) };
      avisar();
    }
    return {
      abrir: function () {
        var tentativas = [0, 1].map(function (i) {
          var tr = opcoes.criarTransporte(i);
          tr.aoMensagem(chegou);
          tr.aoConexao(function () {});
          return tr.conectar('lista-' + gerarId(), {}).then(function () { transportes.push(tr); tr.assinar(LOBBY + '+'); return true; }, function () { return false; });
        });
        return Promise.all(tentativas).then(function (r) { if (!r.some(Boolean)) throw new Error('sem conexão'); return lista(); });
      },
      on: function (nome, cb) { if (nome === 'salas') cbs.push(cb); },
      get salas() { return lista(); },
      fechar: function () { transportes.forEach(function (tr) { tr.desconectar(); }); transportes = []; cbs = []; }
    };
  }

  var OncaOnline = {
    PREFIXO: PREFIXO, ALFABETO: ALFABETO, SERVIDORES: SERVIDORES,
    EXPIRA_RETIDO_SEG: EXPIRA_RETIDO_SEG, EXPIRA_MSG_SEG: EXPIRA_MSG_SEG, LIMITE_CHAT: LIMITE_CHAT,
    gerarCodigo: gerarCodigo, gerarId: gerarId, normalizarCodigo: normalizarCodigo, codigoValido: codigoValido,
    formatarCodigo: formatarCodigo, oposto: oposto, casaTopico: casaTopico, limparTexto: limparTexto,
    criptoDisponivel: criptoDisponivel, paraB64: paraB64, deB64: deB64,
    derivarSala: derivarSala, hmacHex: hmacHex, assinatura: assinatura, canonico: canonico,
    criarTransporteMqtt: criarTransporteMqtt, criarBrokerMemoria: criarBrokerMemoria, criarSala: criarSala, criarLobby: criarLobby,
    LOBBY: LOBBY, LIMITE_APELIDO: LIMITE_APELIDO, LIMITE_NOME_SALA: LIMITE_NOME_SALA, limparNome: limparNome,
    carregarMqtt: carregarMqtt
  };
  root.OncaOnline = OncaOnline;
})(typeof self !== 'undefined' ? self : this);
