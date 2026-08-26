/* Offline. The CIK resolver reads the SEC's ticker map, but a ticker can be
   reassigned or collide across registrants, so it checks the registrant name
   against the company the deck thinks the ticker is before accepting a number.
   That check is the only thing standing between "wrong CIK" and "another
   company's accounts on the deck under the right ticker", so it is tested
   against the real registrant titles and against realistic collisions. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { nameMatches } = require("../scripts/resolve-ciks");

const SOURCES = path.resolve(__dirname, "..", "scripts", "sources.json");
const DECK = path.resolve(__dirname, "..", "affinity-ops-deck.html");

/* deck name, SEC registrant title, should it match */
const CASES = [
  ["Danaos", "DANAOS CORP", true],
  ["Costamare", "COSTAMARE INC.", true],
  ["Star Bulk Carriers", "Star Bulk Carriers Corp.", true],
  ["Genco Shipping & Trading", "GENCO SHIPPING & TRADING LTD", true],
  ["Safe Bulkers", "Safe Bulkers, Inc.", true],
  ["Himalaya Shipping", "Himalaya Shipping Ltd.", true],
  ["Frontline", "FRONTLINE PLC", true],
  ["Torm", "TORM plc", true],
  ["International Seaways", "International Seaways, Inc.", true],
  ["DHT Holdings", "DHT Holdings, Inc.", true],
  ["Golar LNG", "Golar LNG Ltd", true],
  ["Flex LNG", "FLEX LNG LTD.", true],
  ["Capital Clean Energy Carriers", "Capital Clean Energy Carriers Corp.", true],
  /* collisions: the ticker resolves, the company is somebody else */
  ["Frontline", "Frontier Communications Parent, Inc.", false],
  ["Safe Bulkers", "SAFEHOLD INC.", false],
  ["Danaos", "Danimer Scientific, Inc.", false],
  ["Golar LNG", "Cheniere Energy, Inc.", false],
  ["DHT Holdings", "DHB Capital Group Inc", false],
  /* a bare legal suffix is not a company name and must never match */
  ["Frontline", "Ltd.", false],
  ["Torm", "Holdings Inc", false]
];

let pass = 0; const fail = [];
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail.push(n + " :: " + e.message); } };

CASES.forEach(([deck, sec, want]) => {
  t(`${want ? "matches" : "refuses"}: "${deck}" vs "${sec}"`,
    () => assert.strictEqual(nameMatches(deck, sec), want));
});

const cfg = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
const edgar = Object.entries(cfg.names).filter(([, v]) => v.provider === "edgar");

t("every EDGAR name carries an expected company", () => {
  const missing = edgar.filter(([, v]) => !v.expect).map(([k]) => k);
  assert.deepStrictEqual(missing, [], "without expect, the resolver has nothing to check against");
});
t("the expected company matches the deck's own name for that ticker", () => {
  const deck = fs.readFileSync(DECK, "utf8");
  const names = {};
  deck.replace(/tk:"([^"]+)",co:"([^"]+)"/g, (_, tk, co) => { names[tk] = co; return ""; });
  const wrong = edgar.filter(([tk, v]) => names[tk] !== v.expect).map(([tk]) => tk);
  assert.deepStrictEqual(wrong, [], "sources.json has drifted from EQUITIES");
});
t("no CIK is committed unresolved-looking", () => {
  const bad = edgar.filter(([, v]) => v.cik != null && !/^\d{10}$/.test(String(v.cik))).map(([k]) => k);
  assert.deepStrictEqual(bad, [], "a CIK must be ten digits or null");
});
t("every non-EDGAR name has a symbol", () => {
  const bad = Object.entries(cfg.names)
    .filter(([, v]) => v.provider === "fmp" && !v.symbol).map(([k]) => k);
  assert.deepStrictEqual(bad, []);
});
t("sources.json covers every name in the basket", () => {
  const deck = fs.readFileSync(DECK, "utf8");
  /* only the EQUITIES rows: tk on its own also matches the sort label, whose
     value is an escape sequence in the source rather than a ticker */
  const tks = [...deck.matchAll(/tk:"([^"]+)",co:/g)].map(m => m[1]);
  const missing = tks.filter(t => !cfg.names[t]);
  assert.deepStrictEqual(missing, [], "a name in EQUITIES with no source can never be fetched");
});

console.log(`ciks: ${pass}/${pass + fail.length}`);
fail.forEach(f => console.log("  FAIL", f));
process.exit(fail.length ? 1 : 0);
