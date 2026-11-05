/* Trading Desk · iPhone web app (plan B: static on GitHub Pages, encrypted snapshot from a secret Gist).
   Read-only: settings, pause and mode change only through Telegram commands.
   Every trade URL shown here comes verbatim from the desk's links.py (inside the snapshot). */
(function () {
  "use strict";
  const APP_VERSION = "7";
  const POLL_S = 15, STALE_S = 300, API_MIN_GAP_S = 60;
  const LS = window.localStorage;
  const AG = { scanner: { n: "Scanner", c: "#64d2ff" }, auditor: { n: "Auditor", c: "#64d2ff" },
    analyst: { n: "Analyst", c: "#ffd60a" }, executor: { n: "Executor", c: "#00d35a" }, risk: { n: "Risk", c: "#ff6b9a" } };
  const ORDER = ["scanner", "auditor", "analyst", "executor", "risk"];
  const S = { cfg: null, snap: null, lastOk: 0, fails: 0, nextAt: 0, err: null, range: "LIVE",
    apiAt: 0, beamDone: {}, prevPts: 0, prevMarks: 0, timer: null, tick: null, sim: null };
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch (e) { return null; } };
  const usd = (v, sign) => v == null || !isFinite(v) ? "n/a" : (sign && v > 0 ? "+" : v < 0 ? "-" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kusd = v => v == null ? "n/a" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + v.toFixed(0);
  const pct = (v, d = 2) => v == null ? "n/a" : (v > 0 ? "+" : "") + v.toFixed(d) + "%";
  const hm = ts => new Date(ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const hms = ts => new Date(ts * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const price = p => p == null ? "n/a" : p >= 1 ? "$" + p.toFixed(4) : "$" + p.toPrecision(4);
  const age = ts => { if (!ts) return "n/a"; const m = (Date.now() / 1000 - ts) / 60; return m < 60 ? Math.round(m) + "m" : m < 1440 ? Math.floor(m / 60) + "h" : Math.floor(m / 1440) + "d"; };
  const reduced = () => window.Charts.reduced();
  const isLocal = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  /* ---------------- config: one-time link #d=owner:gistId&k=key -> localStorage ---------------- */
  function readFragment() {
    const h = location.hash.replace(/^#/, "");
    if (!/(^|&)d=/.test(h)) return;
    const c = parseLink(h);
    if (c) {
      LS.setItem("desk.cfg", JSON.stringify(c));
      LS.removeItem("desk.last");
    }
    history.replaceState(null, "", location.pathname + location.search + "#/home"); // secret leaves the URL bar
  }
  /* Paste flow: an installed home-screen app has its own storage, so the link can be pasted here.
     Accepts the full URL, "#d=…&k=…", "d=…&k=…", also URL-encoded (%3A, %23, %26 …). Never logged. */
  function parseLink(raw) {
    // iOS inserts spaces, soft hyphens and zero-width chars when copying wrapped text: strip them all
    const INVIS = /[\s\u00AD\u200B-\u200D\u2060\uFEFF]+/g;
    let t = String(raw || "").replace(INVIS, "").replace(/%20|%C2%AD|%E2%80%8[BCD]|%EF%BB%BF/gi, "");
    for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(t); i++) { try { t = decodeURIComponent(t); } catch (e) { break; } }
    t = t.replace(INVIS, "");
    const at = t.search(/(^|[#?&])d=/);
    if (at < 0) return null;
    const p = new URLSearchParams(t.slice(at).replace(/^[#?&]/, "").replace(/[?#]/g, "&"));
    const d = p.get("d"), k = p.get("k");
    if (!d || !k) return null;
    const ok = (d === "local" && isLocal()) || /^[A-Za-z0-9-]{1,39}:[0-9a-f]{20,40}$/.test(d);
    if (!ok || !/^[A-Za-z0-9_-]{43}=?$/.test(k)) return null;
    return { d, k: k.replace(/=$/, "") };
  }
  async function connectLink(raw) {
    const cfg = parseLink(raw);
    if (!cfg && !/(^|[#?&]|%23|%26)d(=|%3D)/i.test(String(raw)))
      throw new Error("In diesem Link fehlt der Schlüssel (#d=…&k=…). Safaris Adressleiste zeigt ihn nach dem Öffnen nicht mehr – in Safari unter Account „Link kopieren“ tippen und hier einfügen.");
    if (!cfg) throw new Error("Das ist kein gültiger Desk-Link. Er muss „#d=…&k=…“ enthalten – bitte den ganzen privaten Link einfügen.");
    let env, snap;
    try { env = await fetchEnv(false, cfg); }
    catch (e1) {
      try { env = await fetchEnv(true, cfg); }   // raw host failed -> try the API once
      catch (e) {
        const why = String((e && e.message) || e).replace(/[^\w .:-]/g, "").slice(0, 40);
        throw new Error(/HTTP 404/.test(e.message) ? "Daten nicht gefunden (404). Der Link ist unvollständig oder veraltet."
          : "Keine Verbindung zu GitHub (" + why + "). Internet prüfen und erneut versuchen.");
      }
    }
    try { snap = await decrypt(env, cfg); }
    catch (e) { throw new Error("Der Schlüssel im Link passt nicht zu den Daten. Bitte den Link vollständig kopieren."); }
    LS.setItem("desk.cfg", JSON.stringify(cfg)); LS.setItem("desk.last", JSON.stringify(env));
    S.cfg = cfg; S.snap = snap; S.lastOk = Date.now(); S.fails = 0; S.err = null;
    return snap;
  }
  function linkForm(compact) {
    const clip = navigator.clipboard && navigator.clipboard.readText;
    return `<div class="linkform${compact ? " compact" : ""}">
      <label for="lnk">Privaten Link hier einfügen</label>
      <input id="lnk" type="url" inputmode="url" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="https://…#d=…&amp;k=…">
      <div class="lbtns">${clip ? '<button type="button" id="lpaste" class="btn2">Aus Zwischenablage einfügen</button>' : ""}<button type="button" id="lgo" class="btn1">Verbinden</button></div>
      <div id="lmsg" class="lmsg" role="status" aria-live="polite"></div></div>`;
  }
  const isStandalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
  function privateLink() { return location.origin + location.pathname + "#d=" + S.cfg.d + "&k=" + S.cfg.k; }
  async function copyText(t) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); return true; } } catch (e) { }
    const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:-100px;opacity:0";
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length);
    let ok = false; try { ok = document.execCommand("copy"); } catch (e) { }
    ta.value = ""; ta.remove(); return ok;
  }
  function bindLinkForm() {
    const inp = $("#lnk"); if (!inp || inp.dataset.bound) return; inp.dataset.bound = "1";
    const msg = $("#lmsg"), go = $("#lgo"), pb = $("#lpaste");
    const say = (t, bad) => { msg.textContent = t; msg.className = "lmsg" + (bad ? " bad" : " ok"); };
    const run = async () => {
      if (!inp.value.trim()) { say("Bitte zuerst den Link einfügen.", true); return; }
      go.disabled = true; say("Prüfe Link …");
      try { await connectLink(inp.value); inp.value = ""; inp.blur(); say("Verbunden ✓"); history.replaceState(null, "", location.pathname + location.search + "#/home"); render(); poll(); }
      catch (e) { say(e.message, true); }
      finally { go.disabled = false; }
    };
    go.onclick = run;
    inp.onkeydown = e => { if (e.key === "Enter") run(); };
    if (pb) pb.onclick = async () => {
      try { const t = await navigator.clipboard.readText(); if (!t) { say("Zwischenablage ist leer.", true); return; } inp.value = t; run(); }
      catch (e) { say("Kein Zugriff auf die Zwischenablage – bitte ins Feld tippen und „Einsetzen“ wählen.", true); }
    };
  }
  function loadCfg() { try { S.cfg = JSON.parse(LS.getItem("desk.cfg") || "null"); } catch (e) { S.cfg = null; } }

  /* ---------------- data ---------------- */
  const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
  let keyObj = null, keyFor = null;
  async function decrypt(env, cfg) {
    const k = (cfg || S.cfg).k;
    if (!keyObj || keyFor !== k) { keyObj = await crypto.subtle.importKey("raw", b64u(k), "AES-GCM", false, ["decrypt"]); keyFor = k; }
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64u(env.iv), additionalData: new TextEncoder().encode(env.aad) }, keyObj, b64u(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function fetchEnv(forceApi, cfg) {
    if (S.sim === "offline") throw new Error("simulated offline");
    const d = (cfg || S.cfg).d;
    if (d === "local") { if (!isLocal()) throw new Error("local source only on localhost"); return getJSON("preview/desk.json?t=" + Date.now()); }
    const [owner, id] = d.split(":");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner || "") || !/^[0-9a-f]{20,40}$/.test(id || "")) throw new Error("bad data link");
    if (!forceApi) return getJSON(`https://gist.githubusercontent.com/${owner}/${id}/raw/desk.json?t=${Date.now()}`);
    S.apiAt = Date.now();
    const g = await getJSON(`https://api.github.com/gists/${id}`);
    const f = g.files && g.files["desk.json"];
    if (!f) throw new Error("no desk.json in gist");
    return f.truncated ? getJSON(f.raw_url) : JSON.parse(f.content);
  }
  async function poll() {
    clearTimeout(S.timer);
    if (!S.cfg) { render(); return; }
    try {
      let env = await fetchEnv(false), snap = await decrypt(env);
      // raw CDN can lag; if the snapshot looks old, ask the API (max once per minute; 60 req/h per IP unauthenticated)
      if (Date.now() / 1000 - snap.ts > STALE_S && Date.now() - S.apiAt > API_MIN_GAP_S * 1000 && S.cfg.d !== "local") {
        try { const e2 = await fetchEnv(true), s2 = await decrypt(e2); if (s2.ts > snap.ts) { env = e2; snap = s2; } } catch (e) { }
      }
      S.snap = snap; S.lastOk = Date.now(); S.fails = 0; S.err = null;
      try { LS.setItem("desk.last", JSON.stringify(env)); } catch (e) { }
    } catch (e) {
      S.fails++; S.err = e.name === "OperationError" ? "Schlüssel passt nicht zu den Daten" : String(e.message || e);
    }
    const wait = S.err ? Math.min(60, POLL_S * Math.pow(2, Math.min(2, S.fails - 1))) : POLL_S;
    S.nextAt = Date.now() + wait * 1000;
    if (!document.hidden) S.timer = setTimeout(poll, wait * 1000);
    render();
  }
  async function warmStart() {
    const last = LS.getItem("desk.last");
    if (last && S.cfg) { try { S.snap = await decrypt(JSON.parse(last)); } catch (e) { } }
  }
  function offline() {
    if (!S.cfg) return null;
    const stale = S.snap && Date.now() / 1000 - S.snap.ts > STALE_S;
    if (!S.err && !stale) return null;
    const n = Math.max(0, Math.round((S.nextAt - Date.now()) / 1000));
    const last = S.snap ? hms(S.snap.ts) : "nie";
    return `Desk offline · retrying in ${n}s · last update ${last}`;
  }

  /* ---------------- odometer ---------------- */
  const Odo = (() => {
    const el = document.createElement("span"); el.className = "odo"; let prev = "";
    function set(str) {
      if (str === prev) return;
      if (str.length !== prev.length) {
        el.innerHTML = str.split("").map(ch => /\d/.test(ch)
          ? `<span class="d"><span class="col">${"0123456789".split("").map(n => `<span>${n}</span>`).join("")}</span></span>`
          : `<span class="d"><span>${esc(ch)}</span></span>`).join("");
        const cols0 = [...el.children];
        cols0.forEach((d, i) => { const c = d.querySelector(".col"); if (c) { c.style.transition = "none"; c.style.transform = `translateY(-${(prev ? 0 : +str[i]) * 1.05}em)`; } });
        void el.offsetHeight;
        cols0.forEach(d => { const c = d.querySelector(".col"); if (c) c.style.transition = ""; });
      }
      const kids = [...el.children], L = kids.length;
      kids.forEach((d, i) => {
        const c = d.querySelector(".col"); if (!c) return;
        c.style.transitionDelay = reduced() ? "0ms" : ((L - 1 - i) * 30) + "ms";
        if (reduced()) c.style.transition = "none";
        c.style.transform = `translateY(-${(+str[i]) * 1.05}em)`;
      });
      prev = str;
    }
    return { el, set };
  })();

  /* ---------------- shared pieces ---------------- */
  function navbar(title, back) {
    if (back) return `<div class="nav"><a class="back" href="${back}">‹ Zurück</a><div class="brand">${esc(title || "")}</div></div>`;
    const unread = S.snap ? S.snap.activity.filter(a => a.ts > +(LS.getItem("desk.seen") || 0)).length : 0;
    return `<div class="nav">
      <a class="avatar" href="#/account" aria-label="Account"><i>L</i></a>
      <a class="brand" href="#/agents">Grok Bot <span>›</span></a>
      <button class="iconbtn" id="sbtn" aria-label="Suche"><span class="ti ti-search"></span></button>
      <a class="iconbtn" href="#/activity" id="bell" aria-label="Pushes"><span class="ti ti-bell"></span>${unread ? '<span class="dot"></span>' : ""}</a>
    </div>
    <div class="search" id="search"><input id="q" type="search" placeholder="Name, Symbol oder Mint" autocomplete="off" autocapitalize="off"><div class="results" id="res"></div></div>`;
  }
  function tradeBtns(c, side) {
    if (!c || !c.links) return "";
    const a = safeUrl(c.links.axiom), f = safeUrl(c.links.fomo);
    return `<div class="btns">
      ${a ? `<a class="btn ${side === "Sell" ? "sell" : "axiom"}" href="${esc(a)}" target="_blank" rel="noopener noreferrer">${side} on Axiom</a>` : ""}
      ${f ? `<a class="btn ${side === "Sell" ? "sell" : "fomo"}" href="${esc(f)}" target="_blank" rel="noopener noreferrer">${side} on FOMO</a>` : ""}
    </div>`;
  }
  function smallLinks(l) {
    if (!l) return "";
    const a = safeUrl(l.axiom), f = safeUrl(l.fomo);
    return `${a ? `<a class="link" href="${esc(a)}" target="_blank" rel="noopener noreferrer">Axiom</a>` : ""}${a && f ? ' <span class="ter">·</span> ' : ""}${f ? `<a class="link" href="${esc(f)}" target="_blank" rel="noopener noreferrer">FOMO</a>` : ""}`;
  }
  const paperPill = () => S.snap && S.snap.mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : "";
  const coinHref = m => S.snap && S.snap.coins[m] ? `#/coin/${m}` : (S.snap && S.snap.audits[m] ? `#/audit/${m}` : null);

  function actRow(a) {
    const kind = a.kind, col = kind === "bought" ? "#0a84ff" : kind === "sold" ? "#00d35a" : kind === "stopped" ? "#ff453a" : "#2c2c2e";
    const href = (kind === "rejected") ? (S.snap.audits[a.mint] ? `#/audit/${a.mint}` : `#/coin/${a.mint}`) : `#/coin/${a.mint}`;
    const vcls = kind === "sold" ? "green" : kind === "stopped" ? "red" : kind === "rejected" ? "sec" : "";
    const ic = { bought: "B", sold: "S", stopped: "!", rejected: "×" }[kind] || "·";
    return `<a class="row" href="${href}"><span class="ic" style="background:${col};color:${kind === "rejected" ? "#fff" : "#000"}">${ic}</span>
      <span class="mid"><div class="t">${esc(a.title)}</div><div class="s">${esc(a.subtitle)} · ${hm(a.ts)}</div></span>
      <span class="v ${vcls}">${esc(a.value)}</span></a>`;
  }

  /* ---------------- agent cards (carousel) ---------------- */
  function agentCard(name) {
    const st = S.snap.state.agents[name], s = S.snap, a = AG[name];
    const dot = st.paused ? "#ff9f0a" : st.alive ? a.c : "#ff453a";
    let body = "";
    if (name === "scanner") {
      body = st.feed.length ? `<ul class="feed">${st.feed.slice(0, 5).map(f => `<li class="${f.verdict === "kill" ? "kill" : "pass"}"><span>${esc(f.name)}</span><span>${f.verdict === "kill" ? esc(f.reason) : "→ auditor"}</span></li>`).join("")}</ul>`
        : `<div class="sec">Listening for graduations</div>`;
    } else if (name === "auditor") {
      const L = st.last;
      body = `<div class="strips">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const v = L && L.layers[i]; return `<i class="${v === 1 ? "g" : v === 0 ? "r" : ""}"></i>`; }).join("")}</div>
        <div>${L ? esc(L.name) + " · " + esc(L.result) : '<span class="sec">No coin taken apart yet</span>'}</div><div class="sec">${st.rejected} rejected</div>`;
    } else if (name === "analyst") {
      body = `<div class="ringwrap"><canvas id="ring"></canvas><div>${st.last ? `<div>${esc(st.last.name)}</div><div class="${st.last.pass ? "green" : "sec"}">${st.last.pass ? "pass" : esc(st.last.reason || "")}</div>` : '<div class="sec">Waiting for a coin</div>'}<div class="ter">rules mode · green from 70</div></div></div>`;
    } else if (name === "executor") {
      const L = st.last, filled = L && ["bought", "filled", "open", "sent"].includes(L.status);
      body = `<div>${usd(st.ticket)} · ${st.stack_pct}% of stack</div>
        ${L ? `<div class="bar"><i style="width:${filled ? 100 : 50}%"></i></div><div>${esc(L.name)} · ${filled ? "✓ Filled" : "Executing... 50%"}</div>` : '<div class="sec">No trade yet tonight</div>'}`;
    } else if (name === "risk") {
      const rs = { stop: "Stop-Loss", take_profit: "Gewinnziel", floor: "Gewinnsicherung", trail: "Trailing-Stop", timeout: "Timeout", pulled: "Liquidität weg" };
      body = `<div class="pills"><span class="pill mono redp">Stop -${st.stop_pct}%</span><span class="pill mono greenp">Ziel +${st.take_profit_pct}%</span><span class="pill mono greenp">Sicherung +${st.floor_pct}% ab +${st.floor_arm_pct}%</span>${st.trailing_enabled ? `<span class="pill mono greenp">Trail ${st.trail_pct}%</span>` : ""}</div>
        <div>${st.last ? esc(st.last.name) + " · " + esc(st.last.label || rs[st.last.reason] || st.last.reason || "") + " · " + usd(st.last.pnl, true) : '<span class="sec">' + (st.count ? "Guarding " + st.count + " position(s)" : "Nothing to guard") + "</span>"}</div>`;
    }
    const stat = name === "analyst" ? "Scoring" : name === "risk" ? (st.count ? "Guarding" : "Idle") : st.label;
    return `<a class="acard" href="#/agents"><div class="hd"><span class="sd" style="background:${dot}"></span><span style="color:${a.c}">${a.n}</span><span class="ter">${st.paused ? "paused" : st.alive ? "" : "offline"}</span></div>
      <div class="stat">${esc(stat)}</div><div class="body">${body}</div></a>`;
  }

  /* ---------------- screens ---------------- */
  function skeleton(kind) {
    const b = (h, m) => `<div class="sk" style="height:${h}px;margin:${m || "0 16px 12px"}"></div>`;
    if (kind === "home") return navbar() + `<div class="bal">${b(70, "8px 0 8px")}${b(22, "0 0 12px")}</div>` + b(240) + b(44) + `<section><h2 class="ter">Agents</h2></section>` + b(300) + b(180);
    if (kind === "coin") return navbar("", "#/home") + b(60) + b(56) + b(260) + b(140);
    if (kind === "audit") return navbar("", "#/home") + `<div class="sk" style="width:220px;height:268px;margin:18px auto;border-radius:30px"></div>` + b(380);
    return navbar() + b(120) + b(120) + b(120);
  }
  function noLink() {
    return navbar() + `<section><h2>Kein Daten-Link</h2><div class="emptybox">Füge deinen privaten Link ein (er endet auf <span class="num">#d=…&amp;k=…</span>). Er wird nur auf diesem Gerät gespeichert. Die Home-Bildschirm-App hat einen eigenen Speicher – deshalb hier einmal einfügen, auch wenn der Link in Safari schon geöffnet war.</div>${linkForm()}<div class="ver">App v${APP_VERSION}</div></section>`;
  }

  function home() {
    const s = S.snap, st = s.state;
    const pts = rangePts();
    const runnng = st.running;
    return navbar() + `
    <div class="bal">
      <div class="balrow"><span class="big num" id="odo"></span>${paperPill()}</div>
      <div class="sub"><span class="${st.today_pct >= 0 ? "green" : "red"} num">${pct(st.today_pct)}</span><span class="sec">heute</span><span class="pill mult num">${st.multiplier.toFixed(2)}×</span></div>
    </div>
    <div class="chartwrap"><canvas id="line"></canvas>${pts.length < 2 || !s.chart.marks.length && Math.abs(st.balance - st.start) < 1e-9 ? '<div class="empty-chart">Waiting for the first trade</div>' : ""}</div>
    <div class="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-r="${r}" class="${S.range === r ? "on" : ""}">${r}</button>`).join("")}</div>
    ${funnelTeaser()}
    <section><h2>Agents · ${runnng} running</h2></section>
    <div class="carousel" id="car">${ORDER.map(agentCard).join("")}</div>
    <section><h2>Activity <a class="more" href="#/activity">See all</a></h2>
      ${s.activity.length ? `<div class="list">${s.activity.slice(0, 5).map(actRow).join("")}</div>` : '<div class="emptybox">Nothing yet tonight</div>'}
    </section>`;
  }
  // LIVE = tonight (since the night start), at least the last 30 minutes
  function spanOf(r) { const s = S.snap; return r === "LIVE" ? Math.max(1800, s.ts - s.state.night_start) : { "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800, ALL: 1e12 }[r]; }
  function rangePts() {
    const s = S.snap, now = s.ts, all = s.chart.points;
    return all.filter(p => p[0] >= now - spanOf(S.range));
  }
  function drawHome() {
    const s = S.snap, cv = $("#line"); if (!cv) return;
    const pts = rangePts(), marks = s.chart.marks;
    const span = S.range === "ALL" ? null : spanOf(S.range);
    const opt = span ? { t0: s.ts - span, t1: s.ts } : {};
    const newPt = pts.length > S.prevPts && S.prevPts > 0, newMk = marks.length > S.prevMarks && S.prevMarks >= 0;
    S.prevPts = pts.length; const pm = S.prevMarks; S.prevMarks = marks.length;
    if (reduced() || (!newPt && !(newMk && pm > 0))) { Charts.line(cv, pts, s.state.start, marks, opt); return; }
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / 250), ma = Math.min(1, (t - t0) / 200);
      Charts.line(cv, pts, s.state.start, marks, Object.assign({ progress: newPt ? k : 1, markAlpha: newMk ? ma : 1 }, opt));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function agentsTab() {
    const s = S.snap;
    return navbar() + `<section><h2>Agents</h2>${ORDER.map(name => {
      const st = s.state.agents[name], a = AG[name], dec = s.decisions[name] || [];
      const dot = st.paused ? "#ff9f0a" : st.alive ? "#00d35a" : "#ff453a";
      const emptyTxt = { scanner: "Listening for graduations", auditor: "No coin taken apart yet", analyst: "No coin scored yet", executor: "No trade yet tonight", risk: "No position yet" }[name];
      return `<div class="agent"><div class="top"><span style="width:10px;height:10px;border-radius:5px;background:${dot}"></span><b style="color:${a.c}">${a.n}</b>
        <span class="sec num">${st.count} heute</span><span class="switch ro ${st.paused ? "" : "on"}" role="switch" aria-checked="${!st.paused}" aria-disabled="true"></span></div>
        <div class="note">${st.paused ? "pausiert" : st.alive ? "läuft" : "kein Heartbeat"} · Pause/Weiter nur per Telegram: „pause ${name}“ / „resume ${name}“${name === "risk" && st.locked ? " · gesperrt, Position offen" : ""}</div>
        <div class="dec">${dec.length ? dec.map(d => {
          const href = coinHref(d.mint);
          const nm = href ? `<a href="${href}">${esc(d.name)}</a>` : `<span>${esc(d.name)}</span>`;
          const ok = ["pass", "sent", "bought", "open", "closed"].includes(d.verdict);
          return `<div class="r"><span class="sec num">${hm(d.ts)}</span>${nm}<span class="${ok ? "green" : "red"}">${esc(d.verdict)}</span><div class="why">${esc(d.reason)} · ${smallLinks(d.links)}</div></div>`;
        }).join("") : `<div class="sec" style="padding:10px 0">${emptyTxt}</div>`}</div>
        <a class="link" href="#/account?g=${name}">Settings ›</a></div>`;
    }).join("")}</section>`;
  }

  /* ---------------- Trader (copy trading, read-only public wallets) ---------------- */
  const ago = ts => { if (!ts) return "nie"; const m = (Date.now() / 1000 - ts) / 60; return m < 1 ? "gerade" : m < 60 ? "vor " + Math.round(m) + " Min" : m < 1440 ? "vor " + Math.floor(m / 60) + " Std" : "vor " + Math.floor(m / 1440) + " T"; };
  function traderTab() {
    const c = S.snap.copy;
    if (!c) return navbar() + `<section><h2>Trader</h2><div class="emptybox">Copy-Trading ist im Desk-Snapshot noch nicht aktiv.</div></section>`;
    const dot = c.paused ? "#ff9f0a" : c.alive ? "#00d35a" : "#ff453a";
    const stTxt = !c.enabled ? "aus" : c.paused ? "pausiert" : !c.alive ? "kein Heartbeat" : c.ws_up ? "live verbunden" : "Fallback-Abfrage";
    const sigStat = { bought: ["green", "gekauft (Paper)"], sent: ["green", "Signal gesendet"], skipped: ["red", "übersprungen"], pending: ["sec", "wird geprüft"], push_failed: ["red", "Push fehlgeschlagen"] };
    const w = c.wallets.map(x => {
      const lb = x.last_buy, href = lb ? (coinHref(lb.mint) || null) : null;
      const sol = safeUrl(x.solscan);
      return `<div class="trow"><div class="th"><span class="sd" style="background:${x.recent ? "#00d35a" : "#48484a"}"></span><b>${esc(x.name)}</b>${x.enabled ? "" : ' <span class="ter">(aus)</span>'}
          ${sol ? `<a class="link num" href="${esc(sol)}" target="_blank" rel="noopener noreferrer">${esc(x.short)} ↗</a>` : `<span class="num ter">${esc(x.short)}</span>`}</div>
        <div class="s">${lb ? `Letzter Kauf: ${href ? `<a href="${href}">${esc(lb.name)}</a>` : esc(lb.name)} · ${ago(lb.ts)} · ${smallLinks(lb.links)}` : "Noch kein Kauf gesehen"}</div>
        <div class="s ter">${x.recent ? "aktiv in den letzten 24 Std" : x.last_active ? "zuletzt aktiv " + ago(x.last_active) : "seit Start nicht aktiv gesehen"} · ${x.buys_24h} Coins in 24 Std</div></div>`;
    }).join("");
    const sg = c.signals.length ? `<div class="list">${c.signals.map(x => {
      const [cls, lbl] = sigStat[x.status] || ["sec", x.status]; const href = coinHref(x.mint);
      return `<div class="trow"><div class="th"><span class="sec num">${hm(x.ts)}</span>${href ? `<a href="${href}"><b>${esc(x.name)}</b></a>` : `<b>${esc(x.name)}</b>`}<span class="${cls}">${esc(lbl)}</span></div>
        <div class="s">${esc(x.traders.join(", "))}${x.status === "skipped" && x.reason ? " · " + esc(x.reason) : ""} · ${smallLinks(x.links)}</div></div>`;
    }).join("")}</div>` : `<div class="emptybox">Noch kein Coin, den ${c.min_wallets} Trader gekauft haben</div>`;
    return navbar() + `<section><h2>Trader</h2>
      <div class="note" style="margin:-4px 0 10px"><span class="sd" style="background:${dot};display:inline-block;width:8px;height:8px;border-radius:4px"></span> Copy ${esc(stTxt)} · Kauf, sobald ${c.min_wallets} von ${c.wallets.filter(x => x.enabled).length} Wallets denselben Coin in ${c.window_min} Min kaufen</div>
      <h2>Copy-Signale</h2>${sg}
      <h2>Wallets</h2><div class="list">${w}</div>
      <div class="note">Öffentliche Wallet-Adressen (Namen = Labels von KOL-Trackern). Der Desk liest nur mit und kauft nie selbst on-chain. Pause per Telegram: „pause copy“.</div>
    </section>`;
  }

  /* ---------------- Filter: where coins get stuck (snapshot.funnel, last 24h) ---------------- */
  const FPATH = () => new URLSearchParams((location.hash.split("?")[1] || "")).get("p") === "copy" ? "copy" : "scan";
  function topBlocker(f) {
    let best = null;
    f.stages.forEach(st => st.reasons.forEach(r => { if (!r.waiting && (!best || r.count > best.count)) best = Object.assign({ stage: st.label }, r); }));
    return best;
  }
  function funnelTeaser() {
    const f = S.snap.funnel; if (!f) return "";
    const steps = [["Neu", f.total]].concat(f.stages.map(st => [st.label + " ✓", st.passed]));
    steps[steps.length - 1][0] = "Gekauft";
    const tb = topBlocker(f);
    return `<section><h2>Filter <a class="more" href="#/filter">Details</a></h2>
      <a class="fteaser" href="#/filter"><div class="fsteps">${steps.map((x, i) => `<span><b class="num">${x[1]}</b><i>${esc(x[0])}</i></span>${i < steps.length - 1 ? '<span class="ar">›</span>' : ""}`).join("")}</div>
      ${tb ? `<div class="s">Meist hängen geblieben: <span class="red">${esc(tb.stage)} · ${esc(tb.label)}</span> (${tb.count})</div>` : ""}
      <div class="s ter">letzte ${f.window_h} Std · antippen für alle Gründe</div></a></section>`;
  }
  function reasonRow(r, total) {
    const w = total ? Math.max(3, Math.round(100 * r.count / total)) : 0;
    return `<a class="freason${r.waiting ? " wait" : ""}" href="#/filter/${encodeURIComponent(r.key)}">
      <span class="fl">${r.waiting ? "⏳ " : ""}${esc(r.label)}</span><span class="fc num">${r.count}</span><span class="sec">›</span>
      <span class="fb"><i style="width:${w}%"></i></span></a>`;
  }
  function stageBlock(st, total) {
    const pctIn = total ? Math.round(100 * st.entered / total) : 0;
    return `<div class="fstage"><div class="fh"><b>${esc(st.label)}</b><span class="sec num">${st.entered} rein → <span class="green">${st.passed} durch</span></span></div>
      <div class="fbar"><i style="width:${pctIn}%"></i></div>
      <div class="s">${st.stuck ? `<span class="red">${st.stuck} hängen geblieben</span>` : "nichts hängen geblieben"}${st.waiting ? ` · <span class="orange">${st.waiting} warten noch</span>` : ""}</div>
      ${st.reasons.length ? `<div class="list">${st.reasons.map(r => reasonRow(r, st.entered)).join("")}</div>` : ""}</div>`;
  }
  function filterTab(arg) {
    const f = S.snap.funnel;
    if (!f) return navbar() + `<section><h2>Filter</h2><div class="emptybox">Der Desk liefert die Filter-Daten noch nicht (Desk-Update nötig).</div></section>`;
    if (arg) return filterDetail(decodeURIComponent(arg));
    const p = FPATH(), c = f.copy;
    const seg = `<div class="seg fseg"><a href="#/filter" class="${p === "scan" ? "on" : ""}">Scanner-Pfad</a><a href="#/filter?p=copy" class="${p === "copy" ? "on" : ""}">Copy-Pfad</a></div>`;
    let body;
    if (p === "copy") {
      body = !c ? '<div class="emptybox">Copy-Trading liefert noch keine Daten.</div>'
        : `<div class="note">Regel: Kauf, sobald ${esc(c.rule)}. Jeder Coin, den ein verfolgter Trader gekauft hat, steht unten bei seinem Grund.</div>
          ${stageBlock(Object.assign({}, c, { label: "Trader-Käufe" }), c.entered)}
          ${boughtBlock(c.bought_coins, c.passed)}`;
    } else {
      body = `<div class="note">Jeder neue Coin der letzten ${f.window_h} Std steht genau einmal bei der Stelle, an der er gestoppt wurde. ⏳ = wartet noch (wird weiter geprüft).</div>
        <div class="fstage"><div class="fh"><b>Neu migriert</b><span class="num">${f.total}</span></div></div>
        ${f.stages.map(st => stageBlock(st, f.total)).join("")}
        ${boughtBlock(f.bought_coins, f.bought)}`;
    }
    return navbar() + `<section><h2>Filter · wo Coins hängen bleiben</h2>${seg}${body}</section>`;
  }
  function boughtBlock(list, n) {
    return `<div class="fstage"><div class="fh"><b class="green">Gekauft</b><span class="num green">${n}</span></div>
      ${list && list.length ? `<div class="list">${list.map(coinRow).join("")}</div>` : '<div class="s sec">noch nichts</div>'}</div>`;
  }
  function coinRow(x) {
    const href = coinHref(x.mint);
    const nm = href ? `<a href="${href}"><b>${esc(x.name)}</b></a>` : `<b>${esc(x.name)}</b>`;
    return `<div class="trow"><div class="th">${nm}<span class="num ter">${esc(x.short)}</span><span class="sec num">${x.ts ? hm(x.ts) : ""}</span></div>
      <div class="s">${esc(x.detail || "")}</div></div>`;
  }
  function filterDetail(key) {
    const f = S.snap.funnel, all = f.stages.concat(f.copy ? [f.copy] : []);
    let st = null, r = null;
    all.forEach(x => x.reasons.forEach(y => { if (y.key === key) { st = x; r = y; } }));
    const back = key.startsWith("copy.") ? "#/filter?p=copy" : "#/filter";
    if (!r) return navbar("Filter", back) + `<section><div class="emptybox">Für diesen Grund ist gerade kein Coin mehr im Fenster.</div></section>`;
    const more = r.count > r.coins.length ? `<div class="note">Gezeigt: die neuesten ${r.coins.length} von ${r.count}.</div>` : "";
    return navbar("Filter", back) + `<section><h2>${esc(st.key === "copy" ? "Copy" : st.label)}</h2>
      <div class="note" style="margin:-4px 0 10px">${r.waiting ? "⏳ wartet noch · " : "gestoppt · "}<b>${esc(r.label)}</b> · ${r.count} Coin${r.count === 1 ? "" : "s"} in ${f.window_h} Std</div>
      <div class="list">${r.coins.map(coinRow).join("")}</div>${more}</section>`;
  }

  function activityTab() {
    const s = S.snap;
    LS.setItem("desk.seen", String(s.ts));
    return navbar() + `<section><h2>Activity</h2><a class="fentry" href="#/filter"><span>⛃ Filter · Wo Coins hängen bleiben</span><span class="sec">›</span></a>${s.activity.length ? `<div class="list">${s.activity.map(actRow).join("")}</div>` : '<div class="emptybox">Nothing yet tonight</div>'}</section>`;
  }

  function auditScreen(mint) {
    const s = S.snap;
    const a = mint ? s.audits[mint] : s.audits[Object.keys(s.audits)[0]];
    if (!a) return navbar("Auditor", "#/home") + `<section><div class="discs">${[0, 1, 2, 3, 4, 5, 6, 7].map(i => `<div class="disc n" style="top:${i * 30}px"></div>`).join("")}</div><div class="emptybox">No coin taken apart yet</div></section>`;
    const red = a.result === "rejected";
    const vline = red ? `<div class="verdict red">Rejected · ${esc(a.reason)}</div><div class="sec">Grok Bot won't buy ${esc(a.name)}</div>`
      : `<div class="verdict green">Cleared · 8/8 parts</div><div class="sec">Sent to Executor · ${a.sent_usd != null ? usd(a.sent_usd) : "n/a"}</div>`;
    const on = s.account.settings.auditor.find(x => x.key === "enabled");
    return navbar(a.name, "#/home") + `<section>
      <div class="discs" id="discs">${a.layers.map((L, i) => `<div class="disc" data-i="${i}" style="top:${i * 30}px;z-index:${10 - i}"></div>`).join("")}<div class="beam" id="beam"></div></div>
      <div id="vline" style="visibility:hidden">${vline}</div>
      <h2>8 Layers</h2><div class="list">${a.layers.map(L => `<div class="lrow"><span>${L.layer}. ${esc(L.name)}</span><span class="lv ${L.pass === true ? "green" : L.pass === false ? "red" : "ter"}">${esc(L.value)}</span></div>`).join("")}</div>
      <div class="list" style="margin-top:14px"><div class="toggle"><span>Take apart before buying</span><span class="switch ro ${on && on.value ? "on" : ""}" aria-disabled="true"></span></div></div>
      <div class="note">Nur per Telegram änderbar („set auditor.enabled …“, fragt zweimal).</div>
      ${tradeBtns(a, "Buy").replace("Buy on Axiom", "Open on Axiom").replace("Buy on FOMO", "Open on FOMO")}
    </section>`;
  }
  function runBeam(mint) {
    const s = S.snap, a = mint ? s.audits[mint] : s.audits[Object.keys(s.audits)[0]]; if (!a) return;
    const discs = [...document.querySelectorAll(".disc[data-i]")], beam = $("#beam"), vl = $("#vline");
    const paint = (i) => { const L = a.layers[i]; const d = discs[i]; d.className = "disc " + (L.pass === true ? "g" : L.pass === false ? "r" : "n"); d.textContent = L.pass === true ? "✓" : L.pass === false ? "✕" : ""; };
    const key = a.mint + ":" + a.ts;
    if (reduced() || S.beamDone[key]) { a.layers.forEach((_, i) => paint(i)); vl.style.visibility = "visible"; return; }
    S.beamDone[key] = true;
    let i = 0; beam.style.opacity = 1; beam.style.top = "21px";
    const next = () => {
      if (i >= a.layers.length || a.layers[i].pass == null) { beam.style.opacity = 0; for (; i < a.layers.length; i++) paint(i); vl.style.visibility = "visible"; return; }
      beam.style.top = (i * 30 + 21) + "px";
      setTimeout(() => { setTimeout(() => { paint(i); i++; next(); }, 150); }, 350);
    };
    next();
  }

  function coinScreen(mint) {
    const s = S.snap, c = s.coins[mint];
    if (!c) {
      const a = s.audits[mint];
      return navbar("", "#/home") + `<section><h2>${esc(a ? a.name : (mint || "").slice(0, 6) + "…")}</h2><div class="emptybox">Keine Kursdaten für diesen Coin im aktuellen Desk-Snapshot.</div>${a ? tradeBtns(a, "Buy") : ""}</section>`;
    }
    const p = c.position, open = p && p.status !== "closed";
    const since = p && c.price != null ? 100 * (c.price / p.entry_price - 1) : null;
    const exitLine = open ? (p.floor_line || p.trail_line || p.stop_price) : null;
    const left = open ? Math.max(0, p.timeout_at - Date.now() / 1000) : 0;
    const audit = c.audit ? `<span class="chip ${c.audit === "8/8" ? "" : "bad"}">⛨ ${esc(c.audit)}</span>` : "";
    return navbar("", "#/home") + `<div class="coinhd">
      <div class="nm">${esc(c.name)} ${audit} ${paperPill()}</div>
      <div class="sec">${esc(c.symbol || "")} · Solana · ${age(c.migrated_at)} old</div>
      <div class="price num">${price(c.price)}</div>
      ${since != null ? `<div class="${since >= 0 ? "green" : "red"} num">${since >= 0 ? "▲" : "▼"} ${Math.abs(since).toFixed(2)}% since entry</div>` : ""}
    </div>
    <div class="candles" style="margin-top:12px;position:relative"><canvas id="cnd"></canvas>${c.candles.length ? "" : '<div class="empty-chart">Noch keine Kerzen</div>'}</div>
    <section style="margin-top:14px"><div class="grid2">
      <div class="cell"><div class="k">Market cap</div><div class="val num">${kusd(c.mcap_usd)}</div></div>
      <div class="cell"><div class="k">Liquidity</div><div class="val num">${kusd(c.liquidity_usd)}</div></div>
      <div class="cell"><div class="k">24h volume</div><div class="val num">${kusd(c.vol24_usd)}</div></div>
      <div class="cell"><div class="k">Holders</div><div class="val num">${c.holders != null ? c.holders.toLocaleString("de-DE") : "n/a"}</div></div>
    </div>
    ${c.copy ? `<div class="copybox"><b>Copy-Trade</b> · gekauft von ${esc(c.copy.traders.join(", "))} · ${hm(c.copy.ts)}</div>` : ""}
    ${open ? `<h2>Your position · ${usd(p.size_usd)} in · ${p.source === "copy" ? "Copy" : "Executor"}</h2>
      <div class="exitcard">
        <div class="lrow"><span>Stop line</span><span class="red num">${price(p.stop_price)} · -${p.stop_pct}%</span></div>
        <div class="lrow"><span>Gewinnziel +${p.tp_pct}%</span><span class="green num">${p.tp_line ? price(p.tp_line) : "n/a"}</span></div>
        <div class="lrow"><span>Gewinnsicherung +${p.floor_pct}%</span><span class="${p.floor_armed ? "green" : "ter"} num">${p.floor_armed ? price(p.floor_line) : "aktiv ab +" + p.floor_arm_pct + "%"}</span></div>
        ${p.trail_line ? `<div class="lrow"><span>Trail line</span><span class="green num">${price(p.trail_line)}</span></div>` : ""}
        <div class="lrow"><span>Timeout in</span><span class="num">${Math.floor(left / 3600)}h ${Math.floor(left % 3600 / 60)}m</span></div>
      </div>` : ""}
    ${tradeBtns(c, open ? "Sell" : "Buy")}
    </section>`;
  }

  function accountTab() {
    const s = S.snap, a = s.account;
    const g = new URLSearchParams((location.hash.split("?")[1] || "")).get("g");
    const groups = Object.entries(a.settings).sort(([x], [y]) => (x === g ? -1 : y === g ? 1 : 0));
    const fmt = v => typeof v === "boolean" ? (v ? "an" : "aus") : String(v);
    return navbar() + `<section><h2>Account</h2>
      <div class="list">
        <div class="lrow"><span>Modus</span><span style="width:160px"><div class="seg"><span class="${a.mode === "PAPER" ? "on" : ""}">PAPER</span><span class="${a.mode === "LIVE" ? "on" : ""}">LIVE</span></div></span></div>
        <div class="lrow"><span>Stack</span><span class="num">${usd(a.stack)} <span class="ter">· frei ${usd(a.free)}</span></span></div>
        <div class="lrow"><span>Your FOMO profile</span><span class="ter">nicht gesetzt</span></div>
        <div class="lrow"><span>Invite a friend</span><span class="ter">aus · keine Referral-Links</span></div>
        <div class="lrow"><span>Telegram</span><span class="${a.telegram ? "green" : "red"}">${a.telegram ? "connected" : "not connected"}</span></div>
        <div class="lrow"><span>Send test push</span><span class="ter">in Telegram: „status“</span></div>
        <div class="lrow"><span>Notifications</span><span class="ter">Telegram only (kein Web-Push in Plan B)</span></div>
      </div>
      <div class="note">Modus, Stack, Pause und alle Settings ändern sich nur per Telegram (z. B. „setze stop auf 8“, „live“ → „LIVE“). Die App zeigt sie nur an.</div>
      <div class="note">${esc(a.fee_model)}</div>
      ${groups.map(([grp, items]) => `<div class="grp">${esc(grp)}</div><div class="list">${items.map(it => {
        const r = it.range, isNum = typeof it.value === "number";
        return `<div class="set"><div class="h"><span>${esc(it.key)}</span><b>${esc(fmt(it.value))}</b></div>${isNum && r ? `<input type="range" disabled min="${r[0]}" max="${r[1]}" step="any" value="${it.value}">` : ""}</div>`;
      }).join("")}</div>`).join("")}
      <h2>Dieses Gerät</h2><div class="list"><div class="lrow"><span>Datenquelle</span><span class="sec">Secret Gist · AES-GCM</span></div>
      <button class="lrow" id="forget" style="width:100%;color:var(--red)">Daten-Link auf diesem Gerät löschen</button></div>
      ${!isStandalone() ? `<div class="grp">Für die Home-Bildschirm-App</div><div class="list"><button class="lrow" id="lcopy" style="width:100%;color:var(--blue,#0a84ff)">Link kopieren</button></div>
      <div class="note" id="lcopymsg">Kopiert den privaten Link (mit Schlüssel) in die Zwischenablage. In der Home-Bildschirm-App dann „Aus Zwischenablage einfügen“.</div>` : ""}
      <div class="grp">Anderen Link verwenden</div>${linkForm(true)}
      <div class="ver">App v${APP_VERSION}</div>
    </section>`;
  }

  /* ---------------- render + router ---------------- */
  function route() { const h = (location.hash || "#/home").replace(/^#\//, "").split("?")[0].split("/"); return { r: h[0] || "home", arg: h[1] }; }
  function render() {
    const { r, arg } = route(), view = $("#view");
    document.querySelectorAll(".tabbar a").forEach(a => a.classList.toggle("on", a.dataset.tab === (r === "filter" ? "activity" : r)));
    const off = offline(), err = $("#err");
    if (off) { err.textContent = off; err.hidden = false; } else err.hidden = true;
    const carLeft = $("#car") ? $("#car").scrollLeft : 0;
    const lk = $("#lnk"), lm = $("#lmsg");
    if (lk && (document.activeElement === lk || lk.value || (lm && lm.textContent && !S.cfg))) return; // don't wipe a link being pasted
    if (!S.cfg) { view.innerHTML = noLink(); bindLinkForm(); return; }
    if (!S.snap && S.err) { // stored link can't load (wrong key, bad id, offline): never get stuck on skeletons
      view.innerHTML = navbar() + `<section><h2>Daten nicht lesbar</h2><div class="emptybox">${esc(S.err)}. Bitte den privaten Link erneut einfügen.</div>${linkForm()}<div class="ver">App v${APP_VERSION}</div></section>`;
      bindLinkForm(); return;
    }
    if (!S.snap) { view.innerHTML = skeleton(r === "coin" ? "coin" : r === "audit" ? "audit" : r === "home" ? "home" : "list"); return; }
    const html = r === "agents" ? agentsTab() : r === "trader" ? traderTab() : r === "filter" ? filterTab(arg) : r === "activity" ? activityTab() : r === "account" ? accountTab()
      : r === "coin" ? coinScreen(arg) : r === "audit" ? auditScreen(arg) : home();
    view.innerHTML = html;
    if (r === "home") {
      const o = $("#odo"); o.appendChild(Odo.el); Odo.set(usd(S.snap.state.balance));
      if ($("#car")) $("#car").scrollLeft = carLeft;
      drawHome();
      const an = S.snap.state.agents.analyst; const rc = $("#ring"); if (rc) Charts.ring(rc, an.last ? an.last.score : null, 70);
      view.querySelectorAll(".ranges button").forEach(b => b.onclick = () => { S.range = b.dataset.r; S.prevPts = 0; render(); });
    }
    if (r === "coin" && S.snap.coins[arg]) {
      const c = S.snap.coins[arg], p = c.position, open = p && p.status !== "closed";
      Charts.candles($("#cnd"), c.candles, open ? (p.floor_line || p.trail_line || p.stop_price) : null, p ? p.entry_price : null);
    }
    if (r === "audit") runBeam(arg);
    const sb = $("#sbtn"); if (sb) sb.onclick = () => { $("#search").classList.toggle("open"); $("#q").focus(); };
    const q = $("#q"); if (q) q.oninput = () => search(q.value);
    bindLinkForm();
    const lc = $("#lcopy"); if (lc) lc.onclick = async () => {
      const ok = S.cfg && await copyText(privateLink());
      const m = $("#lcopymsg"); if (m) { m.textContent = ok ? "Link kopiert ✓ – jetzt die Home-Bildschirm-App öffnen und einfügen." : "Kopieren nicht möglich."; m.style.color = ok ? "#00d35a" : "#ff453a"; }
    };
    const fg = $("#forget"); if (fg) fg.onclick = () => { if (confirm("Daten-Link auf diesem Gerät löschen?")) { LS.removeItem("desk.cfg"); LS.removeItem("desk.last"); location.reload(); } };
  }
  function search(t) {
    t = t.trim().toLowerCase(); const out = $("#res"); if (!t) { out.innerHTML = ""; return; }
    const seen = {}, hits = [];
    const add = (m, name, sym) => { if (!m || seen[m]) return; if ((name || "").toLowerCase().includes(t) || (sym || "").toLowerCase().includes(t) || m.toLowerCase().startsWith(t)) { seen[m] = 1; hits.push({ m, name }); } };
    Object.values(S.snap.coins).forEach(c => add(c.mint, c.name, c.symbol));
    Object.values(S.snap.audits).forEach(a => add(a.mint, a.name));
    Object.values(S.snap.decisions).flat().forEach(d => add(d.mint, d.name));
    out.innerHTML = hits.slice(0, 8).map(h => `<a href="${coinHref(h.m) || "#/coin/" + h.m}"><span>${esc(h.name)}</span><span class="ter num">${esc(h.m.slice(0, 4))}…${esc(h.m.slice(-4))}</span></a>`).join("") || '<div class="sec" style="padding:12px 16px">Nicht im Desk-Snapshot</div>';
  }

  /* ---------------- boot ---------------- */
  readFragment(); loadCfg();
  if (isLocal()) { const sim = new URLSearchParams(location.search).get("sim"); if (sim) S.sim = sim; }
  window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  window.addEventListener("resize", () => render());
  S.tick = setInterval(() => { const e = offline(); if (e) { const el = $("#err"); el.textContent = e; el.hidden = false; } }, 1000);
  if ("serviceWorker" in navigator && !isLocal()) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update().catch(() => { })).catch(() => { });
    // new SW took over an already-controlled page -> reload once (guarded per version, no loops)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) return;
      const key = "desk.swReload";
      if (sessionStorage.getItem(key) === APP_VERSION) return;
      sessionStorage.setItem(key, APP_VERSION);
      location.reload();
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => { }); });
  }
  render();
  warmStart().then(() => { render(); poll(); });
})();
