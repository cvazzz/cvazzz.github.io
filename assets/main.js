(function () {
  var root = document.documentElement;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var copy = {
    en: { t: "Sergio Atanacio · AI & Data Engineer", d: "Junior AI & Data Engineer in Lima, Peru, open to remote roles worldwide. Case studies of production systems: an LLM agent with tool calling and evals, verified data, a role-based platform, a full-stack monitor and a coding-agent workflow.", open: "Open", close: "Close", copied: "Copied" },
    es: { t: "Sergio Atanacio · Ingeniero de IA y datos", d: "Ingeniero junior de IA y datos en Lima, Perú, abierto a roles remotos internacionales. Casos de estudio de sistemas en producción: agente LLM con tool calling y evals, datos verificados, plataforma con roles, monitor full-stack y flujo con agentes de código.", open: "Abrir", close: "Cerrar", copied: "Copiado" }
  };
  var main = document.getElementById("main");
  var lang = "en";

  /* ---- language (no reload) ---- */
  function setLang(l, user) {
    lang = l;
    root.setAttribute("data-lang", l); root.lang = l;
    document.querySelectorAll(".lang button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.set === l)); });
    document.title = copy[l].t;
    var m = document.querySelector('meta[name="description"]'); if (m) m.content = copy[l].d;
    var cv = document.getElementById("cv-link"); if (cv) cv.href = cv.dataset[l];
    document.querySelectorAll("[data-case]").forEach(function (c) { labelToggle(c); });
    if (user) {
      try { localStorage.setItem("lang", l); } catch (e) {}
      if (!reduce) { main.classList.remove("swap"); void main.offsetWidth; main.classList.add("swap"); }
    }
  }
  var saved = null; try { saved = localStorage.getItem("lang"); } catch (e) {}
  document.querySelectorAll(".lang button").forEach(function (b) { b.addEventListener("click", function () { setLang(b.dataset.set, true); }); });

  /* ---- theme ---- */
  var mq = matchMedia("(prefers-color-scheme: dark)");
  function eff() { var t = root.getAttribute("data-theme"); return t || (mq.matches ? "dark" : "light"); }
  function syncTheme() { root.setAttribute("data-eff", eff()); }
  var tb = document.getElementById("theme-btn");
  if (tb) tb.addEventListener("click", function () {
    var next = eff() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next); syncTheme();
    try { localStorage.setItem("theme", next); } catch (e) {}
  });
  if (mq.addEventListener) mq.addEventListener("change", syncTheme);
  syncTheme();

  /* ---- case accordion with #anchors ---- */
  var cases = Array.prototype.slice.call(document.querySelectorAll("[data-case]"));
  function labelToggle(c) {
    var open = c.classList.contains("open");
    var a = c.querySelector(".act");
    if (a) { a.querySelector(".en").textContent = open ? copy.en.close : copy.en.open; a.querySelector(".es").textContent = open ? copy.es.close : copy.es.open; }
  }
  function setOpen(c, open) {
    c.classList.toggle("open", open);
    c.querySelector(".case-toggle").setAttribute("aria-expanded", String(open));
    var p = c.querySelector(".case-panel"); if (p) p.inert = !open;
    labelToggle(c);
  }
  cases.forEach(function (c) {
    setOpen(c, false);
    c.querySelector(".case-toggle").addEventListener("click", function () {
      var open = !c.classList.contains("open");
      setOpen(c, open);
      try { history.replaceState(null, "", open ? "#" + c.id : location.pathname + location.search + "#cases"); } catch (e) {}
    });
  });
  function openFromHash(scroll) {
    var id = decodeURIComponent((location.hash || "").slice(1));
    var c = id && document.getElementById(id);
    if (c && c.hasAttribute("data-case")) {
      setOpen(c, true);
      if (scroll) setTimeout(function () { c.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }, 60);
    }
  }
  window.addEventListener("hashchange", function () { openFromHash(true); });
  setLang(saved === "es" || saved === "en" ? saved : ((navigator.language || "").slice(0, 2) === "es" ? "es" : "en"), false);
  if (location.hash && document.getElementById(location.hash.slice(1)) && document.getElementById(location.hash.slice(1)).hasAttribute("data-case")) openFromHash(true);
  else if (cases[0]) setOpen(cases[0], true);

  /* ---- copy e-mail ---- */
  var cb = document.getElementById("copy-btn"), msg = document.getElementById("copy-msg");
  if (cb) cb.addEventListener("click", function () {
    var addr = cb.dataset.addr;
    function done() { msg.textContent = copy[lang].copied; setTimeout(function () { msg.textContent = ""; }, 2200); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(addr).then(done, function () {});
    else { var t = document.createElement("textarea"); t.value = addr; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(t); }
  });

  /* ---- active nav + reveals (elements are visible at rest; reveal only adds a short rise) ---- */
  if (!("IntersectionObserver" in window)) return;
  var links = {};
  document.querySelectorAll(".nav a").forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
  var spy = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      Object.keys(links).forEach(function (k) { if (k === e.target.id) links[k].setAttribute("aria-current", "location"); else links[k].removeAttribute("aria-current"); });
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  document.querySelectorAll("main section[id]").forEach(function (s) { if (links[s.id]) spy.observe(s); });
  if (reduce) return;
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -10% 0px" });
  document.querySelectorAll(".reveal").forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) return; /* already on screen: leave at rest */
    io.observe(el);
  });
})();
