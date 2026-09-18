/* The chart guarantee, held against the SITE rather than the deck.
 *
 * Same two assertions checks/charts.js makes about the deck, because they are
 * the whole reason the chart layer is built the way it is:
 *
 *   scale   rendered CSS width / viewBox width must be 1.000. A font-size
 *           inside a scaled viewBox is not a size, it is a ratio.
 *   size    every rendered label must land in 8.5–13px. Drawn at true size,
 *           crowding is real, so charts thin their labels instead of shrinking
 *           them — and this is what proves they did.
 *   pairs   getBBox on every <text>, pairwise. Zero overlaps.
 *
 * It additionally checks the thing the deck never had to: that the SERVER's
 * frame is present before any JavaScript runs, and that the client's second
 * pass corrects it rather than replacing it with something different.
 *
 * Usage: SITE_URL=http://127.0.0.1:4321 node checks/site-charts.js
 *        (or let checks/run-site.js serve dist/ and pass it in)
 */
const { browser, newPage, WIDTHS } = require("./lib");
const { trackRequests, reportNoise } = require("./site-lib");

const BASE = process.env.SITE_URL || "http://127.0.0.1:4321";
/* The dev sheet has every chart kind; the report has the ones a reader
   actually meets, in the lanes they actually sit in. Both are checked, because
   a chart that holds its guarantee in a gallery and loses it in an article has
   not held it. */
const PAGES = ["/dev/charts/", "/reports/hormuz-strikes-tanker-economics/"];

const PROBE = () => {
  const scales = [], sizes = [], pairs = [];
  document.querySelectorAll("svg.chart").forEach((svg) => {
    const r = svg.getBoundingClientRect();
    const vw = svg.viewBox.baseVal.width;
    if (!r.width || !vw) return;
    const sc = r.width / vw;
    scales.push(+sc.toFixed(4));
    const texts = [];
    svg.querySelectorAll("text").forEach((t) => {
      if (t.closest(".ph")) return; /* transient hover overlay */
      if (!t.textContent.trim()) return;
      const fs = parseFloat(getComputedStyle(t).fontSize);
      sizes.push(+(fs * sc).toFixed(2));
      const bb = t.getBBox();
      texts.push({ t: t.textContent, x1: bb.x, y1: bb.y, x2: bb.x + bb.width, y2: bb.y + bb.height });
    });
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], c = texts[j];
        if (a.x1 < c.x2 - 1 && c.x1 < a.x2 - 1 && a.y1 < c.y2 - 1 && c.y1 < a.y2 - 1)
          pairs.push(`${svg.getAttribute("aria-label") || "?"}: ${a.t} / ${c.t}`);
      }
  });
  return { scales, sizes, pairs };
};

(async () => {
  const b = await browser();
  let fails = 0;

  /* ── 1. the server's frame is in the HTML ───────────────────────────
     A crawler and a reader with no JavaScript both see this and nothing
     else, so it has to be a real chart rather than an empty slot. */
  {
    const p = await b.newPage({ javaScriptEnabled: false });
    trackRequests(p);
    await p.goto(BASE + PAGES[0], { waitUntil: "domcontentloaded" });
    const n = await p.evaluate(() => ({
      svgs: document.querySelectorAll("svg.chart").length,
      texts: document.querySelectorAll("svg.chart text").length,
      paths: document.querySelectorAll("svg.chart path").length,
    }));
    const ok = n.svgs >= 6 && n.texts > 40 && n.paths > 6;
    console.log(
      `server frame (JS off): ${n.svgs} charts, ${n.texts} labels, ${n.paths} paths — ${ok ? "ok" : "FAIL"}`,
    );
    if (!ok) fails++;
    await p.close();
  }

  /* ── 2. scale, type size and collisions across the sweep ──────────── */
  /* newPage navigates on creation, so it is pointed at the site rather than
     letting it default to the deck. */
  const p = await newPage(b, { w: 1440, h: 1200, url: BASE + PAGES[0] });
  trackRequests(p);
  let minS = 9, maxS = 0, minF = 999, maxF = 0, n = 0;
  const pairs = [];
  for (const w of WIDTHS) {
    await p.setViewportSize({ width: w, height: 1200 });
    for (const theme of ["light", "dark"]) {
      for (const page of PAGES) {
        await p.goto(BASE + page, { waitUntil: "networkidle" });
        await p.evaluate((th) => {
          document.documentElement.dataset.theme = th;
        }, theme);
        await p.waitForTimeout(160);
        const res = await p.evaluate(PROBE);
        res.scales.forEach((s) => {
          minS = Math.min(minS, s);
          maxS = Math.max(maxS, s);
          n++;
        });
        res.sizes.forEach((f) => {
          minF = Math.min(minF, f);
          maxF = Math.max(maxF, f);
        });
        res.pairs.forEach((x) => pairs.push(`${w} ${theme} ${page} ${x}`));
      }
    }
  }
  console.log(
    `chart type size: ${n} charts, scale ${minS.toFixed(3)}–${maxS.toFixed(3)}, rendered ${minF}–${maxF}px`,
  );
  console.log(`chart label collisions: ${pairs.length} overlapping pairs`);
  pairs.slice(0, 15).forEach((x) => console.log("  ", x));

  if (minS < 0.999 || maxS > 1.001) {
    console.log("  FAIL: scale is not 1.000 — a chart is being scaled rather than drawn at size");
    fails++;
  }
  if (minF < 8.5 || maxF > 13.001) {
    console.log(`  FAIL: rendered type outside 8.5–13px (${minF}–${maxF})`);
    fails++;
  }
  if (pairs.length) fails++;

  /* ── 3. the second pass corrects, it does not replace ──────────────
     The server draws at a declared width; the client redraws at the real one.
     Both must be the same chart — same kind, same series, same labels — or
     the reader sees one thing before hydration and another after. */
  {
    await p.setViewportSize({ width: 1280, height: 1200 });
    await p.goto(BASE + PAGES[0], { waitUntil: "domcontentloaded" });
    const before = await p.evaluate(() =>
      [...document.querySelectorAll("svg.chart")].map((s) => s.getAttribute("aria-label")),
    );
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(250);
    const after = await p.evaluate(() =>
      [...document.querySelectorAll("svg.chart")].map((s) => s.getAttribute("aria-label")),
    );
    const same = before.length === after.length && before.every((x, i) => x === after[i]);
    console.log(
      `second pass: ${before.length} charts before, ${after.length} after, labels ${same ? "identical" : "CHANGED"}`,
    );
    if (!same) {
      before.forEach((x, i) => {
        if (x !== after[i]) console.log(`   ${i}: ${x}\n    -> ${after[i]}`);
      });
      fails++;
    }
  }

  fails += reportNoise(p);
  await b.close();
  process.exit(fails ? 1 : 0);
})();
