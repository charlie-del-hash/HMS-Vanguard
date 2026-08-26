#!/usr/bin/env node
/* Refresh the basket's headline reported figures.
 *
 *   node scripts/refresh-financials.js --dry-run     # fetch, print, write nothing
 *   node scripts/refresh-financials.js               # fetch and splice into the deck
 *
 * The deck is one self-contained file with no build step, and this keeps it
 * that way: rather than the page fetching JSON at load, this script rewrites
 * the EQ_FIN literal in place and the commit is what deploys. Refreshing the
 * feed stays a data change, exactly like RATES and FFA.
 *
 * Two providers, because no single free and official source covers the nine
 * exchanges this basket spans:
 *
 *   edgar  SEC EDGAR XBRL companyfacts. Free, keyless, and the figures are
 *          tagged in the company's own filing — as close to the original as
 *          this gets. Covers the 13 US-listed names.
 *   fmp    A licensed aggregator for the other ten. Needs FMP_API_KEY.
 *
 * What it will not do: invent. A figure it cannot find is written as null and
 * the panel renders an en dash. A name whose fetch fails keeps whatever it had
 * rather than being blanked, so one provider outage cannot quietly empty the
 * tab.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DECK = path.join(ROOT, "affinity-ops-deck.html");
const SOURCES = path.join(ROOT, "scripts", "sources.json");
const BEGIN = "/* EQ_FIN:BEGIN";
const END = "/* EQ_FIN:END */";

/* SEC asks for a declared User-Agent with a contact address and no more than
   ten requests a second. Both are conditions of use, not suggestions. */
const UA = process.env.SEC_USER_AGENT
  || "affinity-ops-deck (set SEC_USER_AGENT to name and email)";
const SLEEP_MS = 120;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/* ── EDGAR ────────────────────────────────────────────────────────────────
   companyfacts returns every tagged fact the filer has ever reported, keyed
   by taxonomy then tag then unit. Two things make the extraction fiddly and
   are worth knowing before changing it:

   Foreign private issuers file under IFRS, so the tag names differ from the
   US-GAAP ones — most of this basket is Greek, Norwegian, Cypriot or Bermudan,
   so the IFRS names are the common case here, not the exception.

   EBITDA is not a tag in either taxonomy. It is derived, and the derivation is
   stated in the output so nobody mistakes it for something the company filed.  */
const TAGS = {
  revenue: [
    ["us-gaap", "Revenues"],
    ["us-gaap", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    ["us-gaap", "RevenueFromContractWithCustomerIncludingAssessedTax"],
    ["ifrs-full", "Revenue"],
    ["ifrs-full", "RevenueFromContractsWithCustomers"]
  ],
  netIncome: [
    ["us-gaap", "NetIncomeLoss"],
    ["us-gaap", "ProfitLoss"],
    ["ifrs-full", "ProfitLoss"],
    ["ifrs-full", "ProfitLossAttributableToOwnersOfParent"]
  ],
  operating: [
    ["us-gaap", "OperatingIncomeLoss"],
    ["ifrs-full", "ProfitLossFromOperatingActivities"]
  ],
  da: [
    ["us-gaap", "DepreciationDepletionAndAmortization"],
    ["us-gaap", "DepreciationAndAmortization"],
    ["ifrs-full", "DepreciationAndAmortisationExpense"]
  ],
  eps: [
    ["us-gaap", "EarningsPerShareDiluted"],
    ["us-gaap", "EarningsPerShareBasicAndDiluted"],
    ["us-gaap", "EarningsPerShareBasic"],
    ["ifrs-full", "DilutedEarningsLossPerShare"],
    ["ifrs-full", "BasicEarningsLossPerShare"]
  ]
};

/* the most recently *filed* observation, preferring a quarter over a year so
   the panel shows the latest print rather than the last annual report */
function latestFact(facts, candidates) {
  let best = null;
  for (const [tax, tag] of candidates) {
    const units = facts?.[tax]?.[tag]?.units;
    if (!units) continue;
    for (const unit of Object.keys(units)) {
      for (const o of units[unit]) {
        if (o.val == null || !o.end || !o.filed) continue;
        if (o.form && !/^(10-Q|10-K|20-F|6-K|40-F)/.test(o.form)) continue;
        const cand = { val: o.val, end: o.end, filed: o.filed, form: o.form, fp: o.fp, fy: o.fy, unit, tag };
        if (!best || cand.filed > best.filed || (cand.filed === best.filed && cand.end > best.end)) best = cand;
      }
    }
  }
  return best;
}

const periodLabel = f =>
  !f ? null
    : f.fp && f.fp !== "FY" && f.fy ? `${f.fp} ${f.fy}`
    : f.fy ? `FY ${f.fy}`
    : String(f.end).slice(0, 7);

async function fromEdgar(cik) {
  const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
  const data = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
  const facts = data.facts || {};
  const rev = latestFact(facts, TAGS.revenue);
  const ni = latestFact(facts, TAGS.netIncome);
  const op = latestFact(facts, TAGS.operating);
  const da = latestFact(facts, TAGS.da);
  const eps = latestFact(facts, TAGS.eps);
  const anchor = rev || ni;
  if (!anchor) throw new Error(`no revenue or net income tagged for CIK ${padded}`);

  /* only derived where both halves come from the same period — an operating
     figure from one quarter plus D&A from another is not an EBITDA */
  const ebitda = op && da && op.end === da.end ? op.val + da.val : null;

  return {
    period: periodLabel(anchor),
    asOf: anchor.filed,
    ccy: (rev && rev.unit) || (ni && ni.unit) || "USD",
    revenue: rev ? rev.val : null,
    ebitda,
    netIncome: ni ? ni.val : null,
    eps: eps ? eps.val : null,
    src: `SEC EDGAR, ${anchor.form || "XBRL"}${ebitda == null ? "" : " (EBITDA derived: operating income + D&A)"}`
  };
}

/* ── Aggregator ───────────────────────────────────────────────────────────
   For the ten names EDGAR has nothing for. Verify your plan actually returns
   the non-US symbols before relying on this — coverage outside the US differs
   by provider and by tier, and a silently empty response looks the same as a
   company that did not report. */
async function fromFmp(symbol, key) {
  const url = `https://financialmodelingprep.com/api/v3/income-statement/`
    + `${encodeURIComponent(symbol)}?period=quarter&limit=1&apikey=${encodeURIComponent(key)}`;
  const rows = await getJSON(url);
  if (!Array.isArray(rows) || !rows.length) throw new Error(`no income statement for ${symbol}`);
  const r = rows[0];
  const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    period: r.period && r.calendarYear ? `${r.period} ${r.calendarYear}` : String(r.date || "").slice(0, 7),
    asOf: r.fillingDate || r.date,
    ccy: r.reportedCurrency || "USD",
    revenue: num(r.revenue),
    ebitda: num(r.ebitda),
    netIncome: num(r.netIncome),
    eps: num(r.epsdiluted ?? r.eps),
    src: "Financial Modeling Prep, income statement"
  };
}

