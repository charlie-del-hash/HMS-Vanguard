/* The two figures a reader compares are the ones the window opened and closed
   at, so placement may thin the middle but must never drop an end. Swept over
   every width, both themes and every selection, because the collision set the
   placement runs against is different in each. */
const { browser, newPage, goto } = require("./lib");

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1400 });
  await goto(p, "reports", "equities");
  const tickers = await p.evaluate(() => EQUITIES.map(e => e.tk));
  const widths = [320, 360, 390, 430, 480, 560, 640, 768, 860, 900, 1024, 1100, 1180, 1280, 1366, 1440, 1600, 1720, 1920];
  let charts = 0, short = 0; const bad = [];
  for(const w of widths){
    await p.setViewportSize({ width: w, height: 1400 });
    for(const theme of ["light", "dark"]){
      for(const tk of [null, ...tickers]){
        await p.evaluate(([t, th]) => { S.theme = th; applyTheme(); S.eqSel = t; render(); }, [tk, theme]);
        await p.waitForTimeout(25);
        const res = await p.evaluate(() => {
          const out = [];
          document.querySelectorAll("svg.chart").forEach(svg => {
            const al = svg.getAttribute("aria-label") || "";
            if(!/rebased|weekly close/.test(al)) return;
            out.push([...svg.querySelectorAll("text")]
              .filter(t => !t.closest(".ph") && /^\d+(\.\d)?$/.test(t.textContent)).length);
          });
          return out;
        });
        res.forEach(v => { charts++; if(v < 2){ short += 2 - v; bad.push(`${w} ${theme} sel=${tk} only ${v}`); } });
      }
    }
  }
  console.log(`index-chart anchors: ${charts} chart instances, ${short} anchor figure(s) dropped`);
  bad.slice(0, 10).forEach(x => console.log("  FAIL", x));
  console.log("errs", p.__errs.slice(0, 5));
  await b.close();
  process.exit(short ? 1 : 0);
})();
