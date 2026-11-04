/* Hand-drawn canvas charts. No library. devicePixelRatio aware. */
(function () {
  const C = { green: "#00d35a", red: "#ff453a", blue: "#0a84ff", orange: "#ff9f0a", cyan: "#64d2ff",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)", card2: "#2c2c2e" };
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1, r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* Line chart: points [[ts,v]], start value (dashed), marks [{ts,kind,text}] */
  function line(canvas, points, start, marks, opt) {
    opt = opt || {};
    const { ctx, w, h } = setup(canvas);
    const top = 44, bot = 12;
    const vals = points.map(p => p[1]).concat(start != null ? [start] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const t0 = opt.t0 != null ? opt.t0 : (points.length ? points[0][0] : 0);
    const t1 = opt.t1 != null ? opt.t1 : (points.length ? points[points.length - 1][0] : 1);
    const X = t => (t1 > t0 ? (t - t0) / (t1 - t0) : 1) * (w - 8) + 4;
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (h - top - bot);
    // dashed start line
    if (start != null) {
      ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.restore();
    }
    if (points.length < 2) return { X, Y };
    const prog = opt.progress == null ? 1 : opt.progress; // 0..1 slide-in of the newest point
    const pts = points.map((p, i) => [X(p[0]), Y(p[1])]);
    if (prog < 1 && pts.length > 2) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      pts[pts.length - 1] = [a[0] + (b[0] - a[0]) * prog, a[1] + (b[1] - a[1]) * prog];
    }
    const g = ctx.createLinearGradient(0, top, 0, h);
    g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.beginPath(); ctx.moveTo(pts[0][0], h);
    pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    // marks above the line; a later mark that would overlap moves up a row
    const placed = []; ctx.font = "600 12px -apple-system, system-ui, sans-serif"; ctx.textBaseline = "middle";
    (marks || []).filter(m => m.ts >= t0 && m.ts <= t1).sort((a, b) => a.ts - b.ts).forEach(m => {
      const x = X(m.ts); const tw = ctx.measureText(m.text).width + 14;
      const bx = Math.min(Math.max(2, x - tw / 2), w - tw - 2);
      let row = 0;
      while (placed.some(p => p.row === row && !(bx + tw < p.x || bx > p.x + p.w))) row++;
      placed.push({ x: bx, w: tw, row });
      const col = m.kind === "buy" ? C.blue : m.kind === "win" ? C.green : C.red;
      const near = points.reduce((a, p) => Math.abs(p[0] - m.ts) < Math.abs(a[0] - m.ts) ? p : a, points[0]);
      const ly = Y(near[1]); const by = Math.max(2, Math.min(ly - 30, top - 22) - row * 22);
      ctx.globalAlpha = opt.markAlpha == null ? 1 : opt.markAlpha;
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, by + 18); ctx.lineTo(x, ly); ctx.stroke();
      ctx.fillStyle = col; roundRect(ctx, bx, by, tw, 18, 9); ctx.fill();
      ctx.fillStyle = m.kind === "buy" ? "#fff" : "#000"; ctx.fillText(m.text, bx + 7, by + 9.5);
      ctx.globalAlpha = 1;
    });
    // last dot
    const l = pts[pts.length - 1]; ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(l[0], l[1], 3.5, 0, 7); ctx.fill();
    return { X, Y };
  }

  /* Candles [[t,o,h,l,c,vol]], exitLine (orange dashed), entry (ter dashed) */
  function candles(canvas, cs, exitLine, entry) {
    const { ctx, w, h } = setup(canvas);
    const volH = 44, top = 10, bot = volH + 10;
    if (!cs.length) return;
    let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
    [exitLine, entry].forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (hi - lo < 1e-15) { hi *= 1.01; lo *= 0.99; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
    const n = Math.max(cs.length, 30), cw = (w - 8) / n;
    const Y = v => top + (1 - (v - lo) / (hi - lo)) * (h - top - bot);
    const vmax = Math.max(1e-9, ...cs.map(c => c[5] || 0));
    cs.forEach((c, i) => {
      const x = 4 + (n - cs.length + i) * cw + cw / 2, up = c[4] >= c[1], col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
      ctx.fillRect(x - Math.max(1, cw * 0.32), y1, Math.max(2, cw * 0.64), Math.max(1, y2 - y1));
      const vh = (c[5] || 0) / vmax * volH;
      ctx.globalAlpha = 0.45; ctx.fillRect(x - Math.max(1, cw * 0.32), h - vh, Math.max(2, cw * 0.64), vh); ctx.globalAlpha = 1;
    });
    const dash = (v, col, label) => {
      if (v == null) return;
      ctx.save(); ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(w, Y(v)); ctx.stroke(); ctx.restore();
      if (label) { ctx.font = "600 11px -apple-system, system-ui, sans-serif"; ctx.fillStyle = col; ctx.fillText(label, 6, Y(v) - 6); }
    };
    dash(entry, C.ter, "Entry"); dash(exitLine, C.orange, "Risk trailing stop");
  }

  /* Score ring 0-100, green from `pass` */
  function ring(canvas, score, pass) {
    const { ctx, w, h } = setup(canvas);
    const r = Math.min(w, h) / 2 - 7, cx = w / 2, cy = h / 2;
    ctx.lineWidth = 10; ctx.lineCap = "round"; ctx.strokeStyle = C.card2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    if (score != null) {
      ctx.strokeStyle = score >= (pass || 70) ? C.green : "#ffd60a";
      ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); ctx.stroke();
    }
    ctx.fillStyle = "#fff"; ctx.font = "600 30px -apple-system, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(score == null ? "–" : String(score), cx, cy + 1);
  }

  window.Charts = { line, candles, ring, reduced };
})();
