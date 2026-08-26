/* Viewport x theme x view, and the basket's every-4px sweep.
   Assertions: no .scroll scrolls inside its own panel, and the page never
   scrolls sideways. */
const { browser, newPage, VIEWS, WIDTHS } = require('./lib');

const PROBE = () => {
  const bad = [];
  document.querySelectorAll('.scroll').forEach(n => {
    if(n.scrollWidth > n.clientWidth + 1) bad.push(`${n.id || n.className}: ${n.scrollWidth}>${n.clientWidth}`);
  });
  const de = document.documentElement;
  if(de.scrollWidth > de.clientWidth + 1) bad.push(`page: ${de.scrollWidth}>${de.clientWidth}`);
  if(document.body.scrollWidth > de.clientWidth + 1) bad.push(`body: ${document.body.scrollWidth}>${de.clientWidth}`);
  return bad;
};

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1000 });

  // --- 1. viewport x theme x view -------------------------------------
  const widths = WIDTHS, views = VIEWS;
  let cases = 0; const fails = [];
  for(const w of widths){
    await p.setViewportSize({ width: w, height: 1000 });
    for(const theme of ['light', 'dark']){
      for(const [tab, rtab] of views){
        await p.evaluate(([t, r, th]) => { S.theme = th; applyTheme(); S.tab = t; if(r) S.rtab = r; render(); }, [tab, rtab, theme]);
        await p.waitForTimeout(70);
        cases++;
        const bad = await p.evaluate(PROBE);
        if(bad.length) fails.push(`${w} ${theme} ${tab}/${rtab} :: ${bad.join(', ')}`);
      }
    }
  }
  console.log(`viewport x theme x view: ${cases - fails.length}/${cases}`);
  fails.slice(0, 12).forEach(f => console.log('  FAIL', f));

  // --- 2. basket sweep, every 4px, panel open and folded ---------------
  await p.evaluate(() => { S.theme = 'light'; applyTheme(); S.tab = 'reports'; S.rtab = 'equities'; S.eqSeg = 'all'; S.eqQuery = ''; S.eqSel = 'FRO'; render(); });
  let sweep = 0; const sfails = [];
  for(const panel of [true, false]){
    await p.evaluate(v => { S.eqPanel = v; render(); }, panel);
    for(let w = 320; w <= 1920; w += 4){
      await p.setViewportSize({ width: w, height: 1000 });
      await p.evaluate(() => render());
      sweep++;
      const bad = await p.evaluate(PROBE);
      if(bad.length) sfails.push(`${w} panel=${panel} :: ${bad.join(', ')}`);
    }
  }
  console.log(`basket width sweep: ${sweep - sfails.length}/${sweep}`);
  sfails.slice(0, 12).forEach(f => console.log('  FAIL', f));
  console.log('errs', p.__errs.slice(0, 5));
  await b.close();
  process.exit(fails.length + sfails.length ? 1 : 0);
})();
