/* Chart type size: rendered CSS width / viewBox width must be 1, and every
   font-size x that scale must land in a legible band.
   Chart label collisions: getBBox on every <text>, pairwise overlap. */
const { browser, newPage, VIEWS, WIDTHS } = require('./lib');

const PROBE = () => {
  const scales = [], sizes = [], pairs = [];
  document.querySelectorAll('svg.chart').forEach(svg => {
    const r = svg.getBoundingClientRect();
    const vw = svg.viewBox.baseVal.width;
    if(!r.width || !vw) return;
    const sc = r.width / vw;
    scales.push(+sc.toFixed(4));
    const texts = [];
    svg.querySelectorAll('text').forEach(t => {
      if(t.closest('.ph')) return;               /* transient hover overlay */
      if(!t.textContent.trim()) return;
      const fs = parseFloat(getComputedStyle(t).fontSize);
      sizes.push(+(fs * sc).toFixed(2));
      const bb = t.getBBox();
      texts.push({ t: t.textContent, x1: bb.x, y1: bb.y, x2: bb.x + bb.width, y2: bb.y + bb.height });
    });
    for(let i = 0; i < texts.length; i++) for(let j = i + 1; j < texts.length; j++){
      const a = texts[i], c = texts[j];
      if(a.x1 < c.x2 - 1 && c.x1 < a.x2 - 1 && a.y1 < c.y2 - 1 && c.y1 < a.y2 - 1)
        pairs.push(`${svg.getAttribute('aria-label') || svg.id || '?'}: ${a.t} / ${c.t}`);
    }
  });
  return { scales, sizes, pairs };
};

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1200 });
  const widths = WIDTHS, views = VIEWS;
  let minS = 9, maxS = 0, minF = 999, maxF = 0, n = 0; const pairs = [];
  for(const w of widths){
    await p.setViewportSize({ width: w, height: 1200 });
    for(const theme of ['light', 'dark']){
      for(const [tab, rtab] of views){
        await p.evaluate(([t, r, th]) => { S.theme = th; applyTheme(); S.tab = t; if(r) S.rtab = r; render(); }, [tab, rtab, theme]);
        await p.waitForTimeout(90);
        const res = await p.evaluate(PROBE);
        res.scales.forEach(s => { minS = Math.min(minS, s); maxS = Math.max(maxS, s); n++; });
        res.sizes.forEach(f => { minF = Math.min(minF, f); maxF = Math.max(maxF, f); });
        res.pairs.forEach(x => pairs.push(`${w} ${theme} ${tab}/${rtab} ${x}`));
      }
    }
  }
  console.log(`chart type size: ${n} charts, scale ${minS.toFixed(3)}–${maxS.toFixed(3)}, rendered ${minF}–${maxF}px`);
  console.log(`chart label collisions: ${pairs.length} overlapping pairs`);
  pairs.slice(0, 15).forEach(x => console.log('  ', x));
  console.log('errs', p.__errs.slice(0, 5));
  await b.close();
  process.exit(pairs.length || minS < 0.999 || maxS > 1.001 ? 1 : 0);
})();
