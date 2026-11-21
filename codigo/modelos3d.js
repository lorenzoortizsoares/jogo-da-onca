/* ==========================================================================
 * Jogo da Onça — módulo de arte 3D
 * Tabuleiro (tábua de madeira pirografada) + bonequinhos de madeira esculpidos.
 *
 * Script CLÁSSICO (sem import/export) para funcionar em file://.
 * Define:  window.createOncaModels = function (THREE) { ...; return api; }
 *
 * Mapeamento (contrato compartilhado):
 *   ponto (r,c) -> x = (c-2)*S, z = (r-3)*S, y = 0 (topo do tabuleiro)
 *   pontos 0..24 = grade 5x5 (r*5+c); 25..30 = toca (5,1),(5,2),(5,3),(6,0),(6,2),(6,4)
 * ========================================================================== */
(function () {
  'use strict';

  window.createOncaModels = function createOncaModels(THREE, opts) {
    if (!THREE || !THREE.Mesh) throw new Error('createOncaModels(THREE): passe o namespace THREE');
    // opções (todas opcionais): carve = intensidade das facetas de entalhe nos bonecos
    const OPT = Object.assign({ carve: 0.0016 }, opts || {});

    const api = {};
    const S = 1;
    api.S = S;

    /* ------------------------------------------------------------------ *
     * 1. Grafo do tabuleiro (cópia própria para desenhar)
     * ------------------------------------------------------------------ */
    const PTS = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) PTS.push([r, c]);
    PTS.push([5, 1], [5, 2], [5, 3], [6, 0], [6, 2], [6, 4]);
    const IDX = {};
    PTS.forEach(function (p, i) { IDX[p[0] + ',' + p[1]] = i; });
    const EDGES = [];
    function link(r1, c1, r2, c2) { EDGES.push([IDX[r1 + ',' + c1], IDX[r2 + ',' + c2]]); }
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (c < 4) link(r, c, r, c + 1);
        if (r < 4) link(r, c, r + 1, c);
        if ((r + c) % 2 === 0 && r < 4) {
          if (c < 4) link(r, c, r + 1, c + 1);
          if (c > 0) link(r, c, r + 1, c - 1);
        }
      }
    }
    [[4, 2, 5, 1], [4, 2, 5, 2], [4, 2, 5, 3], [5, 1, 5, 2], [5, 2, 5, 3],
     [5, 1, 6, 0], [5, 2, 6, 2], [5, 3, 6, 4], [6, 0, 6, 2], [6, 2, 6, 4]]
      .forEach(function (e) { link(e[0], e[1], e[2], e[3]); });

    function pxz(i) { const p = PTS[i]; return [(p[1] - 2) * S, (p[0] - 3) * S]; }
    api.pointToWorld = function (i) {
      const q = pxz(i);
      return new THREE.Vector3(q[0], 0, q[1]);
    };
    api.POINTS = PTS.map(function (p) { return p.slice(); });
    api.EDGES = EDGES.map(function (e) { return e.slice(); });

    /* ------------------------------------------------------------------ *
     * 2. Utilidades
     * ------------------------------------------------------------------ */
    function rng(seed) {               // mulberry32 (determinístico)
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function canvas(w, h) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      return cv;
    }
    // Canvas 2D em software (willReadFrequently): evita travar o processo de GPU
    // em ambientes sem GPU real (SwiftShader) ao pintar texturas grandes com blur.
    function ctx2d(cv) {
      return cv.getContext('2d', { willReadFrequently: true }) || cv.getContext('2d');
    }
    function colorTex(cv, aniso) {
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso || 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    }

    /* ------------------------------------------------------------------ *
     * 3. Material de madeira procedural (veios contínuos em espaço do objeto)
     *    MeshStandardMaterial + onBeforeCompile: anéis de crescimento, fibras,
     *    poros e manchas, com anti-serrilhado por fwidth. Nada de tinta.
     * ------------------------------------------------------------------ */
    const WOOD_PARS = [
      'varying vec3 vWoodPos;',
      'uniform vec3 uWoodA;',   // lenho claro (primaveril)
      'uniform vec3 uWoodB;',   // lenho escuro (outonal)
      'uniform vec3 uWoodC;',   // poros / estrias
      'uniform vec4 uWoodP;',   // x freq. anéis, y escala, z distorção, w contraste fibras
      'uniform vec4 uWoodQ;',   // x inclinação da medula, y contraste anéis, z manchas, w poros
      'uniform vec3 uWoodO;',   // deslocamento da medula
      'float wHash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0;',
      '  return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
      'float wNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(mix(wHash(i), wHash(i + vec3(1.0,0.0,0.0)), f.x),',
      '                 mix(wHash(i + vec3(0.0,1.0,0.0)), wHash(i + vec3(1.0,1.0,0.0)), f.x), f.y),',
      '             mix(mix(wHash(i + vec3(0.0,0.0,1.0)), wHash(i + vec3(1.0,0.0,1.0)), f.x),',
      '                 mix(wHash(i + vec3(0.0,1.0,1.0)), wHash(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z); }',
      'float wFbm(vec3 p){ return 0.5 * wNoise(p) + 0.25 * wNoise(p * 2.03 + 3.1) + 0.125 * wNoise(p * 4.07 + 7.3); }',
      'float woodLate;',
      'vec3 oncaWood(vec3 P, float fw){',
      '  vec3 p = P * uWoodP.y + uWoodO;',
      '  p.y += p.z * uWoodQ.x;',
      '  float pfw = fw * uWoodP.y;',
      '  float warp = wFbm(p * vec3(1.1, 1.1, 0.28));',
      '  float r = length(p.xy) + (warp - 0.45) * uWoodP.z;',
      '  float ring = fract(r * uWoodP.x);',
      '  float late = smoothstep(0.58, 0.9, ring) * (1.0 - smoothstep(0.9, 1.0, ring));',
      '  late = mix(0.3, late, 1.0 - smoothstep(0.12, 0.45, pfw * uWoodP.x));',
      '  float fib = wNoise(vec3(p.x * 38.0, p.y * 38.0, p.z * 1.8));',
      '  fib = mix(0.5, fib, 1.0 - smoothstep(0.2, 0.55, pfw * 38.0));',
      '  float fib2 = wNoise(vec3(p.x * 9.0, p.y * 9.0, p.z * 0.7) + 5.0);',
      '  float blot = wNoise(p * vec3(1.4, 1.4, 0.45) + 11.0);',
      '  float k = clamp(late * uWoodQ.y + (blot - 0.5) * uWoodQ.z + (fib2 - 0.5) * 0.35 * uWoodQ.z, 0.0, 1.0);',
      '  vec3 col = mix(uWoodA, uWoodB, k);',
      '  col *= 1.0 + (fib - 0.5) * uWoodP.w;',
      '  float pore = smoothstep(0.74, 0.9, wNoise(vec3(p.x * 95.0, p.y * 95.0, p.z * 5.0)));',
      '  pore *= (1.0 - smoothstep(0.2, 0.5, pfw * 95.0)) * uWoodQ.w;',
      '  col = mix(col, uWoodC, pore);',
      '  woodLate = late;',
      '  return col;',
      '}'
    ].join('\n');

    function woodMaterial(o) {
      const u = {
        uWoodA: { value: new THREE.Color(o.a) },
        uWoodB: { value: new THREE.Color(o.b) },
        uWoodC: { value: new THREE.Color(o.c) },
        uWoodP: { value: new THREE.Vector4(o.ringFreq, o.scale, o.warp, o.fibre) },
        uWoodQ: { value: new THREE.Vector4(o.tilt, o.ringContrast, o.blotch, o.pores) },
        uWoodO: { value: new THREE.Vector3(o.offset[0], o.offset[1], o.offset[2]) }
      };
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: o.roughness,
        metalness: 0,
        envMapIntensity: o.envI !== undefined ? o.envI : 0.45
      });
      if (o.map) m.map = o.map;
      if (o.bumpMap) { m.bumpMap = o.bumpMap; m.bumpScale = o.bumpScale || 1; }
      m.onBeforeCompile = function (sh) {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = 'varying vec3 vWoodPos;\n' + sh.vertexShader.replace(
          '#include <begin_vertex>', '#include <begin_vertex>\n  vWoodPos = position;');
        sh.fragmentShader = WOOD_PARS + '\n' + sh.fragmentShader
          .replace('#include <color_fragment>',
            '#include <color_fragment>\n  { float wfw = length(fwidth(vWoodPos)); diffuseColor.rgb *= oncaWood(vWoodPos, wfw); }')
          .replace('#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (1.0 - 0.16 * woodLate), 0.04, 1.0);');
      };
      m.customProgramCacheKey = function () { return 'oncaWood1'; };
      m.userData.woodUniforms = u;
      return m;
    }

    // Paletas (hex em sRGB; THREE.Color converte para linear)
    const WOOD = {
      board: { a: 0xC0915E, b: 0x99693D, c: 0x5E3A1E, ringFreq: 4.2, scale: 1.0, warp: 0.38, fibre: 0.20,
               tilt: 0.11, ringContrast: 0.62, blotch: 0.32, pores: 0.32, offset: [0.85, -1.45, 0.3], roughness: 0.66 },
      tray:  { a: 0xB98250, b: 0x8E5D30, c: 0x553419, ringFreq: 4.6, scale: 1.0, warp: 0.32, fibre: 0.20,
               tilt: 0.16, ringContrast: 0.6, blotch: 0.3, pores: 0.3, offset: [-2.6, 1.3, 0.0], roughness: 0.66 },
      dog:   { a: 0xE2B676, b: 0xB98848, c: 0x8E6236, ringFreq: 3.1, scale: 2.6, warp: 0.30, fibre: 0.12,
               tilt: 0.05, ringContrast: 0.7, blotch: 0.2, pores: 0.25, offset: [0.6, 1.2, 0.0], roughness: 0.5 },
      dogDark: { a: 0x55331C, b: 0x3E2312, c: 0x2A170B, ringFreq: 3.0, scale: 2.6, warp: 0.3, fibre: 0.08,
               tilt: 0.0, ringContrast: 0.3, blotch: 0.1, pores: 0.0, offset: [0.2, 0.4, 0.0], roughness: 0.3 },
      puma:  { a: 0x52301C, b: 0x2F180B, c: 0x1A0C05, ringFreq: 2.8, scale: 2.4, warp: 0.32, fibre: 0.14,
               tilt: 0.06, ringContrast: 0.55, blotch: 0.22, pores: 0.25, offset: [-0.7, 1.1, 0.0], roughness: 0.42 },
      pumaDark: { a: 0x1E100A, b: 0x150B06, c: 0x0B0603, ringFreq: 3.0, scale: 2.4, warp: 0.3, fibre: 0.06,
               tilt: 0.0, ringContrast: 0.25, blotch: 0.1, pores: 0.0, offset: [0.3, 0.2, 0.0], roughness: 0.26 }
    };

    /* ------------------------------------------------------------------ *
     * 4. Ajudantes de geometria (modelagem por primitivas fundidas)
     * ------------------------------------------------------------------ */
    const V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };
    function mtx(p, r, s, order) {
      return new THREE.Matrix4().compose(
        V3(p[0], p[1], p[2]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, order || 'XYZ')),
        V3(s ? s[0] : 1, s ? s[1] : 1, s ? s[2] : 1));
    }
    function flat(g) {                 // facetas de entalhe (normais por face)
      const n = g.index ? g.toNonIndexed() : g;
      n.deleteAttribute('normal');
      n.computeVertexNormals();
      return n;
    }
    // elipsoide; rad = número ou [rx,ry,rz]; o = {r:[ex,ey,ez], order, w, h, flat}
    function sph(p, rad, o) {
      o = o || {};
      const g = new THREE.SphereGeometry(1, o.w || 20, o.h || 14);
      const rr = Array.isArray(rad) ? rad : [rad, rad, rad];
      g.applyMatrix4(mtx(p, o.r, rr, o.order));
      return o.flat ? flat(g) : g;
    }
    // membro cônico entre a e b, com tampas esféricas
    function limb(a, b, ra, rb, o) {
      o = o || {};
      const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]);
      const d = B.clone().sub(A);
      const len = d.length();
      const seg = o.seg || 14;
      const g = new THREE.CylinderGeometry(rb, ra, len, seg, 3, true);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()));
      g.translate(A.x, A.y, A.z);
      const out = [g];
      if (o.capA !== false) out.push(sph(a, ra, { w: seg, h: 10 }));
      if (o.capB !== false) out.push(sph(b, rb, { w: seg, h: 10 }));
      return out;
    }
    // tubo afilado ao longo de uma curva suave (rabos)
    function tube(points, radius, o) {
      o = o || {};
      const rf = typeof radius === 'function' ? radius : function (t) { return radius[0] + (radius[1] - radius[0]) * t; };
      const curve = new THREE.CatmullRomCurve3(points.map(function (p) { return V3(p[0], p[1], p[2]); }), false, 'catmullrom', 0.5);
      const ts = o.ts || 48, rs = o.rs || 14;
      const fr = curve.computeFrenetFrames(ts, false);
      const pos = [], nor = [], idx = [];
      for (let i = 0; i <= ts; i++) {
        const t = i / ts, P = curve.getPointAt(t), N = fr.normals[i], Bn = fr.binormals[i], r = rf(t);
        for (let j = 0; j <= rs; j++) {
          const v = j / rs * Math.PI * 2, sn = Math.sin(v), cs = -Math.cos(v);
          const nx = cs * N.x + sn * Bn.x, ny = cs * N.y + sn * Bn.y, nz = cs * N.z + sn * Bn.z;
          nor.push(nx, ny, nz);
          pos.push(P.x + r * nx, P.y + r * ny, P.z + r * nz);
        }
      }
      for (let i = 0; i < ts; i++) {
        for (let j = 0; j < rs; j++) {
          const a = i * (rs + 1) + j, b = (i + 1) * (rs + 1) + j, c = (i + 1) * (rs + 1) + j + 1, d = i * (rs + 1) + j + 1;
          idx.push(a, b, d, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      const out = [g];
      if (o.capStart !== false) out.push(sph(points[0], rf(0), { w: rs, h: 10 }));
      out.push(sph(curve.getPointAt(1).toArray(), rf(1), { w: rs, h: 10 }));
      return out;
    }
    // cone/frustum ao longo de +Y (base na origem), achatado em Z, depois orientado
    function cone(p, rBase, rTop, h, flatZ, rot, order, seg) {
      const g = new THREE.CylinderGeometry(rTop, rBase, h, seg || 10, 3, false);
      g.translate(0, h / 2, 0);
      g.applyMatrix4(mtx(p, rot, [1, 1, flatZ], order || 'ZXY'));
      return g;
    }
    function lathe(profile, seg) {
      return new THREE.LatheGeometry(profile.map(function (q) { return new THREE.Vector2(q[0], q[1]); }), seg || 48);
    }
    // perfil por quadros-chave: keys = [[t, v1, v2, ...], ...]; pontas arredondadas (endA/endB)
    function keyed(keys, endA, endB) {
      return function (t) {
        let k = 0;
        while (k < keys.length - 2 && t > keys[k + 1][0]) k++;
        const A = keys[k], B = keys[k + 1];
        let u = (t - A[0]) / (B[0] - A[0]);
        u = Math.min(1, Math.max(0, u));
        u = u * u * (3 - 2 * u);
        let env = 1;
        if (endA && t < endA) env = Math.sqrt(Math.max(0, 1 - Math.pow(1 - t / endA, 2)));
        if (endB && t > 1 - endB) env = Math.min(env, Math.sqrt(Math.max(0, 1 - Math.pow(1 - (1 - t) / endB, 2))));
        const out = [];
        for (let i = 1; i < A.length; i++) out.push((A[i] + (B[i] - A[i]) * u) * Math.max(env, 0.0001));
        return out;
      };
    }
    // "loft": corpo esculpido contínuo ao longo de uma coluna (spine) com seções elípticas.
    // prof(t) -> [rx (lateral), ru (dorsal), rd (ventral)]. side = eixo lateral (padrão +X).
    function loft(spine, prof, o) {
      o = o || {};
      const curve = new THREE.CatmullRomCurve3(spine.map(function (p) { return V3(p[0], p[1], p[2]); }), false, 'catmullrom', 0.5);
      const ns = o.ns || 32, nr = o.nr || 18;
      const side0 = o.side ? V3(o.side[0], o.side[1], o.side[2]) : V3(1, 0, 0);
      const pos = [], idx = [];
      for (let i = 0; i <= ns; i++) {
        const t = 0.5 - 0.5 * Math.cos(Math.PI * i / ns);          // mais denso nas pontas
        const C = curve.getPointAt(t), T = curve.getTangentAt(t).normalize();
        const sd = side0.clone().addScaledVector(T, -side0.dot(T)).normalize();
        const U = V3(0, 0, 0).crossVectors(T, sd).normalize();
        const p = prof(t);
        for (let j = 0; j < nr; j++) {
          const a = j / nr * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          const ry = s >= 0 ? p[1] : p[2];
          pos.push(C.x + sd.x * p[0] * c + U.x * ry * s,
                   C.y + sd.y * p[0] * c + U.y * ry * s,
                   C.z + sd.z * p[0] * c + U.z * ry * s);
        }
      }
      for (let i = 0; i < ns; i++) {
        for (let j = 0; j < nr; j++) {
          const a = i * nr + j, b = (i + 1) * nr + j, c = (i + 1) * nr + (j + 1) % nr, d = i * nr + (j + 1) % nr;
          idx.push(a, d, b, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    // marcas de entalhe: leve irregularidade + facetas (normais por face)
    function carve(g, amp) {
      if (!amp) return g;
      if (Array.isArray(g)) return g.map(function (x) { return carve(x, amp); });
      const pos = g.attributes.position, nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const h = Math.sin(x * 1291.7 + y * 3117.3 + z * 2133.1) * 43758.5453;
        const r = (h - Math.floor(h) - 0.5) * 2 * amp;
        pos.setXYZ(i, x + nor.getX(i) * r, y + nor.getY(i) * r, z + nor.getZ(i) * r);
      }
      return flat(g);
    }
    function flatten(list) {
      const out = [];
      (function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x) out.push(x); })(list);
      return out;
    }
    function applyAll(list, m) { flatten(list).forEach(function (g) { g.applyMatrix4(m); }); return list; }
    function merge(list) {
      const parts = flatten(list).map(function (g) { return g.index ? g.toNonIndexed() : g; });
      let n = 0;
      parts.forEach(function (g) { n += g.attributes.position.count; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      let o = 0;
      parts.forEach(function (g) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        o += g.attributes.position.count;
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.computeBoundingBox();
      out.computeBoundingSphere();
      return out;
    }
    // normais suaves para geometria não indexada (soldando posições iguais)
    function smoothNormals(g) {
      const pos = g.attributes.position, n = pos.count;
      const map = new Map(), keys = new Int32Array(n), acc = [];
      for (let i = 0; i < n; i++) {
        const k = Math.round(pos.getX(i) * 1e4) + '_' + Math.round(pos.getY(i) * 1e4) + '_' + Math.round(pos.getZ(i) * 1e4);
        let id = map.get(k);
        if (id === undefined) { id = acc.length / 3; map.set(k, id); acc.push(0, 0, 0); }
        keys[i] = id;
      }
      const a = V3(0, 0, 0), b = V3(0, 0, 0), c = V3(0, 0, 0), cb = V3(0, 0, 0), ab = V3(0, 0, 0);
      for (let i = 0; i + 2 < n; i += 3) {
        a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
        cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab);
        const l = cb.length();
        if (l > 0) cb.multiplyScalar(Math.min(1, Math.sqrt(l)) / l);   // peso moderado por área
        for (let j = 0; j < 3; j++) { const id = keys[i + j] * 3; acc[id] += cb.x; acc[id + 1] += cb.y; acc[id + 2] += cb.z; }
      }
      const nor = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const id = keys[i] * 3, x = acc[id], y = acc[id + 1], z = acc[id + 2], l = Math.hypot(x, y, z) || 1;
        nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
      }
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return g;
    }

    /* ------------------------------------------------------------------ *
     * 5. Pirografia (canvas): linhas queimadas com halo chamuscado
     * ------------------------------------------------------------------ */
    // polilinha com tremor de mão (pontas fixas)
    function burnLine(x1, y1, x2, y2, R, amp, step) {
      const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(2, Math.ceil(L / step));
      const nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
      const p1 = R() * 6.283, p2 = R() * 6.283, f1 = 0.6 + R() * 1.2, f2 = 2.5 + R() * 3, p3 = R() * 6.283, f3 = 1 + R() * 3;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, env = Math.sin(Math.PI * t);
        const off = amp * env * (0.65 * Math.sin(6.283 * f1 * t + p1) + 0.35 * Math.sin(6.283 * f2 * t + p2));
        const w = 1 + 0.13 * Math.sin(6.283 * f3 * t + p3) + 0.08 * (R() - 0.5);
        pts.push([x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off, w]);
      }
      return pts;
    }
    function roundRectPoly(x0, y0, x1, y1, rad, step, R, amp) {
      const pts = [];
      const segs = [
        ['L', x0 + rad, y0, x1 - rad, y0], ['A', x1 - rad, y0 + rad, -Math.PI / 2, 0],
        ['L', x1, y0 + rad, x1, y1 - rad], ['A', x1 - rad, y1 - rad, 0, Math.PI / 2],
        ['L', x1 - rad, y1, x0 + rad, y1], ['A', x0 + rad, y1 - rad, Math.PI / 2, Math.PI],
        ['L', x0, y1 - rad, x0, y0 + rad], ['A', x0 + rad, y0 + rad, Math.PI, Math.PI * 1.5]
      ];
      segs.forEach(function (s) {
        if (s[0] === 'L') {
          const L = Math.hypot(s[3] - s[1], s[4] - s[2]), n = Math.max(1, Math.ceil(L / step));
          for (let i = 0; i < n; i++) { const t = i / n; pts.push([s[1] + (s[3] - s[1]) * t, s[2] + (s[4] - s[2]) * t]); }
        } else {
          const n = Math.max(4, Math.ceil(rad * (s[4] - s[3]) / step));
          for (let i = 0; i < n; i++) { const a = s[3] + (s[4] - s[3]) * i / n; pts.push([s[1] + Math.cos(a) * rad, s[2] + Math.sin(a) * rad]); }
        }
      });
      // tremor suave ao longo do contorno
      const m = pts.length, ph = R() * 6.283, ph2 = R() * 6.283;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return pts.map(function (q, i) {
        const t = i / m, off = amp * (0.6 * Math.sin(6.283 * 7 * t + ph) + 0.4 * Math.sin(6.283 * 19 * t + ph2));
        const dx = q[0] - cx, dy = q[1] - cy, l = Math.hypot(dx, dy) || 1;
        return [q[0] + dx / l * off, q[1] + dy / l * off, 1 + 0.1 * Math.sin(6.283 * 11 * t + ph2)];
      }).concat([null]);   // null = fechar
    }
    function addPoly(ctx, pts) {
      let closed = false;
      if (pts[pts.length - 1] === null) { closed = true; pts = pts.slice(0, -1); }
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (closed) ctx.closePath();
    }
    // traço de núcleo com largura variável (segmento a segmento)
    function strokeCore(ctx, pts, width, color) {
      let closed = false;
      if (pts[pts.length - 1] === null) { closed = true; pts = pts.slice(0, -1); }
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      const n = pts.length - (closed ? 0 : 1);
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        ctx.lineWidth = width * (a[2] + b[2]) / 2;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    }
    // pinta traços pirografados (e pontos queimados) — poucos filtros de blur
    // por textura (halo largo, halo interno, núcleo composto numa camada).
    function pyroStrokes(ctx, polys, PPU, scale, R, dots) {
      const k = scale || 1;
      dots = dots || [];
      const W = ctx.canvas.width, H = ctx.canvas.height;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // 1) halo largo (madeira chamuscada, âmbar)
      ctx.filter = 'blur(' + (0.035 * PPU * k).toFixed(1) + 'px)';
      ctx.strokeStyle = 'rgba(190,118,62,0.42)';
      ctx.lineWidth = 0.12 * PPU * k;
      ctx.beginPath(); polys.forEach(function (p) { addPoly(ctx, p); }); ctx.stroke();
      // 2) halo interno (queimado médio)
      ctx.filter = 'blur(' + (0.014 * PPU * k).toFixed(1) + 'px)';
      ctx.strokeStyle = 'rgba(122,62,28,0.55)';
      ctx.lineWidth = 0.062 * PPU * k;
      ctx.beginPath(); polys.forEach(function (p) { addPoly(ctx, p); }); ctx.stroke();
      ctx.filter = 'none';
      // halos dos pontos (gradientes radiais, sem filtro)
      dots.forEach(function (d) {
        const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 2.6);
        g.addColorStop(0, 'rgba(105,52,24,0.85)');
        g.addColorStop(0.42, 'rgba(150,86,44,0.55)');
        g.addColorStop(0.72, 'rgba(192,128,74,0.25)');
        g.addColorStop(1, 'rgba(205,150,100,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 2.6, 0, 6.283); ctx.fill();
      });
      // 3) núcleos numa camada separada, compostos com UM blur leve
      const layer = canvas(W, H), lc = ctx2d(layer);
      lc.lineCap = 'round'; lc.lineJoin = 'round';
      polys.forEach(function (p) { strokeCore(lc, p, 0.036 * PPU * k, 'rgb(52,28,15)'); });
      lc.fillStyle = 'rgb(46,24,13)';
      dots.forEach(function (d) {
        lc.beginPath();
        const n = 32, ph = R() * 6.283;
        for (let i = 0; i <= n; i++) {
          const a = i / n * 6.283, rr = d.r * (1 + 0.06 * Math.sin(3 * a + ph) + 0.03 * Math.sin(7 * a + ph * 2));
          if (i === 0) lc.moveTo(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr); else lc.lineTo(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr);
        }
        lc.fill();
      });
      ctx.filter = 'blur(' + Math.max(0.6, 0.0035 * PPU * k).toFixed(1) + 'px)';
      ctx.drawImage(layer, 0, 0);
      ctx.filter = 'none';
      layer.width = layer.height = 1;   // libera memória
      // 4) centro mais escuro + manchas onde a ponteira demorou
      polys.forEach(function (p) { strokeCore(ctx, p, 0.015 * PPU * k, 'rgba(26,13,7,0.75)'); });
      polys.forEach(function (p) {
        const q = p[p.length - 1] === null ? p.slice(0, -1) : p;
        const cnt = Math.floor(q.length / 18) + (R() < 0.6 ? 1 : 0);
        for (let i = 0; i < cnt; i++) {
          const s = q[Math.floor(R() * q.length)];
          ctx.fillStyle = 'rgba(30,15,8,' + (0.35 + R() * 0.3).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(s[0], s[1], (0.018 + R() * 0.012) * PPU * k, 0, 6.283); ctx.fill();
        }
      });
      dots.forEach(function (d) {
        const g2 = ctx.createRadialGradient(d.x - d.r * 0.15, d.y - d.r * 0.15, 0, d.x, d.y, d.r * 0.75);
        g2.addColorStop(0, 'rgba(20,10,5,0.9)');
        g2.addColorStop(1, 'rgba(20,10,5,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r * 0.75, 0, 6.283); ctx.fill();
      });
      ctx.restore();
    }

    /* ------------------------------------------------------------------ *
     * 6. Tabuleiro + bandeja de capturas
     * ------------------------------------------------------------------ */
    const BOARD = { hx: 2.75, hz: 3.75, t: 0.25, corner: 0.34, bevel: 0.07, bevelT: 0.06 };
    const TRAY = { x0: 2.84, x1: 3.68, z0: -1.87, z1: 1.87, corner: 0.17, floorY: -0.035, t: 0.17, rim: 0.065 };
    const SLOT_X = (TRAY.x0 + TRAY.x1) / 2;
    const SLOT_Z = [-1.4, -0.7, 0, 0.7, 1.4];

    function rrShape(x0, y0, x1, y1, r, path) {
      const s = path || new THREE.Shape();
      s.moveTo(x0 + r, y0);
      s.lineTo(x1 - r, y0);
      s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
      s.lineTo(x1, y1 - r);
      s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
      s.lineTo(x0 + r, y1);
      s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
      s.lineTo(x0, y0 + r);
      s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
      return s;
    }
    // laje arredondada com chanfro; footprint final = [x0,x1]x[z0,z1]; topo em topY
    function slab(x0, z0, x1, z1, corner, thick, bevT, bevS, topY, holeInset) {
      const sx0 = x0 + bevS, sx1 = x1 - bevS, sz0 = z0 + bevS, sz1 = z1 - bevS;
      const shape = rrShape(sx0, -sz1, sx1, -sz0, Math.max(0.01, corner - bevS));
      if (holeInset) {
        const hi = holeInset;
        shape.holes.push(rrShape(x0 + hi, -(z1 - hi), x1 - hi, -(z0 + hi), Math.max(0.01, corner - hi * 0.6), new THREE.Path()));
      }
      const depth = Math.max(0.002, thick - 2 * bevT);
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: depth, bevelEnabled: true, bevelThickness: bevT, bevelSize: bevS, bevelOffset: 0,
        bevelSegments: 6, curveSegments: 16
      });
      g.rotateX(-Math.PI / 2);
      g.translate(0, topY - (depth + bevT), 0);
      smoothNormals(g);
      // UV da tampa (grupo 0) = retângulo da tampa superior
      const pos = g.attributes.position, uv = g.attributes.uv, grp = g.groups[0];
      for (let i = grp.start; i < grp.start + grp.count; i++) {
        uv.setXY(i, (pos.getX(i) - sx0) / (sx1 - sx0), 1 - (pos.getZ(i) - sz0) / (sz1 - sz0));
      }
      uv.needsUpdate = true;
      g.userData.lid = { x0: sx0, x1: sx1, z0: sz0, z1: sz1 };
      return g;
    }

    function makeBoardPyroCanvas(lid, texLong) {
      const LW = lid.x1 - lid.x0, LH = lid.z1 - lid.z0;
      const PPU = texLong / Math.max(LW, LH);
      const W = Math.round(LW * PPU), H = Math.round(LH * PPU);
      const cv = canvas(W, H), ctx = ctx2d(cv);
      const X = function (x) { return (x - lid.x0) * PPU; }, Y = function (z) { return (z - lid.z0) * PPU; };
      const R = rng(20241120);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      // borda envelhecida/oleada (escurece suavemente a periferia da tábua):
      // pintada em baixa resolução com blur e ampliada (barato em software)
      const sm = 8, ew = Math.ceil(W / sm), eh = Math.ceil(H / sm);
      const edge = canvas(ew, eh), ec = ctx2d(edge);
      ec.filter = 'blur(' + (0.16 * PPU / sm).toFixed(1) + 'px)';
      ec.strokeStyle = 'rgba(165,120,80,0.40)';
      ec.lineWidth = 0.34 * PPU / sm;
      ec.beginPath();
      addPoly(ec, roundRectPoly(0, 0, ew, eh, (BOARD.corner - BOARD.bevel) * PPU / sm, 0.05 * PPU / sm, R, 0));
      ec.stroke();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(edge, 0, 0, W, H);
      // linhas do jogo (66) + moldura simples + pontos queimados (31)
      const step = 0.05 * PPU, amp = 0.0065 * PPU;
      const polys = EDGES.map(function (e) {
        const a = pxz(e[0]), b = pxz(e[1]);
        return burnLine(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), R, amp, step);
      });
      const inset = 0.26;
      polys.push(roundRectPoly(X(lid.x0 + inset), Y(lid.z0 + inset), X(lid.x1 - inset), Y(lid.z1 - inset),
        0.2 * PPU, step, R, 0.004 * PPU));
      const dots = PTS.map(function (p, i) { const q = pxz(i); return { x: X(q[0]), y: Y(q[1]), r: 0.07 * PPU }; });
      pyroStrokes(ctx, polys, PPU, 1, R, dots);
      return cv;
    }

    function makeTrayPyroCanvas(lid, texLong) {
      const LW = lid.x1 - lid.x0, LH = lid.z1 - lid.z0;
      const PPU = texLong / Math.max(LW, LH);
      const W = Math.round(LW * PPU), H = Math.round(LH * PPU);
      const cv = canvas(W, H), ctx = ctx2d(cv);
      const X = function (x) { return (x - lid.x0) * PPU; }, Y = function (z) { return (z - lid.z0) * PPU; };
      const R = rng(777);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const polys = [];
      SLOT_Z.forEach(function (z) {
        const cx = X(SLOT_X), cy = Y(z), rad = 0.335 * PPU, n = 64, ph = R() * 6.283;
        // leve escurecido dentro do encaixe
        const g = ctx.createRadialGradient(cx, cy, rad * 0.2, cx, cy, rad);
        g.addColorStop(0, 'rgba(200,150,105,0.0)');
        g.addColorStop(1, 'rgba(185,130,85,0.35)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.283); ctx.fill();
        const pts = [];
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.283, rr = rad * (1 + 0.012 * Math.sin(3 * a + ph));
          pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1 + 0.12 * Math.sin(2 * a + ph)]);
        }
        pts.push(null);
        polys.push(pts);
      });
      pyroStrokes(ctx, polys, PPU, 0.62, R);
      return cv;
    }

    function makeShadowCanvas(x0, z0, x1, z1, pad, PPU) {
      const W = Math.round((x1 - x0 + 2 * pad) * PPU), H = Math.round((z1 - z0 + 2 * pad) * PPU);
      const cv = canvas(W, H), ctx = ctx2d(cv);
      ctx.filter = 'blur(' + (0.22 * PPU).toFixed(1) + 'px)';
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      const X = function (x) { return (x - x0 + pad) * PPU; }, Y = function (z) { return (z - z0 + pad) * PPU; };
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X(-BOARD.hx + 0.05), Y(-BOARD.hz + 0.05), (2 * BOARD.hx - 0.1) * PPU, (2 * BOARD.hz - 0.1) * PPU, BOARD.corner * PPU);
      else ctx.rect(X(-BOARD.hx + 0.05), Y(-BOARD.hz + 0.05), (2 * BOARD.hx - 0.1) * PPU, (2 * BOARD.hz - 0.1) * PPU);
      ctx.fill();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X(TRAY.x0 + 0.03), Y(TRAY.z0 + 0.03), (TRAY.x1 - TRAY.x0 - 0.06) * PPU, (TRAY.z1 - TRAY.z0 - 0.06) * PPU, TRAY.corner * PPU);
      else ctx.rect(X(TRAY.x0 + 0.03), Y(TRAY.z0 + 0.03), (TRAY.x1 - TRAY.x0 - 0.06) * PPU, (TRAY.z1 - TRAY.z0 - 0.06) * PPU);
      ctx.fill();
      return cv;
    }

    const cache = {};

    api.makeBoard = function (opts) {
      opts = opts || {};
      const texLong = opts.textureSize || 3072;
      const group = new THREE.Group();
      group.name = 'tabuleiro';

      // --- tábua principal
      if (!cache.boardGeo) {
        cache.boardGeo = slab(-BOARD.hx, -BOARD.hz, BOARD.hx, BOARD.hz, BOARD.corner, BOARD.t, BOARD.bevelT, BOARD.bevel, 0);
      }
      if (!cache.boardTex || cache.boardTexSize !== texLong) {
        cache.boardTex = colorTex(makeBoardPyroCanvas(cache.boardGeo.userData.lid, texLong), 16);
        cache.boardTexSize = texLong;
        const topMat = woodMaterial(Object.assign({}, WOOD.board, { map: cache.boardTex, bumpMap: cache.boardTex, bumpScale: 2.2 }));
        const sideMat = woodMaterial(WOOD.board);
        cache.boardMats = [topMat, sideMat];
      }
      const board = new THREE.Mesh(cache.boardGeo, cache.boardMats);
      board.name = 'tabua';
      board.castShadow = true;
      board.receiveShadow = true;
      group.add(board);

      // --- bandeja de capturas (lado +X): fundo + aro
      if (!cache.trayFloorGeo) {
        cache.trayFloorGeo = slab(TRAY.x0, TRAY.z0, TRAY.x1, TRAY.z1, TRAY.corner, TRAY.t, 0.03, 0.03, TRAY.floorY);
        cache.trayRimGeo = slab(TRAY.x0, TRAY.z0, TRAY.x1, TRAY.z1, TRAY.corner, -TRAY.floorY + 0.004, 0.012, 0.014, 0, TRAY.rim);
        const trayTex = colorTex(makeTrayPyroCanvas(cache.trayFloorGeo.userData.lid, 1536), 8);
        cache.trayMats = [
          woodMaterial(Object.assign({}, WOOD.tray, { map: trayTex, bumpMap: trayTex, bumpScale: 1.6 })),
          woodMaterial(WOOD.tray)
        ];
        cache.trayRimMat = woodMaterial(Object.assign({}, WOOD.tray, { offset: [-2.2, 1.6, 0.4] }));
      }
      const trayFloor = new THREE.Mesh(cache.trayFloorGeo, cache.trayMats);
      trayFloor.name = 'bandeja';
      trayFloor.castShadow = true; trayFloor.receiveShadow = true;
      const trayRim = new THREE.Mesh(cache.trayRimGeo, cache.trayRimMat);
      trayRim.name = 'bandejaAro';
      trayRim.castShadow = true; trayRim.receiveShadow = true;
      group.add(trayFloor, trayRim);

      const bounds = new THREE.Box3(
        V3(-BOARD.hx, -BOARD.t, -BOARD.hz),
        V3(Math.max(BOARD.hx, TRAY.x1), 0, BOARD.hz));

      // --- sombra suave no "chão" (opcional; pode ser ocultada: group.getObjectByName('sombraChao').visible=false)
      if (!cache.shadowTex) {
        const pad = 0.9, PPU = 48;
        cache.shadowPad = pad;
        cache.shadowTex = new THREE.CanvasTexture(makeShadowCanvas(bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z, pad, PPU));
        cache.shadowTex.colorSpace = THREE.SRGBColorSpace;
      }
      const pad = cache.shadowPad;
      const sw = bounds.max.x - bounds.min.x + 2 * pad, sd = bounds.max.z - bounds.min.z + 2 * pad;
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd),
        new THREE.MeshBasicMaterial({ map: cache.shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set((bounds.min.x + bounds.max.x) / 2, -BOARD.t - 0.004, (bounds.min.z + bounds.max.z) / 2);
      shadow.name = 'sombraChao';
      shadow.renderOrder = -1;
      group.add(shadow);

      const captureSlots = SLOT_Z.map(function (z) { return V3(SLOT_X, TRAY.floorY, z); });
      // pontos de enquadramento "justos" (cantos reais da tábua e da bandeja + altura das peças)
      // úteis para ajustar a câmera ortográfica de modo que o tabuleiro preencha ~90% da tela
      const fitPoints = [];
      const PH = 0.72;   // altura máx. das peças
      [[-BOARD.hx, -BOARD.hz], [BOARD.hx, -BOARD.hz], [BOARD.hx, BOARD.hz], [-BOARD.hx, BOARD.hz],
       [TRAY.x0, TRAY.z0], [TRAY.x1, TRAY.z0], [TRAY.x1, TRAY.z1], [TRAY.x0, TRAY.z1]].forEach(function (q) {
        fitPoints.push(V3(q[0], 0, q[1]), V3(q[0], -BOARD.t, q[1]));
      });
      [[-2.36, -3.36], [2.36, -3.36], [2.36, 3.36], [-2.36, 3.36]].forEach(function (q) { fitPoints.push(V3(q[0], PH, q[1])); });
      [SLOT_Z[0], SLOT_Z[4]].forEach(function (z) { fitPoints.push(V3(SLOT_X, PH - 0.05, z)); });
      return { group: group, captureSlots: captureSlots, bounds: bounds, topY: 0, fitPoints: fitPoints };
    };

    /* ------------------------------------------------------------------ *
     * 7. Bonequinhos esculpidos
     * ------------------------------------------------------------------ */
    // perfil torneado da base (raio R, altura H)
    function baseProfile(R, H) {
      return [
        [0, 0], [R - 0.016, 0], [R - 0.005, 0.004], [R, 0.014],
        [R, 0.30 * H], [R - 0.004, 0.37 * H], [R - 0.013, 0.43 * H], [R - 0.006, 0.49 * H],
        [R - 0.005, 0.58 * H], [R - 0.011, 0.72 * H], [R - 0.024, 0.86 * H], [R - 0.040, 0.965 * H],
        [R - 0.054, H], [R - 0.12, H], [0, H]
      ];
    }

    function contactShadowTex() {
      if (cache.contactTex) return cache.contactTex;
      const cv = canvas(128, 128), ctx = ctx2d(cv);
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(0,0,0,0.55)');
      g.addColorStop(0.62, 'rgba(0,0,0,0.42)');
      g.addColorStop(0.8, 'rgba(0,0,0,0.14)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      cache.contactTex = new THREE.CanvasTexture(cv);
      cache.contactTex.colorSpace = THREE.SRGBColorSpace;
      return cache.contactTex;
    }
    function contactShadow(radius) {
      const key = 'contact' + radius;
      if (!cache[key]) {
        const g = new THREE.PlaneGeometry(radius * 2.5, radius * 2.5);
        g.rotateX(-Math.PI / 2);
        cache[key] = g;
      }
      if (!cache.contactMat) {
        cache.contactMat = new THREE.MeshBasicMaterial({
          map: contactShadowTex(), transparent: true, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
        });
      }
      const m = new THREE.Mesh(cache[key], cache.contactMat);
      m.position.y = 0.002;
      m.renderOrder = 1;
      m.name = 'sombraContato';
      return m;
    }

    // orelha arredondada: tronco de cone achatado + ponta esférica, em espaço local
    function roundEar(p, rBase, rTip, h, flatZ, rot, order, local) {
      const m = mtx(p, rot, [1, 1, 1], order || 'YXZ');
      const L = local || [0, 0, 0];
      const a = new THREE.CylinderGeometry(rTip, rBase, h, 14, 2, false);
      a.translate(0, h / 2, 0); a.scale(1, 1, flatZ); a.translate(L[0], L[1], L[2]);
      const b = new THREE.SphereGeometry(rTip, 14, 8);
      b.scale(1, 1, flatZ); b.translate(L[0], L[1] + h, L[2]);
      a.applyMatrix4(m); b.applyMatrix4(m);
      return [a, b];
    }

    // ---------- Cachorro: vira-lata caramelo (caricatura) ----------
    function buildDogGeometry() {
      const BR = 0.30, BH = 0.085, CV = OPT.carve;
      const C = function (g) { return carve(g, CV); };
      const body = [], dark = [];
      body.push(lathe(baseProfile(BR, BH), 56));

      // tronco numa peça só: garupa -> peito (cintura fina, peito fundo)
      body.push(C(loft([[0, 0.322, -0.215], [0, 0.326, -0.13], [0, 0.314, -0.035], [0, 0.315, 0.06], [0, 0.326, 0.142]],
        keyed([[0, 0.052, 0.054, 0.05], [0.18, 0.06, 0.06, 0.06], [0.48, 0.05, 0.054, 0.04],
               [0.8, 0.066, 0.064, 0.086], [1, 0.06, 0.058, 0.072]], 0.15, 0.16), { ns: 30, nr: 18 })));
      // pescoço
      body.push(C(loft([[0, 0.335, 0.085], [0, 0.395, 0.128], [0, 0.462, 0.162]],
        keyed([[0, 0.046, 0.05, 0.062], [1, 0.038, 0.04, 0.04]], 0.12, 0.2), { ns: 12, nr: 16 })));
      // patas dianteiras finas
      const frontR = keyed([[0, 0.036], [0.35, 0.024], [0.7, 0.0195], [1, 0.0185]]);
      const hindR = keyed([[0, 0.047], [0.22, 0.04], [0.45, 0.024], [0.72, 0.0185], [1, 0.0175]]);
      [-1, 1].forEach(function (s) {
        body.push(C(tube([[s * 0.047, 0.305, 0.095], [s * 0.05, 0.24, 0.083], [s * 0.048, 0.17, 0.097], [s * 0.046, 0.112, 0.104]],
          function (t) { return frontR(t)[0]; }, { ts: 20, rs: 12 })));
        body.push(sph([s * 0.046, 0.099, 0.117], [0.026, 0.016, 0.034], { w: 14, h: 10 }));
        // traseiras: coxa forte -> joelho -> jarrete
        body.push(C(tube([[s * 0.05, 0.322, -0.14], [s * 0.054, 0.262, -0.118], [s * 0.056, 0.212, -0.088],
                          [s * 0.056, 0.16, -0.158], [s * 0.054, 0.112, -0.134]],
          function (t) { return hindR(t)[0]; }, { ts: 26, rs: 12 })));
        body.push(sph([s * 0.054, 0.099, -0.12], [0.025, 0.016, 0.032], { w: 14, h: 10 }));
      });
      // rabo enrolado sobre o dorso
      body.push(tube([[0, 0.345, -0.195], [0, 0.395, -0.24], [0, 0.46, -0.252], [0, 0.505, -0.215],
                      [0, 0.512, -0.162], [0, 0.49, -0.126]], [0.024, 0.0125], { ts: 40, rs: 12 }));

      // cabeça grande (pivô no topo do pescoço)
      const head = [], headDark = [];
      head.push(C(sph([0, 0.035, 0.004], [0.077, 0.072, 0.078], { w: 24, h: 18 })));    // crânio
      head.push(sph([0, 0.046, 0.05], [0.05, 0.04, 0.042]));                              // testa
      [-1, 1].forEach(function (s) {
        head.push(sph([s * 0.036, 0.012, 0.045], [0.041, 0.039, 0.042]));                // bochechas
      });
      // focinho comprido (peça contínua até a ponta)
      head.push(C(loft([[0, 0.02, 0.03], [0, 0.013, 0.11], [0, 0.006, 0.188]],
        keyed([[0, 0.043, 0.038, 0.034], [0.6, 0.034, 0.03, 0.026], [1, 0.03, 0.026, 0.022]], 0, 0.18), { ns: 16, nr: 16 })));
      head.push(sph([0, -0.022, 0.09], [0.029, 0.019, 0.064], { r: [0.14, 0, 0] }));      // mandíbula
      headDark.push(sph([0, 0.017, 0.19], [0.023, 0.018, 0.017], { w: 16, h: 12 }));     // nariz
      [-1, 1].forEach(function (s) {
        headDark.push(sph([s * 0.033, 0.05, 0.064], [0.0148, 0.0162, 0.011], { w: 14, h: 10 })); // olhos
        head.push(sph([s * 0.033, 0.073, 0.057], [0.022, 0.0095, 0.016], { r: [0, 0, s * 0.28] })); // sobrancelhas
        headDark.push(tube([[s * 0.024, -0.008, 0.168], [s * 0.033, -0.01, 0.132], [s * 0.04, -0.006, 0.1], [s * 0.046, 0.005, 0.084]],
          [0.0042, 0.0034], { ts: 12, rs: 6 }));                                           // sorriso entalhado
      });
      head.push(sph([0.016, -0.034, 0.142], [0.017, 0.0068, 0.03], { r: [0.6, 0.3, 0], w: 14, h: 8 })); // língua de fora
      // orelha direita (-X) em pé; esquerda (+X) dobrada para a frente
      head.push(cone([-0.044, 0.084, -0.004], 0.034, 0.003, 0.1, 0.4, [-0.12, 0, 0.33], 'ZXY', 12));
      headDark.push(cone([-0.045, 0.087, 0.005], 0.019, 0.002, 0.07, 0.22, [-0.12, 0, 0.33], 'ZXY', 10));
      head.push(cone([0.044, 0.084, -0.004], 0.034, 0.027, 0.046, 0.42, [-0.05, 0, -0.36], 'ZXY', 12));
      const fold = V3(0.044 + Math.sin(0.36) * 0.046, 0.084 + Math.cos(0.36) * 0.046, -0.004);
      head.push(cone([fold.x, fold.y, fold.z], 0.027, 0.004, 0.062, 0.4, [1.95, 0, -0.42], 'ZXY', 12));
      // pose da cabeça: inclinação "bobinha" + leve giro para a câmera
      const headM = mtx([0, 0.452, 0.155], [0.05, 0.2, -0.13], [1, 1, 1], 'YXZ');
      applyAll(head, headM); applyAll(headDark, headM);
      body.push(head); dark.push(headDark);

      return { body: merge(body), dark: merge(dark), baseR: BR };
    }

    // ---------- Onça: sucuarana / onça-parda (caricatura, sem pintas) ----------
    // Pose sentada, calma e confiante (silhueta de estatueta), rabo longo em volta da base.
    function buildPumaGeometry() {
      const BR = 0.36, BH = 0.1, CV = OPT.carve;
      const C = function (g) { return carve(g, CV); };
      const body = [], dark = [];
      body.push(lathe(baseProfile(BR, BH), 64));

      // ancas (coxas dobradas) + pés traseiros deitados na base
      [-1, 1].forEach(function (s) {
        body.push(C(sph([s * 0.083, 0.195, -0.07], [0.062, 0.092, 0.118], { r: [0.42, s * 0.12, 0], w: 22, h: 16 })));
        body.push(C(tube([[s * 0.094, 0.128, -0.15], [s * 0.098, 0.124, -0.06], [s * 0.098, 0.122, 0.02]], [0.028, 0.026], { ts: 10, rs: 12 })));
        body.push(sph([s * 0.098, 0.12, 0.04], [0.036, 0.021, 0.046], { w: 16, h: 10 }));
      });
      // tronco: pelve -> peito (sentado ereto, peito fundo)
      body.push(C(loft([[0, 0.15, -0.12], [0, 0.24, -0.072], [0, 0.34, -0.008], [0, 0.43, 0.05], [0, 0.475, 0.075]],
        keyed([[0, 0.092, 0.08, 0.085], [0.25, 0.096, 0.085, 0.09], [0.55, 0.074, 0.07, 0.078],
               [0.82, 0.084, 0.07, 0.098], [1, 0.07, 0.06, 0.07]], 0.1, 0.18), { ns: 30, nr: 20 })));
      // omoplatas salientes (ombros musculosos)
      [-1, 1].forEach(function (s) {
        body.push(C(sph([s * 0.056, 0.45, 0.03], [0.042, 0.062, 0.052], { r: [-0.5, 0, s * -0.15], w: 18, h: 12 })));
      });
      // patas dianteiras grossas e retas + patas grandes
      const frontR = keyed([[0, 0.05], [0.3, 0.042], [0.65, 0.034], [1, 0.031]]);
      [-1, 1].forEach(function (s) {
        body.push(C(tube([[s * 0.06, 0.44, 0.07], [s * 0.064, 0.34, 0.112], [s * 0.06, 0.22, 0.14], [s * 0.057, 0.135, 0.152]],
          function (t) { return frontR(t)[0]; }, { ts: 22, rs: 14 })));
        body.push(sph([s * 0.057, 0.122, 0.17], [0.041, 0.025, 0.054], { w: 16, h: 10 }));
      });
      // pescoço grosso
      body.push(C(loft([[0, 0.43, 0.05], [0, 0.5, 0.09], [0, 0.565, 0.125]],
        keyed([[0, 0.068, 0.07, 0.075], [1, 0.054, 0.05, 0.055]], 0.1, 0.2), { ns: 12, nr: 18 })));
      // rabo longo e grosso: sai de trás, contorna a base pelo lado +X e sobe na frente
      body.push(tube([[0, 0.17, -0.185], [0.02, 0.135, -0.262], [0.12, 0.127, -0.29], [0.222, 0.127, -0.212],
                      [0.27, 0.127, -0.075], [0.252, 0.128, 0.065], [0.185, 0.132, 0.17], [0.13, 0.165, 0.218], [0.106, 0.21, 0.21]],
        function (t) { return 0.034 - 0.006 * t; }, { ts: 72, rs: 14 }));

      // cabeça felina (pivô no topo do pescoço)
      const head = [], headDark = [];
      head.push(C(sph([0, 0.04, -0.008], [0.074, 0.064, 0.07], { w: 24, h: 18 })));     // crânio
      head.push(sph([0, 0.05, 0.034], [0.06, 0.044, 0.045]));                             // testa
      [-1, 1].forEach(function (s) {
        head.push(sph([s * 0.045, 0.01, 0.028], [0.043, 0.041, 0.046]));                 // bochechas largas
        head.push(sph([s * 0.02, -0.008, 0.082], [0.025, 0.022, 0.023]));                // almofadas do bigode
        head.push(sph([s * 0.031, 0.055, 0.052], [0.025, 0.0105, 0.019], { r: [0.1, 0, s * 0.18] })); // arcadas
      });
      head.push(sph([0, -0.001, 0.062], [0.042, 0.034, 0.04]));                           // focinho curto
      head.push(sph([0, 0.03, 0.072], [0.02, 0.016, 0.04], { r: [0.38, 0, 0] }));         // cana do nariz
      head.push(sph([0, -0.034, 0.06], [0.022, 0.016, 0.024]));                           // queixo
      // nariz triangular (cone invertido achatado)
      headDark.push(cone([0, 0.028, 0.097], 0.019, 0.004, 0.024, 0.45, [0.25, 0, Math.PI], 'ZXY', 10));
      headDark.push(tube([[0, 0.004, 0.1], [0, -0.012, 0.099]], [0.0028, 0.0028], { ts: 4, rs: 6 }));
      [-1, 1].forEach(function (s) {
        headDark.push(tube([[0, -0.012, 0.099], [s * 0.012, -0.02, 0.095], [s * 0.026, -0.016, 0.087]], [0.0027, 0.0022], { ts: 8, rs: 6 }));
        headDark.push(sph([s * 0.031, 0.04, 0.062], [0.017, 0.0095, 0.009], { r: [0, s * 0.45, s * 0.3], order: 'YXZ', w: 14, h: 10 })); // olhos amendoados
        // orelhas pequenas e redondas, nas laterais
        const er = [-0.28, s * 0.32, s * -0.5];
        head.push(roundEar([s * 0.05, 0.075, -0.02], 0.031, 0.02, 0.03, 0.42, er, 'YXZ'));
        headDark.push(roundEar([s * 0.05, 0.075, -0.02], 0.019, 0.012, 0.026, 0.22, er, 'YXZ', [0, 0.005, 0.0078]));
      });
      const headM = mtx([0, 0.575, 0.135], [0.06, 0.28, 0], [1, 1, 1], 'YXZ');
      applyAll(head, headM); applyAll(headDark, headM);
      body.push(head); dark.push(headDark);

      return { body: merge(body), dark: merge(dark), baseR: BR };
    }

    function pieceGroup(geo, bodyMat, darkMat, name) {
      const g = new THREE.Group();
      g.name = name;
      const b = new THREE.Mesh(geo.body, bodyMat);
      b.castShadow = true; b.receiveShadow = true; b.name = name + 'Corpo';
      const d = new THREE.Mesh(geo.dark, darkMat);
      d.castShadow = true; d.receiveShadow = true; d.name = name + 'Detalhes';
      g.add(contactShadow(geo.baseR), b, d);
      return g;
    }

    let dogCount = 0;
    api.makeDog = function () {
      if (!cache.dogGeo) {
        cache.dogGeo = buildDogGeometry();
        // 3 variações de veio (materiais compartilhados entre os 14 cachorros)
        cache.dogMats = [[0.6, 1.2, 0.0], [-0.9, 0.7, 1.7], [0.3, -1.1, 3.1]].map(function (off) {
          return woodMaterial(Object.assign({}, WOOD.dog, { offset: off }));
        });
        cache.dogDark = woodMaterial(WOOD.dogDark);
      }
      const g = pieceGroup(cache.dogGeo, cache.dogMats[dogCount % 3], cache.dogDark, 'cachorro');
      dogCount++;
      return g;
    };

    api.makePuma = function () {
      if (!cache.pumaGeo) {
        cache.pumaGeo = buildPumaGeometry();
        cache.pumaMat = woodMaterial(WOOD.puma);
        cache.pumaDark = woodMaterial(WOOD.pumaDark);
      }
      return pieceGroup(cache.pumaGeo, cache.pumaMat, cache.pumaDark, 'onca');
    };

    /* ------------------------------------------------------------------ *
     * 8. Marcadores de destaque (discos/anéis planos)
     * ------------------------------------------------------------------ */
    function markerCanvas(kind) {
      const N = 256, c = N / 2, cv = canvas(N, N), ctx = ctx2d(cv);
      function ring(rad, width, color, blur) {
        ctx.save();
        if (blur) ctx.filter = 'blur(' + blur + 'px)';
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.arc(c, c, rad, 0, 6.283); ctx.stroke();
        ctx.restore();
      }
      function disc(rad, inner, outer, blur) {
        ctx.save();
        if (blur) ctx.filter = 'blur(' + blur + 'px)';
        const g = ctx.createRadialGradient(c, c, 0, c, c, rad);
        g.addColorStop(0, inner); g.addColorStop(0.7, inner); g.addColorStop(1, outer);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c, c, rad, 0, 6.283); ctx.fill();
        ctx.restore();
      }
      // escala: o plano de cada marcador tem lado = 2*ext (unidades); o canvas cobre esse lado
      if (kind === 'move') {            // ext 0.25 -> disco r 0.18
        const px = N / 0.5;
        disc(0.2 * px, 'rgba(143,203,110,0.42)', 'rgba(143,203,110,0)', 6);
        disc(0.165 * px, 'rgba(160,220,120,0.92)', 'rgba(143,203,110,0.80)', 1.5);
        ring(0.165 * px, 0.022 * px, 'rgba(58,110,40,0.85)', 1);
        disc(0.07 * px, 'rgba(225,250,200,0.75)', 'rgba(200,240,170,0)', 2);
      } else if (kind === 'capture') {  // ext 0.27 -> disco r 0.2
        const px = N / 0.54;
        disc(0.235 * px, 'rgba(224,82,43,0.45)', 'rgba(224,82,43,0)', 7);
        disc(0.19 * px, 'rgba(236,98,52,0.94)', 'rgba(224,82,43,0.85)', 1.5);
        ring(0.19 * px, 0.024 * px, 'rgba(110,26,8,0.9)', 1);
        ring(0.105 * px, 0.022 * px, 'rgba(255,214,170,0.85)', 1);
      } else if (kind === 'victim') {   // ext 0.5 -> anel r ~0.38
        const px = N / 1.0;
        ring(0.385 * px, 0.11 * px, 'rgba(224,82,43,0.45)', 6);
        ring(0.385 * px, 0.06 * px, 'rgba(232,90,48,0.95)', 1.2);
        ring(0.385 * px, 0.016 * px, 'rgba(255,190,150,0.8)', 0.8);
      } else if (kind === 'select') {   // ext 0.55 -> anel r ~0.42
        const px = N / 1.1;
        ring(0.425 * px, 0.12 * px, 'rgba(242,210,122,0.50)', 7);
        ring(0.425 * px, 0.065 * px, 'rgba(246,216,130,0.98)', 1.2);
        ring(0.425 * px, 0.018 * px, 'rgba(255,248,220,0.9)', 0.8);
      } else {                          // hover: ext 0.48 -> anel r ~0.37
        const px = N / 0.96;
        ring(0.37 * px, 0.08 * px, 'rgba(255,248,230,0.22)', 5);
        ring(0.37 * px, 0.035 * px, 'rgba(255,250,236,0.62)', 1.2);
      }
      return cv;
    }
    const MARKER_EXT = { move: 0.25, capture: 0.27, victim: 0.5, select: 0.55, hover: 0.48 };
    const MARKER_Y = { move: 0.014, capture: 0.016, victim: 0.010, select: 0.012, hover: 0.008 };
    const MARKER_ORDER = { move: 12, capture: 13, victim: 11, select: 14, hover: 10 };
    api.makeMarker = function (kind) {
      if (!MARKER_EXT[kind]) kind = 'hover';
      const key = 'marker_' + kind;
      if (!cache[key]) {
        const tex = new THREE.CanvasTexture(markerCanvas(kind));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const geo = new THREE.PlaneGeometry(MARKER_EXT[kind] * 2, MARKER_EXT[kind] * 2);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          map: tex, transparent: true, depthWrite: false, toneMapped: false,
          polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        });
        cache[key] = { geo: geo, mat: mat };
      }
      const g = new THREE.Group();
      g.name = 'marcador_' + kind;
      const m = new THREE.Mesh(cache[key].geo, cache[key].mat);
      m.position.y = MARKER_Y[kind];
      m.renderOrder = MARKER_ORDER[kind];
      m.name = 'marcador';
      g.add(m);
      g.userData.kind = kind;
      return g;
    };

    /* ------------------------------------------------------------------ *
     * 9. Iluminação recomendada (opcional; a prévia usa exatamente isto)
     * ------------------------------------------------------------------ */
    api.makeLights = function () {
      const group = new THREE.Group();
      group.name = 'luzes';
      const hemi = new THREE.HemisphereLight(0xfff0d8, 0x3a2a1c, 0.85);
      const sun = new THREE.DirectionalLight(0xffe1b4, 2.35);
      sun.position.set(-4.2, 9.0, 3.2);
      sun.target.position.set(0.45, 0, 0);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -5.6; sc.right = 5.6; sc.top = 5.6; sc.bottom = -5.6; sc.near = 0.5; sc.far = 30;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.018;
      const fill = new THREE.DirectionalLight(0xdbe6ff, 0.35);
      fill.position.set(6, 5, 7);
      group.add(hemi, sun, sun.target, fill);
      return { group: group, hemi: hemi, sun: sun, fill: fill };
    };

    // ambiente para reflexos suaves na madeira encerada (precisa do renderer)
    api.makeEnvironment = function (renderer) {
      const cv = canvas(512, 256), ctx = ctx2d(cv);
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0.0, '#fff6e6');
      g.addColorStop(0.42, '#d9c7a6');
      g.addColorStop(0.52, '#7d6a4f');
      g.addColorStop(1.0, '#2a2017');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
      // "janela" luminosa no alto à esquerda (reforça o brilho do verniz)
      const s = ctx.createRadialGradient(150, 55, 0, 150, 55, 70);
      s.addColorStop(0, 'rgba(255,250,235,1)'); s.addColorStop(1, 'rgba(255,250,235,0)');
      ctx.fillStyle = s; ctx.fillRect(0, 0, 512, 256);
      const t = new THREE.CanvasTexture(cv);
      t.mapping = THREE.EquirectangularReflectionMapping;
      t.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(t).texture;
      pm.dispose(); t.dispose();
      return env;
    };

    api.renderSettings = {
      toneMapping: 'ACESFilmicToneMapping', toneMappingExposure: 1.0,
      outputColorSpace: 'srgb', shadowMapType: 'PCFSoftShadowMap'
    };

    return api;
  };
})();
