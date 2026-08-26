/* WCAG AA over the rendered body — DOM text and SVG text, backgrounds
   composited as far as computed style allows.

   Read this differentially, never absolutely. Gradient backgrounds cannot be
   composited from computed style, so a checker of this kind carries a standing
   set of signatures that are artefacts rather than failures; what matters is
   that the set does not grow between builds. Point DECK_URL at an older copy
   to produce the baseline, then diff:

     DECK_URL=.../old.html node checks/contrast.js > base.json
     node checks/contrast.js > now.json
     node checks/contrast.js --diff base.json now.json

   A gotcha worth keeping: color-mix() computes to `color(srgb 0.94 ...)` with
   0-1 floats, not rgb() with 0-255. A parser that assumes rgb() reads those as
   near-black and reports confident nonsense — it cost a round trip here once,
   claiming 1.89:1 on a tile that measures 4.78:1. */
const { browser, newPage, VIEWS } = require("./lib");
const PROBE = require("./contrast-probe");

if(process.argv[2] === "--diff"){
  const a = require(require("path").resolve(process.argv[3]));
  const b = require(require("path").resolve(process.argv[4]));
  const ka = new Set(a.map(x => x.k)), kb = new Set(b.map(x => x.k));
  const added = [...kb].filter(k => !ka.has(k));
  const gone = [...ka].filter(k => !kb.has(k));
  let worse = 0;
  b.forEach(x => { const o = a.find(y => y.k === x.k); if(o && x.cr < o.cr - 0.01){ worse++; console.log("  worse", x.k, o.cr, "->", x.cr); } });
  console.log(`contrast: baseline ${a.length} signature(s), now ${b.length} — ${added.length} new, ${gone.length} cleared, ${worse} regressed`);
  added.forEach(k => { const x = b.find(y => y.k === k); console.log("  NEW", x.cr, k, JSON.stringify(x.txt)); });
  process.exit(added.length + worse ? 1 : 0);
}

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1000 });
  const sigs = new Map();
  for(const w of [1440, 390]){
    await p.setViewportSize({ width: w, height: 1000 });
    for(const theme of ["light", "dark"]){
      for(const [tab, rtab] of VIEWS){
        await p.evaluate(([t, r, th]) => { S.theme = th; applyTheme(); S.tab = t; if(r) S.rtab = r; render(); }, [tab, rtab, theme]);
        await p.waitForTimeout(110);
        (await p.evaluate(PROBE)).forEach(x => { const k = `${theme}|${x.sig}`; if(!sigs.has(k)) sigs.set(k, x); });
      }
    }
  }
  const out = [...sigs.entries()].map(([k, v]) => ({ k, cr: v.cr, need: v.need, txt: v.txt }))
    .sort((x, y) => x.k < y.k ? -1 : 1);
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
