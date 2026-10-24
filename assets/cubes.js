/* Hero animation: small cubes assemble into two formations (a data tensor with bar columns,
   and a neural network) and slowly morph between them. Canvas 2D, simple 3D projection, no libraries.
   Colors come from the site's CSS tokens, so it follows the light and dark themes. */
(function () {
  "use strict";
  var canvas = document.getElementById("cubes");
  if (!canvas || !canvas.getContext || !window.Path2D) return;
  var ctx = canvas.getContext("2d");
  var root = document.documentElement;
  var host = canvas.parentElement;
  var mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  var mqDark = matchMedia("(prefers-color-scheme: dark)");
  var finePointer = matchMedia("(pointer: fine)").matches;

  var T_MOVE = 3.6, T_HOLD = 6.5, SPREAD = 0.4, FOCAL = 50;
  var textR = 0, textB = 0, zoneMul = 0.05, W = 0, H = 0, dpr = 1, level = 0, N = 0, scaleF = [10, 10], scale = 10, cx = 0, cy = 0, gA = 1;
  var col = { acc: [27, 91, 114], mut: [70, 86, 95] };
  var form = [], X, Y, Z, S, FX, FY, FZ, FS, ARC, DLY, SC0;
  var f = 0, mode = "move", ts = 0, clock = 0;
  var mx = 0, my = 0, tmx = 0, tmy = 0;
  var mt = 0, running = false, visible = true, last = 0, accT = 0, accN = 0, skip = 0, staticMode = mqReduce.matches;

  /* ---------- helpers ---------- */
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) {
    h = (h || "").trim();
    if (h.charAt(0) !== "#") return null;
    if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  function readColors() {
    var cs = getComputedStyle(root);
    col.acc = hex(cs.getPropertyValue("--accent")) || col.acc;
    col.mut = hex(cs.getPropertyValue("--muted")) || col.mut;
  }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")"; }
  function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  /* ---------- formations (world units: 1 = one cube) ---------- */
  function shuffle(n, seed) { var r = rng(seed), a = [], i, j, t; for (i = 0; i < n; i++) a.push(i); for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function genData(n) {
    var sp = 1.4, pts = [], lines = [], k = Math.max(3, Math.round(Math.cbrt(n * 0.34))), i, a, b, c;
    var cols = 6, pitch = 2 * sp + 0.8, barsW = cols * pitch - 0.8, tensW = k * sp;
    var total = tensW + 2.2 + barsW, left = -total / 2;
    var rest = n - k * k * k, layers = Math.floor(rest / 4);
    var w = [0.5, 0.72, 0.6, 1, 0.82, 1.3], sw = 0; for (i = 0; i < cols; i++) sw += w[i];
    var h = []; var sum = 0;
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

  /* ---------- build ---------- */
  function targetN() {
    var base = W < 640 ? 110 : W < 1024 ? 190 : 260;
    return Math.round(base * [1, 0.7, 0.5][level]);
  }
  function layout() {
    var fw = W - textR - 24, halfW, halfH;
    if (W >= 1024 && fw >= 300) { cx = textR + 24 + fw / 2; cy = H * 0.5; halfW = fw / 2 * 0.95; halfH = H * 0.34; zoneMul = 0.05; gA = 1; }
    else if (textB > 0 && H - textB >= 150) { var fh = H - textB - 10; cx = W / 2; cy = textB + 10 + fh / 2; halfW = W * 0.46; halfH = fh * 0.42; zoneMul = 0.05; gA = 0.9; }
    else { cx = W * 0.72; cy = H * 0.5; halfW = Math.min(cx, W - cx) * 0.9; halfH = H * 0.3; zoneMul = 0.08; gA = 0.7; }
    var fit = [], q, i;
    for (q = 0; q < 2; q++) {
      var ex = 1, ey = 1;
      for (i = 0; i < N; i++) { ex = Math.max(ex, Math.abs(form[q].tx[i]) + 1); ey = Math.max(ey, Math.abs(form[q].ty[i]) + 1); }
      fit[q] = Math.max(4, Math.min(halfW / (ex * 1.08), halfH / (ey * 1.1)));
    }
    scaleF = [fit[0], Math.min(fit[1], fit[0] * 1.7)];
  }
  function build() {
    N = targetN();
    var raw = [genData(N), genNet(N)], q, i, r = rng(7);
    form = [];
    for (q = 0; q < 2; q++) {
      var perm = shuffle(N, 11 + q * 5), F = { tx: new Float32Array(N), ty: new Float32Array(N), tz: new Float32Array(N), ts: new Float32Array(N), trav: [], lines: raw[q].lines };
      for (i = 0; i < N; i++) {
        var pi = perm[i], p = raw[q].pts[pi];
        F.tx[i] = p[0]; F.ty[i] = p[1]; F.tz[i] = p[2]; F.ts[i] = p[3];
        F.trav[i] = raw[q].trav && raw[q].trav[pi] ? raw[q].trav[pi] : null;
      }
      form.push(F);
    }
    X = new Float32Array(N); Y = new Float32Array(N); Z = new Float32Array(N); S = new Float32Array(N);
    FX = new Float32Array(N); FY = new Float32Array(N); FZ = new Float32Array(N); FS = new Float32Array(N);
    ARC = new Float32Array(N * 3); DLY = new Float32Array(N);
    for (i = 0; i < N; i++) {
      var th = r() * 6.2832, ph2 = Math.acos(2 * r() - 1), rad = 9 + r() * 7;
      X[i] = Math.sin(ph2) * Math.cos(th) * rad * 1.5; Y[i] = Math.cos(ph2) * rad * 0.8; Z[i] = Math.sin(ph2) * Math.sin(th) * rad; S[i] = 0.6 + r() * 0.3;
      ARC[i * 3] = (r() - 0.5) * 5; ARC[i * 3 + 1] = (r() - 0.5) * 5; ARC[i * 3 + 2] = (r() - 0.5) * 5;
      DLY[i] = r() * SPREAD;
    }
    layout();
    f = 0; mode = "move"; ts = 0; startMove();
  }
  function startMove() { var i; for (i = 0; i < N; i++) { FX[i] = X[i]; FY[i] = Y[i]; FZ[i] = Z[i]; FS[i] = S[i]; } }

  /* ---------- per-frame ---------- */
  var tgx = 0, tgy = 0, tgz = 0;
  function target(F, i, t) {
    var tr = F.trav[i];
    if (tr) { var ph = (tr[1] + t * 0.07) % 1, e = tr[0]; tgx = e[0] + (e[3] - e[0]) * ph; tgy = e[1] + (e[4] - e[1]) * ph; tgz = e[2] + (e[5] - e[2]) * ph; }
    else { tgx = F.tx[i]; tgy = F.ty[i]; tgz = F.tz[i]; }
  }
  var w = [1, 0];
  function update(dt, settled) {
    var F = form[f], i, avg = 0;
    if (settled) { mode = "hold"; ts = 0; }
    else { ts += dt; }
    if (mode === "move") {
      var dur = T_MOVE * (1 - SPREAD);
      for (i = 0; i < N; i++) {
        var p = Math.min(1, Math.max(0, (ts - DLY[i] * T_MOVE) / dur)), e = ease(p), a = Math.sin(Math.PI * p);
        target(F, i, clock);
        X[i] = FX[i] + (tgx - FX[i]) * e + ARC[i * 3] * a;
        Y[i] = FY[i] + (tgy - FY[i]) * e + ARC[i * 3 + 1] * a;
        Z[i] = FZ[i] + (tgz - FZ[i]) * e + ARC[i * 3 + 2] * a;
        S[i] = FS[i] + (F.ts[i] - FS[i]) * e;
        avg += e;
      }
      avg /= N; w[f] = avg; w[1 - f] = 1 - avg;
      if (ts >= T_MOVE) { mode = "hold"; ts = 0; }
    } else {
      for (i = 0; i < N; i++) { target(F, i, clock); X[i] = tgx; Y[i] = tgy; Z[i] = tgz; S[i] = F.ts[i]; }
      w[f] = 1; w[1 - f] = 0;
      if (!settled && ts >= T_HOLD) { f = 1 - f; mode = "move"; ts = 0; startMove(); }
    }
  }

  var paths = [], tb = [], OP = 0.7;
  function measureText() {
    var hr = host.getBoundingClientRect(), kids = host.children, i;
    tb = []; textR = 0; textB = 0;
    for (i = 0; i < kids.length; i++) {
      if (kids[i] === canvas) continue;
      var rc = kids[i].getBoundingClientRect(); if (!rc.width) continue;
      var l = rc.left - hr.left, t = rc.top - hr.top, r = rc.right - hr.left, b = rc.bottom - hr.top;
      tb.push([l - 14, t - 10, r + 14, b + 10]); textR = Math.max(textR, r); textB = Math.max(textB, b);
    }
  }
  function inZone(x, y) { for (var k = 0; k < tb.length; k++) { var z = tb[k]; if (x > z[0] && x < z[2] && y > z[1] && y < z[3]) return 1; } return 0; }
  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var yaw = Math.sin(t * 0.16) * 0.42 + mx * 0.1 + (staticMode ? 0.22 : 0), pit = 0.3 + my * 0.05;
    var cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
    function rot(x, y, z, o) { var x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw; o[0] = x1; o[1] = y * cp - z1 * sp; o[2] = y * sp + z1 * cp; }
    scale = scaleF[0] * w[0] + scaleF[1] * w[1];
    var v = [0, 0, 0], ax = [0, 0, 0], ay = [0, 0, 0], az = [0, 0, 0], ox = mx * 6, oy = my * 4;
    rot(1, 0, 0, ax); rot(0, 1, 0, ay); rot(0, 0, 1, az);
    var axes = [ax, ay, az], i, q, b, kd;
    function px(x, y, z) { var k = FOCAL / (FOCAL + z); return [cx + ox + x * k * scale, cy + oy - y * k * scale]; }

    /* connections / axes, faint, behind the cubes; almost nothing over the text */
    ctx.lineWidth = 1; ctx.lineCap = "butt";
    for (q = 0; q < 2; q++) {
      if (w[q] < 0.05) continue;
      var Ls = form[q].lines, al = (q === 1 ? 0.17 : 0.2) * w[q] * w[q] * gA * OP * 0.8, pClear = new Path2D(), pZone = new Path2D();
      for (i = 0; i < Ls.length; i++) {
        var l = Ls[i], p1, p2; rot(l[0], l[1], l[2], v); p1 = px(v[0], v[1], v[2]); rot(l[3], l[4], l[5], v); p2 = px(v[0], v[1], v[2]);
        var tp = inZone((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2) ? pZone : pClear;
        tp.moveTo(p1[0], p1[1]); tp.lineTo(p2[0], p2[1]);
      }
      ctx.strokeStyle = rgba(col.mut, al); ctx.stroke(pClear);
      ctx.strokeStyle = rgba(col.mut, al * zoneMul); ctx.stroke(pZone);
    }

    /* cubes: 3 visible faces each, batched in 2 colors x 3 depth buckets */
    for (i = 0; i < 12; i++) paths[i] = new Path2D();
    var zr = 9;
    for (i = 0; i < N; i++) {
      rot(X[i], Y[i], Z[i], v);
      var bk = v[2] < -zr / 3 ? 0 : v[2] > zr / 3 ? 2 : 1, kk = i % 3 === 0 ? 0 : 1, pc = px(v[0], v[1], v[2]), zone = inZone(pc[0], pc[1]), key = zone * 6 + kk * 3 + bk, P = paths[key], h = S[i] / 2;
      for (var a = 0; a < 3; a++) {
        var A = axes[a], B = axes[(a + 1) % 3], C = axes[(a + 2) % 3], s = A[2] > 0 ? -1 : 1;
        var bx = v[0] + s * A[0] * h, by = v[1] + s * A[1] * h, bz = v[2] + s * A[2] * h;
        var sg = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
        for (b = 0; b < 4; b++) {
          var u1 = sg[b][0] * h, u2 = sg[b][1] * h;
          var p = px(bx + B[0] * u1 + C[0] * u2, by + B[1] * u1 + C[1] * u2, bz + B[2] * u1 + C[2] * u2);
          if (b === 0) P.moveTo(p[0], p[1]); else P.lineTo(p[0], p[1]);
        }
        P.closePath();
      }
    }
    var mult = [1, 0.74, 0.5];
    ctx.lineJoin = "round";
    for (var zn = 0; zn < 2; zn++) for (kd = 0; kd < 2; kd++) for (b = 0; b < 3; b++) {
      var c = kd === 0 ? col.acc : col.mut, m = mult[b] * gA * OP * (zn ? zoneMul : 1);
      ctx.fillStyle = rgba(c, (kd === 0 ? 0.11 : 0.07) * m);
      ctx.strokeStyle = rgba(c, (kd === 0 ? 0.6 : 0.4) * m);
      ctx.fill(paths[zn * 6 + kd * 3 + b]); ctx.stroke(paths[zn * 6 + kd * 3 + b]);
    }
  }

  /* ---------- sizing, loop, lifecycle ---------- */
  function resize() {
    var nw = host.clientWidth, nh = host.clientHeight;
    if (!nw || !nh) return;
    var prevN = N;
    W = nw; H = nh; measureText();
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (level >= 2 ? 0.75 : 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!N || targetN() !== prevN) build(); else layout();
    if (staticMode) renderStatic();
  }
  function renderStatic() {
    var i; for (i = 0; i < N; i++) { f = 0; target(form[0], i, 0); X[i] = tgx; Y[i] = tgy; Z[i] = tgz; S[i] = form[0].ts[i]; }
    w[0] = 1; w[1] = 0; clock = 0; draw(0);
  }
  function loop(now) {
    if (!running) return;
    var raw = (now - last) / 1000; last = now;
    if (raw > 0.25 || raw <= 0) { skip = 2; requestAnimationFrame(loop); return; }
    var dt = Math.min(raw, 0.05);
    if (skip > 0) skip--; else { accT += raw; accN++; }
    if (accT >= 2) {
      if (accT / accN * 1000 > 24 && level < 2) { level++; accT = 0; accN = 0; resize(); build(); requestAnimationFrame(loop); return; }
      accT = 0; accN = 0;
    }
    clock += dt; mt += dt; if (mt > 1) { mt = 0; measureText(); layout(); }
    mx += (tmx - mx) * Math.min(1, dt * 3); my += (tmy - my) * Math.min(1, dt * 3);
    update(dt, false);
    draw(clock);
    requestAnimationFrame(loop);
  }
  function start() { if (running || staticMode || !visible || document.hidden || !N) return; running = true; last = performance.now(); skip = 2; accT = 0; accN = 0; requestAnimationFrame(loop); }
  function stop() { running = false; }

  function applyMotionPref() {
    staticMode = mqReduce.matches;
    if (staticMode) { stop(); if (N) renderStatic(); } else { if (N) { build(); } start(); }
  }

  readColors();
  if ("ResizeObserver" in window) new ResizeObserver(function () { resize(); }).observe(host); else { resize(); window.addEventListener("resize", resize); }
  resize();
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); else stop(); }, { threshold: 0 }).observe(host);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });
  if (finePointer) window.addEventListener("pointermove", function (e) { tmx = (e.clientX / innerWidth - 0.5) * 2; tmy = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { measureText(); layout(); if (staticMode && N) renderStatic(); });
  function onTheme() { readColors(); if (staticMode && N) renderStatic(); }
  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-eff"] });
  if (mqDark.addEventListener) mqDark.addEventListener("change", onTheme);
  if (mqReduce.addEventListener) mqReduce.addEventListener("change", applyMotionPref);
  if (staticMode) renderStatic(); else start();
})();
