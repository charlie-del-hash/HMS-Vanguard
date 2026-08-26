/* Touch targets, company reachability, reduced motion, print, and the LMSR
   invariants — the checks that each need their own browser context. */
const { browser, URLBASE } = require('./lib');
const assert = require('assert');

const CTRLS = 'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"]),[data-act]';

(async () => {
  const b = await browser();
  let pass = 0; const fail = [];
  const t = async (n, fn) => { try { await fn(); pass++; } catch(e){ fail.push(n + ' :: ' + e.message); } };

  /* ── touch targets, pointer:coarse ─────────────────────────── */
  const coarse = await b.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const cp = await coarse.newPage();
  const cerrs = []; cp.on('pageerror', e => cerrs.push(e.message));
  await cp.goto(URLBASE); await cp.waitForTimeout(400);
  const small = [];
  for(const w of [390, 768]){
    await cp.setViewportSize({ width: w, height: 900 });
    for(const [tab, rtab] of [['predict', null], ['comms', null], ['reports', 'library'], ['reports', 'equities']]){
      await cp.evaluate(([x, r]) => { S.tab = x; if(r) S.rtab = r; render(); }, [tab, rtab]);
      await cp.waitForTimeout(120);
      const bad = await cp.evaluate(sel => {
        const out = [];
        document.querySelectorAll(sel).forEach(el => {
          const cs = getComputedStyle(el);
          if(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return;
          if(el.closest('svg')) return;                 /* marks, not controls */
          const r = el.getBoundingClientRect();
          if(!r.width || !r.height) return;
          if(el.querySelector(sel)) return;             /* wrappers */
          if(r.width < 44 || r.height < 44)
            out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().trim().split(/\s+/)[0]}#${el.id || ''} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent||'').trim().slice(0,16)}"`);
        });
        return out;
      }, CTRLS);
      bad.forEach(x => small.push(`${w} ${tab}/${rtab} :: ${x}`));
    }
  }
  const uniq = [...new Set(small.map(x => x.split(' :: ')[1]))];
  const inBasket = small.filter(x => x.includes('reports/equities'));
  console.log(`touch targets under pointer:coarse — under 44pt: ${uniq.length} distinct control(s)`);
  uniq.forEach(x => console.log('   ', x));
  console.log(`  of which in the basket: ${new Set(inBasket.map(x => x.split(' :: ')[1])).size}`);

  /* ── company reachability ──────────────────────────────────── */
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URLBASE); await p.waitForTimeout(400);
  await p.evaluate(() => { S.tab = 'reports'; S.rtab = 'equities'; S.eqSel = 'FRO'; render(); });
  let reach = 0; const rfail = [];
  /* The invariant the CSS actually enforces: the Company column and the fold
     are mutually exclusive — the fold exists so that a dropped column is not a
     dropped fact, and drawing both would be 20px a row of pure duplication —
     and where neither is on, the detail panel is beside the table carrying the
     name instead. Never both, and never none. */
  for(const w of [320, 390, 480, 640, 768, 900, 1024, 1180, 1440, 1920]){
    await p.setViewportSize({ width: w, height: 1000 });
    for(const panel of [true, false]){
      await p.evaluate(v => { S.eqPanel = v; render(); }, panel);
      await p.waitForTimeout(140);
      const r = await p.evaluate(() => {
        const row = document.querySelector('.eqrow[data-v="FRO"]');
        const vis = el => { if(!el) return false; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
        const col  = vis(row && row.children[1]);
        const fold = vis(row && row.querySelector('.cofold'));
        const sp = document.querySelector('.grid.withside > .panel.sticky');
        const tb = document.querySelector('.panel.eqpanel');
        let beside = false;
        if(vis(sp) && tb){
          const a = sp.getBoundingClientRect(), c = tb.getBoundingClientRect();
          beside = a.left > c.left + 40 && a.top < c.bottom - 40 && /Frontline/i.test(sp.textContent);
        }
        return { col, fold, beside };
      });
      reach++;
      if(r.col && r.fold) rfail.push(`${w} panel=${panel} :: column and fold both drawn`);
      else if(!r.col && !r.fold && !r.beside) rfail.push(`${w} panel=${panel} :: name unreachable`);
    }
  }
  console.log(`company reachability: ${reach - rfail.length}/${reach} — never both column and fold, never neither`);
  rfail.forEach(x => console.log('  FAIL', x));

  /* ── reduced motion ────────────────────────────────────────── */
  const rm = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })).newPage();
  await rm.goto(URLBASE); await rm.waitForTimeout(400);
  let moving = 0;
  for(const [tab, rtab] of [['predict', null], ['comms', null], ['reports', 'library'], ['reports', 'equities']]){
    await rm.evaluate(([x, r]) => { S.tab = x; if(r) S.rtab = r; render(); }, [tab, rtab]);
    await rm.waitForTimeout(120);
    moving += await rm.evaluate(() => {
      let n = 0;
      document.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        const dur = x => x.split(',').some(v => parseFloat(v) > 0.001);
        if(dur(cs.animationDuration) || dur(cs.transitionDuration)) n++;
      });
      return n;
    });
  }
  console.log(`reduced motion: ${moving} element(s) still animating or transitioning`);

  /* ── print ─────────────────────────────────────────────────── */
  await p.evaluate(() => { S.theme = 'dark'; applyTheme(); render(); });
  await p.emulateMedia({ media: 'print' });
  await p.waitForTimeout(200);
  const pr = await p.evaluate(() => {
    const hidden = el => !el || getComputedStyle(el).display === 'none';
    const bg = getComputedStyle(document.body).backgroundColor;
    return { ticker: hidden(document.querySelector('.ticker')), spine: hidden(document.querySelector('.spine')), bg };
  });
  await p.emulateMedia({ media: 'screen' });
  await t('print hides the ticker', async () => assert.strictEqual(pr.ticker, true));
  await t('print hides the spine', async () => assert.strictEqual(pr.spine, true));
  await t('print forces light even from dark', async () => {
    const m = pr.bg.match(/[\d.]+/g).map(Number);
    assert.ok(m[0] > 200 && m[1] > 200 && m[2] > 200, pr.bg);
  });

  /* ── market maker invariants ───────────────────────────────── */
  await p.evaluate(() => { S.theme = 'light'; applyTheme(); S.tab = 'predict'; render(); });
  const inv = await p.evaluate(() => {
    const out = {};
    const m = S.markets.find(x => x.state === 'open');
    out.complementary = Math.abs(yesC(m) + noC(m) - 100) < 1e-9;
    out.priceInBand = yesC(m) >= 1 && yesC(m) <= 99;
    /* the cost function is convex in size: each extra share costs at least as
       much as the one before it */
    let convex = true, prev = -Infinity;
    for(let n = 1; n <= 40; n++){
      const marginal = tradeCost(m, 'yes', n) - tradeCost(m, 'yes', n - 1);
      if(marginal < prev - 1e-9) convex = false;
      prev = marginal;
    }
    out.convex = convex;
    out.zeroCostsNothing = Math.abs(tradeCost(m, 'yes', 0)) < 1e-12;
    /* buying then selling the same size back can never leave the maker short */
    const q = 25;
    const inCost = tradeCost(m, 'yes', q);
    applyTrade(m, 'yes', q);
    const outCost = tradeCost(m, 'yes', -q);
    applyTrade(m, 'yes', -q);
    out.lossFreeRoundTrip = inCost + outCost >= -1e-9;
    /* the seed price is the price */
    const probe = { qY: 0, qN: 0, state: 'open', outcome: null };
    seedPrice(probe, 0.37);
    out.seedIsThePrice = Math.abs(pYes(probe) - 0.37) < 1e-9;
    /* maxAffordable is exact: n fits the budget and n+1 does not */
    const budget = 60;
    const n = maxAffordable(m, 'yes', budget);
    out.affordableFits = n === 0 || tradeCost(m, 'yes', n) <= budget + 1e-9;
    out.affordableIsMaximal = n >= MAXQ || tradeCost(m, 'yes', n + 1) > budget;
    /* a resolved market prints its outcome, not its curve */
    const res = S.markets.find(x => x.state === 'resolved');
    out.resolvedPrintsOutcome = !res || yesC(res) === (res.outcome === 'yes' ? 100 : 0);
    return out;
  });
  for(const [k, v] of Object.entries(inv)) await t(`market maker · ${k}`, async () => assert.strictEqual(v, true));

  await t('no page errors anywhere', async () => {
    assert.deepStrictEqual(errs, [], errs.join(' | '));
    assert.deepStrictEqual(cerrs, [], cerrs.join(' | '));
  });

  console.log(`\nprint / market maker / errors: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log('  FAIL', f));
  await b.close();
  process.exit(fail.length + rfail.length ? 1 : 0);
})();