/* ── Write-back ───────────────────────────────────────────────────────────
   Surgical: only the span between the two markers is replaced, so a value
   containing a brace cannot run away with the rest of the file. */
function spliceFin(html, entries) {
  const a = html.indexOf(BEGIN);
  const b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error("EQ_FIN markers not found in the deck");
  const head = html.slice(0, a);
  const tail = html.slice(b + END.length);
  const banner = `${BEGIN} — {tk: {period, asOf, ccy, revenue, ebitda, netIncome, eps, src}}
   Generated by scripts/refresh-financials.js. Do not hand-edit: the script
   splices between these two markers, so anything written here is overwritten
   on the next refresh. The markers are why the rewrite can be surgical rather
   than a regex over a brace-counted literal. */`;
  const body = Object.keys(entries).sort().map(tk => {
    const f = entries[tk];
    const n = v => (v == null ? "null" : String(v));
    /* The literal is written into an inline <script>, where the HTML parser
       looks for "</script>" before the JS parser sees anything — so a provider
       string containing it would end the script element no matter how well the
       JS quoting is done. The deck's esc() cannot help: the value is in JS
       here, not in markup. Escaping "<" as \u003C is still "<" at runtime, so
       the round-trip is unchanged and the parser never sees the close tag.
       U+2028 and U+2029 go the same way, being line terminators to JS. */
    const q = v => JSON.stringify(String(v))
      .replace(/</g, "\\u003C")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    return `  ${/^[A-Za-z_$][\w$]*$/.test(tk) ? tk : JSON.stringify(tk)}: {`
      + `period:${q(f.period)}, asOf:${q(f.asOf)}, ccy:${q(f.ccy)}, `
      + `revenue:${n(f.revenue)}, ebitda:${n(f.ebitda)}, netIncome:${n(f.netIncome)}, `
      + `eps:${n(f.eps)}, src:${q(f.src)}},`;
  }).join("\n");
  return `${head}${banner}\n${body}${body ? "\n" : ""}${END}${tail}`;
}

/* whatever the deck already holds, so a failed fetch keeps the last good
   figures instead of blanking a name */
function readExisting(html) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < 0) return {};
  const span = html.slice(html.indexOf("*/", a) + 2, b);
  const out = {};
  try {
    // eslint-disable-next-line no-new-func
    Object.assign(out, new Function(`return {${span}}`)());
  } catch { /* an unreadable span is replaced wholesale rather than trusted */ }
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const only = (process.argv.find(a => a.startsWith("--only=")) || "").split("=")[1];
  const cfg = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
  const html = fs.readFileSync(DECK, "utf8");
  const out = readExisting(html);
  const fmpKey = process.env.FMP_API_KEY || "";

  const names = Object.entries(cfg.names).filter(([tk]) => !only || only.split(",").includes(tk));
  let ok = 0, skipped = 0, failed = 0;

  for (const [tk, src] of names) {
    try {
      let fin;
      if (src.provider === "edgar") {
        if (!src.cik) { console.log(`skip  ${tk}  no CIK in sources.json — look it up rather than guess`); skipped++; continue; }
        fin = await fromEdgar(src.cik);
      } else if (src.provider === "fmp") {
        if (!fmpKey) { console.log(`skip  ${tk}  FMP_API_KEY not set`); skipped++; continue; }
        fin = await fromFmp(src.symbol, fmpKey);
      } else {
        console.log(`skip  ${tk}  unknown provider ${src.provider}`); skipped++; continue;
      }
      if (!fin.period || !fin.asOf) throw new Error("no period or filing date");
      out[tk] = fin;
      ok++;
      console.log(`ok    ${tk}  ${fin.period}  rev ${fin.revenue}  ebitda ${fin.ebitda}  ni ${fin.netIncome}  eps ${fin.eps}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${tk}  ${e.message}${out[tk] ? "  (keeping the previous figures)" : ""}`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`\n${ok} fetched, ${skipped} skipped, ${failed} failed, ${Object.keys(out).length} names in the deck`);
  if (dry) { console.log("--dry-run: nothing written"); return; }

  const next = spliceFin(html, out);
  if (next === html) { console.log("no change"); return; }
  fs.writeFileSync(DECK, next);
  console.log(`wrote ${path.relative(ROOT, DECK)}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { spliceFin, readExisting, latestFact, periodLabel, BEGIN, END };
