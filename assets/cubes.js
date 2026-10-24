/* Cube formations, one per section, driven by scroll. One fixed canvas and one shared rAF loop.
   Small cubes (flat translucent faces, thin edges) assemble into a shape that means something for the
   section: hero (data tensor + neural network), data pipeline, commit graph, timeline, AI/Data clusters,
   and a single cube for contact. Colors come from the CSS tokens. No libraries. */
(function () {
  "use strict";
  var canvas = document.getElementById("cubes");
  if (!canvas || !canvas.getContext || !window.Path2D) return;
  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  var mqDark = matchMedia("(prefers-color-scheme: dark)");
  var finePointer = matchMedia("(pointer: fine)").matches;
  var FOCAL = 50, OP = 0.85, ZONE = 0.05;
  var col = { acc: [27, 91, 114], mut: [70, 86, 95] };
  var W = 0, H = 0, dpr = 1, level = 0, clock = 0, mx = 0, my = 0, tmx = 0, tmy = 0;
  var running = false, staticMode = mqReduce.matches, last = 0, accT = 0, accN = 0, skip = 0;
  var stat = { active: 0, max: 0, budget: 0, ms: 0, maxMs: 0, level: 0 };
  var defs = [];

  /* ---------- helpers ---------- */
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) { h = (h || "").trim(); if (h.charAt(0) !== "#") return null; if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]; return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function readColors() { var cs = getComputedStyle(root); col.acc = hex(cs.getPropertyValue("--accent")) || col.acc; col.mut = hex(cs.getPropertyValue("--muted")) || col.mut; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }
  function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function shuffle(n, seed) { var r = rng(seed), a = [], i, j, t; for (i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function isEs() { return root.lang === "es"; }
  function fit(bw, bh, ex, ey) { return Math.max(3, Math.min(bw / (2 * ex * 1.0), bh / (2 * ey * 1.05))); }

  /* ================= HERO: data tensor + bar columns <-> neural network (time based) ================= */
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
    var f = 0, mode = "move", ts = 0, w = [1, 0], tgx = 0, tgy = 0, tgz = 0, now = 0;
    function startMove() { for (var i = 0; i < N; i++) { FX[i] = X[i]; FY[i] = Y[i]; FZ[i] = Z[i]; FS[i] = S[i]; } }
    function target(F, i, t) {
      var tr = F.trav[i];
      if (tr) { var ph = (tr[1] + t * 0.07) % 1, e = tr[0]; tgx = e[0] + (e[3] - e[0]) * ph; tgy = e[1] + (e[4] - e[1]) * ph; tgz = e[2] + (e[5] - e[2]) * ph; }
      else { tgx = F.tx[i]; tgy = F.ty[i]; tgz = F.tz[i]; }
    }
    startMove();
    return {
      n: N,
      tick: function (dt, clock) {
        var F = form[f], i, avg = 0; ts += dt; now = clock;
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
          for (i = 0; i < N; i++) { target(F, i, clock); X[i] = tgx; Y[i] = tgy; Z[i] = tgz; S[i] = F.ts[i]; }
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

  /* ================= PIPELINE: extract -> clean -> validate -> load ================= */
  function scenePipeline(n) {
    var rows = Math.ceil(n / 16), RISE = 0.42, yb = -(4 + rows * 1.15 + 3) / 2, Q = new Float32Array(n * 3), S = new Float32Array(n * 3), lane = new Float32Array(n), k, qk;
    function by(x) { return yb + 0.5 + (x + 9) * RISE * 0.55; }
    for (k = 0; k < n; k++) {
      qk = n - 1 - k;
      Q[k * 3] = -8.6 + (qk % 4) * 1.15; Q[k * 3 + 1] = yb + 0.6 + Math.floor(qk / 16) * 1.15; Q[k * 3 + 2] = (Math.floor(qk / 4) % 4 - 1.5) * 1.15;
      S[k * 3] = 4.7 + (k % 4) * 1.15; S[k * 3 + 1] = by(S[k * 3]) + 0.1 + Math.floor(k / 16) * 1.15; S[k * 3 + 2] = (Math.floor(k / 4) % 4 - 1.5) * 1.15;
      lane[k] = ((k * 5) % 3 - 1) * 1.1;
    }
    var ey = (4 + rows * 1.15 + 3) / 2 + 1.2;
    return {
      n: n,
      eval: function (i, P, t, o) {
        var e = (i / n) * 0.55, u = clamp((P - e) / 0.45, 0, 1), a = sstep(0, 0.12, u), b = sstep(0.88, 1, u), i3 = i * 3;
        o.x = Q[i3] + (S[i3] - Q[i3]) * u;
        o.y = Q[i3 + 1] * (1 - a) + by(o.x) * a * (1 - b) + S[i3 + 1] * b;
        o.z = Q[i3 + 2] * (1 - a) + lane[i] * a * (1 - b) + S[i3 + 2] * b;
        o.s = 0.55 + 0.45 * sstep(0.25, 0.4, u); o.k = u > 0.6 ? 0 : 1;
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

  /* ================= GIT GRAPH: commits as cubes on branches ================= */
  function sceneGit(n) {
    var lanes = [{ y: 0, x0: -11.5, x1: 11.5, share: 0.3, k: 0 }, { y: 3.4, x0: -8, x1: 2, share: 0.2, k: 1 }, { y: -3.4, x0: -3, x1: 7, share: 0.2, k: 1 }, { y: 6.8, x0: -1, x1: 9, share: 0.15, k: 1 }, { y: -6.8, x0: -9, x1: -1, share: 0.15, k: 1 }];
    var TX = new Float32Array(n), TY = new Float32Array(n), TZ = new Float32Array(n), KD = new Uint8Array(n), R = new Float32Array(n), FR = new Float32Array(n * 3);
    var XS = 0.7, idx = 0, li, j, laneIdx = [[], [], [], [], []], r = rng(5);
    for (li = 0; li < 5; li++) {
      var cnt = li === 4 ? n - idx : Math.round(n * lanes[li].share);
      for (j = 0; j < cnt; j++) {
        var x = (lanes[li].x0 + (lanes[li].x1 - lanes[li].x0) * (cnt > 1 ? j / (cnt - 1) : 0)) * XS;
        TX[idx] = x; TY[idx] = lanes[li].y; TZ[idx] = (r() - 0.5) * 0.3; KD[idx] = lanes[li].k; R[idx] = (x / XS + 11.5) / 23;
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
      n: n,
      eval: function (i, P, t, o) {
        var v = ease(clamp((P * 1.2 - R[i]) / 0.15, 0, 1)); e[i] = v;
        o.x = FR[i * 3] + (TX[i] - FR[i * 3]) * v; o.y = FR[i * 3 + 1] + (TY[i] - FR[i * 3 + 1]) * v; o.z = FR[i * 3 + 2] + (TZ[i] - FR[i * 3 + 2]) * v; o.s = 0.42 + 0.16 * v; o.k = KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, 9, 7.6); },
      edges: edges, reveal: e
    };
  }

  /* ================= TIMELINE: layers stack up as time advances ================= */
  function sceneTimeline(n) {
    var xs = [-7.5, 0.4, 4, 7.5], wts = [0.18, 0.24, 0.14, 0.44], total = Math.floor(n / 4), h = [], sum = 0, c, a, b, d, i;
    for (c = 0; c < 4; c++) { h[c] = Math.max(1, Math.round(total * wts[c])); sum += h[c]; }
    while (sum > total) { var m = 0; for (c = 1; c < 4; c++) if (h[c] > h[m]) m = c; h[m]--; sum--; }
    var hmax = Math.max.apply(null, h), sp = 1.25, yb = -(hmax * sp) / 2, TX = [], TY = [], TZ = [], TH = [], KD = [];
    for (c = 0; c < 4; c++) for (a = 0; a < h[c]; a++) for (b = 0; b < 2; b++) for (d = 0; d < 2; d++) { TX.push(xs[c] + b * sp); TY.push(yb + a * sp + sp / 2); TZ.push((d - 0.5) * sp); TH.push(c * 0.22 + (a / h[c]) * 0.22); KD.push(c === 3 ? 0 : 1); }
    var extra = n - TX.length; for (i = 0; i < extra; i++) { TX.push(xs[3] + (i % 2) * sp); TY.push(yb + (h[3] + 1) * sp + sp / 2); TZ.push(0); TH.push(0.88); KD.push(0); }
    return {
      n: n,
      eval: function (i, P, t, o) {
        var v = ease(clamp((P * 1.02 - TH[i]) / 0.12, 0, 1));
        o.x = TX[i]; o.y = TY[i] + (1 - v) * 7; o.z = TZ[i]; o.s = 0.75 + 0.25 * v; o.k = KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, 9.6, hmax * 0.7 + 1.6); },
      lines: function (inst, P, t, emit) {
        emit(-9, yb - 0.1, 0, 9.4, yb - 0.1, 0, 0.3);
        emit(-8.2, yb - 0.1, 0, -8.2, yb - 0.9, 0, 0.3); emit(-3.1, yb - 0.1, 0, -3.1, yb - 0.9, 0, 0.3); emit(7.5, yb - 0.1, 0, 7.5, yb - 0.9, 0, 0.3);
      },
      labels: [[-8.2, "2024", "2024"], [-3.1, "2025", "2025"], [7.5, "2026", "2026"]], labelY: yb - 1.8
    };
  }

  /* ================= SKILLS: two clusters (AI, Data) sort themselves and get closer ================= */
  function sceneSkills(n) {
    n = n - (n % 2); var half = n / 2, MX = new Float32Array(n * 3), SX = new Float32Array(n * 3), r = rng(9), i, c;
    var per = Math.ceil(half / 3), g = Math.ceil(Math.sqrt(per));
    for (i = 0; i < half; i++) { /* AI: three sparse layers */
      var L = i % 3, q = Math.floor(i / 3);
      SX[i * 3] = -2.4 + L * 2.4; SX[i * 3 + 1] = ((q % g) - (g - 1) / 2) * 1.75; SX[i * 3 + 2] = (Math.floor(q / g) - (g - 1) / 2) * 1.75;
    }
    var kk = Math.max(2, Math.ceil(Math.cbrt(half)));
    for (i = 0; i < half; i++) { var j = half + i; SX[j * 3] = ((i % kk) - (kk - 1) / 2) * 1.15; SX[j * 3 + 1] = ((Math.floor(i / kk) % kk) - (kk - 1) / 2) * 1.15; SX[j * 3 + 2] = ((Math.floor(i / (kk * kk))) - (kk - 1) / 2) * 1.15; }
    for (i = 0; i < n; i++) { MX[i * 3] = (r() - 0.5) * 11; MX[i * 3 + 1] = (r() - 0.5) * 8; MX[i * 3 + 2] = (r() - 0.5) * 7; }
    return {
      n: n,
      eval: function (i, P, t, o) {
        var s = sstep(0.1, 0.6, P), cd = 8.2 - 2.4 * sstep(0.5, 1, P), side = i < half ? -cd : cd, i3 = i * 3, dr = (1 - s) * 0.6;
        o.x = MX[i3] + (SX[i3] + side - MX[i3]) * s + Math.sin(t * 0.7 + i) * dr;
        o.y = MX[i3 + 1] + (SX[i3 + 1] - MX[i3 + 1]) * s + Math.cos(t * 0.6 + i * 1.3) * dr;
        o.z = MX[i3 + 2] + (SX[i3 + 2] - MX[i3 + 2]) * s; o.s = 1; o.k = i < half ? 0 : 1;
      },
      scale: function (bw, bh) { return fit(bw, bh, 11.2, 4.8); },
      dyn: function (P) { var cd = 8.2 - 2.4 * sstep(0.5, 1, P); return [[-cd, "AI", "IA"], [cd, "Data", "Datos"]]; }, labelY: -5.6, labelA: function (P) { return sstep(0.35, 0.7, P); }
    };
  }

  /* ================= CONTACT: everything converges into one cube ================= */
  function sceneContact(n) {
    var k = Math.max(3, Math.floor(Math.cbrt(n))), N = k * k * k, TX = new Float32Array(N * 3), CX = new Float32Array(N * 3), r = rng(13), i, a, b, c, KD = new Uint8Array(N), idx = 0;
    for (a = 0; a < k; a++) for (b = 0; b < k; b++) for (c = 0; c < k; c++) {
      TX[idx * 3] = (a - (k - 1) / 2) * 1.04; TX[idx * 3 + 1] = (b - (k - 1) / 2) * 1.04; TX[idx * 3 + 2] = (c - (k - 1) / 2) * 1.04;
      KD[idx] = (a === 0 || b === 0 || c === 0 || a === k - 1 || b === k - 1 || c === k - 1) && (a + b + c) % 2 === 0 ? 0 : 1; idx++;
    }
    for (i = 0; i < N; i++) { var th = r() * 6.2832, ph = Math.acos(2 * r() - 1), rad = k * 1.6 + r() * k; CX[i * 3] = Math.sin(ph) * Math.cos(th) * rad * 1.3; CX[i * 3 + 1] = Math.cos(ph) * rad * 0.8; CX[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * rad; }
    return {
      n: N,
      eval: function (i, P, t, o) {
        var s = ease(clamp((P - 0.12) / 0.72, 0, 1)), i3 = i * 3;
        o.x = CX[i3] + (TX[i3] - CX[i3]) * s; o.y = CX[i3 + 1] + (TX[i3 + 1] - CX[i3 + 1]) * s; o.z = CX[i3 + 2] + (TX[i3 + 2] - CX[i3 + 2]) * s; o.s = 1; o.k = KD[i];
      },
      scale: function (bw, bh) { return fit(bw, bh, k * 1.5, k * 1.5); }
    };
  }

  var SCENES = { hero: { make: sceneHero, base: [180, 100] }, pipeline: { make: scenePipeline, base: [120, 70] }, git: { make: sceneGit, base: [70, 48] }, timeline: { make: sceneTimeline, base: [120, 72] }, skills: { make: sceneSkills, base: [120, 70] }, contact: { make: sceneContact, base: [125, 64] } };

  /* ================= instances ================= */
  function makeInstance(key, n) {
    var sc = SCENES[key].make(n), N = sc.n, r = rng(31), sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), del = new Float32Array(N), i;
    for (i = 0; i < N; i++) { var th = r() * 6.2832, ph = Math.acos(2 * r() - 1), rad = 8 + r() * 6; sx[i] = Math.sin(ph) * Math.cos(th) * rad * 1.3; sy[i] = Math.cos(ph) * rad * 0.7; sz[i] = Math.sin(ph) * Math.sin(th) * rad; del[i] = r() * 0.55; }
    return { key: key, sc: sc, n: N, sx: sx, sy: sy, sz: sz, del: del, sm: -1 };
  }
  function budget() { return (W < 720 ? 160 : 300) * [1, 0.7, 0.5][level]; }
  function used() { var u = 0; for (var i = 0; i < defs.length; i++) if (defs[i].inst) u += defs[i].inst.n; return u; }
  function tryCreate(d) {
    var base = SCENES[d.key].base[W < 720 ? 1 : 0] * [1, 0.7, 0.5][level], n = Math.min(Math.round(base), budget() - used());
    if (n < 24) return;
    d.inst = makeInstance(d.key, n);
  }

  /* ================= drawing ================= */
  var o = { x: 0, y: 0, z: 0, s: 1, k: 0 }, tmpV = [0, 0, 0];
  function drawInstance(c, inst, bx, by, bw, bh, P, L, t, yaw, pit, ox, oy, vw, vh) {
    var N = inst.n, sc = inst.sc, cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit), i, a, b;
    function rot(x, y, z, out) { var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw; out[0] = x1; out[1] = y * cp - z1 * sp; out[2] = y * sp + z1 * cp; }
    var ax = [0, 0, 0], ay = [0, 0, 0], az = [0, 0, 0], axes = [ax, ay, az], v = tmpV;
    rot(1, 0, 0, ax); rot(0, 1, 0, ay); rot(0, 0, 1, az);
    var scale = sc.scale(bw, bh, P), cx = bx + bw / 2 + ox, cy = by + bh / 2 + oy, aI = sstep(0, 0.3, L) * OP;
    var zx0 = bx - bw * 0.12, zx1 = bx + bw * 1.12, zy0 = by - bh * 0.12, zy1 = by + bh * 1.12;
    function px(x, y, z) { var k = FOCAL / (FOCAL + z); return [cx + x * k * scale, cy - y * k * scale]; }
    function inZone(x, y) { return x > zx0 && x < zx1 && y > zy0 && y < zy1 ? 0 : 1; }
    /* lines */
    var lp = [[new Path2D(), new Path2D()], [new Path2D(), new Path2D()], [new Path2D(), new Path2D()], [new Path2D(), new Path2D()]];
    function emit(x1, y1, z1, x2, y2, z2, al) {
      if (al <= 0.02) return;
      rot(x1, y1, z1, v); var p1 = px(v[0], v[1], v[2]); rot(x2, y2, z2, v); var p2 = px(v[0], v[1], v[2]);
      var q = al > 0.8 ? 3 : al > 0.5 ? 2 : al > 0.25 ? 1 : 0, P2 = lp[q][inZone((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)];
      P2.moveTo(p1[0], p1[1]); P2.lineTo(p2[0], p2[1]);
    }
    /* cubes: positions */
    var paths = []; for (i = 0; i < 12; i++) paths[i] = new Path2D();
    var CXs = inst.cx || (inst.cx = new Float32Array(N * 3));
    var zr = 9;
    for (i = 0; i < N; i++) {
      sc.eval(i, P, t, o);
      var li = clamp((L - inst.del[i] * 0.55) / 0.45, 0, 1), e = ease(li);
      var X = inst.sx[i] + (o.x - inst.sx[i]) * e, Y = inst.sy[i] + (o.y - inst.sy[i]) * e, Z = inst.sz[i] + (o.z - inst.sz[i]) * e, Sz = o.s * (0.7 + 0.3 * e);
      CXs[i * 3] = X; CXs[i * 3 + 1] = Y; CXs[i * 3 + 2] = Z;
      rot(X, Y, Z, v);
      var bk = v[2] < -zr / 3 ? 0 : v[2] > zr / 3 ? 2 : 1, pc = px(v[0], v[1], v[2]), zone = inZone(pc[0], pc[1]), P3 = paths[zone * 6 + o.k * 3 + bk], h = Sz / 2;
      for (a = 0; a < 3; a++) {
        var A = axes[a], B = axes[(a + 1) % 3], C = axes[(a + 2) % 3], s = A[2] > 0 ? -1 : 1;
        var bx2 = v[0] + s * A[0] * h, by2 = v[1] + s * A[1] * h, bz2 = v[2] + s * A[2] * h, sg = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
        for (b = 0; b < 4; b++) {
          var u1 = sg[b][0] * h, u2 = sg[b][1] * h, p = px(bx2 + B[0] * u1 + C[0] * u2, by2 + B[1] * u1 + C[1] * u2, bz2 + B[2] * u1 + C[2] * u2);
          if (b === 0) P3.moveTo(p[0], p[1]); else P3.lineTo(p[0], p[1]);
        }
        P3.closePath();
      }
    }
    /* scene lines */
    if (sc.lines) sc.lines(inst, P, t, emit);
    if (sc.edges) {
      for (i = 0; i < sc.edges.length; i++) {
        var ed = sc.edges[i], ra = Math.min(sc.reveal[ed[0]], sc.reveal[ed[1]]);
        if (ra > 0.55) emit(CXs[ed[0] * 3], CXs[ed[0] * 3 + 1], CXs[ed[0] * 3 + 2], CXs[ed[1] * 3], CXs[ed[1] * 3 + 1], CXs[ed[1] * 3 + 2], 0.45 * ra);
      }
    }
    c.lineWidth = 1; c.lineCap = "butt";
    for (a = 0; a < 4; a++) {
      var base = 0.2 * [0.25, 0.5, 0.75, 1][a] * aI * 0.9;
      c.strokeStyle = rgba(col.mut, base); c.stroke(lp[a][0]);
      c.strokeStyle = rgba(col.mut, base * ZONE); c.stroke(lp[a][1]);
    }
    /* cubes: batched fills + edges */
    var mult = [1, 0.74, 0.5]; c.lineJoin = "round";
    for (var zn = 0; zn < 2; zn++) for (var kd = 0; kd < 2; kd++) for (b = 0; b < 3; b++) {
      var cc = kd === 0 ? col.acc : col.mut, m = mult[b] * aI * (zn ? ZONE : 1);
      c.fillStyle = rgba(cc, (kd === 0 ? 0.11 : 0.07) * m); c.strokeStyle = rgba(cc, (kd === 0 ? 0.6 : 0.4) * m);
      c.fill(paths[zn * 6 + kd * 3 + b]); c.stroke(paths[zn * 6 + kd * 3 + b]);
    }
    /* labels */
    var labs = sc.dyn ? sc.dyn(P) : sc.labels;
    if (labs) {
      var la = sc.labelA ? sc.labelA(P) : 1;
      c.font = "500 10px 'IBM Plex Mono', ui-monospace, monospace"; c.textAlign = "center"; c.fillStyle = rgba(col.mut, 0.75 * aI / OP * 0.7 * la);
      for (i = 0; i < labs.length; i++) { rot(labs[i][0], sc.labelY + (sc.labelRise ? sc.labelRise(labs[i][0]) : 0), 0, v); var pl = px(v[0], v[1], v[2]); if (inZone(pl[0], pl[1]) === 0) c.fillText(isEs() ? labs[i][2] : labs[i][1], pl[0], pl[1]); }
    }
  }

  /* ================= animated mode: one canvas, one loop ================= */
  function resize() {
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (level >= 2 ? 0.75 : 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  function destroyAll() { for (var i = 0; i < defs.length; i++) defs[i].inst = null; }
  function frame(now) {
    if (!running) return;
    var raw = (now - last) / 1000; last = now;
    if (raw > 0.25 || raw <= 0) { skip = 2; requestAnimationFrame(frame); return; }
    var dt = Math.min(raw, 0.05), c0 = performance.now();
    if (skip > 0) skip--; else { accT += raw; accN++; }
    if (accT >= 2) {
      if (accT / accN * 1000 > 24 && level < 2) { level++; accT = 0; accN = 0; destroyAll(); resize(); }
      else { accT = 0; accN = 0; }
    }
    clock += dt;
    mx += (tmx - mx) * Math.min(1, dt * 3); my += (tmy - my) * Math.min(1, dt * 3);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var vh = H, anyVis = false, total = 0, i;
    for (i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (!d.vis) { if (d.inst) d.inst = null; continue; }
      anyVis = true;
      if (!d.inst) tryCreate(d);
      var inst = d.inst; if (!inst) continue;
      var sr = (d.wide ? d.sec : d.el).getBoundingClientRect(), br = d.box.getBoundingClientRect();
      var s = (vh - sr.top) / (vh + sr.height);
      inst.sm = inst.sm < 0 ? s : inst.sm + (s - inst.sm) * (1 - Math.exp(-dt * 7));
      var sm = inst.sm, L, P;
      if (d.key === "hero") { L = 1 - sstep(0.55, 0.95, sm); P = 0; inst.sc.tick(dt, clock); }
      else { var sEnd = (vh - (sr.top + window.scrollY - (document.documentElement.scrollHeight - vh))) / (vh + sr.height); L = sstep(0.04, 0.3, sm) * (1 - sstep(0.8, 1, sm)); P = clamp((sm - 0.1) / Math.max(0.2, Math.min(0.62, sEnd - 0.12)), 0, 1); }
      total += inst.n;
      if (L <= 0.002 || br.bottom < -40 || br.top > vh + 40 || br.width < 40) continue;
      var yaw = 0.22 + (sm - 0.5) * 0.5 + Math.sin(clock * 0.16) * 0.18 + mx * 0.1, pit = 0.3 + my * 0.05;
      drawInstance(ctx, inst, br.left, br.top, br.width, br.height, P, L, clock, yaw, pit, mx * 6, my * 4, W, H);
    }
    var cost = performance.now() - c0; stat.ms = stat.ms * 0.9 + cost * 0.1; if (cost > stat.maxMs) stat.maxMs = cost; stat.level = level;
    stat.active = total; if (total > stat.max) stat.max = total; stat.budget = budget();
    if (!anyVis) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function start() { if (running || staticMode || document.hidden) return; running = true; last = performance.now(); skip = 2; accT = 0; accN = 0; requestAnimationFrame(frame); }
  function stop() { running = false; }

  /* ================= reduced motion: one static, assembled frame per section ================= */
  function renderStaticAll() {
    canvas.style.display = "none";
    defs.forEach(function (d) {
      var br = d.box.getBoundingClientRect(); if (br.width < 40 || br.height < 40) return;
      if (!d.sc) { d.sc = document.createElement("canvas"); d.sc.setAttribute("aria-hidden", "true"); d.sc.className = "vis-static"; d.box.appendChild(d.sc); }
      var r = Math.min(window.devicePixelRatio || 1, 1.5), c = d.sc.getContext("2d");
      d.sc.width = Math.round(br.width * r); d.sc.height = Math.round(br.height * r);
      var base = SCENES[d.key].base[window.innerWidth < 720 ? 1 : 0], inst = makeInstance(d.key, base);
      if (inst.sc.settle) inst.sc.settle();
      c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, br.width, br.height);
      drawInstance(c, inst, 0, 0, br.width, br.height, 1, 1, 0, 0.3, 0.3, 0, 0, br.width, br.height);
    });
  }

  /* ================= setup ================= */
  readColors();
  var els = document.querySelectorAll(".vis[data-scene]");
  for (var q = 0; q < els.length; q++) {
    var box = els[q].querySelector(".vis-box"); if (!box) continue;
    defs.push({ el: els[q], box: box, sec: els[q].parentElement, key: els[q].getAttribute("data-scene"), vis: false, visSec: false, visEl: false, wide: false, inst: null, sc: null });
  }
  if (!defs.length) return;
  function syncVis() { defs.forEach(function (d) { d.wide = getComputedStyle(d.el).position === "absolute"; d.vis = d.wide ? d.visSec : d.visEl; }); if (!staticMode && defs.some(function (d) { return d.vis; })) start(); }
  function applyMode() {
    staticMode = mqReduce.matches;
    if (staticMode) { stop(); destroyAll(); renderStaticAll(); }
    else { canvas.style.display = ""; defs.forEach(function (d) { if (d.sc) { d.sc.parentNode.removeChild(d.sc); d.sc = null; } }); resize(); if (defs.some(function (d) { return d.vis; })) start(); }
  }
  if ("ResizeObserver" in window) { new ResizeObserver(function () { if (!staticMode) resize(); else renderStaticAll(); }).observe(staticMode ? document.body : canvas); }
  window.addEventListener("resize", function () { if (staticMode) renderStaticAll(); else { resize(); syncVis(); } }, { passive: true });
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
  if (mqDark.addEventListener) mqDark.addEventListener("change", onTheme);
  if (mqReduce.addEventListener) mqReduce.addEventListener("change", applyMode);
  document.addEventListener("click", function (ev) { if (staticMode && ev.target.closest && ev.target.closest(".lang button")) setTimeout(renderStaticAll, 50); });
  window.__cubesStat = function () { return JSON.stringify(stat); };
  resize();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (staticMode) renderStaticAll(); });
  if (staticMode) renderStaticAll();
})();
