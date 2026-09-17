/* Nothing on the site may scroll sideways.
 *
 * The deck's overflow check (checks/overflow.js) holds the same rule for the
 * deck. This one holds it for the pages the Astro build produces, at the same
 * 14 widths in both themes — and, like the deck's, it also checks that no
 * element which is allowed its own horizontal scroller is actually using one
 * inside a panel that should have shed instead.
 *
 * Usage: SITE_URL=http://127.0.0.1:4321 node checks/site-overflow.js
 */
const { browser, newPage, WIDTHS } = require("./lib");
const { trackRequests, reportNoise } = require("./site-lib");

const BASE = process.env.SITE_URL || "http://127.0.0.1:4321";
/* The real pages first — they are the ones a reader sees. The dev sheets stay
   because they exercise every chart kind and every token in one place. */
const PAGES = [
  "/",
  "/reports/",
  "/reports/hormuz-strikes-tanker-economics/",
  "/dev/blocks/",
  "/dev/charts/",
  "/dev/text/",
  "/dev/tokens/",
];

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1000, url: BASE + PAGES[0] });
  trackRequests(p);
  let n = 0;
  const bad = [];

  for (const page of PAGES) {
    for (const theme of ["light", "dark"]) {
      for (const w of WIDTHS) {
        await p.setViewportSize({ width: w, height: 1000 });
        await p.goto(BASE + page, { waitUntil: "networkidle" });
        await p.evaluate((th) => {
          document.documentElement.dataset.theme = th;
        }, theme);
        await p.waitForTimeout(150);
        const res = await p.evaluate(() => {
          const d = document.documentElement;
          const out = { page: d.scrollWidth - d.clientWidth, els: [] };
          for (const el of document.querySelectorAll("*")) {
            if (el.scrollWidth > el.clientWidth + 1) {
              const cs = getComputedStyle(el);
              // A deliberate scroller is fine; anything else is a layout bug.
              if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
              if (cs.overflowX === "clip" || cs.overflowX === "hidden") continue;
              out.els.push(
                `${el.tagName.toLowerCase()}.${el.className || "?"} ${el.scrollWidth}>${el.clientWidth}`,
              );
            }
          }
          return out;
        });
        n++;
        if (res.page > 1) bad.push(`${page} ${theme} ${w}: page scrolls ${res.page}px`);
        res.els.slice(0, 3).forEach((e) => bad.push(`${page} ${theme} ${w}: ${e}`));
      }
    }
  }

  console.log(`overflow: ${n - bad.length}/${n} clean (${PAGES.length} pages x 2 themes x ${WIDTHS.length} widths)`);
  bad.slice(0, 20).forEach((x) => console.log("  ", x));
  const noise = reportNoise(p);
  await b.close();
  process.exit(bad.length || noise ? 1 : 0);
})();
