/* The sourced layer: EQ_IR and EQ_FIN are empty in the repo, so the deck has
   to be identical without them and correct with them. Both halves are checked
   here against an injected fixture — that is the whole contract the refresh
   job writes to. */
const { browser, newPage, goto, stateOf } = require("./lib");
const assert = require("assert");

const FIXTURE = {
  ir:  { GNK: { name: "Genco Shipping & Trading", url: "https://www.gencoshipping.com/investors/" } },
  fin: { GNK: { period: "Q2 2026", asOf: "2026-08-05", ccy: "USD",
                revenue: 118_400_000, ebitda: 41_900_000, netIncome: -6_300_000, eps: -0.15,
                src: "SEC EDGAR, 10-Q" } }
};

(async () => {
  const b = await browser();
  const p = await newPage(b, { w: 1440, h: 1200 });
  let pass = 0; const fail = [];
  const t = async (n, fn) => { try { await fn(); pass++; } catch(e){ fail.push(n + " :: " + e.message); } };

  await goto(p, "reports", "equities");

  /* ── empty: the deck must look exactly as it did ── */
  await t("EQ_IR and EQ_FIN ship empty", async () => {
    const n = await stateOf(p, "Object.keys(EQ_IR).length + Object.keys(EQ_FIN).length");
    assert.strictEqual(n, 0, "the repo must not carry fetched data by hand");
  });
  await t("no reported block when there is no data", async () => {
    await p.evaluate(() => { S.eqSel = "GNK"; render(); });
    await p.waitForTimeout(150);
    assert.strictEqual((await p.$$(".reported")).length, 0);
    assert.strictEqual((await p.$$(".irlink")).length, 0);
  });
  await t("the tab note claims no sourcing when there is none", async () => {
    const txt = await p.evaluate(() => document.querySelector(".stats-note").textContent);
    assert.doesNotMatch(txt, /so far/, txt.slice(0, 120));
  });
  await t("the Source row still says indicative", async () => {
    const txt = await p.evaluate(() => document.querySelector(".gov").textContent);
    assert.match(txt, /Indicative placeholder, not a live feed/);
  });

  /* ── with data ── */
  await p.evaluate(f => { Object.assign(EQ_IR, f.ir); Object.assign(EQ_FIN, f.fin); render(); }, FIXTURE);
  await p.waitForTimeout(200);

  await t("the reported block appears for a sourced name", async () => {
    assert.strictEqual((await p.$$(".reported")).length, 1);
  });
  await t("all four headline figures render, scaled", async () => {
    const dd = await p.evaluate(() => [...document.querySelectorAll(".rep-g dd")].map(x => x.textContent.trim()));
    assert.deepStrictEqual(dd, ["USD 118.4m", "USD 41.9m", "USD -6.3m", "-0.15"], JSON.stringify(dd));
  });
  await t("a loss is coloured as one", async () => {
    const neg = await p.evaluate(() => [...document.querySelectorAll(".rep-g dd")].filter(x => x.classList.contains("neg-txt")).length);
    assert.strictEqual(neg, 2, "net income and EPS are both negative in the fixture");
  });
  await t("the period and the reporting date are shown", async () => {
    const txt = await p.evaluate(() => document.querySelector(".reported").textContent);
    assert.match(txt, /Q2 2026/);
    assert.match(txt, /5 Aug 2026/, txt);
    assert.match(txt, /SEC EDGAR, 10-Q/);
  });
  await t("the Source row switches to naming the filing", async () => {
    const txt = await p.evaluate(() => document.querySelector(".gov").textContent.replace(/\s+/g, " "));
    assert.match(txt, /Genco Shipping .*own, as reported for Q2 2026/, txt.slice(0, 200));
    assert.match(txt, /still indicative placeholder/);
  });
  await t("the tab note counts the sourced names", async () => {
    const txt = await p.evaluate(() => document.querySelector(".stats-note").textContent.replace(/\s+/g, " "));
    assert.match(txt, /1 of 23 so far/, txt.slice(-140));
  });

  /* ── the outbound link ── */
  await t("the IR link points at the curated https URL", async () => {
    const a = await p.evaluate(() => { const el = document.querySelector(".irlink");
      return { href: el.getAttribute("href"), rel: el.getAttribute("rel"), target: el.getAttribute("target") }; });
    assert.strictEqual(a.href, FIXTURE.ir.GNK.url);
    assert.strictEqual(a.target, "_blank");
    assert.match(a.rel, /noopener/);
    assert.match(a.rel, /noreferrer/);
  });
  await t("every outbound link in the deck is https and safe", async () => {
    const bad = await p.evaluate(() => [...document.querySelectorAll('a[href^="http"]')]
      .filter(a => !/^https:\/\//.test(a.getAttribute("href"))
                || a.getAttribute("target") !== "_blank"
                || !/noopener/.test(a.getAttribute("rel") || ""))
      .map(a => a.getAttribute("href")));
    assert.deepStrictEqual(bad, []);
  });
  await t("a non-https IR url is refused rather than rendered", async () => {
    await p.evaluate(() => { EQ_IR.GNK = { name: "x", url: "javascript:alert(1)" }; render(); });
    await p.waitForTimeout(150);
    assert.strictEqual((await p.$$(".irlink")).length, 0, "javascript: url reached the DOM");
    assert.strictEqual((await p.$$(".reported")).length, 1, "the figures should survive a bad link");
  });

  await t("no page errors", async () => assert.deepStrictEqual(p.__errs, [], p.__errs.join(" | ")));

  console.log(`sourced figures: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log("  FAIL", f));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
