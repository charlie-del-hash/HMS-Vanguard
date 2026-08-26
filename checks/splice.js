/* The refresh script rewrites the deck in place, so the splice is the one part
   of it that can do real damage. This runs entirely offline — no provider is
   called — and checks that what goes in comes back out, that the deck still
   parses and renders afterwards, and that a hostile value cannot escape the
   literal it is written into. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { browser, newPage, goto } = require("./lib");
const { spliceFin, readExisting, BEGIN, END } = require("../scripts/refresh-financials");

const DECK = path.resolve(__dirname, "..", "affinity-ops-deck.html");

const FIX = {
  GNK:  { period: "Q2 2026", asOf: "2026-08-05", ccy: "USD",
          revenue: 118400000, ebitda: 41900000, netIncome: -6300000, eps: -0.15,
          src: "SEC EDGAR, 10-Q" },
  "0144": { period: "FY 2026", asOf: "2026-03-28", ccy: "HKD",
          revenue: 8210000000, ebitda: null, netIncome: 1740000000, eps: 0.42,
          src: "Financial Modeling Prep, income statement" }
};

/* a provider is an outside input; a value it returns must not be able to end
   the literal, open a tag, or run */
const HOSTILE = {
  EVIL: { period: 'x"}, alert(1), {"a":"', asOf: "2026-01-01", ccy: "USD",
          revenue: 1, ebitda: null, netIncome: 1, eps: 1,
          src: "*/ } ; window.pwned = 1; /* </script><img src=x onerror=alert(1)>" }
};

(async () => {
  let pass = 0; const fail = [];
  const t = async (n, fn) => { try { await fn(); pass++; } catch (e) { fail.push(n + " :: " + e.message); } };
  const html = fs.readFileSync(DECK, "utf8");

  await t("the deck ships with an empty EQ_FIN", () => {
    assert.deepStrictEqual(readExisting(html), {});
  });
  await t("markers are present and in order", () => {
    assert.ok(html.indexOf(BEGIN) > 0);
    assert.ok(html.indexOf(END) > html.indexOf(BEGIN));
  });
  await t("splice round-trips every field", () => {
    assert.deepStrictEqual(readExisting(spliceFin(html, FIX)), FIX);
  });
  await t("splice is idempotent", () => {
    assert.strictEqual(spliceFin(spliceFin(html, FIX), FIX), spliceFin(html, FIX));
  });
  await t("splice touches nothing outside the markers", () => {
    const out = spliceFin(html, FIX);
    assert.strictEqual(out.slice(0, html.indexOf(BEGIN)), html.slice(0, html.indexOf(BEGIN)));
    assert.strictEqual(out.slice(out.indexOf(END) + END.length), html.slice(html.indexOf(END) + END.length));
  });
  await t("a non-identifier ticker is quoted", () => {
    assert.match(spliceFin(html, FIX), /"0144":\s*\{/);
  });
  await t("clearing back to empty restores the original file", () => {
    assert.strictEqual(spliceFin(spliceFin(html, FIX), {}), spliceFin(html, {}));
  });
  await t("a hostile value cannot escape the literal", () => {
    const out = spliceFin(html, HOSTILE);
    assert.deepStrictEqual(readExisting(out), HOSTILE, "round-trip must survive it verbatim");
    assert.ok(!/<\/script>/i.test(out.slice(out.indexOf(BEGIN), out.indexOf(END))), "closed the script tag");
    assert.ok(!/window\.pwned\s*=/.test(out.slice(0, out.indexOf(BEGIN))), "escaped upward");
  });

  /* and it still has to be a working deck afterwards */
  const spliced = spliceFin(html, FIX);
  const tmp = path.join(require("os").tmpdir(), `deck-splice-${process.pid}.html`);
  fs.writeFileSync(tmp, spliced);
  const b = await browser();
  const http = require("http");
  const srv = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); r.end(spliced); });
  await new Promise(res => srv.listen(0, "127.0.0.1", res));
  const p = await newPage(b, { w: 1440, h: 1200, url: `http://127.0.0.1:${srv.address().port}/deck.html` });

  await t("the spliced deck loads with no errors", async () => {
    assert.deepStrictEqual(p.__errs, [], p.__errs.join(" | "));
  });
  await t("the spliced figures reach the panel", async () => {
    await goto(p, "reports", "equities");
    await p.evaluate(() => { S.eqSel = "GNK"; render(); });
    await p.waitForTimeout(200);
    const dd = await p.evaluate(() => [...document.querySelectorAll(".rep-g dd")].map(x => x.textContent.trim()));
    assert.deepStrictEqual(dd, ["USD 118.4m", "USD 41.9m", "USD -6.3m", "-0.15"], JSON.stringify(dd));
  });
  await t("a null figure renders as a dash, not a zero", async () => {
    await p.evaluate(() => { S.eqSel = "0144"; S.eqSeg = "all"; S.eqQuery = ""; render(); });
    await p.waitForTimeout(200);
    const dd = await p.evaluate(() => [...document.querySelectorAll(".rep-g dd")].map(x => x.textContent.trim()));
    assert.strictEqual(dd[1], "HKD –", JSON.stringify(dd));
  });
  await t("the count reflects what was spliced", async () => {
    const txt = await p.evaluate(() => document.querySelector(".stats-note").textContent.replace(/\s+/g, " "));
    assert.match(txt, /2 of 23 so far/, txt.slice(-140));
  });

  srv.close(); await b.close();
  try { fs.unlinkSync(tmp); } catch {}
  console.log(`splice: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log("  FAIL", f));
  process.exit(fail.length ? 1 : 0);
})();
