const { browser, newPage, URLBASE } = require('./lib');
const assert = require('assert');
(async () => {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  let pass = 0, fail = [];
  const t = async (name, fn) => { try { await fn(); pass++; } catch(e){ fail.push(name + ' :: ' + e.message); } };

  // 1. clean load lands on the default view and writes a route
  let p = await newPage(b, { ctx });
  await t('default route is predict/<selId>', async () => {
    const h = await p.evaluate(() => location.hash);
    assert.match(h, /^#predict\/\d+$/, h);
  });
  await t('no page errors on load', async () => assert.deepStrictEqual(p.__errs, []));

  // 2. navigate to equities, select a name, check the hash follows
  await t('hash follows the selection', async () => {
    await p.evaluate(() => { S.tab='reports'; S.rtab='equities'; S.eqSel='HLAG'; render(); });
    await p.waitForTimeout(150);
    assert.strictEqual(await p.evaluate(() => location.hash), '#equities/HLAG');
  });
  await t('clearing the selection drops the name from the hash', async () => {
    await p.evaluate(() => { S.eqSel = null; render(); });
    await p.waitForTimeout(120);
    assert.strictEqual(await p.evaluate(() => location.hash), '#equities');
  });
  await t('library tab has its own route', async () => {
    await p.evaluate(() => { S.rtab='library'; render(); });
    await p.waitForTimeout(120);
    assert.strictEqual(await p.evaluate(() => location.hash), '#library');
  });
  await t('replaceState keeps the back stack at one entry', async () => {
    const n = await p.evaluate(() => history.length);
    await p.evaluate(() => { S.rtab='equities'; S.eqSel='FRO'; render(); S.eqSel='HLAG'; render(); });
    await p.waitForTimeout(120);
    assert.strictEqual(await p.evaluate(() => history.length), n);
  });

  // 3. state survives a reload in the same context (same origin, same storage)
  await t('view survives a reload', async () => {
    await p.evaluate(() => { S.tab='reports'; S.rtab='equities'; S.eqSel='HAFNI'; S.eqSeg='tank'; S.eqSort='pnav'; S.eqPanel=false; S.eqQuery='ta'; render(); });
    await p.waitForTimeout(150);
    await p.close();
    p = await newPage(b, { ctx });   // no hash: the store is the only source
    const st = await p.evaluate(() => ({ tab:S.tab, rtab:S.rtab, sel:S.eqSel, seg:S.eqSeg, sort:S.eqSort, panel:S.eqPanel, q:S.eqQuery }));
    assert.deepStrictEqual(st, { tab:'reports', rtab:'equities', sel:'HAFNI', seg:'tank', sort:'pnav', panel:false, q:'ta' });
  });

  // 4. a link beats the store
  await t('a hash overrides the stored view', async () => {
    await p.close();
    p = await newPage(b, { ctx, hash: '#equities/HLAG' });
    const st = await p.evaluate(() => ({ tab:S.tab, rtab:S.rtab, sel:S.eqSel, seg:S.eqSeg, q:S.eqQuery }));
    assert.deepStrictEqual(st, { tab:'reports', rtab:'equities', sel:'HLAG', seg:'all', q:'' });
  });
  await t('the linked row is actually in the table', async () => {
    const n = await p.evaluate(() => document.querySelectorAll('.eqrow[data-v="HLAG"]').length);
    assert.strictEqual(n, 1);
  });

  // 5. junk is refused
  for(const [hash, why] of [['#equities/NOPE','unknown ticker'], ['#nonsense','unknown module'], ['#predict/9999','unknown market'], ['#equities/<script>','markup']]) {
    await t(`junk hash refused: ${why}`, async () => {
      await p.close();
      p = await newPage(b, { ctx, hash });
      assert.deepStrictEqual(p.__errs, [], p.__errs.join(' | '));
      const st = await p.evaluate(() => ({ tab:S.tab, sel:S.eqSel, selId:S.selId }));
      if(hash === '#equities/NOPE' || hash === '#equities/<script>') assert.strictEqual(st.tab, 'reports');
      if(hash === '#predict/9999') assert.strictEqual(st.tab, 'predict');
      const bad = await p.evaluate(() => /<script|onerror=|javascript:/i.test(document.getElementById('app').innerHTML));
      assert.strictEqual(bad, false, 'markup leaked into the DOM');
      if(hash === '#equities/NOPE' || hash === '#equities/<script>')
        assert.strictEqual(await p.evaluate(() => S.eqSel), null, 'unknown ticker left a selection standing');
    });
  }

  // 6. a poisoned store falls back rather than through
  await t('a hand-edited store is refused', async () => {
    await p.close();
    const p2 = await newPage(b, { ctx });
    await p2.evaluate(() => localStorage.setItem('affinity-ops-view', JSON.stringify({
      tab:'evil', rtab:'nope', eqSel:'ZZZ', eqSort:'__proto__', eqSeg:9, eqPanel:'yes', selId:'x', mktCat:'<b>' })));
    await p2.close();
    p = await newPage(b, { ctx });
    assert.deepStrictEqual(p.__errs, [], p.__errs.join(' | '));
    const st = await p.evaluate(() => ({ tab:S.tab, rtab:S.rtab, sel:S.eqSel, sort:S.eqSort, seg:S.eqSeg, panel:S.eqPanel, selId:S.selId, cat:S.mktCat }));
    assert.deepStrictEqual(st, { tab:'predict', rtab:'library', sel:'FRO', sort:'ytd', seg:'all', panel:true, selId:1, cat:'all' });
  });

  // 7. hashchange from outside
  await t('hashchange navigates', async () => {
    await p.evaluate(() => { location.hash = '#equities/BWLPG'; });
    await p.waitForTimeout(250);
    assert.strictEqual(await p.evaluate(() => S.eqSel), 'BWLPG');
    assert.strictEqual(await p.evaluate(() => S.tab), 'reports');
  });
  await t('a broken hashchange leaves the view alone', async () => {
    await p.evaluate(() => { location.hash = '#garbage'; });
    await p.waitForTimeout(250);
    assert.strictEqual(await p.evaluate(() => S.eqSel), 'BWLPG');
  });

  console.log(`route/persist: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log('  FAIL', f));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
