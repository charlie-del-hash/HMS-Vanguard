/* WCAG AA over the Astro site, at two widths in both themes.
 *
 * The deck has had a contrast check since before this site existed
 * (checks/contrast.js), and the site inherited the deck's tokens — so the
 * reasoning was that it must be fine. "Inherited, therefore fine" is the
 * assumption this whole audit kept disproving, and the site does not only use
 * inherited tokens: it composes them differently (--small on --tint, chart text
 * on a panel, a chip on a card) and those compositions are new.
 *
 * ── absolute here, differential on the deck ───────────────────────────
 * checks/contrast.js prints signatures and is read as a diff against a
 * baseline, because the deck has gradient backgrounds that cannot be
 * composited from computed style and so produce standing false failures.
 *
 * This site has no gradient behind text. That means every signature the probe
 * returns here is a real one, and this check can do what the deck's cannot:
 * fail outright. If a gradient ever lands behind text on this site, this check
 * will start failing and the honest fix is to give it a solid backdrop rather
 * than to add an exception here.
 *
 *   SITE_URL=http://127.0.0.1:4321 node checks/site-contrast.js
 */
const { browser, newPage } = require("./lib");
const PROBE = require("./contrast-probe");

const BASE = process.env.SITE_URL || "http://127.0.0.1:4321";

/* The reader-facing pages, then the dev sheets — the sheets are where every
   chart kind and every token appear at once, so they catch a token that only
   goes wrong in a combination no report happens to use yet. */
const PAGES = [
  "/",
  "/reports/",
  "/reports/hormuz-strikes-tanker-economics/",
  "/privacy/",
  "/404.html",
  "/dev/blocks/",
  "/dev/charts/",
  "/dev/text/",
  "/dev/tokens/",
];

/* 1440 for the desk, 390 for a phone. The widths matter because type scales
   with clamp() — a heading that passes at 3:1 as large text at 1440 may drop
   below 18.66px at 390 and need 4.5:1. */
const WIDTHS = [1440, 390];

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: WIDTHS[0], h: 1000, url: BASE + PAGES[0] });

  const found = new Map();
  let measured = 0;
  const broken = [];

  for (const page of PAGES) {
    for (const w of WIDTHS) {
      await p.setViewportSize({ width: w, height: 1000 });
      const nav = await p.goto(BASE + page, { waitUntil: "networkidle" });
      /* A 404 has excellent contrast. Assert the page is really there, for the
         same reason site-overflow does. */
      if (!nav || nav.status() !== 200) {
        broken.push(`${page} ${w}: returned ${nav ? nav.status() : "no response"}`);
        continue;
      }
      for (const theme of ["light", "dark"]) {
        await p.evaluate((th) => {
          document.documentElement.dataset.theme = th;
        }, theme);
        await p.waitForTimeout(120);
        measured++;
        for (const x of await p.evaluate(PROBE)) {
          const key = `${theme}|${x.sig}`;
          if (!found.has(key)) found.set(key, { ...x, theme, page, w });
        }
      }
    }
  }

  await b.close();

  const fails = [...found.values()].sort((a, c) => a.cr - c.cr);
  console.log(
    `site-contrast: ${measured} page-renders measured ` +
      `(${PAGES.length} pages x ${WIDTHS.length} widths x 2 themes), ` +
      `${fails.length} failing text run(s)`,
  );
  for (const f of fails.slice(0, 25)) {
    console.log(`  ${f.cr}:1 (needs ${f.need}) ${f.theme} ${f.page} @${f.w}  ${JSON.stringify(f.txt)}`);
    console.log(`      ${f.sig}`);
  }
  if (fails.length > 25) console.log(`  … and ${fails.length - 25} more`);
  for (const b2 of broken) console.log(`  FAIL  ${b2}`);

  process.exit(fails.length || broken.length ? 1 : 0);
})();
