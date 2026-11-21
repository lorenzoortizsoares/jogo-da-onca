/*
 * audio.js — Jogo da Onça
 * Sons sintetizados com Web Audio (nenhum arquivo de som).
 *
 * CLASSIC script (sem import/export): define window.createOncaAudio().
 *
 *   var audio = createOncaAudio();
 *   audio.unlock();          // cria/retoma o AudioContext (chamar num gesto do usuário;
 *                            // também é chamado automaticamente no 1º pointerdown/keydown/touchend)
 *   audio.toc(strength)      // "toc" de madeira quando uma peça pousa (strength 0.1..1.6, padrão 1)
 *   audio.bark()             // latido curto (cachorro capturado)
 *   audio.roar()             // rugido grave (vitória da onça)
 *   audio.dogsWin()          // dois latidos alegres (vitória dos cachorros)
 *   audio.setMuted(bool)     // estado salvo em localStorage ('onca.muted')
 *   audio.isMuted()
 *
 * Todo método é um no-op seguro se o Web Audio não existir ou falhar.
 * Cadeia de saída: master gain -> DynamicsCompressor -> trim -> limitador suave -> destino.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'onca.muted';
  var MASTER_LEVEL = 0.9;

  /* ------------------------------------------------------------------ */
  /* utilidades                                                          */
  /* ------------------------------------------------------------------ */
  function readMuted() {
    try { return window.localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }
  function writeMuted(m) {
    try { window.localStorage.setItem(STORAGE_KEY, m ? '1' : '0'); } catch (e) { /* armazenamento bloqueado */ }
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // caches por contexto (buffer de ruído, curvas de distorção)
  var caches = (typeof WeakMap === 'function') ? new WeakMap() : null;
  function cacheFor(ctx) {
    if (!caches) { return ctx.__oncaCache || (ctx.__oncaCache = {}); }
    var c = caches.get(ctx);
    if (!c) { c = {}; caches.set(ctx, c); }
    return c;
  }

  function noiseBuffer(ctx) {
    var c = cacheFor(ctx);
    if (!c.noise) {
      var len = Math.floor(ctx.sampleRate * 2);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) { d[i] = Math.random() * 2 - 1; }
      c.noise = buf;
    }
    return c.noise;
  }

  function noise(ctx, t, dur) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    src.start(t, rand(0, 1.8));
    src.stop(t + dur);
    return src;
  }

  // curva tanh normalizada (saturação suave para "aspereza")
  function driveCurve(ctx, k) {
    var c = cacheFor(ctx), key = 'drive' + k;
    if (!c[key]) {
      var n = 2048, curve = new Float32Array(n), norm = Math.tanh(k);
      for (var i = 0; i < n; i++) {
        var x = (i * 2) / (n - 1) - 1;
        curve[i] = Math.tanh(k * x) / norm;
      }
      c[key] = curve;
    }
    return c[key];
  }

  // limitador de segurança: identidade até 0.75, joelho suave até ~0.98.
  // A entrada é pré-escalada por 0.5, então a curva cobre sinais de -2..2.
  var LIMIT_CURVE = null;
  function limiterCurve() {
    if (!LIMIT_CURVE) {
      var n = 8192, curve = new Float32Array(n), knee = 0.75, room = 0.23;
      for (var i = 0; i < n; i++) {
        var x = ((i * 2) / (n - 1) - 1) * 2; // sinal real (-2..2)
        var a = Math.abs(x);
        var y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
        curve[i] = x < 0 ? -y : y;
      }
      LIMIT_CURVE = curve;
    }
    return LIMIT_CURVE;
  }

  function gain(ctx, v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  function filter(ctx, type, f, q) {
    var b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    if (q != null) { b.Q.value = q; }
    return b;
  }
  function link() {
    for (var i = 0; i < arguments.length - 1; i++) { arguments[i].connect(arguments[i + 1]); }
    return arguments[arguments.length - 1];
  }
  // envelope: pts = [[tempo, valor, 'lin'?], ...] (tempos relativos a t0).
  // Rampas exponenciais nunca usam 0 (piso 1e-4).
  function envelope(param, t0, pts) {
    param.setValueAtTime(Math.max(pts[0][1], 1e-4), t0 + pts[0][0]);
    for (var i = 1; i < pts.length; i++) {
      var at = t0 + pts[i][0], v = pts[i][1];
      if (pts[i][2] === 'lin') { param.linearRampToValueAtTime(v, at); }
      else { param.exponentialRampToValueAtTime(Math.max(v, 1e-4), at); }
    }
  }
  function oscillator(ctx, type, t, stopAt) {
    var o = ctx.createOscillator();
    o.type = type;
    o.start(t);
    o.stop(stopAt);
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* TOC — batida de madeira: clique de ruído + tom médio-grave curto     */
  /* ------------------------------------------------------------------ */
  function synthToc(ctx, out, t, strength) {
    var s = +strength;
    if (!isFinite(s)) { s = 1; }
    s = clamp(s, 0.1, 1.6);
    var lvl = Math.pow(s, 0.9);
    var f = 340 * rand(0.93, 1.07);        // altura do corpo (varia um pouco a cada toc)
    var end = t + 0.25;
    var bus = gain(ctx, 0.85 * lvl);
    bus.connect(out);

    // 1) clique de ataque: ruído em banda (mais brilhante quando mais forte)
    var click = noise(ctx, t, 0.05);
    var hp = filter(ctx, 'highpass', 700, 0.7);
    var bp = filter(ctx, 'bandpass', rand(2000, 2700) * (0.85 + 0.15 * s), 1.2);
    var cg = ctx.createGain();
    envelope(cg.gain, t, [[0, 1e-4], [0.0012, 0.55], [0.02, 1e-4]]);
    link(click, hp, bp, cg, bus);

    // 2) ressonância "oca" da madeira excitada pelo clique (passa-banda de Q alto)
    var ring = noise(ctx, t, 0.02);
    var rg = ctx.createGain();
    envelope(rg.gain, t, [[0, 1e-4], [0.001, 2.2], [0.01, 1e-4]]);
    var res = filter(ctx, 'bandpass', f * 2.05, 16);
    link(ring, rg, res, bus);

    // 3) corpo: tom com pequena queda de altura e decaimento rápido
    var o1 = oscillator(ctx, 'sine', t, end);
    o1.frequency.setValueAtTime(f * 1.25, t);
    o1.frequency.exponentialRampToValueAtTime(f, t + 0.016);
    var g1 = ctx.createGain();
    envelope(g1.gain, t, [[0, 1e-4], [0.002, 0.6], [0.035, 0.22], [0.12, 1e-4]]);
    link(o1, g1, bus);

    // 4) parcial inarmônico (barra livre ~2.76x)
    var o2 = oscillator(ctx, 'sine', t, end);
    o2.frequency.setValueAtTime(f * 2.76, t);
    var g2 = ctx.createGain();
    envelope(g2.gain, t, [[0, 1e-4], [0.0015, 0.2 * (0.6 + 0.4 * s)], [0.04, 1e-4]]);
    link(o2, g2, bus);

    // 5) baque grave da tábua
    var o3 = oscillator(ctx, 'sine', t, end);
    o3.frequency.setValueAtTime(f * 0.47, t);
    o3.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.07);
    var g3 = ctx.createGain();
    envelope(g3.gain, t, [[0, 1e-4], [0.004, 0.32], [0.08, 1e-4]]);
    link(o3, g3, bus);
  }

  /* ------------------------------------------------------------------ */
  /* LATIDO — ~150 ms: glide de altura + formantes + ataque de ruído      */
  /* ------------------------------------------------------------------ */
  function synthBark(ctx, out, t, opt) {
    opt = opt || {};
    var happy = !!opt.happy;
    var p = (opt.pitch || 1) * rand(0.96, 1.04);
    var D = 0.15 * (opt.dur || 1);
    var end = t + D + 0.09;
    var bus = gain(ctx, opt.gain == null ? 0.8 : opt.gain);
    bus.connect(out);

    // contorno de altura "wu-AF": sobe rápido e cai (alegre: cai menos)
    var f0 = 290 * p;
    var peakAt = D * (happy ? 0.3 : 0.22);
    var fEnd = happy ? 1.05 : 0.72;
    function contour(param, mul) {
      param.setValueAtTime(f0 * 0.8 * mul, t);
      param.exponentialRampToValueAtTime(f0 * 1.5 * mul, t + peakAt);
      param.exponentialRampToValueAtTime(f0 * fEnd * mul, t + D);
    }
    var a = oscillator(ctx, 'sawtooth', t, end); contour(a.frequency, 1);
    var b = oscillator(ctx, 'sawtooth', t, end); contour(b.frequency, 1.013);
    var c = oscillator(ctx, 'square', t, end); contour(c.frequency, 0.5);

    // aspereza: vibrato rápido (mais "rouco" no latido normal)
    var lfo = oscillator(ctx, 'sine', t, end);
    lfo.frequency.setValueAtTime(rand(46, 60), t);
    var lfoDepth = gain(ctx, f0 * (happy ? 0.025 : 0.07));
    link(lfo, lfoDepth);
    lfoDepth.connect(a.frequency);
    lfoDepth.connect(b.frequency);

    var src = gain(ctx, 0.32);
    a.connect(src); b.connect(src);
    link(c, gain(ctx, 0.4), src);

    var shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(ctx, 2.2);
    src.connect(shaper);

    // formantes em paralelo (F1 "abre a boca" e fecha)
    var F = happy ? [950, 1900, 3100] : [720, 1400, 2650];
    var Q = [4.5, 6, 8];
    var G = [1.35, 1.0, 0.45];
    var mix = gain(ctx, 1);
    for (var i = 0; i < 3; i++) {
      var bp = filter(ctx, 'bandpass', F[i], Q[i]);
      if (i === 0) {
        bp.frequency.setValueAtTime(F[0] * 0.72, t);
        bp.frequency.exponentialRampToValueAtTime(F[0] * 1.15, t + D * 0.28);
        bp.frequency.exponentialRampToValueAtTime(F[0] * 0.78, t + D);
      }
      link(shaper, bp, gain(ctx, G[i]), mix);
    }
    // um pouco de corpo direto (passa-baixa)
    link(shaper, filter(ctx, 'lowpass', 1600, 0.7), gain(ctx, 0.22), mix);

    var amp = ctx.createGain();
    envelope(amp.gain, t, [[0, 1e-4], [0.006, 1], [D * 0.45, 0.72], [D, 0.1], [D + 0.05, 1e-4]]);
    link(mix, amp, bus);

    // ataque de ruído + "sopro"
    var n = noise(ctx, t, D + 0.07);
    var nbp = filter(ctx, 'bandpass', 1750 * Math.sqrt(p), 0.9);
    var ng = ctx.createGain();
    envelope(ng.gain, t, [[0, 1e-4], [0.004, happy ? 0.3 : 0.5], [0.04, 0.07], [D, 0.035], [D + 0.04, 1e-4]]);
    link(n, nbp, ng, bus);
  }

  /* ------------------------------------------------------------------ */
  /* RUGIDO — ~1.5 s: dente-de-serra grave + modulação de rosnado         */
  /* + ruído filtrado, envelope que cresce                               */
  /* ------------------------------------------------------------------ */
  function synthRoar(ctx, out, t) {
    var D = 1.5;
    var end = t + D + 0.1;
    var bus = gain(ctx, 0.62);
    bus.connect(out);
    var f0 = rand(78, 88);

    function contour(param, mul) {
      param.setValueAtTime(f0 * 0.82 * mul, t);
      param.exponentialRampToValueAtTime(f0 * 1.32 * mul, t + 0.42);
      param.exponentialRampToValueAtTime(f0 * 1.12 * mul, t + 0.95);
      param.exponentialRampToValueAtTime(f0 * 0.66 * mul, t + D);
    }
    var o1 = oscillator(ctx, 'sawtooth', t, end); contour(o1.frequency, 1);
    var o2 = oscillator(ctx, 'sawtooth', t, end); contour(o2.frequency, 1.011);
    var o3 = oscillator(ctx, 'square', t, end); contour(o3.frequency, 0.5);

    // rosnado: modulação de amplitude ~20-32 Hz com taxa variável
    var growl = oscillator(ctx, 'triangle', t, end);
    growl.frequency.setValueAtTime(21, t);
    growl.frequency.linearRampToValueAtTime(31, t + 0.5);
    growl.frequency.linearRampToValueAtTime(26, t + 1.0);
    growl.frequency.linearRampToValueAtTime(18, t + D);
    var am = gain(ctx, 0.58);
    link(growl, gain(ctx, 0.42), am.gain);
    // aspereza na altura (FM leve com o mesmo LFO)
    var fm = gain(ctx, 6);
    growl.connect(fm);
    fm.connect(o1.frequency);
    fm.connect(o2.frequency);

    var src = gain(ctx, 0.45);
    o1.connect(src); o2.connect(src);
    link(o3, gain(ctx, 0.5), src);
    src.connect(am);

    var shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(ctx, 3);
    am.connect(shaper);

    // "boca": passa-baixa que abre e fecha + formante
    var lp = filter(ctx, 'lowpass', 300, 2.5);
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.exponentialRampToValueAtTime(1500, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(900, t + 1.0);
    lp.frequency.exponentialRampToValueAtTime(320, t + D);
    var fmt = filter(ctx, 'bandpass', 520, 3);
    fmt.frequency.setValueAtTime(380, t);
    fmt.frequency.exponentialRampToValueAtTime(650, t + 0.5);
    fmt.frequency.exponentialRampToValueAtTime(420, t + D);

    var amp = ctx.createGain();
    envelope(amp.gain, t, [[0, 1e-4], [0.12, 0.28], [0.5, 1], [1.0, 0.85, 'lin'], [1.3, 0.4, 'lin'], [D, 0, 'lin']]);
    var voice = gain(ctx, 1);
    link(shaper, lp, voice);
    link(shaper, fmt, gain(ctx, 0.7), voice);
    link(voice, amp, bus);

    // ruído rouco (mesma modulação) + ronco sub-grave
    var n = noise(ctx, t, D + 0.05);
    var nbp = filter(ctx, 'bandpass', 700, 0.6);
    var nam = gain(ctx, 0.5);
    link(growl, gain(ctx, 0.5), nam.gain);
    var ng = ctx.createGain();
    envelope(ng.gain, t, [[0, 1e-4], [0.15, 0.06], [0.5, 0.28], [1.05, 0.2, 'lin'], [D, 0, 'lin']]);
    link(n, nbp, nam, ng, bus);

    var r = noise(ctx, t, D + 0.05);
    var rlp = filter(ctx, 'lowpass', 170, 0.8);
    var rg = ctx.createGain();
    envelope(rg.gain, t, [[0, 1e-4], [0.4, 0.55], [1.1, 0.4, 'lin'], [D, 0, 'lin']]);
    link(r, rlp, rg, bus);
  }

  /* dois latidos alegres e rápidos */
  function synthDogsWin(ctx, out, t) {
    synthBark(ctx, out, t, { pitch: 1.38, dur: 0.75, happy: true, gain: 0.62 });
    synthBark(ctx, out, t + 0.19, { pitch: 1.55, dur: 0.82, happy: true, gain: 0.62 });
  }

  /* cadeia de saída: master -> compressor -> trim -> limitador -> destino */
  function buildOutput(ctx, dest) {
    var master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.2;
    var trim = gain(ctx, 0.5 * 0.85);       // 0.5 = pré-escala do limitador
    var limiter = ctx.createWaveShaper();
    limiter.curve = limiterCurve();
    link(master, comp, trim, limiter, dest || ctx.destination);
    return { input: master, master: master, compressor: comp };
  }

  /* ------------------------------------------------------------------ */
  /* fábrica pública                                                     */
  /* ------------------------------------------------------------------ */
  window.createOncaAudio = function () {
    var AC = null;
    try { AC = window.AudioContext || window.webkitAudioContext || null; } catch (e) { AC = null; }
    var ctx = null, out = null, broken = false;
    var muted = readMuted();
    var gestured = false;

    function hasActivation() {
      try { return !!(navigator.userActivation && navigator.userActivation.hasBeenActive); } catch (e) { return false; }
    }

    function ensure() {
      if (ctx) { return ctx; }
      if (!AC || broken) { return null; }
      try {
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e1) { ctx = new AC(); }
        out = buildOutput(ctx);
        out.master.gain.value = muted ? 0 : MASTER_LEVEL;
      } catch (e) {
        broken = true;
        try { if (ctx && ctx.close) { ctx.close(); } } catch (e2) { /* nada */ }
        ctx = null; out = null;
        return null;
      }
      return ctx;
    }

    function resume(c) {
      try {
        if (c && c.state !== 'running' && c.state !== 'closed' && typeof c.resume === 'function') {
          var p = c.resume();
          if (p && typeof p.catch === 'function') { p.catch(function () { /* sem gesto ainda */ }); }
        }
      } catch (e) { /* nada */ }
    }

    function unlock() {
      try {
        gestured = true;
        var c = ensure();
        if (c) { resume(c); }
        if (c && c.state === 'running') { detachGestures(); }
      } catch (e) { /* no-op */ }
    }

    // contexto pronto para tocar agora? (não cria contexto antes de um gesto)
    function ready() {
      if (muted || !AC || broken) { return null; }
      var active = gestured || hasActivation();
      if (!ctx && !active) { return null; }
      var c = ensure();
      if (!c || c.state === 'closed') { return null; }
      if (c.state === 'running') { return c; }
      if (active) { resume(c); return c; }  // toca assim que o resume terminar
      return null;
    }

    function play(fn) {
      try {
        var c = ready();
        if (!c || !out) { return; }
        fn(c, out.input, c.currentTime + 0.012);
      } catch (e) { /* som é opcional: nunca quebra o jogo */ }
    }

    // desbloqueio automático no primeiro gesto
    var GESTURES = ['pointerdown', 'mousedown', 'touchend', 'keydown'];
    var attached = false;
    function onGesture() { unlock(); }
    function attachGestures() {
      if (attached || !AC) { return; }
      try {
        for (var i = 0; i < GESTURES.length; i++) {
          window.addEventListener(GESTURES[i], onGesture, { capture: true, passive: true });
        }
        attached = true;
      } catch (e) { /* nada */ }
    }
    function detachGestures() {
      if (!attached) { return; }
      try {
        for (var i = 0; i < GESTURES.length; i++) {
          window.removeEventListener(GESTURES[i], onGesture, { capture: true });
        }
      } catch (e) { /* nada */ }
      attached = false;
    }
    attachGestures();

    var audio = {
      supported: !!AC,
      unlock: unlock,
      toc: function (strength) {
        play(function (c, dest, t) { synthToc(c, dest, t, strength == null ? 1 : strength); });
      },
      bark: function () {
        play(function (c, dest, t) { synthBark(c, dest, t, null); });
      },
      roar: function () {
        play(function (c, dest, t) { synthRoar(c, dest, t); });
      },
      dogsWin: function () {
        play(function (c, dest, t) { synthDogsWin(c, dest, t); });
      },
      setMuted: function (m) {
        try {
          muted = !!m;
          writeMuted(muted);
          if (ctx && out) {
            var g = out.master.gain, now = ctx.currentTime;
            if (g.cancelScheduledValues) { g.cancelScheduledValues(now); }
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(muted ? 0 : MASTER_LEVEL, now + 0.04);
          }
        } catch (e) { /* no-op */ }
      },
      isMuted: function () { return muted; },
      // ganchos de teste/inspeção (renderização offline em audio-test.html)
      _synth: { toc: synthToc, bark: synthBark, roar: synthRoar, dogsWin: synthDogsWin },
      _buildOutput: buildOutput
    };
    return audio;
  };
})();
