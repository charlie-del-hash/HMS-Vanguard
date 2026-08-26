/* Shared harness. Every check drives headless Chromium against a served copy
   of the deck and reads the live DOM — never the source. The deck is one file
   with no build step, so `npm run check` serves it and points these at it.

   DECK_URL overrides the target, which is how a check is run against an older
   build for a differential (see contrast.js). */
/* Playwright may be a dev dependency here or installed globally; try both
   before giving up, so the checks run without a package.json of their own. */
function loadPlaywright(){
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean);
  for(const t of tries){ try{ return require(t); }catch{} }
  try{
    const root = require("child_process").execSync("npm root -g", { encoding: "utf8" }).trim();
    for(const t of ["playwright", "playwright-core"]){
      try{ return require(require("path").join(root, t)); }catch{}
    }
  }catch{}
  throw new Error("playwright not found — npm i -D playwright, or set PLAYWRIGHT_MODULE to its path");
}
const { chromium } = loadPlaywright();

const URLBASE = process.env.DECK_URL || "http://127.0.0.1:8099/affinity-ops-deck.html";
const EXE = process.env.CHROMIUM_PATH || undefined;

async function browser(){
  return chromium.launch(EXE ? { executablePath: EXE } : {});
}

async function newPage(b, opts = {}){
  const ctx = opts.ctx || await b.newContext({
    viewport: { width: opts.w || 1440, height: opts.h || 1000 },
    deviceScaleFactor: opts.dsf || 1,
    ...(opts.context || {})
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if(m.type() === "error") errs.push("console: " + m.text()); });
  await page.goto(URLBASE + (opts.hash || ""));
  await page.waitForTimeout(350);
  page.__errs = errs;
  page.__ctx = ctx;
  return page;
}

/* `const S` at the top level of a classic script is a global *lexical*
   binding, not a property of window, so it has to be reached by name. */
const stateOf = (page, expr) => page.evaluate(x => new Function("return " + x)(), expr);

/* go to a view without clicking through the shell */
const goto = async (page, tab, rtab) => {
  await page.evaluate(([t, r]) => { S.tab = t; if(r) S.rtab = r; render(); }, [tab, rtab || null]);
  await page.waitForTimeout(120);
};

const VIEWS = [["predict", null], ["comms", null], ["reports", "library"], ["reports", "equities"]];
const WIDTHS = [320, 360, 390, 430, 480, 560, 640, 768, 900, 1024, 1180, 1366, 1600, 1920];

/* a tiny assertion tally, so every check prints the same shape of result */
function tally(name){
  let pass = 0; const fail = [];
  return {
    async t(label, fn){ try{ await fn(); pass++; }catch(e){ fail.push(`${label} :: ${e.message}`); } },
    ok(label, cond, detail = ""){ if(cond) pass++; else fail.push(`${label}${detail ? " :: " + detail : ""}`); },
    report(){
      console.log(`${name}: ${pass}/${pass + fail.length}`);
      fail.slice(0, 20).forEach(f => console.log("  FAIL", f));
      if(fail.length > 20) console.log(`  … and ${fail.length - 20} more`);
      return fail.length;
    }
  };
}

module.exports = { browser, newPage, stateOf, goto, tally, VIEWS, WIDTHS, URLBASE };
