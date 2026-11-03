/* Jaryan Ma connectivity probe: browser test page logic.
 * Plain ES2017, no libraries, no external requests. Everything it calls is on the three probe host names of THIS deployment.
 * It sends nothing about the person: no IP address, no user agent, no cookies from other sites. */
(function () {
  "use strict";

  var API = location.protocol + "//" + location.host.replace(/^probe\./, "probe-api.");
  var TIMEOUT_MS = 20000;
  var STORE = "jm.probe.state";

  function $(id) { return document.getElementById(id); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function hex(n) {
    var a = new Uint8Array(n);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  // ---- environment (no identifiers) -----------------------------------------------------------------------------------------
  function browserClass() {
    var ua = navigator.userAgent || "";
    if (/Instagram/i.test(ua)) return "instagram-inapp";
    if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "facebook-inapp";
    if (/Telegram/i.test(ua)) return "telegram-inapp";
    if (/; wv\)/.test(ua)) return "android-webview";
    if (/CriOS|Chrome\//.test(ua)) return "chrome";
    if (/Safari\//.test(ua)) return "safari";
    return "other";
  }
  var BROWSER_LABEL = { "instagram-inapp": "مرورگر داخلی اینستاگرام", "facebook-inapp": "مرورگر داخلی فیسبوک", "telegram-inapp": "مرورگر داخلی تلگرام", "android-webview": "مرورگر داخلی یک برنامه (WebView)", chrome: "Chrome", safari: "Safari", other: "مرورگر دیگر" };

  // ---- request helpers -------------------------------------------------------------------------------------------------------
  function timed(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  /** fetch + JSON with a hard timeout. Throws Error(code): timeout | network | http_NNN | invalid_json */
  function call(url, options) {
    var started = now();
    return timed(fetch(url, options), TIMEOUT_MS).then(function (res) {
      if (!res.ok) { var e = new Error("http_" + res.status); e.status = res.status; throw e; }
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (x) { var e2 = new Error("invalid_json"); e2.status = res.status; throw e2; }
        return { status: res.status, json: json, ms: Math.round(now() - started), bytes: text.length };
      });
    }, function (err) {
      if (err && err.message === "timeout") throw err;
      throw new Error("network");
    });
  }
  function loadImage(src) {
    var started = now();
    return timed(new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight, ms: Math.round(now() - started) }); };
      img.onerror = function () { reject(new Error("network")); };
      img.src = src + "?r=" + hex(4);
    }), TIMEOUT_MS);
  }

  // ---- the steps ------------------------------------------------------------------------------------------------------------
  function bigPayload() {
    var pad = new Array(600 * 1024 + 1).join("x");
    return JSON.stringify({ simulated: true, items: [{ id: "probe-0001", quantity: 1 }], note: pad });
  }
  function byteLength(text) { return (window.TextEncoder ? new TextEncoder().encode(text).length : unescape(encodeURIComponent(text)).length); }

  var STEPS = [
    { id: "ip", group: "info", label: "نوع آدرس شبکهٔ شما (IPv4 یا IPv6)",
      run: function (ctx) { return call("/probe/ip", { cache: "no-store" }).then(function (r) { ctx.family = r.json && r.json.family; return { ms: r.ms, detail: ctx.family }; }); } },
    { id: "image", group: "browse", label: "تصویر محصول (حدود ۳۰۰ کیلوبایت)",
      run: function () { return loadImage("/img/product.png").then(function (r) { if (r.w < 100) throw new Error("invalid_image"); return { ms: r.ms }; }); } },
    { id: "catalog", group: "browse", label: "فهرست محصولات از دامنهٔ فروشگاه (حدود ۱۰۰ کیلوبایت)",
      run: function () { return call("/data/catalog.json", { cache: "no-store" }).then(function (r) { if (!r.json || !r.json.products || r.json.products.length < 10) throw new Error("invalid_json"); return { ms: r.ms }; }); } },
    { id: "apiPing", group: "api", label: "اتصال به API روی دامنهٔ دیگر (CORS)",
      run: function () { return call(API + "/api/ping", { cache: "no-store" }).then(function (r) { if (!r.json || r.json.ok !== true) throw new Error("invalid_json"); return { ms: r.ms }; }); } },
    { id: "apiCatalog", group: "browse", label: "فهرست محصولات از API",
      run: function () { return call(API + "/api/catalog", { cache: "no-store" }).then(function (r) { if (!r.json || !r.json.products) throw new Error("invalid_json"); return { ms: r.ms }; }); } },
    { id: "session", group: "checkout", label: "ورود آزمایشی و کوکی نشست",
      run: function () {
        return call(API + "/api/login", { method: "POST", credentials: "include", cache: "no-store" }).then(function (login) {
          return call(API + "/api/me", { credentials: "include", cache: "no-store" }).then(function (me) {
            if (!me.json || me.json.sid !== login.json.sid) throw new Error("cookie_not_returned");
            return { ms: login.ms + me.ms };
          });
        });
      } },
    { id: "cart", group: "checkout", label: "سبد خرید آزمایشی (ارسال POST)",
      run: function () {
        var body = JSON.stringify({ items: [{ id: "probe-0001", quantity: 2 }] });
        return call(API + "/api/cart", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: body }).then(function (r) {
          if (!r.json || r.json.simulated !== true || r.json.received !== byteLength(body)) throw new Error("invalid_json");
          return { ms: r.ms };
        });
      } },
    { id: "order", group: "checkout", label: "ثبت سفارش آزمایشی (POST حجیم ۶۰۰ کیلوبایت)",
      run: function () {
        var body = bigPayload();
        return call(API + "/api/order", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: body }).then(function (r) {
          if (!r.json || r.json.simulated !== true || r.json.received !== byteLength(body) || String(r.json.orderNumber).indexOf("PROBE-") !== 0) throw new Error("invalid_json");
          return { ms: r.ms, detail: Math.round(byteLength(body) / 1024) + " KB" };
        });
      } },
    { id: "stability", group: "api", label: "پایداری: ۲۰ درخواست پیاپی",
      run: function () {
        var started = now(), failed = 0, i = 0;
        function next() {
          if (i >= 20) { if (failed > 0) throw new Error("failed_" + failed + "_of_20"); return { ms: Math.round(now() - started) }; }
          i += 1;
          return call(API + "/api/ping?i=" + i, { cache: "no-store" }).then(function () {}, function () { failed += 1; }).then(next);
        }
        return Promise.resolve().then(next);
      } }
  ];
  var PAYMENT = { id: "payment", group: "payment", label: "رفت‌وبرگشت پرداخت آزمایشی (تغییر مسیر به «درگاه» و بازگشت)" };

  // ---- state & UI ---------------------------------------------------------------------------------------------------------------
  var state = null; // { runId, startedAt, meta, env, steps: [] }
  var running = false;

  function saveState() { try { sessionStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* storage blocked: payment step will say so */ } }
  function loadState() { try { var t = sessionStorage.getItem(STORE); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function clearState() { try { sessionStorage.removeItem(STORE); } catch (e) { /* ignore */ } }

  function readMeta() {
    function v(id) { return ($(id).value || "").replace(/[^\w؀-ۿ .-]/g, "").slice(0, 40); }
    return { operator: v("operator"), network: v("network"), vpn: v("vpn"), vpnName: v("vpnName"), city: v("city"), tester: v("tester").replace(/[^A-Za-z0-9]/g, "") };
  }

  function renderSteps() {
    var list = $("steps");
    list.textContent = "";
    var all = STEPS.concat([PAYMENT]);
    all.forEach(function (s) {
      var r = null;
      state.steps.forEach(function (x) { if (x.id === s.id) r = x; });
      var li = document.createElement("li");
      li.className = r ? (r.ok ? "ok" : "fail") : (state.current === s.id ? "run" : "");
      var name = document.createElement("span"); name.className = "name"; name.textContent = s.label;
      var badge = document.createElement("span"); badge.className = "badge";
      badge.textContent = r ? (r.ok ? "موفق ✓ " + r.ms + "ms" : "ناموفق ✗") : (state.current === s.id ? "در حال اجرا…" : "—");
      li.appendChild(name); li.appendChild(badge);
      if (r && !r.ok && r.err) { var d = document.createElement("span"); d.className = "detail"; d.textContent = r.err; li.appendChild(d); }
      list.appendChild(li);
    });
  }

  function groupOk(group) {
    var any = false, ok = true;
    state.steps.forEach(function (s) { if (s.group === group) { any = true; if (!s.ok) ok = false; } });
    return any && ok;
  }

  function finish() {
    state.finishedAt = new Date().toISOString();
    var browse = groupOk("browse") && groupOk("api"), checkout = groupOk("checkout"), payment = groupOk("payment");
    state.groups = { browse: browse, checkout: checkout, payment: payment };
    state.verdict = browse && checkout && payment ? "pass" : (browse && checkout ? "pass_no_payment" : (browse ? "browse_only" : "fail"));
    clearState();
    state.current = null;
    renderSteps();
    var texts = {
      pass: ["موفق: ویترین، تصاویر، API، ورود، سبد، سفارش و تغییر مسیر پرداخت همه کار کردند.", "pass"],
      pass_no_payment: ["تقریباً موفق: خرید کار کرد اما رفت‌وبرگشت پرداخت کامل نشد.", "partial"],
      browse_only: ["مشکل: ویترین باز شد ولی ثبت سفارش (ورود/سبد/سفارش) کار نکرد. یعنی مشتری می‌تواند ببیند اما نمی‌تواند سفارش بدهد.", "fail"],
      fail: ["ناموفق: بخش اصلی در دسترس نیست.", "fail"]
    };
    var v = $("verdict");
    v.textContent = texts[state.verdict][0];
    v.className = "verdict " + texts[state.verdict][1];
    var ok = state.steps.filter(function (s) { return s.ok; }).length;
    $("summary").textContent = ok + " از " + (STEPS.length + 1) + " مرحله موفق بود.";
    $("json").value = JSON.stringify(exportObject(), null, 1);
    $("resultCard").hidden = false;
    $("start").disabled = false;
    $("start").textContent = "اجرای دوبارهٔ آزمون";
    running = false;
    $("status").textContent = "آزمون تمام شد.";
    $("resultCard").scrollIntoView && $("resultCard").scrollIntoView({ block: "start" });
  }

  function exportObject() {
    return {
      schema: 1, tool: "jm-connectivity-probe", runId: state.runId, startedAt: state.startedAt, finishedAt: state.finishedAt,
      host: location.host.replace(/^probe\./, ""), meta: state.meta, env: state.env,
      steps: state.steps.map(function (s) { return { id: s.id, ok: s.ok, ms: s.ms, err: s.err || undefined }; }),
      groups: state.groups, verdict: state.verdict
    };
  }

  function runSteps(index) {
    if (index >= STEPS.length) { return startPayment(); }
    var s = STEPS[index];
    state.current = s.id;
    renderSteps();
    var ctx = state.ctx;
    return Promise.resolve().then(function () { return s.run(ctx); }).then(function (r) {
      state.steps.push({ id: s.id, group: s.group, ok: true, ms: (r && r.ms) || 0 });
    }, function (e) {
      state.steps.push({ id: s.id, group: s.group, ok: false, ms: 0, err: (e && e.message) || "error" });
    }).then(function () { if (s.id === "ip") { state.env.family = ctx.family || "unknown"; } return runSteps(index + 1); });
  }

  function startPayment() {
    state.current = PAYMENT.id;
    renderSteps();
    state.payStart = Date.now();
    var stored = true;
    try { sessionStorage.setItem(STORE, JSON.stringify(state)); sessionStorage.getItem(STORE); } catch (e) { stored = false; }
    if (!stored) {
      state.steps.push({ id: "payment", group: "payment", ok: false, ms: 0, err: "storage_blocked" });
      return finish();
    }
    $("status").textContent = "در حال رفتن به «درگاه» آزمایشی و بازگشت… اگر صفحه خطا داد، با دکمهٔ بازگشت به اینجا برگردید.";
    location.assign("/pay/start");
    return null;
  }

  function begin() {
    if (running) return;
    running = true;
    $("start").disabled = true;
    $("resultCard").hidden = true;
    $("sendStatus").textContent = "";
    $("status").textContent = "آزمون در حال اجراست؛ صفحه را نبندید…";
    var nav = navigator.connection || {};
    state = {
      runId: hex(4), startedAt: new Date().toISOString(), meta: readMeta(), steps: [], ctx: {}, current: null,
      env: { browser: browserClass(), online: navigator.onLine, effectiveType: nav.effectiveType || "unknown", saveData: !!nav.saveData, lang: (navigator.language || "").slice(0, 8), family: "unknown" }
    };
    state.steps.push({ id: "page", group: "info", ok: true, ms: pageLoadMs() });
    runSteps(0);
  }
  function pageLoadMs() {
    try { var n = performance.getEntriesByType("navigation")[0]; return n ? Math.round(n.responseEnd) : 0; } catch (e) { return 0; }
  }

  // ---- coming back from the payment round trip ----------------------------------------------------------------------------------
  function resume() {
    var saved = loadState();
    var returned = /(^|[?&])pay=returned(&|$)/.test(location.search);
    if (!saved) return;
    state = saved;
    running = true;
    $("start").disabled = true;
    var ms = Date.now() - (state.payStart || Date.now());
    state.steps.push(returned ? { id: "payment", group: "payment", ok: true, ms: ms } : { id: "payment", group: "payment", ok: false, ms: 0, err: "no_return" });
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ }
    finish();
  }

  // ---- sending / exporting --------------------------------------------------------------------------------------------------------
  function b64url(text) {
    return btoa(unescape(encodeURIComponent(text))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function send() {
    var text = JSON.stringify(exportObject());
    var encoded = b64url(text);
    if (encoded.length > 6800) { var slim = exportObject(); slim.steps = slim.steps.map(function (s) { return { id: s.id, ok: s.ok, ms: s.ms }; }); encoded = b64url(JSON.stringify(slim)); }
    $("sendStatus").textContent = "در حال ارسال…";
    call(API + "/api/report?r=" + encoded, { cache: "no-store", method: "GET" }).then(function () {
      $("sendStatus").textContent = "ارسال شد. ممنون!";
    }, function () {
      // a 204 answer has no body; fetch's ok check passes it, so reaching here means a real failure
      $("sendStatus").textContent = "ارسال نشد (شاید همین مشکل اتصال است). از «ذخیره» یا «کپی» استفاده کنید و نتیجه را دستی بفرستید.";
    });
  }
  function download() {
    try {
      var blob = new Blob([$("json").value], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "jm-probe-" + state.runId + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      $("sendStatus").textContent = "اگر فایل ذخیره نشد (در مرورگر داخلی بعضی برنامه‌ها ممکن است)، «کپی نتیجه» را بزنید.";
    } catch (e) { $("sendStatus").textContent = "ذخیره در این مرورگر ممکن نیست؛ «کپی نتیجه» را بزنید."; }
  }
  function copy() {
    var box = $("json");
    function fallback() { box.removeAttribute("readonly"); box.select(); try { document.execCommand("copy"); $("sendStatus").textContent = "کپی شد."; } catch (e) { $("sendStatus").textContent = "متن را به‌صورت دستی انتخاب و کپی کنید."; } box.setAttribute("readonly", ""); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(box.value).then(function () { $("sendStatus").textContent = "کپی شد."; }, fallback); } else { fallback(); }
  }

  // ---- wire up --------------------------------------------------------------------------------------------------------------------
  $("browserName").textContent = BROWSER_LABEL[browserClass()] || "نامشخص";
  $("start").addEventListener("click", begin);
  $("send").addEventListener("click", send);
  $("download").addEventListener("click", download);
  $("copy").addEventListener("click", copy);
  if (navigator.share) { $("share").hidden = false; $("share").addEventListener("click", function () { navigator.share({ title: "نتیجهٔ آزمون اتصال", text: $("json").value }).catch(function () {}); }); }
  resume();
  window.__jmProbe = { exportObject: function () { return state ? exportObject() : null; } }; // read by the automated browser test only
})();
