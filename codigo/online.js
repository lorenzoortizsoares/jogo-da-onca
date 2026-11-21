/* =====================================================================
   Jogo da Onça — modo online (2 jogadores, cada um no seu celular)
   Sem conta: as mensagens passam por um servidor MQTT público gratuito
   (com um segundo servidor de reserva). Só os lances trafegam.

   Tópicos (PREFIXO + CÓDIGO + '/...'):
     sala      (retido)  { v, criador:{id,lado}, convidado:{id}|null, status, servidor }
     estado    (retido)  { partida, seq, estado, lance, autor }
     pedido              { tipo:'entrar'|'cheia'|'revanche'|'revanche-resposta'|'sair', id, ... }
     presenca/<id>       { id, online }   (batidas periódicas + "testamento" ao cair)
   Script clássico: define window.OncaOnline.
   ===================================================================== */
(function (root) {
  'use strict';

  var PREFIXO = 'jogodaonca-lz/v1/';
  var ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sem 0/O, 1/I/L (evita confusão ao digitar)
  var SERVIDORES = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var MQTT_JS = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';

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
              clean: true, keepalive: 20, connectTimeout: 7000, reconnectPeriod: 2500, resubscribe: true,
              will: will ? { topic: will.topico, payload: JSON.stringify(will.dados), qos: 1, retain: false } : undefined
            });
            cli.on('connect', function () { aoEst(true); if (!feito) { feito = true; resolve(); } });
            cli.on('offline', function () { aoEst(false); });
            cli.on('close', function () { aoEst(false); });
            cli.on('error', function (e) { if (!feito) { feito = true; try { cli.end(true); } catch (x) { /* */ } reject(e); } });
            cli.on('message', function (t, buf) {
              var s = buf ? buf.toString() : '';
              if (!s) return;
              var o; try { o = JSON.parse(s); } catch (e) { return; }
              aoMsg(t, o);
            });
            setTimeout(function () { if (!feito) { feito = true; try { cli.end(true); } catch (x) { /* */ } reject(new Error('tempo esgotado')); } }, 8000);
          });
        });
      },
      publicar: function (t, obj, o) { if (cli) cli.publish(t, obj == null ? '' : JSON.stringify(obj), { qos: 1, retain: !!(o && o.reter) }); },
      assinar: function (filtro) { if (cli) cli.subscribe(filtro, { qos: 1 }); },
      aoMensagem: function (cb) { aoMsg = cb; },
      aoConexao: function (cb) { aoEst = cb; },
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
    var retidos = {}, clientes = [];
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
      criarTransporte: function () {
        var c = { ligado: false, filtros: [], will: null, aoMsg: function () {}, aoEst: function () {} };
        clientes.push(c);
        var tr = {
          nome: 'memoria',
          conectar: function (id, opcoes) { c.will = opcoes && opcoes.will; c.ligado = true; depois(function () { c.aoEst(true); }); return Promise.resolve(); },
          publicar: function (t, obj, o) {
            var msg = copia(obj);
            if (o && o.reter) { if (msg == null) delete retidos[t]; else retidos[t] = msg; }
            if (msg != null) entregar(t, msg);
          },
          assinar: function (filtro) { c.filtros.push(filtro); entregarRetidos(c, filtro); },
          aoMensagem: function (cb) { c.aoMsg = cb; },
          aoConexao: function (cb) { c.aoEst = cb; },
          desconectar: function () { c.ligado = false; },
          // só para testes: queda de conexão (dispara o testamento) e volta
          cair: function () { if (!c.ligado) return; c.ligado = false; if (c.will) entregar(c.will.topico, c.will.dados); c.aoEst(false); },
          voltar: function () { c.ligado = true; c.aoEst(true); c.filtros.forEach(function (f) { entregarRetidos(c, f); }); }
        };
        return tr;
      }
    };
  }

  // ------------------------------------------------------------------ sala (sessão de um jogador)
  // opcoes: { id, criarTransporte(indiceServidor) -> transporte, initialState() -> estado inicial,
  //           batidaMs (8000), ausenciaMs (20000), esperaSalaMs (4500) }
  function criarSala(opcoes) {
    var o = Object.assign({ batidaMs: 8000, ausenciaMs: 20000, esperaSalaMs: 4500 }, opcoes || {});
    var eventos = {};
    var s = {
      id: o.id || gerarId(), codigo: null, servidor: 0, transporte: null,
      info: null, estado: null, conectado: false, adversarioOnline: false, ultimaBatida: 0,
      relogios: [], encerrada: false
    };
    function emitir(nome, dado) { (eventos[nome] || []).slice().forEach(function (cb) { cb(dado); }); }
    function base() { return PREFIXO + s.codigo + '/'; }
    function agora() { return Date.now(); }
    function publicar(sufixo, dados, reter) { if (s.transporte) s.transporte.publicar(base() + sufixo, dados, { reter: !!reter }); }

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
      if (s.encerrada || !msg || topico.indexOf(base()) !== 0) return;
      var resto = topico.slice(base().length);
      if (resto === 'sala') {
        var advAntes = idAdversario();
        s.info = msg;
        // REG-006: acabei de descobrir quem é o adversário -> bato na hora (senão ele me
        // veria como "desconectado" até a próxima batida periódica)
        if (!advAntes && idAdversario()) bater();
        emitir('sala', msg);
        // o estado pode ter chegado antes da sala: processa agora
        if (s.estadoPendente) { var p = s.estadoPendente; s.estadoPendente = null; receber(base() + 'estado', p); }
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
    function bater() { s.batidasEnviadas = (s.batidasEnviadas || 0) + 1; publicar('presenca/' + s.id, { id: s.id, online: true }); }

    function tratarPedido(p) {
      if (p.tipo === 'entrar') {
        if (papel() !== 'criador') return;
        if (s.info.status === 'aguardando') {
          s.info = Object.assign({}, s.info, { convidado: { id: p.id }, status: 'jogando' });
          publicar('sala', s.info, true);
          publicar('estado', { partida: 1, seq: 0, estado: o.initialState(), lance: null, autor: s.id }, true);
          marcarPresenca(p.id);   // REG-006: o pedido de entrada já prova que ele está online
          bater();                // e ele recebe a minha batida logo depois da sala
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
      else if (p.tipo === 'sair') { s.adversarioOnline = false; emitir('saiu', true); }
    }

    function iniciarBatidas() {
      pararBatidas();
      bater();
      s.relogios.push(setInterval(bater, o.batidaMs));
      s.relogios.push(setInterval(function () {
        if (s.adversarioOnline && agora() - s.ultimaBatida > o.ausenciaMs) { s.adversarioOnline = false; emitir('presenca', false); }
      }, Math.max(250, Math.floor(o.batidaMs / 2))));
    }
    function pararBatidas() { s.relogios.forEach(clearInterval); s.relogios = []; }

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
      return s.transporte.conectar(s.id, { will: { topico: base() + 'presenca/' + s.id, dados: { id: s.id, online: false } } })
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
      get servidor() { return s.servidor; },
      get info() { return s.info; },
      get estado() { return s.estado; },
      get conectado() { return s.conectado; },
      get adversarioOnline() { return s.adversarioOnline; },
      get meuLado() { return meuLado(); },
      get papel() { return papel(); },
      on: function (nome, cb) { (eventos[nome] = eventos[nome] || []).push(cb); return api; },

      // cria uma sala nova; quem cria escolhe o lado
      criar: function (lado, codigo) {
        s.codigo = codigo || gerarCodigo();
        return ligarAlgum([0, 1]).then(function () {
          s.info = { v: 1, criador: { id: s.id, lado: lado === 'J' ? 'J' : 'D' }, convidado: null, status: 'aguardando', servidor: s.servidor, t: agora() };
          publicar('sala', s.info, true);
          publicar('estado', null, true);   // limpa partida antiga com o mesmo código (improvável)
          return { codigo: s.codigo };
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
        return proximo();
      },
      // depois de consultar: o convidado aceita e entra
      entrar: function (tempoMs) {
        return new Promise(function (resolve, reject) {
          var feito = false;
          var fim = function (fn, v) { if (!feito) { feito = true; clearTimeout(t); fn(v); } };
          var t = setTimeout(function () { fim(reject, new Error('a sala não respondeu')); }, tempoMs || 10000);
          api.on('sala', function (info) { if (info.status === 'jogando' && info.convidado && info.convidado.id === s.id) fim(resolve, info); });
          api.on('cheia', function () { fim(reject, new Error('sala cheia')); });
          if (s.info && s.info.status === 'jogando' && papel()) { fim(resolve, s.info); return; }
          publicar('pedido', { tipo: 'entrar', id: s.id });
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
            s.info = Object.assign({}, s.info, { criador: { id: s.info.criador.id, lado: oposto(s.info.criador.lado) } });
            publicar('sala', s.info, true);
          }
          var ant = s.estado || { partida: 0 };
          publicar('estado', { partida: ant.partida + 1, seq: 0, estado: o.initialState(), lance: null, autor: s.id }, true);
        }
        publicar('pedido', { tipo: 'revanche-resposta', id: s.id, aceitar: !!aceitar });
      },
      sair: function () {
        if (!s.transporte) return;
        publicar('pedido', { tipo: 'sair', id: s.id });
        publicar('presenca/' + s.id, { id: s.id, online: false });
        if (papel() === 'criador' && s.info && s.info.status === 'aguardando') publicar('sala', null, true);
        api.fechar();
      },
      fechar: function () {
        s.encerrada = true;
        pararBatidas();
        var tr = s.transporte; s.transporte = null;
        if (tr) setTimeout(function () { tr.desconectar(); }, 150);
      },
      _transporte: function () { return s.transporte; },  // testes
      _diag: function () { return { ultimaBatida: s.ultimaBatida, agora: agora(), idAdversario: idAdversario(), batidasRecebidas: s.batidasRecebidas || 0, batidasEnviadas: s.batidasEnviadas || 0, relogios: s.relogios.length, codigo: s.codigo, temTransporte: !!s.transporte }; }
    };
    return api;
  }

  var OncaOnline = {
    PREFIXO: PREFIXO, ALFABETO: ALFABETO, SERVIDORES: SERVIDORES,
    gerarCodigo: gerarCodigo, gerarId: gerarId, normalizarCodigo: normalizarCodigo, codigoValido: codigoValido,
    formatarCodigo: formatarCodigo, oposto: oposto, casaTopico: casaTopico,
    criarTransporteMqtt: criarTransporteMqtt, criarBrokerMemoria: criarBrokerMemoria, criarSala: criarSala,
    carregarMqtt: carregarMqtt
  };
  root.OncaOnline = OncaOnline;
})(typeof self !== 'undefined' ? self : this);
