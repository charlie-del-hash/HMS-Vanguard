/* Render scripts/og-card.html to public/og.png at 1200x630.
 *
 * ── why this is a script and not a build step ─────────────────────────
 * The card is a static image that changes when the tagline changes, which is
 * roughly never. Generating it during `npm run build` would put Playwright in
 * the deploy build's dependency path — and checks/vercel-output.js asserts the
 * opposite, because a headless browser downloaded on every deployment is ~300MB
 * of install time for a file that has not changed since the last one.
 *
 * So: run it by hand, commit the PNG beside its source.
 *
 *   npm run og
 *
 * Playwright and Chromium are already devDependencies — the check suites drive
 * a real browser — so this adds no dependency at all, at build time or at
 * runtime. That was the constraint: a share card with nothing new installed.
 *
 * 1200x630 is the size every platform crops from: Open Graph's documented
 * minimum for a large card, Twitter's summary_large_image, LinkedIn and Slack.
 * deviceScaleFactor stays 1 — a 2x card is 4x the bytes for a picture that is
 * displayed at about 500px wide in every timeline that renders it.
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const source = fileURLToPath(new URL("scripts/og-card.html", root));
const out = fileURLToPath(new URL("public/og.jpg", root));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
});
await page.goto(`file://${source}`);
/* The card is one <h1> in a system font stack. Waiting on fonts.ready rather
   than a timeout means the screenshot cannot catch a fallback face mid-swap,
   which is the one way this silently produces a wrong-looking image. */
await page.evaluate(() => document.fonts.ready);
/* JPEG, not PNG. The card's background is a two-stop gradient plus a radial
   wash, which is the worst case for PNG's palette compression — the same image
   is 305KB as a PNG and about a fifth of that as a quality-90 JPEG, with no
   visible difference on a smooth gradient and no text artefacts at this size.
   Every platform that reads og:image accepts JPEG. */
await page.screenshot({ path: out, type: "jpeg", quality: 90 });
await browser.close();

const kb = Math.round(statSync(out).size / 1024);
console.log(`[make-og] wrote public/og.jpg — 1200x630, ${kb}KB`);
if (kb > 300) {
  console.warn(
    `[make-og] that is large for a card. Slack and X re-fetch it on every share; ` +
      `keep it under ~300KB or the preview arrives after the reader has scrolled past.`,
  );
}
