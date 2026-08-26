#!/usr/bin/env node
/* Fill in the CIKs in sources.json from the SEC's own ticker map.
 *
 *   node scripts/resolve-ciks.js --dry-run    # resolve, print, write nothing
 *   node scripts/resolve-ciks.js              # resolve and write sources.json
 *
 * Why this exists rather than a hand-curated list: a wrong CIK does not error.
 * It fetches a different company's accounts and puts them on the deck under the
 * right ticker, which is the worst failure this pipeline has. Typing thirteen
 * ten-digit numbers from memory is exactly how that happens, so nobody types
 * them — the SEC's own file is the authority and this reads it.
 *
 * It is still not blind. www.sec.gov/files/company_tickers.json maps a ticker
 * to a CIK and a registrant name, and a ticker can be reassigned or collide, so
 * the registrant name is checked against the company the deck thinks it is
 * before the number is accepted. A mismatch is reported and left unresolved
 * rather than written, because an unresolved name is skipped downstream and a
 * wrongly resolved one is not.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SOURCES = path.resolve(__dirname, "sources.json");
const MAP_URL = "https://www.sec.gov/files/company_tickers.json";
const UA = process.env.SEC_USER_AGENT
  || "affinity-ops-deck (+https://github.com/charlie-del-hash/HMS-Vanguard)";

/* Registrant names and desk names differ in the ways company names always do:
   Danaos vs DANAOS CORP, Torm vs TORM plc. Compare on the significant words
   rather than the whole string, and require the deck's name to be contained in
   the registrant's — a shared first word alone is not a match. */
const NOISE = new Set(["corp", "corporation", "inc", "incorporated", "plc", "ltd",
  "limited", "holdings", "holding", "co", "company", "group", "sa", "nv", "as",
  "asa", "the", "and", "of", "public", "shipping", "partners", "lp"]);

const words = s => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
  .split(/\s+/).filter(w => w && !NOISE.has(w));

function nameMatches(deckName, secName) {
  const a = words(deckName), b = new Set(words(secName));
  if (!a.length) return false;
  const hit = a.filter(w => b.has(w)).length;
  return hit === a.length || (a.length >= 2 && hit >= 2);
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const cfg = JSON.parse(fs.readFileSync(SOURCES, "utf8"));

  const res = await fetch(MAP_URL, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${MAP_URL}`);
  const raw = await res.json();

  /* the file is an object of {cik_str, ticker, title} keyed by index; more than
     one row can carry the same ticker across share classes, so collect them all
     and refuse rather than pick when they disagree */
  const byTicker = new Map();
  for (const row of Object.values(raw)) {
    const t = String(row.ticker || "").toUpperCase();
    if (!t) continue;
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t).push({ cik: String(row.cik_str).padStart(10, "0"), title: row.title });
  }

  let resolved = 0, already = 0, unmatched = 0, ambiguous = 0;
  for (const [tk, src] of Object.entries(cfg.names)) {
    if (src.provider !== "edgar") continue;
    if (src.cik) { already++; console.log(`have  ${tk.padEnd(6)} ${src.cik}`); continue; }

    const hits = byTicker.get(tk.toUpperCase()) || [];
    if (!hits.length) { unmatched++; console.log(`MISS  ${tk.padEnd(6)} no SEC registrant with this ticker`); continue; }

    const expect = src.expect || "";
    const good = expect ? hits.filter(h => nameMatches(expect, h.title)) : hits;

    if (!good.length) {
      unmatched++;
      console.log(`MISS  ${tk.padEnd(6)} ticker maps to ${hits.map(h => `"${h.title}"`).join(", ")}, `
        + `which does not look like "${expect}" — left unresolved on purpose`);
      continue;
    }
    const ciks = [...new Set(good.map(h => h.cik))];
    if (ciks.length > 1) {
      ambiguous++;
      console.log(`AMBIG ${tk.padEnd(6)} ${ciks.join(" / ")} — ${good.map(h => h.title).join(" / ")}`);
      continue;
    }
    src.cik = ciks[0];
    resolved++;
    console.log(`ok    ${tk.padEnd(6)} ${ciks[0]}  ${good[0].title}`);
  }

  console.log(`\n${resolved} resolved, ${already} already set, ${unmatched} unmatched, ${ambiguous} ambiguous`);
  if (unmatched || ambiguous) console.log("unresolved names are skipped by the fetcher rather than guessed");
  if (dry) { console.log("--dry-run: nothing written"); return; }
  if (!resolved) { console.log("no change"); return; }
  fs.writeFileSync(SOURCES, JSON.stringify(cfg, null, 2) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), SOURCES)}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { nameMatches, words };
