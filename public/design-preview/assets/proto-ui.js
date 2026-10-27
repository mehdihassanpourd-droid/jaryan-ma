/* Tiny shared behaviours for the prototypes (no libraries, no network). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const concept = document.documentElement.dataset.concept || "a";
  const fa = (n) => String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

  // Controls that are not part of this design preview say so, politely (a live region, not a dead button).
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  document.body.appendChild(toast);
  let tt = 0;
  $$("[data-demo]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); toast.textContent = b.dataset.demo; toast.classList.add("is-on"); clearTimeout(tt); tt = setTimeout(() => toast.classList.remove("is-on"), 2800); }));

  // <dialog> openers: [data-open="id"] / [data-close]
  $$("[data-open]").forEach((b) => b.addEventListener("click", () => { const d = document.getElementById(b.dataset.open); if (d && d.showModal) d.showModal(); }));
  $$("dialog").forEach((d) => {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => d.close()));
    $$("a", d).forEach((a) => a.addEventListener("click", () => d.close()));
  });

  // Product page: fill the page from ?c=tote|mandala|pottery&n=1..3 (the default is the mandala).
  const q = new URLSearchParams(location.search);
  const catKey = (window.PROTO && window.PROTO.cats[q.get("c")]) ? q.get("c") : "mandala";
  const n0 = Math.min(3, Math.max(1, parseInt(q.get("n") || "1", 10) || 1));
  const cat = window.PROTO && window.PROTO.cats[catKey];
  if (cat && document.body.dataset.page === "product") {
    document.body.dataset.cat = catKey;
    const title = `${cat.item} — نمونهٔ ${fa(n0)}`;
    document.title = `${title} | جریان ما (پیش‌نمایش طراحی)`;
    const bind = { title, category: cat.name, technique: cat.technique, optionLabel: cat.optionLabel, lead: cat.lead };
    $$("[data-bind]").forEach((el) => { if (bind[el.dataset.bind] !== undefined) el.textContent = bind[el.dataset.bind]; });
    $$("[data-img]").forEach((img) => { const k = ((n0 - 1 + parseInt(img.dataset.img, 10)) % 3) + 1; img.src = `/design-preview/assets/img/${concept}-${catKey}-${k}.svg`; });
    const opts = $("[data-options]");
    if (opts) opts.innerHTML = cat.options.map((o, i) => `<button type="button" class="opt" role="radio" aria-checked="${i === 0}" data-i="${i}">${o}</button>`).join("");
    if (opts) opts.addEventListener("click", (e) => { const b = e.target.closest(".opt"); if (!b) return; $$(".opt", opts).forEach((x) => x.setAttribute("aria-checked", String(x === b))); });
    // category switcher links keep the same concept
    $$("[data-cat-link]").forEach((a) => { a.classList.toggle("is-current", a.dataset.catLink === catKey); if (a.dataset.catLink === catKey) a.setAttribute("aria-current", "true"); });
  }

  // Gallery: scroll-snap track + counter/dots/thumbs
  const track = $("[data-gallery]");
  if (track) {
    const slides = $$("[data-slide]", track);
    const marks = $$("[data-mark]");
    const counter = $("[data-counter]");
    const set = (i) => { marks.forEach((m, k) => m.classList.toggle("is-on", k === i)); if (counter) counter.textContent = `${fa(i + 1)} از ${fa(slides.length)}`; };
    let raf = 0;
    track.addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const w = track.clientWidth; const i = Math.round(Math.abs(track.scrollLeft) / w); set(Math.min(slides.length - 1, i)); }); }, { passive: true });
    marks.forEach((m, k) => m.addEventListener("click", () => slides[k].scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", inline: "start", block: "nearest" })));
    set(0);
  }

  // Sticky buy bar: shown while the main call-to-action is out of view
  const cta = $("[data-cta]");
  const bar = $("[data-sticky]");
  if (cta && bar && "IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => bar.classList.toggle("is-visible", !e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 }).observe(cta);
  }

  // Segmented tabs (concept B)
  $$("[role=tablist]").forEach((list) => {
    const tabs = $$("[role=tab]", list);
    const show = (t) => tabs.forEach((x) => { const on = x === t; x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute("aria-controls")).hidden = !on; });
    tabs.forEach((t) => t.addEventListener("click", () => show(t)));
    list.addEventListener("keydown", (e) => { const i = tabs.indexOf(document.activeElement); if (i < 0) return; const step = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0; if (!step) return; const t = tabs[(i + step + tabs.length) % tabs.length]; t.focus(); show(t); });
  });
})();
