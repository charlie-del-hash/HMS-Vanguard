/* What a report page must be true about itself.
 *
 * The chart and overflow checks cover how it LOOKS. These cover what it
 * CLAIMS, which for a research funnel is the part that matters:
 *
 *   crawlable    the whole article is text in the HTML with JavaScript off.
 *                This is the entire argument for having left a single
 *                client-rendered file, so it is asserted rather than assumed.
 *   sourced      every figure on the page either cites a source or carries the
 *                indicative chip. checks/sourced.js holds this against the deck
 *                in fourteen assertions; this is the same rule for reports.
 *   honest CTA   the portal link is either real or absent-and-explained. A dead
 *                href is the one thing the funnel's last block may not do.
 *   inert        a payload cannot become markup. The dev block gallery carries
 *                a hostile fixture; none of it may execute or become a tag.
 *
 *   node checks/site-report.js          (SITE_URL from run-site.js)
 */
const { browser, newPage } = require("./lib");
const { trackRequests, reportNoise } = require("./site-lib");

const BASE = process.env.SITE_URL || "http://127.0.0.1:4321";
const REPORT = "/reports/hormuz-strikes-tanker-economics/";
const GALLERY = "/dev/blocks/";

const ELEVEN = [
  "prose", "kpi_row", "chart", "timeline", "map", "table",
  "callout", "quote", "sourcebox", "cta", "embed",
];

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

