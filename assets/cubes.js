/* Cube formations, one per section. One fixed canvas and one shared rAF loop.
   Each formation assembles with the scroll and then keeps moving on its own (time based), in 3D:
   perspective, flat per-face shading, depth ordering, dimmer and smaller with distance.
   Hero: scatter -> data tensor + bars -> neural network -> tensor ... (continuous).
   Colors come from the CSS tokens. No libraries. */
(function () {
  "use strict";
  var canvas = document.getElementById("cubes");
  if (!canvas || !canvas.getContext || !window.Path2D) return;
  var root = document.documentElement;
  var mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  var mqDark = matchMedia("(prefers-color-scheme: dark)");
  var finePointer = matchMedia("(pointer: fine)").matches;
  var FOCAL = 34, OP = 0.9, ZONE = 0.05, HERO_ZONE = 0.09;
  var col = { acc: [27, 91, 114], mut: [70, 86, 95], dark: false };
  var W = 0, H = 0, dpr = 1, level = 0, clock = 0, mx = 0, my = 0, tmx = 0, tmy = 0;
  var running = false, last = 0, accT = 0, accN = 0, skip = 0;
  var stat = { active: 0, max: 0, budget: 0, ms: 0, maxMs: 0, level: 0 };
  var defs = [];
  function motionOn() { var m = root.getAttribute("data-motion"); return m === "on" || (m !== "off" && !mqReduce.matches); }
  var staticMode = !motionOn();

  /* ---------- helpers ---------- */
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) { h = (h || "").trim(); if (h.charAt(0) !== "#") return null; if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  var styleCache = [];
  function readColors() {
    var cs = getComputedStyle(root), bg = hex(cs.getPropertyValue("--bg")) || [233, 237, 236];
    col.acc = hex(cs.getPropertyValue("--accent")) || col.acc; col.mut = hex(cs.getPropertyValue("--muted")) || col.mut;
    col.dark = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) < 128; styleCache.length = 0;
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }
  function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function shuffle(n, seed) { var r = rng(seed), a = [], i, j, t; for (i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function isEs() { return root.lang === "es"; }
  function fit(bw, bh, ex, ey) { return Math.max(3, Math.min(bw / (2 * ex * 1.0), bh / (2 * ey * 1.32))); }
  function loop(t, period, offset) { return (((t / period) + (offset || 0)) % 1 + 1) % 1; }

  /* ================= HERO: data tensor + bar columns <-> neural network (time based, continuous) ================= */
  function genData(n) {
    var sp = 1.4, pts = [], lines = [], k = Math.max(3, Math.round(Math.cbrt(n * 0.34))), i, a, b, c;
    var cols = 6, pitch = 2 * sp + 0.8, barsW = cols * pitch - 0.8, tensW = k * sp;
    var total = tensW + 2.2 + barsW, left = -total / 2;
    var rest = n - k * k * k, layers = Math.floor(rest / 4);
    var w = [0.5, 0.72, 0.6, 1, 0.82, 1.3], sw = 0; for (i = 0; i < cols; i++) sw += w[i];
    var h = [], sum = 0;
    for (i = 0; i < cols; i++) { h[i] = Math.max(1, Math.round(layers * w[i] / sw)); sum += h[i]; }
    while (sum > layers) { var mi = 0; for (i = 1; i < cols; i++) if (h[i] > h[mi]) mi = i; h[mi]--; sum--; }
    var hmax = 0; for (i = 0; i < cols; i++) if (h[i] > hmax) hmax = h[i];
    var y0 = -(hmax * sp) / 2;
    for (a = 0; a < k; a++) for (b = 0; b < k; b++) for (c = 0; c < k; c++) pts.push([left + a * sp + sp / 2, y0 + b * sp + sp / 2, (c - (k - 1) / 2) * sp, 1]);
    var bl = left + tensW + 2.2;
    for (i = 0; i < cols; i++) for (a = 0; a < h[i]; a++) for (b = 0; b < 2; b++) for (c = 0; c < 2; c++) pts.push([bl + i * pitch + b * sp + sp / 2, y0 + a * sp + sp / 2, (c - 0.5) * sp, 1]);
    var extra = n - pts.length, tall = 0; for (i = 1; i < cols; i++) if (h[i] > h[tall]) tall = i;
    for (i = 0; i < extra; i++) pts.push([bl + tall * pitch + sp + (i % 3 - 1) * 0.2, y0 + (h[tall] + 1 + Math.floor(i / 2)) * sp, (i % 2 - 0.5) * sp, 0.8]);
    lines.push([left - 0.6, y0 - 0.2, 0, left + total + 0.6, y0 - 0.2, 0]);
    lines.push([bl - 1.1, y0 - 0.2, 0, bl - 1.1, y0 + (hmax + 2) * sp, 0]);
    return { pts: pts, lines: lines, trav: null };
  }
  function genNet(n) {
    var dims = [[4, 3], [5, 4], [5, 4], [3, 2]], xs = [-9, -3, 3, 9], pts = [], layer = [], lines = [], L, j, kk, i;
    for (L = 0; L < 4; L++) {
      var ny = dims[L][0], nz = dims[L][1], ids = [];
      for (j = 0; j < ny; j++) for (kk = 0; kk < nz; kk++) { ids.push(pts.length); pts.push([xs[L], (j - (ny - 1) / 2) * 2.7, (kk - (nz - 1) / 2) * 2.7, 1.5]); }
      layer.push(ids);
    }
    var edges = [];
    for (L = 0; L < 3; L++) {
      var A = layer[L], B = layer[L + 1];
      for (i = 0; i < A.length; i++) {
        var base = Math.floor(i * B.length / A.length), tg = [base, (base + 1) % B.length];
        for (j = 0; j < 2; j++) { var pa = pts[A[i]], pb = pts[B[tg[j]]]; edges.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2]]); }
      }
    }
    var trav = {}, m = n - pts.length;
    for (i = 0; i < m; i++) { var e = edges[(i * 7) % edges.length], ph = (i * 0.6180339) % 1; trav[pts.length] = [e, ph]; pts.push([e[0] + (e[3] - e[0]) * ph, e[1] + (e[4] - e[1]) * ph, e[2] + (e[5] - e[2]) * ph, 0.3]); }
    return { pts: pts, lines: edges, trav: trav };
  }
  function sceneHero(n) {
    var T_MOVE = 3.6, T_HOLD = 6.5, SPREAD = 0.4;
    var raw = [genData(n), genNet(n)], form = [], q, i, r = rng(7), N = n;
    for (q = 0; q < 2; q++) {
      var perm = shuffle(N, 11 + q * 5), F = { tx: new Float32Array(N), ty: new Float32Array(N), tz: new Float32Array(N), ts: new Float32Array(N), trav: [], lines: raw[q].lines, ex: 1, ey: 1 };
      for (i = 0; i < N; i++) {
        var p = raw[q].pts[perm[i]];
        F.tx[i] = p[0]; F.ty[i] = p[1]; F.tz[i] = p[2]; F.ts[i] = p[3];
        F.trav[i] = raw[q].trav && raw[q].trav[perm[i]] ? raw[q].trav[perm[i]] : null;
        F.ex = Math.max(F.ex, Math.abs(p[0]) + 1); F.ey = Math.max(F.ey, Math.abs(p[1]) + 1);
      }
      form.push(F);
    }
    var X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), S = new Float32Array(N), FX = new Float32Array(N), FY = new Float32Array(N), FZ = new Float32Array(N), FS = new Float32Array(N), ARC = new Float32Array(N * 3), DLY = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var th = r() * 6.2832, ph2 = Math.acos(2 * r() - 1), rad = 9 + r() * 7;
      X[i] = Math.sin(ph2) * Math.cos(th) * rad * 1.5; Y[i] = Math.cos(ph2) * rad * 0.8; Z[i] = Math.sin(ph2) * Math.sin(th) * rad; S[i] = 0.6 + r() * 0.3;
      ARC[i * 3] = (r() - 0.5) * 5; ARC[i * 3 + 1] = (r() - 0.5) * 5; ARC[i * 3 + 2] = (r() - 0.5) * 5; DLY[i] = r() * SPREAD;
    }
    var f = 0, mode = "move", ts = 0, w = [1, 0], tgx = 0, tgy = 0, tgz = 0;
    function startMove() { for (var i = 0; i < N; i++) { FX[i] = X[i]; FY[i] = Y[i]; FZ[i] = Z[i]; FS[i] = S[i]; } }
    function target(F, i, t) {
      var tr = F.trav[i];
      if (tr) { var ph = (tr[1] + t * 0.07) % 1, e = tr[0]; tgx = e[0] + (e[3] - e[0]) * ph; tgy = e[1] + (e[4] - e[1]) * ph; tgz = e[2] + (e[5] - e[2]) * ph; }
      else { tgx = F.tx[i]; tgy = F.ty[i]; tgz = F.tz[i]; }
    }
    startMove();
    return {
      n: N, zr: 11,
      tick: function (dt, clock) {
        var F = form[f], i, avg = 0; ts += dt;
        if (mode === "move") {
          var dur = T_MOVE * (1 - SPREAD);
          for (i = 0; i < N; i++) {
            var p = clamp((ts - DLY[i] * T_MOVE) / dur, 0, 1), e = ease(p), a = Math.sin(Math.PI * p);
            target(F, i, clock);
            X[i] = FX[i] + (tgx - FX[i]) * e + ARC[i * 3] * a; Y[i] = FY[i] + (tgy - FY[i]) * e + ARC[i * 3 + 1] * a; Z[i] = FZ[i] + (tgz - FZ[i]) * e + ARC[i * 3 + 2] * a;
            S[i] = FS[i] + (F.ts[i] - FS[i]) * e; avg += e;
          }
          avg /= N; w[f] = avg; w[1 - f] = 1 - avg;
          if (ts >= T_MOVE) { mode = "hold"; ts = 0; }
        } else {
          /* hold: the formation breathes a little so it never looks frozen */
          for (i = 0; i < N; i++) { target(F, i, clock); X[i] = tgx; Y[i] = tgy + Math.sin(clock * 0.9 + i * 0.37) * 0.09; Z[i] = tgz + Math.cos(clock * 0.7 + i * 0.21) * 0.12; S[i] = F.ts[i]; }
          w[f] = 1; w[1 - f] = 0;
          if (ts >= T_HOLD) { f = 1 - f; mode = "move"; ts = 0; startMove(); }
        }
      },
      settle: function () { f = 0; w[0] = 1; w[1] = 0; for (var i = 0; i < N; i++) { target(form[0], i, 0); X[i] = tgx; Y[i] = tgy; Z[i] = tgz; S[i] = form[0].ts[i]; } },
      eval: function (i, P, t, o) { o.x = X[i]; o.y = Y[i]; o.z = Z[i]; o.s = S[i]; o.k = i % 3 === 0 ? 0 : 1; },
      scale: function (bw, bh) { var s0 = fit(bw, bh, form[0].ex, form[0].ey), s1 = Math.min(fit(bw, bh, form[1].ex, form[1].ey), s0 * 1.7); return s0 * w[0] + s1 * w[1]; },
      lines: function (inst, P, t, emit) {
        for (var q = 0; q < 2; q++) {
          if (w[q] < 0.05) continue;
          var Ls = form[q].lines, al = (q === 1 ? 0.17 : 0.2) * w[q] * w[q];
          for (var i = 0; i < Ls.length; i++) { var l = Ls[i]; emit(l[0], l[1], l[2], l[3], l[4], l[5], al); }
        }
      }
    };
  }

  /* ================= PIPELINE: cubes travel the belt for ever: extract -> clean -> validate -> load ================= */
  function scenePipeline(n) {
    var rows = Math.ceil(n / 16), RISE = 0.42, yb = -(4 + rows * 1.15 + 3) / 2, Q = new Float32Array(n * 3), S = new Float32Array(n * 3), lane = new Float32Array(n), k, qk;
    function by(x) { return yb + 0.5 + (x + 9) * RISE * 0.55; }
    for (k = 0; k < n; k++) {
      qk = n - 1 - k;
      Q[k * 3] = -8.6 + (qk % 4) * 1.15; Q[k * 3 + 1] = yb + 0.6 + Math.floor(qk / 16) * 1.15; Q[k * 3 + 2] = (Math.floor(qk / 4) % 4 - 1.5) * 1.15;
      S[k * 3] = 4.7 + (k % 4) * 1.15; S[k * 3 + 1] = by(S[k * 3]) + 0.1 + Math.floor(k / 16) * 1.15; S[k * 3 + 2] = (Math.floor(k / 4) % 4 - 1.5) * 1.15;
      lane[k] = ((k * 7) % 5 - 2) * 1.25;
    }
    var ey = (4 + rows * 1.15 + 3) / 2 + 1.2;
    return {
      n: n, zr: 10, pit: 0.28,
      eval: function (i, P, t, o) {
        var v = (P * 0.9 + t * 0.05 + i / n) % 1, u = clamp((v - 0.2) / 0.58, 0, 1), a = sstep(0, 0.12, u), b = sstep(0.88, 1, u), i3 = i * 3;
        o.x = Q[i3] + (S[i3] - Q[i3]) * u;
        o.y = Q[i3 + 1] * (1 - a) + by(o.x) * a * (1 - b) + S[i3 + 1] * b + Math.sin(t * 2 + i) * 0.06 * a * (1 - b);
        o.z = Q[i3 + 2] * (1 - a) + lane[i] * a * (1 - b) + S[i3 + 2] * b;
        o.s = (0.55 + 0.45 * sstep(0.25, 0.4, u)) * sstep(0, 0.03, v) * (1 - sstep(0.97, 1, v)); o.k = u > 0.6 ? 0 : 1;
      },
      scale: function (bw, bh) { return fit(bw, bh, 9.8, ey); },
      lines: function (inst, P, t, emit) {
        emit(-9.6, by(-9.6) - 0.65, 0, 9.6, by(9.6) - 0.65, 0, 0.3);
        emit(-3, by(-3) - 0.65, 0, -3, by(-3) + 1.9, 0, 0.22); emit(1, by(1) - 0.65, 0, 1, by(1) + 1.9, 0, 0.22);
      },
      labels: [[-7, "extract", "extraer"], [-3, "clean", "limpiar"], [1, "validate", "validar"], [6.4, "load", "cargar"]],
      labelY: yb - 1.2, labelRise: function (x) { return by(x) - yb - 1.6; }
    };
  }

  /* ================= GIT GRAPH: commits as cubes; pulses run along the branches ================= */
  function sceneGit(n) {
    var lanes = [{ y: 0, x0: -11.5, x1: 11.5, share: 0.3, k: 0 }, { y: 3.4, x0: -8, x1: 2, share: 0.2, k: 1 }, { y: -3.4, x0: -3, x1: 7, share: 0.2, k: 1 }, { y: 6.8, x0: -1, x1: 9, share: 0.15, k: 1 }, { y: -6.8, x0: -9, x1: -1, share: 0.15, k: 1 }];
    var TX = new Float32Array(n), TY = new Float32Array(n), TZ = new Float32Array(n), KD = new Uint8Array(n), R = new Float32Array(n), FR = new Float32Array(n * 3);
    var XS = 0.7, idx = 0, li, j, laneIdx = [[], [], [], [], []], r = rng(5);
    for (li = 0; li < 5; li++) {
      var cnt = li === 4 ? n - idx : Math.round(n * lanes[li].share);
      for (j = 0; j < cnt; j++) {
        var x = (lanes[li].x0 + (lanes[li].x1 - lanes[li].x0) * (cnt > 1 ? j / (cnt - 1) : 0)) * XS;
        TX[idx] = x; TY[idx] = lanes[li].y; TZ[idx] = (r() - 0.5) * 1.2; KD[idx] = lanes[li].k; R[idx] = (x / XS + 11.5) / 23;
        FR[idx * 3] = x - 1.5; FR[idx * 3 + 1] = lanes[li].y + 6; FR[idx * 3 + 2] = (r() - 0.5) * 4;
        laneIdx[li].push(idx); idx++;
      }
    }
    function nearestMain(x) { var b = 0, bd = 1e9; for (var q = 0; q < laneIdx[0].length; q++) { var d = Math.abs(TX[laneIdx[0][q]] - x); if (d < bd) { bd = d; b = laneIdx[0][q]; } } return b; }
    var edges = [];
    for (li = 0; li < 5; li++) for (j = 1; j < laneIdx[li].length; j++) edges.push([laneIdx[li][j - 1], laneIdx[li][j]]);
    for (li = 1; li < 5; li++) { var A = laneIdx[li]; if (A.length) { edges.push([nearestMain(TX[A[0]]), A[0]]); edges.push([A[A.length - 1], nearestMain(TX[A[A.length - 1]] + 1.6)]); } }
    var e = new Float32Array(n);
    return {
      n: n, zr: 9, pit: 0.22,
      eval: function (i, P, t, o) {
        var v = ease(clamp((P * 1.2 - R[i]) / 0.15, 0, 1)); e[i] = v;
        var xr = R[i] * 23 - 11.5, p1 = ((t * 0.2) % 1) * 25 - 12, p2 = (((t * 0.2) + 0.5) % 1) * 25 - 12;
        var wv = Math.max(Math.exp(-Math.pow((xr - p1) / 2.2, 2)), Math.exp(-Math.pow((xr - p2) / 2.2, 2))) * v;
        o.x = FR[i * 3] + (TX[i] - FR[i * 3]) * v; o.y = FR[i * 3 + 1] + (TY[i] - FR[i * 3 + 1]) * v + Math.sin(t * 1.1 + i * 0.7) * 0.16 * v;
        o.z = FR[i * 3 + 2] + (TZ[i] - FR[i * 3 + 2]) * v + Math.sin(t * 0.5 + i) * 0.35 * v;
        o.s = (0.42 + 0.16 * v) * (1 + 1.3 * wv); o.k = wv > 0.3 ? 0 : KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, 9, 7.6); },
      edges: edges, reveal: e
    };
  }

  /* ================= TIMELINE: layers stack up, hold, then reset in a slow loop ================= */
  function sceneTimeline(n) {
    var xs = [-7.5, 0.4, 4, 7.5], wts = [0.18, 0.24, 0.14, 0.44], total = Math.floor(n / 4), h = [], sum = 0, c, a, b, d, i;
    for (c = 0; c < 4; c++) { h[c] = Math.max(1, Math.round(total * wts[c])); sum += h[c]; }
    while (sum > total) { var m = 0; for (c = 1; c < 4; c++) if (h[c] > h[m]) m = c; h[m]--; sum--; }
    var hmax = Math.max.apply(null, h), sp = 1.25, yb = -(hmax * sp) / 2, TX = [], TY = [], TZ = [], TH = [], KD = [];
    for (c = 0; c < 4; c++) for (a = 0; a < h[c]; a++) for (b = 0; b < 2; b++) for (d = 0; d < 2; d++) { TX.push(xs[c] + b * sp); TY.push(yb + a * sp + sp / 2); TZ.push((d - 0.5) * sp); TH.push(c * 0.22 + (a / h[c]) * 0.22); KD.push(c === 3 ? 0 : 1); }
    var extra = n - TX.length; for (i = 0; i < extra; i++) { TX.push(xs[3] + (i % 2) * sp); TY.push(yb + (h[3] + 1) * sp + sp / 2); TZ.push(0); TH.push(0.88); KD.push(0); }
    return {
      n: n, zr: 8,
      eval: function (i, P, t, o) {
        var ph = loop(t, 22, 0), lb = ph < 0.4 ? 0.3 + 0.7 * ease(ph / 0.4) : ph < 0.8 ? 1 : 1 - 0.7 * ease((ph - 0.8) / 0.2);
        var eff = Math.min(P * 1.02, lb * 1.02), v = ease(clamp((eff - TH[i]) / 0.12, 0, 1));
        o.x = TX[i] + Math.sin(t * 0.6 + TX[i]) * 0.1; o.y = TY[i] + (1 - v) * 3.5 + Math.sin(t * 1.3 + i * 0.4) * 0.05 * v; o.z = TZ[i] + Math.cos(t * 0.5 + i) * 0.12 * v; o.s = 0.75 + 0.25 * v; o.k = KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, 9.6, hmax * 0.7 + 1.6); },
      lines: function (inst, P, t, emit) {
        emit(-9, yb - 0.1, 0, 9.4, yb - 0.1, 0, 0.3);
        emit(-8.2, yb - 0.1, 0, -8.2, yb - 0.9, 0, 0.3); emit(-3.1, yb - 0.1, 0, -3.1, yb - 0.9, 0, 0.3); emit(7.5, yb - 0.1, 0, 7.5, yb - 0.9, 0, 0.3);
      },
      labels: [[-8.2, "2024", "2024"], [-3.1, "2025", "2025"], [7.5, "2026", "2026"]], labelY: yb - 1.8
    };
  }

  /* ================= SKILLS: two clusters orbit, sort themselves, get closer and swap cubes ================= */
  function sceneSkills(n) {
    n = n - (n % 2); var half = n / 2, MX = new Float32Array(n * 3), SX = new Float32Array(n * 3), r = rng(9), i;
    var per = Math.ceil(half / 3), g = Math.ceil(Math.sqrt(per));
    for (i = 0; i < half; i++) { var L = i % 3, q = Math.floor(i / 3); SX[i * 3] = -2.4 + L * 2.4; SX[i * 3 + 1] = ((q % g) - (g - 1) / 2) * 1.75; SX[i * 3 + 2] = (Math.floor(q / g) - (g - 1) / 2) * 1.75; }
    var kk = Math.max(2, Math.ceil(Math.cbrt(half)));
    for (i = 0; i < half; i++) { var j = half + i; SX[j * 3] = ((i % kk) - (kk - 1) / 2) * 1.15; SX[j * 3 + 1] = ((Math.floor(i / kk) % kk) - (kk - 1) / 2) * 1.15; SX[j * 3 + 2] = ((Math.floor(i / (kk * kk))) - (kk - 1) / 2) * 1.15; }
    for (i = 0; i < n; i++) { MX[i * 3] = (r() - 0.5) * 11; MX[i * 3 + 1] = (r() - 0.5) * 8; MX[i * 3 + 2] = (r() - 0.5) * 7; }
    return {
      n: n, zr: 9,
      eval: function (i, P, t, o) {
        var s = sstep(0.1, 0.6, P), cd = 8.2 - 2.4 * sstep(0.5, 1, P), isAI = i < half, side = isAI ? -cd : cd, i3 = i * 3, dr = (1 - s) * 0.6;
        /* each cluster turns around its own centre */
        var th = t * (isAI ? 0.32 : -0.26), c = Math.cos(th), sn = Math.sin(th), sx0 = SX[i3] * c + SX[i3 + 2] * sn, sz0 = -SX[i3] * sn + SX[i3 + 2] * c, sy0 = SX[i3 + 1] + Math.sin(t * 0.8 + i * 0.5) * 0.12;
        var x = side + sx0, y = sy0, z = sz0;
        /* some cubes cross over to the other cluster and come back */
        if (i % 7 === 0) {
          var ph = (t * 0.07 + i * 0.137) % 1, wv = ph < 0.5 ? sstep(0, 0.5, ph) : 1 - sstep(0.5, 1, ph);
          x = side * (1 - 2 * wv) + sx0 * 0.6; y = sy0 + Math.sin(Math.PI * wv) * 3.2; z = sz0 + Math.sin(Math.PI * wv) * 1.5;
        }
        o.x = MX[i3] + (x - MX[i3]) * s + Math.sin(t * 0.7 + i) * dr;
        o.y = MX[i3 + 1] + (y - MX[i3 + 1]) * s + Math.cos(t * 0.6 + i * 1.3) * dr;
        o.z = MX[i3 + 2] + (z - MX[i3 + 2]) * s; o.s = 1; o.k = isAI ? 0 : 1;
      },
      scale: function (bw, bh) { return fit(bw, bh, 11.2, 4.8); },
      dyn: function (P) { var cd = 8.2 - 2.4 * sstep(0.5, 1, P); return [[-cd, "AI", "IA"], [cd, "Data", "Datos"]]; }, labelY: -5.6, labelA: function (P) { return sstep(0.35, 0.7, P); }
    };
  }

  /* ================= CONTACT: everything converges into one spinning cube; now and then it comes apart ================= */
  function sceneContact(n) {
    var k = Math.max(3, Math.floor(Math.cbrt(n))), N = k * k * k, TX = new Float32Array(N * 3), CX = new Float32Array(N * 3), r = rng(13), i, a, b, c, KD = new Uint8Array(N), idx = 0;
    for (a = 0; a < k; a++) for (b = 0; b < k; b++) for (c = 0; c < k; c++) {
      TX[idx * 3] = (a - (k - 1) / 2) * 1.04; TX[idx * 3 + 1] = (b - (k - 1) / 2) * 1.04; TX[idx * 3 + 2] = (c - (k - 1) / 2) * 1.04;
      KD[idx] = (a === 0 || b === 0 || c === 0 || a === k - 1 || b === k - 1 || c === k - 1) && (a + b + c) % 2 === 0 ? 0 : 1; idx++;
    }
    for (i = 0; i < N; i++) { var th = r() * 6.2832, ph = Math.acos(2 * r() - 1), rad = k * 1.6 + r() * k; CX[i * 3] = Math.sin(ph) * Math.cos(th) * rad * 1.3; CX[i * 3 + 1] = Math.cos(ph) * rad * 0.8; CX[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * rad; }
    return {
      n: N, zr: k * 1.1,
      eval: function (i, P, t, o) {
        var sScroll = ease(clamp((P - 0.12) / 0.72, 0, 1)), ph = loop(t, 20, 0.75);
        var sLoop = ph < 0.5 ? 1 : ph < 0.65 ? 1 - ease((ph - 0.5) / 0.15) : ph < 0.75 ? 0 : ease((ph - 0.75) / 0.25), s = Math.min(sScroll, sLoop), i3 = i * 3;
        var sp = t * 0.5, c = Math.cos(sp), sn = Math.sin(sp), x1 = TX[i3] * c + TX[i3 + 2] * sn, z1 = -TX[i3] * sn + TX[i3 + 2] * c, ct = Math.cos(t * 0.31), st = Math.sin(t * 0.31), y1 = TX[i3 + 1] * ct - z1 * st, z2 = TX[i3 + 1] * st + z1 * ct;
        var cxw = CX[i3] + Math.sin(t * 0.4 + i) * 0.8, cyw = CX[i3 + 1] + Math.cos(t * 0.35 + i * 1.7) * 0.8;
        o.x = cxw + (x1 - cxw) * s; o.y = cyw + (y1 - cyw) * s; o.z = CX[i3 + 2] + (z2 - CX[i3 + 2]) * s; o.s = 1; o.k = KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, k * 1.5, k * 1.5); }
    };
  }

  var SCENES = { hero: { make: sceneHero, base: [180, 100] }, pipeline: { make: scenePipeline, base: [120, 70] }, git: { make: sceneGit, base: [70, 48] }, timeline: { make: sceneTimeline, base: [120, 72] }, skills: { make: sceneSkills, base: [120, 70] }, contact: { make: sceneContact, base: [125, 64] } };

  /* ================= instances ================= */
  function makeInstance(key, n) {
    var sc = SCENES[key].make(n), N = sc.n, r = rng(31), sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), del = new Float32Array(N), order = [], i;
    for (i = 0; i < N; i++) { var th = r() * 6.2832, ph = Math.acos(2 * r() - 1), rad = 8 + r() * 6; sx[i] = Math.sin(ph) * Math.cos(th) * rad * 1.3; sy[i] = Math.cos(ph) * rad * 0.7; sz[i] = Math.sin(ph) * Math.sin(th) * rad; del[i] = r() * 0.55; order.push(i); }
    return { key: key, sc: sc, n: N, sx: sx, sy: sy, sz: sz, del: del, sm: -1, t0: clock, ph: r() * 6, order: order, RX: new Float32Array(N), RY: new Float32Array(N), RZ: new Float32Array(N), SZ: new Float32Array(N), KD: new Uint8Array(N) };
  }
  function lvl() { return [1, 0.7, 0.5][level]; }
  function budget() { return (W < 720 ? 160 : 300) * lvl(); }
  function used() { var u = 0; for (var i = 0; i < defs.length; i++) if (defs[i].inst) u += defs[i].inst.n; return u; }
  function tryCreate(d) {
    var base = SCENES[d.key].base[W < 720 ? 1 : 0] * lvl(), n = Math.min(Math.round(base), budget() - used());
    if (n < 24) return;
    d.inst = makeInstance(d.key, n);
  }

  /* ================= drawing: 3D cubes with flat per-face shading, painter's order ================= */
  var o = { x: 0, y: 0, z: 0, s: 1, k: 0 }, tmpV = [0, 0, 0], VX = new Float32Array(8), VY = new Float32Array(8);
  var FACE_MASK = [4, 2, 1];                                    /* axis x, y, z -> vertex bit */
  var SHADE_DARK = [0.62, 1.5, 1.0], SHADE_LIGHT = [1.4, 0.55, 1.0];   /* side, top, front */
  function faceStyle(kind, face, dq, zone, aq, stroke, zoneMul) {
    var key = ((((kind * 3 + face) * 6 + dq) * 2 + zone) * 9 + aq) * 3 + stroke, s = styleCache[key];
    if (s) return s;
    var aI = aq / 8 * OP, fa = 1 - 0.65 * (dq / 5), zm = zone ? zoneMul : 1, c = kind === 0 ? col.acc : col.mut, a;
    if (stroke === 0) a = (kind === 0 ? 0.15 : 0.1) * (col.dark ? SHADE_DARK : SHADE_LIGHT)[face] * fa * aI * zm;
    else if (stroke === 1) a = (kind === 0 ? 0.72 : 0.5) * fa * aI * zm;
    else a = (kind === 0 ? 0.72 : 0.5) * fa * aI * zm * 0.32;
    return (styleCache[key] = rgba(c, Math.min(a, 1)));
  }
  function drawInstance(c, inst, bx, by, bw, bh, P, L, t, yaw, pit, ox, oy, zoneFn, zoneMul) {
    var N = inst.n, sc = inst.sc; pit += sc.pit || 0; var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), i, a, b;
    function rot(x, y, z, out) { var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw; out[0] = x1; out[1] = y * cp - z1 * sp; out[2] = y * sp + z1 * cp; }
    var ax = [0, 0, 0], ay = [0, 0, 0], az = [0, 0, 0], axes = [ax, ay, az], v = tmpV;
    rot(1, 0, 0, ax); rot(0, 1, 0, ay); rot(0, 0, 1, az);
    var scale = sc.scale(bw, bh, P), cx = bx + bw / 2 + ox, cy = by + bh / 2 + oy, aI = sstep(0, 0.3, L) * OP, aq = Math.round(aI / OP * 8), zr = sc.zr || 9;
    function px(x, y, z) { var k = FOCAL / (FOCAL + z); return [cx + x * k * scale, cy - y * k * scale]; }
    /* lines (behind the cubes) */
    var lp = [[new Path2D(), new Path2D()], [new Path2D(), new Path2D()], [new Path2D(), new Path2D()], [new Path2D(), new Path2D()]];
    function emit(x1, y1, z1, x2, y2, z2, al) {
      if (al <= 0.02) return;
      rot(x1, y1, z1, v); var p1 = px(v[0], v[1], v[2]); rot(x2, y2, z2, v); var p2 = px(v[0], v[1], v[2]);
      var q = al > 0.8 ? 3 : al > 0.5 ? 2 : al > 0.25 ? 1 : 0, P2 = lp[q][zoneFn((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)];
      P2.moveTo(p1[0], p1[1]); P2.lineTo(p2[0], p2[1]);
    }
    /* positions + depth */
    var RX = inst.RX, RY = inst.RY, RZ = inst.RZ, SZ = inst.SZ, KD = inst.KD, CXs = inst.cx || (inst.cx = new Float32Array(N * 3)), order = inst.order;
    for (i = 0; i < N; i++) {
      sc.eval(i, P, t, o);
      var li = clamp((L - inst.del[i] * 0.55) / 0.45, 0, 1), e = ease(li);
      var X = inst.sx[i] + (o.x - inst.sx[i]) * e, Y = inst.sy[i] + (o.y - inst.sy[i]) * e, Z = inst.sz[i] + (o.z - inst.sz[i]) * e;
      CXs[i * 3] = X; CXs[i * 3 + 1] = Y; CXs[i * 3 + 2] = Z; SZ[i] = o.s * (0.7 + 0.3 * e); KD[i] = o.k;
      rot(X, Y, Z, v); RX[i] = v[0]; RY[i] = v[1]; RZ[i] = v[2];
    }
    order.sort(function (p, q) { return RZ[q] - RZ[p]; });     /* far first */
    if (sc.lines) sc.lines(inst, P, t, emit);
    if (sc.edges) {
      for (i = 0; i < sc.edges.length; i++) {
        var ed = sc.edges[i], ra = Math.min(sc.reveal[ed[0]], sc.reveal[ed[1]]);
        if (ra > 0.55) emit(CXs[ed[0] * 3], CXs[ed[0] * 3 + 1], CXs[ed[0] * 3 + 2], CXs[ed[1] * 3], CXs[ed[1] * 3 + 1], CXs[ed[1] * 3 + 2], 0.45 * ra);
      }
    }
    c.lineWidth = 1; c.lineCap = "butt"; c.lineJoin = "round";
    for (a = 0; a < 4; a++) {
      var base = 0.2 * [0.25, 0.5, 0.75, 1][a] * aI * 0.9;
      c.strokeStyle = rgba(col.mut, base); c.stroke(lp[a][0]);
      c.strokeStyle = rgba(col.mut, base * zoneMul); c.stroke(lp[a][1]);
    }
    /* cubes */
    var lastFill = "", lastStroke = "";
    for (var qi = 0; qi < N; qi++) {
      var id = order[qi], sz = SZ[id];
      if (sz < 0.02) continue;
      var kind = KD[id], dT = clamp((RZ[id] + zr) / (2 * zr), 0, 1), dq = Math.round(dT * 5), h = sz / 2, kk0 = FOCAL / (FOCAL + RZ[id]);
      var zone = zoneFn(cx + RX[id] * kk0 * scale, cy - RY[id] * kk0 * scale);
      for (var vi = 0; vi < 8; vi++) {
        var sx = (vi & 4) ? h : -h, sy = (vi & 2) ? h : -h, szz = (vi & 1) ? h : -h;
        var wx = RX[id] + sx * ax[0] + sy * ay[0] + szz * az[0], wy = RY[id] + sx * ax[1] + sy * ay[1] + szz * az[1], wz = RZ[id] + sx * ax[2] + sy * ay[2] + szz * az[2], kk = FOCAL / (FOCAL + wz);
        VX[vi] = cx + wx * kk * scale; VY[vi] = cy - wy * kk * scale;
      }
      /* back edges, very faint */
      var sb = faceStyle(kind, 0, dq, zone, aq, 2, zoneMul); if (sb !== lastStroke) { c.strokeStyle = sb; lastStroke = sb; }
      c.beginPath();
      for (a = 0; a < 3; a++) { quad(c, a, axes[a][2] > 0 ? 1 : 0); }
      c.stroke();
      /* visible faces: flat shade per face */
      for (a = 0; a < 3; a++) {
        var side = axes[a][2] > 0 ? 0 : 1;           /* face facing the camera */
        var fs = faceStyle(kind, a, dq, zone, aq, 0, zoneMul); if (fs !== lastFill) { c.fillStyle = fs; lastFill = fs; }
        c.beginPath(); quad(c, a, side); c.fill();
      }
      var ss = faceStyle(kind, 0, dq, zone, aq, 1, zoneMul); if (ss !== lastStroke) { c.strokeStyle = ss; lastStroke = ss; }
      c.beginPath(); for (a = 0; a < 3; a++) quad(c, a, axes[a][2] > 0 ? 0 : 1); c.stroke();
    }
    /* labels */
    var labs = sc.dyn ? sc.dyn(P) : sc.labels;
    if (labs) {
      var la = sc.labelA ? sc.labelA(P) : 1;
      c.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace"; c.textAlign = "center"; c.fillStyle = rgba(col.mut, 0.75 * aI / OP * 0.7 * la);
      for (i = 0; i < labs.length; i++) { rot(labs[i][0], sc.labelY + (sc.labelRise ? sc.labelRise(labs[i][0]) : 0), 0, v); var pl = px(v[0], v[1], v[2]); if (zoneFn(pl[0], pl[1]) === 0) c.fillText(isEs() ? labs[i][2] : labs[i][1], pl[0], pl[1]); }
    }
  }
  /* trace one face (axis a, side 0|1) of the current cube from VX/VY */
  function quad(c, a, side) {
    var m = FACE_MASK[a], m1 = FACE_MASK[(a + 1) % 3], m2 = FACE_MASK[(a + 2) % 3], b0 = side ? m : 0;
    c.moveTo(VX[b0], VY[b0]); c.lineTo(VX[b0 | m1], VY[b0 | m1]); c.lineTo(VX[b0 | m1 | m2], VY[b0 | m1 | m2]); c.lineTo(VX[b0 | m2], VY[b0 | m2]); c.closePath();
  }

  /* ================= animated mode: one shared loop, one small canvas per visible formation ================= */
  /* A full-viewport canvas made the browser re-composite ~1 MP every frame and collapsed to ~1 fps on
     machines without a strong GPU. Each formation now gets a canvas just as big as its own area. */
  function resize() {
    W = document.documentElement.clientWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (level >= 2 ? 0.75 : 1);
    needMeasure = true;
  }
  function dropInstance(d) { d.inst = null; if (d.cv) d.cv.style.visibility = "hidden"; }   /* canvases are kept and reused: creating and removing layers on every jump stalled the compositor */
  function destroyAll() { for (var i = 0; i < defs.length; i++) dropInstance(defs[i]); }
  function boxZone(bx, by, bw, bh) { var x0 = bx - bw * 0.12, x1 = bx + bw * 1.12, y0 = by - bh * 0.22, y1 = by + bh * 1.22; return function (x, y) { return x > x0 && x < x1 && y > y0 && y < y1 ? 0 : 1; }; }
  function textZone(rects) { return function (x, y) { for (var k = 0; k < rects.length; k++) { var z = rects[k]; if (x > z[0] && x < z[2] && y > z[1] && y < z[3]) return 1; } return 0; }; }

  /* layout is measured now and then (resize, language, accordion, timer), never inside every frame */
  var needMeasure = true, lastMeasure = 0, docH = 0;
  function measure() {
    var sy = window.scrollY; docH = document.documentElement.scrollHeight; needMeasure = false; lastMeasure = performance.now();
    defs.forEach(function (d) {
      var r = (d.pinned ? d.sec : d.el).getBoundingClientRect(); d.ref = { top: r.top + sy, height: r.height, left: r.left, width: r.width };
      var kids = d.sec.children, rects = [];
      for (var i = 0; i < kids.length; i++) { if (kids[i].classList.contains("vis")) continue; var k = kids[i].getBoundingClientRect(); if (k.width) rects.push([k.left - 14, k.top + sy - 10, k.right + 14, k.bottom + sy + 10]); }
      d.textDoc = rects;
    });
  }
  function ensureCanvas(d, rw, rh) {
    var qw = Math.ceil(rw / 32) * 32, qh = Math.ceil(rh / 32) * 32;
    if (!d.cv) { d.cv = document.createElement("canvas"); d.cv.setAttribute("aria-hidden", "true"); d.cv.className = "cubes-live"; d.cv.style.cssText = "position:fixed;left:0;top:0;pointer-events:none;z-index:8;display:block"; document.body.appendChild(d.cv); d.cvw = d.cvh = 0; }
    var pw = Math.round(qw * dpr), ph = Math.round(qh * dpr);
    if (d.cvw !== pw || d.cvh !== ph) { d.cv.width = pw; d.cv.height = ph; d.cv.style.width = qw + "px"; d.cv.style.height = qh + "px"; d.cvw = pw; d.cvh = ph; d.cx2 = d.cv.getContext("2d", { desynchronized: true }); }
    return d.cx2;
  }
  function frame(now) {
    if (!running) return;
    var raw = (now - last) / 1000; last = now;
    if (raw <= 0) { requestAnimationFrame(frame); return; }
    var dt = Math.min(raw, 0.05), c0 = performance.now();
    /* slow frames count, however slow: the old code ignored anything above 250 ms and so never degraded */
    if (skip > 0) skip--; else { accT += Math.min(raw, 0.5); accN++; }
    if (accT >= 2 || (accN >= 3 && accT / accN > 0.2)) {
      if (accT / accN * 1000 > 24 && level < 2) { level++; accT = 0; accN = 0; destroyAll(); resize(); skip = 2; }
      else { accT = 0; accN = 0; }
    }
    clock += dt;
    mx += (tmx - mx) * Math.min(1, dt * 3); my += (tmy - my) * Math.min(1, dt * 3);
    if (needMeasure || c0 - lastMeasure > 700) measure();
    var vh = H, sy = window.scrollY, anyVis = false, total = 0, i;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!d.vis) { if (d.inst) dropInstance(d); continue; }
      anyVis = true;
      if (!d.inst) tryCreate(d);
      var inst = d.inst; if (!inst || !d.ref) continue;
      var rtop = d.ref.top - sy, s = (vh - rtop) / (vh + d.ref.height);
      inst.sm = inst.sm < 0 ? s : inst.sm + (s - inst.sm) * (1 - Math.exp(-dt * 7));
      var sm = inst.sm, L, P, lt = clock - inst.t0, bx, by, bw, bh, zoneFn = null, zoneMul = ZONE;
      var br = d.box.getBoundingClientRect(); bx = br.left; by = br.top; bw = br.width; bh = br.height;   /* the only per-frame layout read: the box can be sticky */
      if (d.key === "hero") {
        L = 1 - sstep(0.55, 0.95, sm); P = 0; inst.sc.tick(dt, clock);
        if (d.wide) { /* wide screens: the formation takes the right part of the hero, text rectangles stay clear */
          var tp = Math.max(rtop, 0), bt = Math.min(rtop + d.ref.height, vh), midY = (tp + bt) / 2, hh = Math.min((bt - tp) * 0.86, 760);
          bx = d.ref.left + d.ref.width * 0.4; bw = d.ref.width * 0.6; bh = Math.min(hh, bw * 0.62); by = midY - bh / 2;
          var tr = []; for (var q2 = 0; q2 < d.textDoc.length; q2++) { var z = d.textDoc[q2]; tr.push([z[0], z[1] - sy, z[2], z[3] - sy]); }
          zoneFn = textZone(tr); zoneMul = HERO_ZONE;
        }
      } else {
        var sEnd = (vh - (rtop + sy - (docH - vh))) / (vh + d.ref.height);
        L = sstep(0.04, 0.3, sm) * (1 - sstep(0.8, 1, sm)); P = clamp((sm - 0.1) / Math.max(0.2, Math.min(0.62, sEnd - 0.12)), 0, 1);
      }
      if (!zoneFn) {
        if (d.wide) { var tr2 = []; for (var q3 = 0; q3 < d.textDoc.length; q3++) { var z2 = d.textDoc[q3]; tr2.push([z2[0], z2[1] - sy, z2[2], z2[3] - sy]); } zoneFn = textZone(tr2); }
        else zoneFn = boxZone(bx, by, bw, bh);
      }
      total += inst.n;
      if (L <= 0.002 || by + bh < -40 || by > vh + 40 || bw < 40) { if (d.cv) d.cv.style.visibility = "hidden"; continue; }
      /* canvas region = the formation area plus a margin; only this region is drawn and composited */
      var mgx = bw * 0.18, mgy = bh * 0.3, rx = bx - mgx, ry = by - mgy, rw = bw + 2 * mgx, rh = bh + 2 * mgy;
      var cx2 = ensureCanvas(d, rw, rh); d.cv.style.visibility = "visible";
      d.cv.style.transform = "translate(" + Math.round(rx) + "px," + Math.round(ry) + "px)";
      cx2.setTransform(dpr, 0, 0, dpr, -Math.round(rx) * dpr, -Math.round(ry) * dpr);
      cx2.clearRect(Math.round(rx), Math.round(ry), d.cvw / dpr + 2, d.cvh / dpr + 2);
      var yaw = 0.12 + (sm - 0.5) * 0.5 + Math.sin(clock * 0.24 + inst.ph) * 0.5 + mx * 0.14, pit = 0.3 + Math.sin(clock * 0.11 + inst.ph) * 0.07 + my * 0.06;
      drawInstance(cx2, inst, bx, by, bw, bh, P, L, lt, yaw, pit, mx * 9, my * 6, zoneFn, zoneMul);
    }
    var cost = performance.now() - c0; stat.ms = stat.ms * 0.9 + cost * 0.1; if (cost > stat.maxMs) stat.maxMs = cost; stat.level = level;
    stat.active = total; if (total > stat.max) stat.max = total; stat.budget = budget();
    if (!anyVis) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function start() { if (running || staticMode || document.hidden) return; running = true; last = performance.now(); skip = 2; accT = 0; accN = 0; needMeasure = true; requestAnimationFrame(frame); }
  function stop() { running = false; }

  /* ================= motion off (system setting or the switch): one static, assembled frame per section ================= */
  function renderStaticAll() {
    defs.forEach(function (d) {
      var br = d.box.getBoundingClientRect(); if (br.width < 40 || br.height < 40) return;
      if (!d.sc) { d.sc = document.createElement("canvas"); d.sc.setAttribute("aria-hidden", "true"); d.sc.className = "vis-static"; d.box.appendChild(d.sc); }
      var r = Math.min(window.devicePixelRatio || 1, 1.5), c = d.sc.getContext("2d");
      d.sc.width = Math.round(br.width * r); d.sc.height = Math.round(br.height * r);
      var base = SCENES[d.key].base[window.innerWidth < 720 ? 1 : 0], inst = makeInstance(d.key, base);
      if (inst.sc.settle) inst.sc.settle();
      c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, br.width, br.height);
      drawInstance(c, inst, 0, 0, br.width, br.height, 1, 1, 0, 0.42, 0.32, 0, 0, function () { return 0; }, ZONE);
    });
  }

  /* ================= setup ================= */
  canvas.style.display = "none";
  readColors();
  var els = document.querySelectorAll(".vis[data-scene]");
  for (var q = 0; q < els.length; q++) {
    var box = els[q].querySelector(".vis-box"); if (!box) continue;
    defs.push({ el: els[q], box: box, sec: els[q].parentElement, key: els[q].getAttribute("data-scene"), vis: false, visSec: false, visEl: false, wide: false, pinned: false, inst: null, sc: null, cv: null, cx2: null, cvw: 0, cvh: 0, ref: null, textDoc: [] });
  }
  if (!defs.length) return;
  function syncVis() { defs.forEach(function (d) { var pos = getComputedStyle(d.el).position; d.wide = pos === "absolute"; d.pinned = d.wide || pos === "sticky"; d.vis = d.pinned ? d.visSec : d.visEl; }); needMeasure = true; if (!staticMode && defs.some(function (d) { return d.vis; })) start(); }
  function applyMode() {
    staticMode = !motionOn();
    if (staticMode) { stop(); destroyAll(); renderStaticAll(); }
    else { defs.forEach(function (d) { if (d.sc) { d.sc.parentNode.removeChild(d.sc); d.sc = null; } }); resize(); syncVis(); }
  }
  if ("ResizeObserver" in window) { new ResizeObserver(function () { needMeasure = true; if (staticMode) renderStaticAll(); }).observe(document.body); }
  window.addEventListener("resize", function () { resize(); if (staticMode) renderStaticAll(); else syncVis(); }, { passive: true });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { for (var i = 0; i < defs.length; i++) { if (defs[i].sec === e.target) defs[i].visSec = e.isIntersecting; if (defs[i].el === e.target) defs[i].visEl = e.isIntersecting; } });
      syncVis();
    }, { threshold: 0 });
    defs.forEach(function (d) { io.observe(d.sec); io.observe(d.el); });
  } else { defs.forEach(function (d) { d.visSec = d.visEl = true; }); syncVis(); }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else if (defs.some(function (d) { return d.vis; })) start(); });
  if (finePointer) window.addEventListener("pointermove", function (e) { tmx = (e.clientX / innerWidth - 0.5) * 2; tmy = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  function onTheme() { readColors(); if (staticMode) renderStaticAll(); }
  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-eff"] });
  new MutationObserver(function () { needMeasure = true; }).observe(root, { attributes: true, attributeFilter: ["lang", "data-lang"] });
  document.addEventListener("click", function (ev) { needMeasure = true; setTimeout(function () { needMeasure = true; }, 500); if (staticMode && ev.target.closest && ev.target.closest(".lang button")) setTimeout(renderStaticAll, 50); });
  if (mqDark.addEventListener) mqDark.addEventListener("change", onTheme);
  if (mqReduce.addEventListener) mqReduce.addEventListener("change", applyMode);
  window.addEventListener("motionchange", applyMode);
  window.__cubesStat = function () { return JSON.stringify(stat); };
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { needMeasure = true; if (staticMode) renderStaticAll(); });
  if (staticMode) renderStaticAll();
})();
