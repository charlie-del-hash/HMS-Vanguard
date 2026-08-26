/* Index-chart label placement. Every <text> in the coverage basket and the
   side-panel chart is tested against both series' stroked geometry, the rebase
   rule, the other labels and the frame — the crosshair layer is excluded,
   because it is a transient overlay that is meant to sit on top.
   Swept over every selection, because the overlay's shape is the selection. */
const { browser, newPage, goto, WIDTHS } = require("./lib");

const PROBE = () => {
  const out = [];
  const pathPts = d => {
    const pts = [];
    d.replace(/([ML])\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g, (_, c, x, y) => { pts.push([+x, +y]); return ""; });
    return pts;
  };
  const segHitsRect = (p, q, r) => {
    const inside = t => t[0] >= r.x1 && t[0] <= r.x2 && t[1] >= r.y1 && t[1] <= r.y2;
    if(inside(p) || inside(q)) return true;
    const ccw = (a, b, c) => (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
    const cross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
    const k = [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]];
    for(let i = 0; i < 4; i++) if(cross(p, q, k[i], k[(i + 1) % 4])) return true;
    return false;
  };
  document.querySelectorAll("svg.chart").forEach(svg => {
    const label = svg.getAttribute("aria-label") || "";
    if(!/rebased|weekly close/.test(label)) return;
    const vb = svg.viewBox.baseVal;
    const texts = [...svg.querySelectorAll("text")].filter(t => !t.closest(".ph") && t.textContent.trim())
      .map(t => { const b = t.getBBox();
        return { t: t.textContent, x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }; });
    const lines = [];
    svg.querySelectorAll("path[stroke], line[stroke]").forEach(el => {
      if(el.closest(".ph")) return;
      if(el.tagName === "line"){
        lines.push([[+el.getAttribute("x1"), +el.getAttribute("y1")], [+el.getAttribute("x2"), +el.getAttribute("y2")]]);
      } else {
        const p = pathPts(el.getAttribute("d"));
        for(let i = 0; i < p.length - 1; i++) lines.push([p[i], p[i + 1]]);
      }
    });
    const hits = [];
    texts.forEach(tb => {
      const r = { x1: tb.x1 + 1, y1: tb.y1 + 1, x2: tb.x2 - 1, y2: tb.y2 - 1 };
      if(lines.some(([p, q]) => segHitsRect(p, q, r))) hits.push({ kind: "line", t: tb.t });
      if(tb.x1 < -0.5 || tb.x2 > vb.width + 0.5 || tb.y1 < -0.5 || tb.y2 > vb.height + 0.5)
        hits.push({ kind: "frame", t: tb.t });
    });
    for(let i = 0; i < texts.length; i++) for(let j = i + 1; j < texts.length; j++){
      const a = texts[i], c = texts[j];
      if(a.x1 < c.x2 - 1 && c.x1 < a.x2 - 1 && a.y1 < c.y2 - 1 && c.y1 < a.y2 - 1)
        hits.push({ kind: "text", t: `${a.t} / ${c.t}` });
    }
    if(hits.length) out.push({ chart: label.slice(0, 44), hits });
  });
  return out;
};

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1400 });
  await goto(p, "reports", "equities");
  const tickers = await p.evaluate(() => EQUITIES.map(e => e.tk));
  const segs = await p.evaluate(() => ["all", ...EQ_SEGS.map(g => g.k)]);
  let n = 0; const bad = [];
  for(const w of WIDTHS){
    await p.setViewportSize({ width: w, height: 1400 });
    for(const tk of [null, ...tickers]){
      await p.evaluate(t => { S.eqSel = t; S.eqSeg = "all"; render(); }, tk);
      await p.waitForTimeout(25);
      n++;
      (await p.evaluate(PROBE)).forEach(r => bad.push(`${w} sel=${tk} ${r.chart} ${JSON.stringify(r.hits)}`));
    }
  }
  for(const w of [390, 900, 1440]){
    await p.setViewportSize({ width: w, height: 1400 });
    for(const g of segs){
      await p.evaluate(x => { S.eqSeg = x; S.eqSel = null; render(); }, g);
      await p.waitForTimeout(25);
      n++;
      (await p.evaluate(PROBE)).forEach(r => bad.push(`${w} seg=${g} ${r.chart} ${JSON.stringify(r.hits)}`));
    }
  }
  console.log(`index-chart labels: ${n - bad.length}/${n} renders clean (text on line, text on text, out of frame)`);
  bad.slice(0, 15).forEach(x => console.log("  FAIL", x));
  console.log("errs", p.__errs.slice(0, 5));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