(async () => {
  const b = await browser();

  /* ── 1. a crawler sees the article ─────────────────────────────────── */
  console.log("a reader with no JavaScript gets the whole report");
  {
    const p = await b.newPage({ javaScriptEnabled: false });
    trackRequests(p);
    await p.goto(BASE + REPORT, { waitUntil: "domcontentloaded" });

    const seen = await p.evaluate((kinds) => {
      const text = document.body.innerText;
      return {
        words: text.split(/\s+/).filter(Boolean).length,
        h1: document.querySelector("h1")?.textContent?.trim() || "",
        kinds: kinds.filter((k) => document.querySelector(`.b-${k}`)),
        charts: document.querySelectorAll("svg.chart").length,
        chartText: document.querySelectorAll("svg.chart text").length,
        ld: document.querySelector('script[type="application/ld+json"]')?.textContent || "",
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") || "",
        desc: document.querySelector('meta[name="description"]')?.getAttribute("content") || "",
        noindex: !!document.querySelector('meta[name="robots"][content*="noindex"]'),
      };
    }, ELEVEN);

    t("the article is real text, not a mount point", seen.words > 500, `only ${seen.words} words`);
    t("the headline is in the HTML", seen.h1.length > 10, `h1 was "${seen.h1}"`);
    t(
      "all eleven block kinds render",
      seen.kinds.length === ELEVEN.length,
      `missing: ${ELEVEN.filter((k) => !seen.kinds.includes(k)).join(", ")}`,
    );
    t("charts are drawn server-side", seen.charts >= 3 && seen.chartText > 40,
      `${seen.charts} charts, ${seen.chartText} labels`);
    t("a report is NOT noindex", !seen.noindex);
    t("there is a canonical URL", /^https?:\/\//.test(seen.canonical), seen.canonical);
    t("there is a meta description", seen.desc.length > 40, `"${seen.desc}"`);

    let ld = null;
    try {
      ld = JSON.parse(seen.ld);
    } catch {
      /* reported below */
    }
    t("structured data parses", !!ld);
    t(
      "its headline matches the page's",
      !!ld && ld.headline === seen.h1,
      ld ? `ld "${ld.headline}" vs h1 "${seen.h1}"` : "no JSON-LD",
    );
    /* An image we do not have would be a claim made to a crawler and not to a
       reader, which is the same lie in a less visible place. */
    t("structured data claims no image it has not got", !ld || !("image" in ld));

    await p.close();
  }

  /* ── 2. every figure says where it came from ───────────────────────── */
  console.log("every figure is sourced or marked indicative");
  {
    const p = await newPage(b, { w: 1280, h: 1400, url: BASE + REPORT });
    trackRequests(p);

    const prov = await p.evaluate(() => {
      const out = { kpis: [], tables: [], charts: [], sourcebox: 0 };
      for (const tile of document.querySelectorAll(".b-kpi_row .tile")) {
        const label = tile.querySelector(".label")?.textContent?.trim() || "?";
        out.kpis.push({ label, ok: !!tile.querySelector(".ind") || !!tile.querySelector(".foot a") });
      }
      for (const fig of document.querySelectorAll(".b-table figure, .b-table .tablewrap")) {
        const cap = fig.querySelector(".cap")?.textContent?.trim().slice(0, 40) || "?";
        out.tables.push({ cap, ok: !!fig.querySelector(".prov") });
      }
      for (const fig of document.querySelectorAll(".b-chart .chartblock")) {
        const cap = fig.querySelector("figcaption")?.textContent?.trim().slice(0, 40) || "?";
        out.charts.push({ cap, ok: !!fig.querySelector(".prov") });
      }
      out.sourcebox = document.querySelectorAll(".b-sourcebox .sources li").length;
      return out;
    });

    const badKpi = prov.kpis.filter((k) => !k.ok);
    const badTable = prov.tables.filter((k) => !k.ok);
    const badChart = prov.charts.filter((k) => !k.ok);

    t(`all ${prov.kpis.length} KPI tiles carry provenance`, badKpi.length === 0,
      badKpi.map((k) => k.label).join(", "));
    t(`all ${prov.tables.length} tables carry provenance`, badTable.length === 0,
      badTable.map((k) => k.cap).join(", "));
    t(`all ${prov.charts.length} charts carry provenance`, badChart.length === 0,
      badChart.map((k) => k.cap).join(", "));
    t("the report ends with a populated source box", prov.sourcebox > 0);

    /* ── 3. the CTA never links nowhere ──────────────────────────────── */
    console.log("the funnel's last block is honest");
    const cta = await p.evaluate(() => {
      const el = document.querySelector(".b-cta .cta");
      if (!el) return null;
      const a = el.querySelector("a.go");
      return {
        hasLink: !!a,
        href: a?.getAttribute("href") || "",
        saysUnset: !!el.querySelector(".unset"),
        target: a ? a.getBoundingClientRect() : null,
      };
    });
    t("there is a CTA", !!cta);
    t(
      "it either links properly or says it is not configured",
      !!cta && ((cta.hasLink && /^https?:\/\//.test(cta.href)) || (!cta.hasLink && cta.saysUnset)),
      cta ? `hasLink=${cta.hasLink} href="${cta.href}" saysUnset=${cta.saysUnset}` : "",
    );
    t(
      "no empty or placeholder href",
      !cta || !cta.hasLink || !["", "#", "https://example.com"].includes(cta.href),
      cta && cta.href,
    );
    if (cta?.hasLink && cta.target) {
      t("the CTA meets the 44px touch target", cta.target.height >= 44,
        `${Math.round(cta.target.height)}px`);
    }

    await p.close();
  }

  /* ── 4. a payload cannot become markup ─────────────────────────────── */
  console.log("a stored payload is text, never markup");
  {
    const p = await newPage(b, { w: 1280, h: 1400, url: BASE + GALLERY });
    trackRequests(p);

    const inert = await p.evaluate(() => {
      const nasty = document.querySelectorAll(".b-prose")[document.querySelectorAll(".b-prose").length - 1];
      const html = nasty ? nasty.innerHTML : "";
      const text = nasty ? nasty.textContent || "" : "";
      return {
        pwned: "__pwned" in window,
        scriptTags: nasty ? nasty.querySelectorAll("script").length : -1,
        imgTags: nasty ? nasty.querySelectorAll("img").length : -1,
        /* Not a string match on innerHTML: correctly-escaped text CONTAINS
           `onerror=` as characters, and asserting on that fails a page that is
           doing exactly the right thing. The question is whether any ELEMENT
           carries an event-handler attribute. */
        handlerAttrs: [...nasty.querySelectorAll("*")].flatMap((el) =>
          [...el.attributes].map((a) => a.name).filter((n) => n.startsWith("on")),
        ),
        /* The javascript: and data: links must be words. The https one must
           still be a working anchor — escaping everything would be safe and
           useless. */
        jsHref: /href="javascript:/i.test(html) || /href="data:/i.test(html),
        goodAnchor: nasty ? nasty.querySelectorAll('a[href^="https://"]').length : 0,
        showsScriptAsText: text.includes("<script>"),
      };
    });

    t("the hostile payload did not execute", inert.pwned === false);
    t("no script element came from a payload", inert.scriptTags === 0, `${inert.scriptTags}`);
    t("no img element came from a payload", inert.imgTags === 0, `${inert.imgTags}`);
    t(
      "no element carries an event-handler attribute",
      inert.handlerAttrs.length === 0,
      inert.handlerAttrs.join(", "),
    );
    t("javascript: and data: links are not anchors", inert.jsHref === false);
    t("an https link still works", inert.goodAnchor === 1, `${inert.goodAnchor} anchors`);
    t("the escaped tag is visible as text", inert.showsScriptAsText);

    fail += reportNoise(p);
    await p.close();
  }

  await b.close();
  console.log(`\nsite-report: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
