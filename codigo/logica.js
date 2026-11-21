/*
 * Jogo da Onça - REGRAS + IA  (dev/logic.js)
 *
 * Classic script (no import/export) so that it works from file:// pages, inside a
 * Web Worker (Blob) and in the test pages:
 *   page / tests : window.OncaLogic
 *   Web Worker   : self.OncaLogic + message handler
 *                  e.data {id, state, level, history[, timeLimitMs]}
 *                  -> postMessage({id, move, stats:{depth, nodes, ms}})
 *
 * Board: 31 points. Grid (r,c) r,c in 0..4 -> index r*5+c (0..24);
 * toca: 25=(5,1) 26=(5,2) 27=(5,3) 28=(6,0) 29=(6,2) 30=(6,4).
 * World mapping (for the 3D view): x = c-2, z = r-3, y = 0 board top.
 *
 * State (plain, JSON-serialisable):
 *   { board:number[31] (0 empty, 1 dog, 2 jaguar), jaguar, captured, turn:'J'|'D', ply, chain }
 *   chain = captures already made by the jaguar during the current turn (0 normally;
 *           > 0 only between applyJaguarCapture and endJaguarTurn).
 */
(function factory(root) {
  'use strict';

  var VERSION = '1.0.0';
  var N = 31;
  var EMPTY = 0, DOG = 1, JAGUAR = 2;
  var CAPTURES_TO_WIN = 5;

  /* =====================================================================
   * Geometry
   * ===================================================================== */
  var NODES = [];
  var IDX = [];
  (function () {
    var r, c, k;
    for (r = 0; r < 5; r++) for (c = 0; c < 5; c++) NODES.push({ r: r, c: c });
    NODES.push({ r: 5, c: 1 }, { r: 5, c: 2 }, { r: 5, c: 3 }, { r: 6, c: 0 }, { r: 6, c: 2 }, { r: 6, c: 4 });
    for (k = 0; k < 35; k++) IDX.push(-1);
    for (k = 0; k < NODES.length; k++) IDX[NODES[k].r * 5 + NODES[k].c] = k;
  })();

  function index(r, c) {
    if (typeof r !== 'number' || typeof c !== 'number') return -1;
    if (r !== Math.floor(r) || c !== Math.floor(c)) return -1;
    if (r < 0 || r > 6 || c < 0 || c > 4) return -1;
    return IDX[r * 5 + c];
  }

  var EDGES = [];
  var ADJ = [];
  (function () {
    var lists = [], r, c, k;
    for (k = 0; k < N; k++) lists.push([]);
    function add(a, b) {
      if (a < 0 || b < 0 || a === b) throw new Error('OncaLogic: bad edge ' + a + '-' + b);
      if (lists[a].indexOf(b) >= 0) return;
      lists[a].push(b);
      lists[b].push(a);
      EDGES.push(a < b ? [a, b] : [b, a]);
    }
    // orthogonal neighbours inside the 5x5 grid
    for (r = 0; r < 5; r++) for (c = 0; c < 5; c++) {
      if (c < 4) add(index(r, c), index(r, c + 1));
      if (r < 4) add(index(r, c), index(r + 1, c));
    }
    // diagonals only between points with (r+c) even (one per grid cell)
    for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) {
      if ((r + c) % 2 === 0) add(index(r, c), index(r + 1, c + 1));
      else add(index(r, c + 1), index(r + 1, c));
    }
    // toca (triangle attached to (4,2))
    var toca = [[4, 2, 5, 1], [4, 2, 5, 2], [4, 2, 5, 3], [5, 1, 5, 2], [5, 2, 5, 3],
                [5, 1, 6, 0], [5, 2, 6, 2], [5, 3, 6, 4], [6, 0, 6, 2], [6, 2, 6, 4]];
    for (k = 0; k < toca.length; k++) add(index(toca[k][0], toca[k][1]), index(toca[k][2], toca[k][3]));
    for (k = 0; k < N; k++) ADJ.push(lists[k].sort(function (x, y) { return x - y; }));
    EDGES.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1]; });
  })();

  // JUMPS[a] = [{over, to}]: a-over and over-to are edges and to = over + (over - a) in (r,c)
  var JUMPS = [];
  (function () {
    for (var a = 0; a < N; a++) {
      var list = [];
      for (var k = 0; k < ADJ[a].length; k++) {
        var b = ADJ[a][k];
        var t = index(2 * NODES[b].r - NODES[a].r, 2 * NODES[b].c - NODES[a].c);
        if (t >= 0 && ADJ[b].indexOf(t) >= 0) list.push({ over: b, to: t });
      }
      JUMPS.push(list);
    }
  })();

  /* ---------- flat typed tables for the engine ---------- */
  var ADJ_OFF = new Int32Array(N + 1), ADJ_LIST;
  var JMP_OFF = new Int32Array(N + 1), JMP_OVER, JMP_TO;
  var LIN_OFF = new Int32Array(N + 1), LIN_A, LIN_C;   // lines (a, p, c) through p (p jumped)
  var MID = new Int8Array(N * N);                        // MID[a*N+c] = jumped point or -1
  var IS_ADJ = new Uint8Array(N * N);
  (function () {
    var p, k, total = 0;
    for (p = 0; p < N; p++) { ADJ_OFF[p] = total; total += ADJ[p].length; }
    ADJ_OFF[N] = total;
    ADJ_LIST = new Int8Array(total);
    for (p = 0; p < N; p++) for (k = 0; k < ADJ[p].length; k++) {
      ADJ_LIST[ADJ_OFF[p] + k] = ADJ[p][k];
      IS_ADJ[p * N + ADJ[p][k]] = 1;
    }
    total = 0;
    for (p = 0; p < N; p++) { JMP_OFF[p] = total; total += JUMPS[p].length; }
    JMP_OFF[N] = total;
    JMP_OVER = new Int8Array(total);
    JMP_TO = new Int8Array(total);
    for (k = 0; k < MID.length; k++) MID[k] = -1;
    for (p = 0; p < N; p++) for (k = 0; k < JUMPS[p].length; k++) {
      var jp = JUMPS[p][k];
      JMP_OVER[JMP_OFF[p] + k] = jp.over;
      JMP_TO[JMP_OFF[p] + k] = jp.to;
      MID[p * N + jp.to] = jp.over;
    }
    var lines = [];
    for (p = 0; p < N; p++) lines.push([]);
    for (p = 0; p < N; p++) for (k = 0; k < JUMPS[p].length; k++) lines[JUMPS[p][k].over].push([p, JUMPS[p][k].to]);
    total = 0;
    for (p = 0; p < N; p++) { LIN_OFF[p] = total; total += lines[p].length; }
    LIN_OFF[N] = total;
    LIN_A = new Int8Array(total);
    LIN_C = new Int8Array(total);
    for (p = 0; p < N; p++) for (k = 0; k < lines[p].length; k++) {
      LIN_A[LIN_OFF[p] + k] = lines[p][k][0];
      LIN_C[LIN_OFF[p] + k] = lines[p][k][1];
    }
  })();

  /* ---------- Zobrist keys (fixed seed -> deterministic) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var ZL = new Int32Array(N * 2), ZH = new Int32Array(N * 2), ZSL = 0, ZSH = 0;
  (function () {
    var rnd = mulberry32(0x0A5A0CA5);
    function r32() { return (rnd() * 4294967296) | 0; }
    for (var k = 0; k < N * 2; k++) { ZL[k] = r32(); ZH[k] = r32(); }
    ZSL = r32(); ZSH = r32();
  })();

  /* =====================================================================
   * Rules (public, immutable API)
   * ===================================================================== */
  function isPoint(p) { return typeof p === 'number' && p >= 0 && p < N && p === Math.floor(p); }

  function checkState(s, fn) {
    if (!s || typeof s !== 'object' || !s.board || s.board.length !== N || !isPoint(s.jaguar)) {
      throw new Error(fn + ': invalid state');
    }
  }

  function initialState() {
    var board = [];
    for (var i = 0; i < N; i++) board.push(NODES[i].r <= 2 ? DOG : EMPTY);
    board[12] = JAGUAR;
    return { board: board, jaguar: 12, captured: 0, turn: 'J', ply: 0, chain: 0 };
  }

  function cloneState(s) {
    return {
      board: Array.prototype.slice.call(s.board),
      jaguar: s.jaguar,
      captured: s.captured | 0,
      turn: s.turn,
      ply: s.ply | 0,
      chain: s.chain | 0
    };
  }

  function dogMoves(s) {
    var b = s.board, res = [];
    for (var p = 0; p < N; p++) {
      if (b[p] !== DOG) continue;
      var a = ADJ[p];
      for (var k = 0; k < a.length; k++) if (b[a[k]] === EMPTY) res.push({ from: p, to: a[k] });
    }
    return res;
  }

  // Steps of the jaguar. Empty while a capture chain is in progress (chain > 0):
  // after capturing, the jaguar may only keep capturing or stop.
  function jaguarSteps(s) {
    var res = [];
    if ((s.chain | 0) > 0) return res;
    var b = s.board, a = ADJ[s.jaguar];
    if (!a) return res;
    for (var k = 0; k < a.length; k++) if (b[a[k]] === EMPTY) res.push(a[k]);
    return res;
  }

  function jaguarCaptures(s, from) {
    if (from === undefined || from === null) from = s.jaguar;
    var res = [];
    if (!isPoint(from)) return res;
    var b = s.board, js = JUMPS[from];
    for (var k = 0; k < js.length; k++) {
      var o = js[k].over, t = js[k].to;
      if (b[o] === DOG && (b[t] === EMPTY || (t === s.jaguar && from !== s.jaguar))) res.push({ over: o, to: t });
    }
    return res;
  }

  function jaguarHasAnyMove(b, j) {
    var k;
    for (k = ADJ_OFF[j]; k < ADJ_OFF[j + 1]; k++) if (b[ADJ_LIST[k]] === EMPTY) return true;
    for (k = JMP_OFF[j]; k < JMP_OFF[j + 1]; k++) if (b[JMP_OVER[k]] === DOG && b[JMP_TO[k]] === EMPTY) return true;
    return false;
  }

  function dogsHaveAnyMove(b) {
    for (var p = 0; p < N; p++) {
      if (b[p] !== DOG) continue;
      for (var k = ADJ_OFF[p]; k < ADJ_OFF[p + 1]; k++) if (b[ADJ_LIST[k]] === EMPTY) return true;
    }
    return false;
  }

  function applyDogMove(s, from, to) {
    checkState(s, 'applyDogMove');
    if (s.turn !== 'D') throw new Error('applyDogMove: it is not the dogs\' turn');
    if ((s.captured | 0) >= CAPTURES_TO_WIN) throw new Error('applyDogMove: the game is over');
    if (!isPoint(from) || !isPoint(to)) throw new Error('applyDogMove: invalid point');
    if (s.board[from] !== DOG) throw new Error('applyDogMove: no dog at ' + from);
    if (s.board[to] !== EMPTY) throw new Error('applyDogMove: point ' + to + ' is not empty');
    if (!IS_ADJ[from * N + to]) throw new Error('applyDogMove: ' + from + ' and ' + to + ' are not adjacent');
    var n = cloneState(s);
    n.board[from] = EMPTY;
    n.board[to] = DOG;
    n.turn = 'J';
    n.ply = (s.ply | 0) + 1;
    n.chain = 0;
    return n;
  }

  function applyJaguarStep(s, to) {
    checkState(s, 'applyJaguarStep');
    if (s.turn !== 'J') throw new Error('applyJaguarStep: it is not the jaguar\'s turn');
    if ((s.captured | 0) >= CAPTURES_TO_WIN) throw new Error('applyJaguarStep: the game is over');
    if ((s.chain | 0) > 0) throw new Error('applyJaguarStep: after a capture the jaguar may only keep capturing or stop (endJaguarTurn)');
    var from = s.jaguar;
    if (!isPoint(to) || s.board[to] !== EMPTY || !IS_ADJ[from * N + to]) {
      throw new Error('applyJaguarStep: illegal step ' + from + '->' + to);
    }
    var n = cloneState(s);
    n.board[from] = EMPTY;
    n.board[to] = JAGUAR;
    n.jaguar = to;
    n.turn = 'D';
    n.ply = (s.ply | 0) + 1;
    n.chain = 0;
    return n;
  }

  // One jump. The turn does NOT pass: the caller chains more captures or calls endJaguarTurn.
  function applyJaguarCapture(s, over, to) {
    checkState(s, 'applyJaguarCapture');
    if (s.turn !== 'J') throw new Error('applyJaguarCapture: it is not the jaguar\'s turn');
    if ((s.captured | 0) >= CAPTURES_TO_WIN) throw new Error('applyJaguarCapture: the game is over');
    var from = s.jaguar;
    if (!isPoint(over) || !isPoint(to) || s.board[from] !== JAGUAR || MID[from * N + to] !== over) {
      throw new Error('applyJaguarCapture: no jump ' + from + ' over ' + over + ' to ' + to);
    }
    if (s.board[over] !== DOG) throw new Error('applyJaguarCapture: no dog at ' + over);
    if (s.board[to] !== EMPTY) throw new Error('applyJaguarCapture: landing point ' + to + ' is not empty');
    var n = cloneState(s);
    n.board[from] = EMPTY;
    n.board[over] = EMPTY;
    n.board[to] = JAGUAR;
    n.jaguar = to;
    n.captured = (s.captured | 0) + 1;
    n.chain = (s.chain | 0) + 1;
    return n;
  }

  function endJaguarTurn(s) {
    checkState(s, 'endJaguarTurn');
    if (s.turn !== 'J') throw new Error('endJaguarTurn: it is not the jaguar\'s turn');
    if (!((s.chain | 0) > 0)) throw new Error('endJaguarTurn: the jaguar has not captured this turn (it cannot pass)');
    var n = cloneState(s);
    n.turn = 'D';
    n.ply = (s.ply | 0) + 1;
    n.chain = 0;
    return n;
  }

  function winner(s) {
    if ((s.captured | 0) >= CAPTURES_TO_WIN) return 'J';
    if (s.turn === 'J') {
      if ((s.chain | 0) > 0) return null;          // mid-chain: the jaguar can always stop
      return jaguarHasAnyMove(s.board, s.jaguar) ? null : 'D';
    }
    if (s.turn === 'D') return dogsHaveAnyMove(s.board) ? null : 'J';
    return null;
  }

  function positionKey(s) {
    return Array.prototype.join.call(s.board, '') + s.turn;
  }

  // All complete moves in the AI format. For the jaguar every prefix of a capture
  // chain is listed (chains stop growing once the 5th dog is taken).
  function legalMoves(s) {
    var res = [], k;
    if ((s.captured | 0) >= CAPTURES_TO_WIN) return res;
    if (s.turn === 'D') {
      var dm = dogMoves(s);
      for (k = 0; k < dm.length; k++) res.push({ type: 'dog', from: dm[k].from, to: dm[k].to });
      return res;
    }
    var b = Array.prototype.slice.call(s.board), j = s.jaguar, already = s.captured | 0;
    b[j] = EMPTY;
    (function dfs(cur, path, caps) {
      var js = JUMPS[cur];
      for (var q = 0; q < js.length; q++) {
        var o = js[q].over, t = js[q].to;
        if (b[o] !== DOG || b[t] !== EMPTY) continue;
        var p2 = path.concat([t]), c2 = caps.concat([o]);
        res.push({ type: 'capture', path: p2, captured: c2 });
        if (already + c2.length < CAPTURES_TO_WIN) {
          b[o] = EMPTY;
          dfs(t, p2, c2);
          b[o] = DOG;
        }
      }
    })(j, [j], []);
    var st = jaguarSteps(s);
    for (k = 0; k < st.length; k++) res.push({ type: 'step', from: j, to: st[k] });
    return res;
  }

  // Applies a complete AI-style move (whole capture chain included) and passes the turn.
  function applyMove(s, move) {
    if (!move || typeof move !== 'object') throw new Error('applyMove: invalid move');
    if (move.type === 'dog') return applyDogMove(s, move.from, move.to);
    if (move.type === 'step') {
      if (move.from !== undefined && move.from !== s.jaguar) throw new Error('applyMove: step must start at the jaguar');
      return applyJaguarStep(s, move.to);
    }
    if (move.type === 'capture') {
      var path = move.path;
      if (!path || path.length < 2) throw new Error('applyMove: capture without path');
      if (path[0] !== s.jaguar) throw new Error('applyMove: capture must start at the jaguar');
      var cur = s;
      for (var k = 1; k < path.length; k++) {
        if (!isPoint(path[k - 1]) || !isPoint(path[k])) throw new Error('applyMove: invalid capture path');
        var over = MID[path[k - 1] * N + path[k]];
        if (move.captured && move.captured[k - 1] !== undefined && move.captured[k - 1] !== over) {
          throw new Error('applyMove: captured list does not match the path');
        }
        cur = applyJaguarCapture(cur, over, path[k]);
      }
      return endJaguarTurn(cur);
    }
    throw new Error('applyMove: unknown move type ' + move.type);
  }

  /* =====================================================================
   * AI: negamax alpha-beta (PVS) + iterative deepening + quiescence,
   * move ordering (TT/PV move, captures longest first, killers, history),
   * Zobrist hashing + transposition table (levels 3-4).
   * ===================================================================== */
  var LEVELS = [
    { id: 1, name: 'Básico' },
    { id: 2, name: 'Intermediário' },
    { id: 3, name: 'Avançado' },
    { id: 4, name: 'Expert' }
  ];
  var DEFAULT_TIME_MS = { 1: 250, 2: 300, 3: 900, 4: 2200 };

  var MATE = 100000, MATE_BOUND = MATE - 1000, INF = 1e9;
  var TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;
  var LOSING = 500;              // repetition is not penalised when we are this much behind
  var SAFETY_MS = 20;            // stop the search a bit before the limit (bookkeeping)

  // Evaluation weights (jaguar's point of view).
  var DEFAULT_WEIGHTS = {
    cap: 1000,      // per captured dog (dominant)
    step: 28,       // jaguar mobility (empty neighbours)
    region: 7,      // empty points reachable by the jaguar
    exp1: 55,       // dogs jumpable after 1 jaguar step
    exp2: 22,       // ... after 2 steps
    expF: 6,        // ... further away
    link: 3,        // dog-dog adjacencies (compact pack, counted twice per pair)
    strag: 25,      // stragglers (dogs with no dog neighbour)
    safeAdj: 8,     // dogs touching the jaguar that cannot be jumped
    toca1: 40,      // jaguar in the toca (middle row)
    toca2: 100,     // jaguar at the bottom of the toca
    capNow: 650,    // jaguar to move with a capture available (horizon only)
    threat1: 70,    // dogs to move, one dog en prise
    threat2: 450    // dogs to move, each extra dog en prise
  };

  var LEVEL_PARAMS = [null,
    // 1 Básico: 2 ply, frequent random / noisy choices, still takes a free capture most of the time
    { maxDepth: 2, time: 250, tt: false, qMax: 2, noise: 140, randomRate: 0.3, takeCapture: 0.85, exact: true,
      killers: false, asp: false, lmr: false, ext: false, trap: false },
    // 2 Intermediário: up to 4 ply, small noise
    { maxDepth: 4, time: 300, tt: false, qMax: 2, noise: 25, killers: true, asp: false, lmr: false, ext: false, trap: true },
    // 3 Avançado: iterative deepening + TT, no noise
    { maxDepth: 64, time: 900, tt: true, qMax: 4, noise: 0, killers: true, asp: false, lmr: false, ext: true, trap: true },
    // 4 Expert: everything
    { maxDepth: 64, time: 2200, tt: true, qMax: 6, noise: 0, killers: true, asp: true, lmr: false, ext: true, trap: true }
  ];

  var now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  function clampLevel(level) {
    level = Math.round(+level);
    if (!(level >= 1)) return 1;
    return level > 4 ? 4 : level;
  }

  function createAI(config) {
    config = config || {};
    var key;
    var Wt = {};
    for (key in DEFAULT_WEIGHTS) Wt[key] = DEFAULT_WEIGHTS[key];
    if (config.weights) for (key in config.weights) if (Object.prototype.hasOwnProperty.call(Wt, key)) Wt[key] = +config.weights[key];
    var params = [null];
    for (var lv = 1; lv <= 4; lv++) {
      var pp = {};
      for (key in LEVEL_PARAMS[lv]) pp[key] = LEVEL_PARAMS[lv][key];
      if (config.params && config.params[lv]) for (key in config.params[lv]) pp[key] = config.params[lv][key];
      params.push(pp);
    }
    var wCap = Wt.cap, wStep = Wt.step, wRegion = Wt.region, wExp1 = Wt.exp1, wExp2 = Wt.exp2, wExpF = Wt.expF,
        wLink = Wt.link, wStrag = Wt.strag, wSafeAdj = Wt.safeAdj, wCapNow = Wt.capNow,
        wThreat1 = Wt.threat1, wThreat2 = Wt.threat2;
    var tocaPen = new Int32Array(N);
    tocaPen[25] = tocaPen[26] = tocaPen[27] = -Wt.toca1;
    tocaPen[28] = tocaPen[29] = tocaPen[30] = -Wt.toca2;

    var MAXPLY = 128, MAXM = 256;
    var bd = new Int8Array(N);
    var jag = 0, cap = 0, stm = 0, hl = 0, hh = 0;      // stm: 0 = jaguar, 1 = dogs
    var mvBuf = new Float64Array(MAXPLY * MAXM);
    var scBuf = new Float64Array(MAXPLY * MAXM);
    var killer = new Float64Array(MAXPLY * 2);
    var hist = new Int32Array(2048);
    var dist = new Int8Array(N), queue = new Int8Array(N + 1);
    var capBase = 0, capN = 0;

    var ttBits = config.ttBits || 20, ttMask = 0;
    var ttLo = null, ttHi = null, ttScore = null, ttDepth = null, ttFlag = null, ttMove = null, ttAge = null;
    var age = 0;

    var nodes = 0, deadline = 0, maxNodes = Infinity, aborted = false;
    var useTT = false, qMax = 4, useKillers = true, useLMR = false, useExt = false, useTrap = true;

    var rootMv = new Float64Array(MAXM), rootScore = new Float64Array(MAXM), rootDone = new Float64Array(MAXM);
    var rootBonus = new Float64Array(MAXM), ord = new Int32Array(MAXM), rootN = 0, iterBestI = -1;

    function ensureTT() {
      if (ttLo) return;
      var size = 1 << ttBits;
      ttMask = size - 1;
      ttLo = new Int32Array(size); ttHi = new Int32Array(size); ttScore = new Int32Array(size);
      ttDepth = new Int8Array(size); ttFlag = new Uint8Array(size); ttMove = new Float64Array(size);
      ttAge = new Uint8Array(size);
    }

    function clear() {
      if (ttFlag) ttFlag.fill(0);
      hist.fill(0);
      killer.fill(0);
    }

    function computeHash() {
      hl = 0; hh = 0;
      for (var p = 0; p < N; p++) {
        if (bd[p] === DOG) { hl ^= ZL[p * 2]; hh ^= ZH[p * 2]; }
        else if (bd[p] === JAGUAR) { hl ^= ZL[p * 2 + 1]; hh ^= ZH[p * 2 + 1]; }
      }
      if (stm === 1) { hl ^= ZSL; hh ^= ZSH; }
    }

    function loadState(s) {
      if (!s || !s.board || s.board.length !== N) throw new Error('chooseMove: invalid state');
      var j = -1;
      for (var p = 0; p < N; p++) {
        var v = s.board[p] | 0;
        if (v !== EMPTY && v !== DOG && v !== JAGUAR) throw new Error('chooseMove: invalid board value');
        bd[p] = v;
        if (v === JAGUAR) j = p;
      }
      if (j < 0) throw new Error('chooseMove: no jaguar on the board');
      jag = j;
      cap = s.captured | 0;
      stm = s.turn === 'D' ? 1 : 0;
      computeHash();
    }

    /* ----- move generation -----
     * quiet move code  = 8*(from + 32*to)                     (len 0)
     * capture code     = len + 8*(from + 32*l1 + 32^2*l2 ...)  (len = number of jumps, 1..5)
     */
    function genCaptures(base) {
      capBase = base; capN = 0;
      var j = jag;
      bd[j] = EMPTY;
      capDFS(j, 1, j, 32);
      bd[j] = JAGUAR;
      return capN;
    }

    function capDFS(cur, L, acc, mul) {
      for (var k = JMP_OFF[cur]; k < JMP_OFF[cur + 1]; k++) {
        var o = JMP_OVER[k], t = JMP_TO[k];
        if (bd[o] !== DOG || bd[t] !== EMPTY) continue;
        var acc2 = acc + mul * t;
        if (capN < MAXM - 16) mvBuf[capBase + capN++] = L + 8 * acc2;
        if (cap + L < CAPTURES_TO_WIN) {
          bd[o] = EMPTY;
          capDFS(t, L + 1, acc2, mul * 32);
          bd[o] = DOG;
        }
      }
    }

    function genMoves(ply) {
      var base = ply * MAXM, n = 0, k, q;
      if (stm === 0) {
        n = genCaptures(base);
        var j = jag;
        for (k = ADJ_OFF[j]; k < ADJ_OFF[j + 1]; k++) {
          q = ADJ_LIST[k];
          if (bd[q] === EMPTY) mvBuf[base + n++] = (j + (q << 5)) << 3;
        }
      } else {
        for (var p = 0; p < N; p++) {
          if (bd[p] !== DOG) continue;
          for (k = ADJ_OFF[p]; k < ADJ_OFF[p + 1]; k++) {
            q = ADJ_LIST[k];
            if (bd[q] === EMPTY) mvBuf[base + n++] = (p + (q << 5)) << 3;
          }
        }
      }
      return n;
    }

    function makeMove(code) {
      var len = code % 8, from, to;
      if (len === 0) {
        from = (code >> 3) & 31; to = code >> 8;
        if (stm === 0) {
          bd[from] = EMPTY; bd[to] = JAGUAR; jag = to;
          hl ^= ZL[from * 2 + 1] ^ ZL[to * 2 + 1]; hh ^= ZH[from * 2 + 1] ^ ZH[to * 2 + 1];
        } else {
          bd[from] = EMPTY; bd[to] = DOG;
          hl ^= ZL[from * 2] ^ ZL[to * 2]; hh ^= ZH[from * 2] ^ ZH[to * 2];
        }
      } else {
        var v = (code - len) / 8;
        from = v % 32; v = (v - from) / 32;
        var cur = from;
        for (var k = 0; k < len; k++) {
          var l = v % 32; v = (v - l) / 32;
          var o = MID[cur * N + l];
          bd[o] = EMPTY; hl ^= ZL[o * 2]; hh ^= ZH[o * 2];
          cur = l;
        }
        bd[from] = EMPTY; bd[cur] = JAGUAR; jag = cur; cap += len;
        hl ^= ZL[from * 2 + 1] ^ ZL[cur * 2 + 1]; hh ^= ZH[from * 2 + 1] ^ ZH[cur * 2 + 1];
      }
      stm ^= 1; hl ^= ZSL; hh ^= ZSH;
    }

    function unmakeMove(code) {
      stm ^= 1; hl ^= ZSL; hh ^= ZSH;
      var len = code % 8, from, to;
      if (len === 0) {
        from = (code >> 3) & 31; to = code >> 8;
        if (stm === 0) {
          bd[to] = EMPTY; bd[from] = JAGUAR; jag = from;
          hl ^= ZL[from * 2 + 1] ^ ZL[to * 2 + 1]; hh ^= ZH[from * 2 + 1] ^ ZH[to * 2 + 1];
        } else {
          bd[to] = EMPTY; bd[from] = DOG;
          hl ^= ZL[from * 2] ^ ZL[to * 2]; hh ^= ZH[from * 2] ^ ZH[to * 2];
        }
      } else {
        var v = (code - len) / 8;
        from = v % 32; v = (v - from) / 32;
        var cur = from;
        bd[jag] = EMPTY;                       // final landing point
        for (var k = 0; k < len; k++) {
          var l = v % 32; v = (v - l) / 32;
          var o = MID[cur * N + l];
          bd[o] = DOG; hl ^= ZL[o * 2]; hh ^= ZH[o * 2];
          cur = l;
        }
        hl ^= ZL[from * 2 + 1] ^ ZL[cur * 2 + 1]; hh ^= ZH[from * 2 + 1] ^ ZH[cur * 2 + 1];
        bd[from] = JAGUAR; jag = from; cap -= len;
      }
    }

    function codeToMove(code, moverIsJ) {
      var len = code % 8;
      if (len === 0) {
        var f = (code >> 3) & 31, t = code >> 8;
        return { type: moverIsJ ? 'step' : 'dog', from: f, to: t };
      }
      var v = (code - len) / 8, from = v % 32;
      v = (v - from) / 32;
      var path = [from], captured = [], cur = from;
      for (var k = 0; k < len; k++) {
        var l = v % 32; v = (v - l) / 32;
        captured.push(MID[cur * N + l]);
        path.push(l);
        cur = l;
      }
      return { type: 'capture', path: path, captured: captured };
    }

    /* ----- evaluation (jaguar's point of view) ----- */
    function evaluate(dogsToMove) {
      var j = jag, k, q, p;
      for (k = 0; k < N; k++) dist[k] = -1;
      dist[j] = 0; queue[0] = j;
      var head = 0, tail = 1;
      while (head < tail) {
        p = queue[head++];
        var dp = dist[p] + 1;
        for (k = ADJ_OFF[p]; k < ADJ_OFF[p + 1]; k++) {
          q = ADJ_LIST[k];
          if (bd[q] === EMPTY && dist[q] < 0) { dist[q] = dp; queue[tail++] = q; }
        }
      }
      var region = tail - 1;
      var steps = 0;
      for (k = ADJ_OFF[j]; k < ADJ_OFF[j + 1]; k++) if (bd[ADJ_LIST[k]] === EMPTY) steps++;
      var caps = 0;
      for (k = JMP_OFF[j]; k < JMP_OFF[j + 1]; k++) if (bd[JMP_OVER[k]] === DOG && bd[JMP_TO[k]] === EMPTY) caps++;

      var links = 0, strag = 0, exp1 = 0, exp2 = 0, expF = 0, safeAdj = 0;
      for (p = 0; p < N; p++) {
        if (bd[p] !== DOG) continue;
        var nd = 0;
        for (k = ADJ_OFF[p]; k < ADJ_OFF[p + 1]; k++) if (bd[ADJ_LIST[k]] === DOG) nd++;
        links += nd;
        if (nd === 0) strag++;
        var m = 99;
        for (k = LIN_OFF[p]; k < LIN_OFF[p + 1]; k++) {
          if (bd[LIN_C[k]] !== EMPTY) continue;
          var a = LIN_A[k];
          if (a === j) { m = 0; break; }
          var da = dist[a];
          if (da > 0 && da < m) m = da;
        }
        if (m === 1) exp1++;
        else if (m === 2) exp2++;
        else if (m > 2 && m < 99) expF++;
        if (m !== 0 && IS_ADJ[p * N + j]) safeAdj++;
      }
      var s = wCap * cap + wStep * steps + wRegion * region + wExp1 * exp1 + wExp2 * exp2 + wExpF * expF -
        wLink * links + wStrag * strag - wSafeAdj * safeAdj + tocaPen[j];
      if (caps > 0) {
        if (!dogsToMove) s += wCapNow;
        else s += wThreat1 + wThreat2 * (caps - 1);
      }
      return s;
    }

    function evalStm() { return stm === 0 ? evaluate(false) : -evaluate(true); }

    function checkLimits() {
      if (nodes >= maxNodes || now() >= deadline) aborted = true;
    }

    function halveHistory() { for (var i = 0; i < hist.length; i++) hist[i] >>= 1; }

    function jaguarLiberties() {
      var n = 0, j = jag;
      for (var k = ADJ_OFF[j]; k < ADJ_OFF[j + 1]; k++) if (bd[ADJ_LIST[k]] === EMPTY) n++;
      return n;
    }

    // dogs to move, jaguar without captures: is there a dog move that leaves the jaguar with no move?
    function dogsCanTrapNow() {
      for (var p = 0; p < N; p++) {
        if (bd[p] !== DOG) continue;
        for (var k = ADJ_OFF[p]; k < ADJ_OFF[p + 1]; k++) {
          var q = ADJ_LIST[k];
          if (bd[q] !== EMPTY) continue;
          bd[p] = EMPTY; bd[q] = DOG;
          var trapped = !jaguarHasAnyMove(bd, jag);
          bd[q] = EMPTY; bd[p] = DOG;
          if (trapped) return true;
        }
      }
      return false;
    }

    /* ----- quiescence: jaguar captures / dog threat evasions ----- */
    function qsearch(alpha, beta, ply, qd) {
      if ((++nodes & 1023) === 0) checkLimits();
      if (aborted) return 0;
      if (cap >= CAPTURES_TO_WIN) return stm === 1 ? -(MATE - ply) : MATE - ply;
      var base = ply * MAXM, i, t, n, score, best, k, code;
      if (stm === 0) {
        var steps = jaguarLiberties();
        n = genCaptures(base);
        if (n === 0) return steps === 0 ? -(MATE - ply) : evaluate(false);
        if (qd >= qMax || ply >= MAXPLY - 2) return evaluate(false);
        if (steps > 0) {
          best = evaluate(true);                 // stand pat: the jaguar may decline the capture
          if (best >= beta) return best;
          if (best > alpha) alpha = best;
        } else best = -INF;
        for (i = 0; i < n; i++) scBuf[base + i] = mvBuf[base + i] % 8;
        for (i = 0; i < n; i++) {
          var bi = i, bs = scBuf[base + i];
          for (t = i + 1; t < n; t++) if (scBuf[base + t] > bs) { bs = scBuf[base + t]; bi = t; }
          if (bi !== i) {
            code = mvBuf[base + i]; mvBuf[base + i] = mvBuf[base + bi]; mvBuf[base + bi] = code;
            scBuf[base + bi] = scBuf[base + i]; scBuf[base + i] = bs;
          }
          code = mvBuf[base + i];
          makeMove(code);
          score = -qsearch(-beta, -alpha, ply + 1, qd + 1);
          unmakeMove(code);
          if (aborted) return 0;
          if (score > best) {
            best = score;
            if (score > alpha) { alpha = score; if (alpha >= beta) break; }
          }
        }
        return best;
      }
      // dogs to move
      var threatMask = 0, landMask = 0, nThreat = 0, jj = jag;
      for (k = JMP_OFF[jj]; k < JMP_OFF[jj + 1]; k++) {
        var o = JMP_OVER[k], tt = JMP_TO[k];
        if (bd[o] === DOG && bd[tt] === EMPTY) { threatMask |= 1 << o; landMask |= 1 << tt; nThreat++; }
      }
      if (nThreat === 0) {
        if (useTrap && jaguarLiberties() <= 1 && dogsCanTrapNow()) return MATE - ply - 1;
        return -evaluate(true);
      }
      if (qd >= qMax || ply >= MAXPLY - 2) return -evaluate(true);
      n = genMoves(ply);
      if (n === 0) return -(MATE - ply);
      // "pass" option: an unrelated dog move, the jaguar then captures
      stm = 0; hl ^= ZSL; hh ^= ZSH;
      best = -qsearch(-beta, -alpha, ply + 1, qd + 1);
      stm = 1; hl ^= ZSL; hh ^= ZSH;
      if (aborted) return 0;
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
      for (i = 0; i < n; i++) {
        code = mvBuf[base + i];
        var from = (code >> 3) & 31, to = code >> 8;
        if (!(((threatMask >>> from) & 1) || ((landMask >>> to) & 1))) continue;
        makeMove(code);
        score = -qsearch(-beta, -alpha, ply + 1, qd + 1);
        unmakeMove(code);
        if (aborted) return 0;
        if (score > best) {
          best = score;
          if (score > alpha) { alpha = score; if (alpha >= beta) break; }
        }
      }
      return best;
    }

    /* ----- main search ----- */
    function negamax(depth, alpha, beta, ply) {
      if ((++nodes & 1023) === 0) checkLimits();
      if (aborted) return 0;
      if (cap >= CAPTURES_TO_WIN) return stm === 1 ? -(MATE - ply) : MATE - ply;
      if (depth <= 0 || ply >= MAXPLY - 12) return qsearch(alpha, beta, ply, 0);

      var ttIdx = 0, ttCode = -1;
      if (useTT) {
        ttIdx = hl & ttMask;
        if (ttFlag[ttIdx] !== 0 && ttLo[ttIdx] === hl && ttHi[ttIdx] === hh) {
          ttCode = ttMove[ttIdx];
          if (ttDepth[ttIdx] >= depth) {
            var ts = ttScore[ttIdx];
            if (ts > MATE_BOUND) ts -= ply; else if (ts < -MATE_BOUND) ts += ply;
            var tf = ttFlag[ttIdx];
            if (tf === TT_EXACT || (tf === TT_LOWER && ts >= beta) || (tf === TT_UPPER && ts <= alpha)) return ts;
          }
        }
      }

      var n = genMoves(ply);
      if (n === 0) return -(MATE - ply);           // side to move has no move -> it loses
      if (n === 1 && useExt) depth++;              // forced reply: look one ply further

      var base = ply * MAXM, i, t, code, len, sc;
      var k1 = killer[ply * 2], k2 = killer[ply * 2 + 1], hb = stm << 10;
      for (i = 0; i < n; i++) {
        code = mvBuf[base + i];
        len = code % 8;
        if (code === ttCode) sc = 4e9;
        else if (len !== 0) sc = 3e9 + len * 1e6;
        else if (code === k1) sc = 2e9;
        else if (code === k2) sc = 1.9e9;
        else sc = hist[hb + (code >> 3)];
        scBuf[base + i] = sc;
      }

      var alphaOrig = alpha, best = -INF, bestCode = 0, score;
      for (i = 0; i < n; i++) {
        var bi = i, bs = scBuf[base + i];
        for (t = i + 1; t < n; t++) if (scBuf[base + t] > bs) { bs = scBuf[base + t]; bi = t; }
        if (bi !== i) {
          code = mvBuf[base + i]; mvBuf[base + i] = mvBuf[base + bi]; mvBuf[base + bi] = code;
          scBuf[base + bi] = scBuf[base + i]; scBuf[base + i] = bs;
        }
        code = mvBuf[base + i];
        makeMove(code);
        if (i === 0) {
          score = -negamax(depth - 1, -beta, -alpha, ply + 1);
        } else {
          var red = 0;
          if (useLMR && depth >= 3 && i >= 4 && code % 8 === 0 && code !== k1 && code !== k2) red = 1;
          score = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1);
          if (red && score > alpha && !aborted) score = -negamax(depth - 1, -alpha - 1, -alpha, ply + 1);
          if (score > alpha && score < beta && !aborted) score = -negamax(depth - 1, -beta, -alpha, ply + 1);
        }
        unmakeMove(code);
        if (aborted) return 0;
        if (score > best) {
          best = score;
          bestCode = code;
          if (score > alpha) {
            alpha = score;
            if (alpha >= beta) {
              if (code % 8 === 0) {
                if (useKillers && code !== k1) { killer[ply * 2 + 1] = k1; killer[ply * 2] = code; }
                var hi = hb + (code >> 3);
                hist[hi] += depth * depth;
                if (hist[hi] > 100000000) halveHistory();
              }
              break;
            }
          }
        }
      }

      if (useTT) {
        var flag = best <= alphaOrig ? TT_UPPER : (best >= beta ? TT_LOWER : TT_EXACT);
        if (ttFlag[ttIdx] === 0 || ttAge[ttIdx] !== age || depth >= ttDepth[ttIdx] || flag === TT_EXACT) {
          var ss = best;
          if (ss > MATE_BOUND) ss += ply; else if (ss < -MATE_BOUND) ss -= ply;
          ttLo[ttIdx] = hl; ttHi[ttIdx] = hh; ttScore[ttIdx] = ss;
          ttDepth[ttIdx] = depth > 127 ? 127 : depth;
          ttFlag[ttIdx] = flag; ttMove[ttIdx] = bestCode; ttAge[ttIdx] = age;
        }
      }
      return best;
    }

    function rootSearch(depth, alpha, beta, exactAll) {
      var best = -INF, alpha0 = alpha;
      for (var oi = 0; oi < rootN; oi++) {
        var i = ord[oi], code = rootMv[i], bonus = rootBonus[i], s;
        makeMove(code);
        if (exactAll) {
          s = -negamax(depth - 1, -INF, INF, 1) + bonus;
        } else if (oi === 0) {
          s = -negamax(depth - 1, -(beta - bonus), -(alpha - bonus), 1) + bonus;
        } else {
          s = -negamax(depth - 1, -(alpha - bonus) - 1, -(alpha - bonus), 1) + bonus;
          if (!aborted && s > alpha && s < beta) s = -negamax(depth - 1, -(beta - bonus), -(alpha - bonus), 1) + bonus;
        }
        unmakeMove(code);
        if (aborted) break;
        rootScore[i] = s;
        if (s > best) {
          best = s;
          if (s > alpha0) iterBestI = i;
        }
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }
      return best;
    }

    function sortRoot() {
      for (var a = 1; a < rootN; a++) {
        var x = ord[a], sx = rootScore[x], b = a - 1;
        while (b >= 0 && rootScore[ord[b]] < sx) { ord[b + 1] = ord[b]; b--; }
        ord[b + 1] = x;
      }
    }

    function boardKeyAfter(code) {
      makeMove(code);
      var str = '';
      for (var p = 0; p < N; p++) str += bd[p];
      str += stm === 0 ? 'J' : 'D';
      unmakeMove(code);
      return str;
    }

    // penalty per root move for recreating positions already seen in this game
    function repetitionPenalties(history) {
      if (!history || !history.length) return null;
      var counts = {}, L = history.length, h, e;
      for (h = 0; h < L; h++) {
        var kk = history[h];
        if (typeof kk !== 'string') continue;
        e = counts[kk];
        if (!e) counts[kk] = e = [0, 0];
        e[0]++;
        if (L - h <= 16) e[1]++;
      }
      var pen = new Float64Array(rootN), any = false;
      for (var i = 0; i < rootN; i++) {
        e = counts[boardKeyAfter(rootMv[i])];
        if (e) { pen[i] = Math.min(400, 30 * e[0] + 50 * e[1]); any = true; }
      }
      return any ? pen : null;
    }

    function think(s, level, opts) {
      var t0 = now();
      opts = opts || {};
      level = clampLevel(level);
      var P = params[level];
      var limit = (+opts.timeLimitMs > 0) ? +opts.timeLimitMs : P.time;
      var rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
      var stats = { depth: 0, nodes: 0, ms: 0, score: 0, level: level };
      loadState(s);
      var moverIsJ = stm === 0;
      if (cap >= CAPTURES_TO_WIN) { stats.ms = now() - t0; return { move: null, stats: stats }; }

      var midChain = moverIsJ && (s.chain | 0) > 0;
      var n = genMoves(0), i;
      rootN = 0;
      for (i = 0; i < n; i++) {
        var c0 = mvBuf[i];
        if (midChain && c0 % 8 === 0) continue;
        rootMv[rootN++] = c0;
      }
      if (rootN === 0) { stats.ms = now() - t0; return { move: null, stats: stats }; }
      if (rootN === 1) { stats.ms = now() - t0; return { move: codeToMove(rootMv[0], moverIsJ), stats: stats }; }

      useTT = !!P.tt && opts.useTT !== false;
      qMax = P.qMax; useKillers = !!P.killers; useLMR = !!P.lmr; useExt = !!P.ext; useTrap = P.trap !== false;
      if (useTT) ensureTT();
      age = (age + 1) & 255;
      nodes = 0; aborted = false;
      deadline = t0 + Math.max(5, limit - SAFETY_MS);
      // Node budget: explicit (opts.maxNodes) or a safety net ~6x the measured speed (~1M nodes/s)
      // so the search also stops if the clock does not advance (seen in headless virtual time).
      maxNodes = (+opts.maxNodes > 0) ? +opts.maxNodes : Math.max(200000, Math.round(limit * 6000));
      killer.fill(0);
      for (i = 0; i < hist.length; i++) hist[i] >>= 2;

      // initial root order: static evaluation of each move (captures naturally first)
      for (i = 0; i < rootN; i++) {
        makeMove(rootMv[i]);
        rootScore[i] = -evalStm();
        unmakeMove(rootMv[i]);
        ord[i] = i;
      }
      sortRoot();

      // root bonuses: small noise (level 2) and repetition penalties (unless losing)
      var repPen = repetitionPenalties(opts.history);
      var standing = evalStm();
      var noiseAmp = P.exact ? 0 : (P.noise || 0);
      var noise = new Float64Array(rootN);
      for (i = 0; i < rootN; i++) noise[i] = noiseAmp ? (rng() * 2 - 1) * noiseAmp : 0;
      function setBonuses(applyRep) {
        for (var q = 0; q < rootN; q++) rootBonus[q] = noise[q] - (applyRep && repPen ? repPen[q] : 0);
      }
      setBonuses(standing > -LOSING);

      var bestI = -1, bestScore = 0, completed = 0;
      var maxDepth = (+opts.maxDepth > 0) ? Math.min(Math.floor(+opts.maxDepth), 64) : P.maxDepth;
      for (var d = 1; d <= maxDepth; d++) {
        iterBestI = -1;
        var sc;
        if (P.asp && d >= 3 && completed > 0 && Math.abs(bestScore) < MATE_BOUND) {
          var lo = bestScore - 60, hi = bestScore + 60;
          sc = rootSearch(d, lo, hi, false);
          if (!aborted && (sc <= lo || sc >= hi)) sc = rootSearch(d, -INF, INF, false);
        } else {
          sc = rootSearch(d, -INF, INF, !!P.exact);
        }
        if (aborted) {
          if (iterBestI >= 0) bestI = iterBestI;
          break;
        }
        bestI = iterBestI;
        bestScore = sc;
        completed = d;
        for (i = 0; i < rootN; i++) rootDone[i] = rootScore[i];
        sortRoot();
        var raw = bestI >= 0 ? sc - rootBonus[bestI] : sc;
        if (repPen && raw <= -LOSING) setBonuses(false);   // losing: repetition is welcome
        if (Math.abs(raw) > MATE_BOUND) break;              // forced result found
        if (d >= 2 && now() - t0 > limit * 0.55) break;     // next iteration would not finish
      }

      var chosen = bestI >= 0 ? bestI : ord[0];
      if (P.exact && completed > 0) {
        // Básico: frequent random / noisy choices, but usually takes a free capture
        var caps = [];
        for (i = 0; i < rootN; i++) if (rootMv[i] % 8 !== 0) caps.push(i);
        if (moverIsJ && caps.length && rng() < P.takeCapture) {
          chosen = caps[0];
          for (i = 1; i < caps.length; i++) if (rootDone[caps[i]] > rootDone[chosen]) chosen = caps[i];
        } else if (rng() < P.randomRate) {
          chosen = Math.floor(rng() * rootN);
          if (chosen >= rootN) chosen = rootN - 1;
        } else {
          var bestNoisy = -INF;
          for (i = 0; i < rootN; i++) {
            var v = rootDone[i] + (rng() * 2 - 1) * P.noise;
            if (v > bestNoisy) { bestNoisy = v; chosen = i; }
          }
        }
      }
      stats.depth = completed;
      stats.nodes = nodes;
      stats.ms = Math.round((now() - t0) * 10) / 10;
      stats.score = Math.round(completed > 0 ? rootDone[chosen] - rootBonus[chosen] : 0);
      return { move: codeToMove(rootMv[chosen], moverIsJ), stats: stats };
    }

    function chooseMoveWithStats(s, level, opts) {
      try {
        return think(s, level, opts);
      } catch (err) {
        // never throw: fall back to the first legal move (or null)
        var ms = [];
        try { ms = legalMoves(s); } catch (e2) { ms = []; }
        return { move: ms.length ? ms[0] : null, stats: { depth: 0, nodes: 0, ms: 0, error: String(err && err.message || err) } };
      }
    }

    function chooseMove(s, level, opts) { return chooseMoveWithStats(s, level, opts).move; }

    // static evaluation of a state from the jaguar's point of view (debug / tests)
    function evaluateState(s) {
      loadState(s);
      return evaluate(stm === 1);
    }

    // tests: the engine's own move list (decoded) and the internal result of make/unmake
    function debugAfterMoves(s) {
      loadState(s);
      var n = genMoves(0), res = [], moverIsJ = stm === 0, i, p;
      var snap = Array.prototype.slice.call(bd), j0 = jag, c0 = cap, s0 = stm, hl0 = hl, hh0 = hh;
      var codes = [];
      for (i = 0; i < n; i++) codes.push(mvBuf[i]);
      for (i = 0; i < codes.length; i++) {
        var code = codes[i], errs = [];
        makeMove(code);
        var hlI = hl, hhI = hh;
        computeHash();
        if (hl !== hlI || hh !== hhI) errs.push('incremental hash differs from full hash');
        hl = hlI; hh = hhI;
        var after = { move: codeToMove(code, moverIsJ), board: Array.prototype.slice.call(bd), jaguar: jag, captured: cap, turn: stm === 0 ? 'J' : 'D' };
        unmakeMove(code);
        for (p = 0; p < N; p++) if (bd[p] !== snap[p]) { errs.push('unmake did not restore point ' + p); break; }
        if (jag !== j0 || cap !== c0 || stm !== s0 || hl !== hl0 || hh !== hh0) errs.push('unmake did not restore jaguar/captured/turn/hash');
        after.errors = errs;
        res.push(after);
      }
      return res;
    }

    return {
      chooseMove: chooseMove, chooseMoveWithStats: chooseMoveWithStats, clear: clear, evaluate: evaluateState,
      _debugAfterMoves: debugAfterMoves
    };
  }

  var defaultAI = null;
  function getDefaultAI() { return defaultAI || (defaultAI = createAI()); }
  function chooseMove(s, level, opts) { return getDefaultAI().chooseMove(s, level, opts); }
  function chooseMoveWithStats(s, level, opts) { return getDefaultAI().chooseMoveWithStats(s, level, opts); }

  /* =====================================================================
   * Worker support
   * ===================================================================== */
  function handleWorkerMessage(data, post) {
    var d = data || {};
    try {
      var opts = { history: Array.isArray(d.history) ? d.history : [] };
      if (+d.timeLimitMs > 0) opts.timeLimitMs = +d.timeLimitMs;
      var res = chooseMoveWithStats(d.state, d.level, opts);
      var st = res.stats || {};
      post({ id: d.id, move: res.move, stats: { depth: st.depth | 0, nodes: st.nodes | 0, ms: +st.ms || 0, score: st.score | 0 } });
    } catch (err) {
      post({ id: d.id, move: null, stats: { depth: 0, nodes: 0, ms: 0 }, error: String(err && err.message || err) });
    }
  }

  function installWorkerHandler(scope) {
    scope.onmessage = function (e) {
      handleWorkerMessage(e && e.data, function (msg) { scope.postMessage(msg); });
    };
  }

  // Source of this whole module, runnable inside a Worker (works even when the
  // module is inlined into a single index.html).
  function workerSource() { return '(' + factory.toString() + ')(self);\n'; }

  function createWorker() {
    try {
      if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
      var url = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
      return new Worker(url);
    } catch (e) {
      return null;
    }
  }

  // Promise-based helper for the UI: runs the AI in a Worker when possible, otherwise
  // on the main thread (after a short timeout so the UI can paint first).
  // Resolves with {move, stats}. Never rejects.
  var asyncWorker = null, asyncWorkerFailed = false, asyncPending = {}, asyncNextId = 1;
  function syncFallback(args) { return chooseMoveWithStats(args.state, args.level, args.opts); }
  function dropAsyncWorker() {
    if (asyncWorker) { try { asyncWorker.terminate(); } catch (e) { /* ignore */ } }
    asyncWorker = null;
    var ids = Object.keys(asyncPending);
    for (var k = 0; k < ids.length; k++) {
      var p = asyncPending[ids[k]];
      delete asyncPending[ids[k]];
      clearTimeout(p.timer);
      p.resolve(syncFallback(p.args));
    }
  }
  function getAsyncWorker() {
    if (asyncWorker || asyncWorkerFailed) return asyncWorker;
    asyncWorker = createWorker();
    if (!asyncWorker) { asyncWorkerFailed = true; return null; }
    asyncWorker.onmessage = function (e) {
      var d = e.data || {}, p = asyncPending[d.id];
      if (!p) return;
      delete asyncPending[d.id];
      clearTimeout(p.timer);
      if (d.error) p.resolve(syncFallback(p.args));
      else p.resolve({ move: d.move, stats: d.stats, worker: true });
    };
    asyncWorker.onerror = function () { asyncWorkerFailed = true; dropAsyncWorker(); };
    return asyncWorker;
  }
  function chooseMoveAsync(state, level, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var args = { state: state, level: level, opts: opts };
      var w = opts.useWorker === false ? null : getAsyncWorker();
      if (!w) { setTimeout(function () { resolve(syncFallback(args)); }, 30); return; }
      var id = asyncNextId++;
      var limit = (+opts.timeLimitMs > 0) ? +opts.timeLimitMs : (DEFAULT_TIME_MS[clampLevel(level)] || 1000);
      var watchdog = (+opts.watchdogMs > 0) ? +opts.watchdogMs : limit + 5000;
      asyncPending[id] = {
        resolve: resolve,
        args: args,
        timer: setTimeout(function () {           // watchdog: worker stuck -> main thread
          if (!asyncPending[id]) return;
          delete asyncPending[id];
          dropAsyncWorker();
          resolve(syncFallback(args));
        }, watchdog)
      };
      try {
        w.postMessage({ id: id, state: cloneState(state), level: level, history: opts.history || [], timeLimitMs: opts.timeLimitMs });
      } catch (err) {
        clearTimeout(asyncPending[id].timer);
        delete asyncPending[id];
        resolve(syncFallback(args));
      }
    });
  }

  /* =====================================================================
   * Export
   * ===================================================================== */
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }
  deepFreeze(NODES); deepFreeze(EDGES); deepFreeze(ADJ); deepFreeze(JUMPS); deepFreeze(LEVELS);
  deepFreeze(DEFAULT_TIME_MS);

  var api = {
    VERSION: VERSION,
    N: N, EMPTY: EMPTY, DOG: DOG, JAGUAR: JAGUAR, CAPTURES_TO_WIN: CAPTURES_TO_WIN,
    NODES: NODES, index: index, ADJ: ADJ, EDGES: EDGES, JUMPS: JUMPS,
    initialState: initialState, cloneState: cloneState,
    dogMoves: dogMoves, jaguarSteps: jaguarSteps, jaguarCaptures: jaguarCaptures,
    applyDogMove: applyDogMove, applyJaguarStep: applyJaguarStep,
    applyJaguarCapture: applyJaguarCapture, endJaguarTurn: endJaguarTurn,
    winner: winner, positionKey: positionKey, applyMove: applyMove, legalMoves: legalMoves,
    LEVELS: LEVELS, DEFAULT_TIME_MS: DEFAULT_TIME_MS,
    chooseMove: chooseMove, chooseMoveWithStats: chooseMoveWithStats, createAI: createAI,
    chooseMoveAsync: chooseMoveAsync, createWorker: createWorker, workerSource: workerSource,
    handleWorkerMessage: handleWorkerMessage, installWorkerHandler: installWorkerHandler
  };
  root.OncaLogic = api;

  if (typeof importScripts === 'function' && typeof document === 'undefined') installWorkerHandler(root);
})(typeof self !== 'undefined' ? self : this);
