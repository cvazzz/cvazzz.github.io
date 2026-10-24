(function () {
  var root = document.documentElement;
  var copy = {
    en: { t: "Sergio Atanacio · AI, automation and data engineer", d: "Junior engineer building LLM agents, data pipelines and automation. Based in Lima, Peru. Open to remote roles worldwide." },
    es: { t: "Sergio Atanacio · Ingeniero de IA, automatización y datos", d: "Ingeniero junior que construye agentes LLM, pipelines de datos y automatización. Lima, Perú. Abierto a roles remotos internacionales." }
  };
  function setLang(l, save) {
    root.setAttribute("data-lang", l); root.lang = l;
    document.querySelectorAll(".lang button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.set === l)); });
    document.title = copy[l].t;
    var m = document.querySelector('meta[name="description"]'); if (m) m.content = copy[l].d;
    var cv = document.getElementById("cv-link"); if (cv) cv.href = cv.dataset[l];
    if (save) { try { localStorage.setItem("lang", l); } catch (e) {} }
  }
  var saved = null; try { saved = localStorage.getItem("lang"); } catch (e) {}
  setLang(saved || ((navigator.language || "").slice(0, 2) === "es" ? "es" : "en"), false);
  document.querySelectorAll(".lang button").forEach(function (b) { b.addEventListener("click", function () { setLang(b.dataset.set, true); }); });

  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("js");
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".reveal").forEach(function (el, i) {
    if (el.closest(".intro")) el.style.transitionDelay = i * 80 + "ms";
    io.observe(el);
  });
})();
