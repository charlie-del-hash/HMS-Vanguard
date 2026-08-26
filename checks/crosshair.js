const { browser, newPage } = require('./lib');
const assert = require('assert');
(async () => {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
  let pass = 0, fail = [];
  const t = async (n, fn) => { try { await fn(); pass++; } catch(e){ fail.push(n + ' :: ' + e.message); } };

  const p = await newPage(b, { ctx });
  const readout = () => p.evaluate(() => [...document.querySelectorAll('svg.chart .ph')]
      .map(g => ({ on: g.getAttribute('opacity'), txt: g.querySelector('.ph-lab').textContent,
                   x: g.querySelector('.ph-line').getAttribute('x1'),
                   bx: +g.querySelector('.ph-box').getAttribute('x'), bw: +g.querySelector('.ph-box').getAttribute('width'),
                   vw: g.closest('svg').viewBox.baseVal.width })));

  const hoverChart = async (label, frac) => {
    await p.evaluate(l => {
      const svg = [...document.querySelectorAll('svg.chart[data-pts]')]
        .find(s => (s.getAttribute('aria-label')||'').includes(l) || s.id === l);
      if(svg) svg.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, label);
    await p.waitForTimeout(60);
    const bb = await p.evaluate(l => {
      const svg = [...document.querySelectorAll('svg.chart[data-pts]')]
        .find(s => (s.getAttribute('aria-label')||'').includes(l) || s.id === l);
      if(!svg) return null;
      const r = svg.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, label);
    if(!bb) throw new Error('chart not found: ' + label);
    await p.mouse.move(bb.x + bb.w * frac, bb.y + bb.h * 0.5);
    await p.waitForTimeout(80);
  };

  // price chart still works
  await t('price chart lights up', async () => {
    await hoverChart('pricechart', 0.6);
    const r = (await readout()).filter(x => x.on === '1');
    assert.strictEqual(r.length, 1, JSON.stringify(await readout()));
    assert.match(r[0].txt, /·\s\d+c$/, r[0].txt);
  });

  // equities
  await p.evaluate(() => { S.tab='reports'; S.rtab='equities'; S.eqSel='FRO'; render(); });
  await p.waitForTimeout(300);
  await t('coverage basket lights up and names both series', async () => {
    await hoverChart('Coverage basket', 0.55);
    const r = (await readout()).filter(x => x.on === '1');
    assert.strictEqual(r.length, 1, 'exactly one crosshair lit, got ' + r.length);
    assert.match(r[0].txt, /^W\d+ · \d+\.\d · FRO \d+\.\d$/, r[0].txt);
  });
  await t('the readout plate stays inside its frame', async () => {
    for(const frac of [0.02, 0.2, 0.5, 0.8, 0.99]){
      await hoverChart('Coverage basket', frac);
      const r = (await readout()).filter(x => x.on === '1')[0];
      assert.ok(r.bx >= 0 && r.bx + r.bw <= r.vw, `plate ${r.bx}..${r.bx + r.bw} outside 0..${r.vw} at ${frac}`);
    }
  });
  await t('side-panel chart lights up', async () => {
    await hoverChart('FRO weekly close', 0.5);
    const r = (await readout()).filter(x => x.on === '1');
    assert.strictEqual(r.length, 1, 'exactly one crosshair lit, got ' + r.length);
    assert.match(r[0].txt, /^W\d+ · \d+(\.\d)?$/, r[0].txt);
  });
  await t('moving between charts leaves only one lit', async () => {
    await hoverChart('Coverage basket', 0.3);
    await hoverChart('FRO weekly close', 0.3);
    const r = (await readout()).filter(x => x.on === '1');
    assert.strictEqual(r.length, 1, JSON.stringify(await readout()));
  });
  await t('moving off every chart puts them all out', async () => {
    await p.mouse.move(5, 5);
    await p.waitForTimeout(120);
    const r = (await readout()).filter(x => x.on === '1');
    assert.strictEqual(r.length, 0);
  });
  await t('the plate is wide enough for its text', async () => {
    await hoverChart('Coverage basket', 0.55);
    const w = await p.evaluate(() => {
      const g = [...document.querySelectorAll('svg.chart .ph')].find(x => x.getAttribute('opacity') === '1');
      const lab = g.querySelector('.ph-lab'), box = g.querySelector('.ph-box');
      return { tw: lab.getBBox().width, bw: +box.getAttribute('width') };
    });
    assert.ok(w.bw >= w.tw + 6, `plate ${w.bw} vs text ${w.tw}`);
  });
  await t('narrow frames drop the second series from the readout', async () => {
    await p.setViewportSize({ width: 360, height: 1100 });
    await p.waitForTimeout(400);
    await hoverChart('Coverage basket', 0.5);
    const r = (await readout()).filter(x => x.on === '1')[0];
    assert.ok(r, 'nothing lit at 360');
    assert.doesNotMatch(r.txt, /FRO/, r.txt);
    assert.ok(r.bx >= 0 && r.bx + r.bw <= r.vw, `plate ${r.bx}..${r.bx + r.bw} outside 0..${r.vw}`);
  });
  await t('no page errors', async () => assert.deepStrictEqual(p.__errs, [], p.__errs.join(' | ')));

  console.log(`crosshair: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log('  FAIL', f));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
