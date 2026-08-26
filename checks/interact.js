const { browser, newPage } = require('./lib');
const assert = require('assert');

(async () => {
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const p = await newPage(b, { ctx });
  let pass = 0; const fail = [];
  const t = async (n, fn) => { try { await fn(); pass++; } catch(e){ fail.push(n + ' :: ' + e.message); } };
  const click = async sel => { await p.click(sel); await p.waitForTimeout(110); };
  /* top-level `const S` is a global lexical binding, not a window property,
     so it has to be reached by name rather than off window */
  const S_ = k => p.evaluate(x => new Function('return ' + x)(), k);
  const live = () => p.evaluate(() => document.getElementById('live').textContent);

  /* ── prediction desk ─────────────────────────────────────────── */
  await t('deck opens on the prediction desk', async () => assert.strictEqual(await S_('S.tab'), 'predict'));
  await t('select a market', async () => {
    await click('.mrow[data-v="2"]');
    assert.strictEqual(await S_('S.selId'), 2);
  });
  await t('market filter', async () => { await click('#mfilter-all'); assert.strictEqual(await S_('S.mktFilter'), 'all'); });
  await t('market sort', async () => {
    await p.selectOption('[data-bind="sort"]', 'vol'); await p.waitForTimeout(120);
    assert.strictEqual(await S_('S.sort'), 'vol');
  });
  await t('market category filter', async () => {
    await p.selectOption('[data-bind="mktCat"]', 'Tankers'); await p.waitForTimeout(120);
    assert.strictEqual(await S_('S.mktCat'), 'Tankers');
    await p.selectOption('[data-bind="mktCat"]', 'all'); await p.waitForTimeout(120);
  });
  await t('market search', async () => {
    await p.fill('[data-bind="query"]', 'cape'); await p.waitForTimeout(160);
    assert.ok((await p.$$('.mrow')).length >= 1);
    await p.fill('[data-bind="query"]', ''); await p.waitForTimeout(160);
  });
  await t('side toggle', async () => { await click('[data-act="side"][data-v="no"]'); assert.strictEqual(await S_('S.side'), 'no'); await click('[data-act="side"][data-v="yes"]'); });
  await t('quantity', async () => {
    await p.fill('#qty', '25'); await p.waitForTimeout(130);
    assert.strictEqual(await S_('S.qty'), '25');
  });
  await t('a trade fills and moves the balance', async () => {
    const before = await S_('S.balance');
    await click('[data-act="buy"]');
    const after = await S_('S.balance');
    assert.ok(after < before, `${after} !< ${before}`);
    assert.ok((await S_('S.positions')).length > 0);
  });
  await t('the trade is logged', async () => assert.ok((await S_('S.log')).length > 1));
  await t('close a position', async () => {
    const n = (await S_('S.positions')).length;
    await click('[data-act="close"]');
    assert.strictEqual((await S_('S.positions')).length, n - 1);
  });
  await t('resolver opens', async () => { await click('[data-act="resolvetoggle"]'); assert.strictEqual(await S_('S.showResolve'), true); });
  await t('settle a market', async () => {
    await click('[data-act="settle"][data-v="yes"]');
    const m = await p.evaluate(() => S.markets.find(x => x.id === S.selId));
    assert.strictEqual(m.state, 'resolved');
    assert.strictEqual(m.outcome, 'yes');
  });
  await t('create a market', async () => {
    const n = (await S_('S.markets')).length;
    await p.fill('#newq', 'Test question for the desk'); await p.waitForTimeout(120);
    await click('[data-act="newmkt"]');
    assert.strictEqual((await S_('S.markets')).length, n + 1);
  });
  await t('toast dismiss', async () => {
    if(await p.$('[data-act="dismiss"]')) await click('[data-act="dismiss"]');
    assert.strictEqual(await S_('S.note'), null);
  });

  /* ── comms ───────────────────────────────────────────────────── */
  await t('module switch to comms', async () => { await click('#nav-comms'); assert.strictEqual(await S_('S.tab'), 'comms'); });
  await t('channel filter', async () => { await click('[data-act="cfilter"][data-v="slack"]'); assert.strictEqual(await S_('S.convoFilter'), 'slack'); await click('[data-act="cfilter"][data-v="all"]'); });
  await t('select a conversation', async () => { await click('[data-act="selconvo"][data-v="2"]'); assert.strictEqual(await S_('S.selConvo'), 2); });
  await t('send a message', async () => {
    const n = await p.evaluate(() => S.convos.find(c => c.id === S.selConvo).msgs.length);
    await p.fill('#draft', 'Ack, will confirm.'); await p.waitForTimeout(120);
    await click('[data-act="send"]');
    assert.strictEqual(await p.evaluate(() => S.convos.find(c => c.id === S.selConvo).msgs.length), n + 1);
  });

  /* ── reports · library ───────────────────────────────────────── */
  await t('module switch to reports', async () => { await click('#nav-reports'); assert.strictEqual(await S_('S.tab'), 'reports'); });
  await t('generate a report', async () => {
    await click('#rtab-library');
    const n = (await S_('S.reports')).length;
    await click('[data-act="genreport"]');
    assert.strictEqual((await S_('S.reports')).length, n + 1);
  });

  /* ── reports · shipping equities ─────────────────────────────── */
  await t('switch to the basket tab', async () => { await click('#rtab-equities'); assert.strictEqual(await S_('S.rtab'), 'equities'); });
  await t('select a row', async () => {
    await click('.eqrow[data-v="GNK"]');
    assert.strictEqual(await S_('S.eqSel'), 'GNK');
  });
  await t('selecting a row speaks', async () => assert.match(await live(), /^GNK selected/));
  await t('clicking the selected row again clears it', async () => {
    await click('.eqrow[data-v="GNK"]');
    assert.strictEqual(await S_('S.eqSel'), null);
    assert.match(await live(), /Selection cleared/);
  });
  await t('a segment chip filters', async () => {
    await click('[data-act="eqseg"][data-v="tank"]');
    assert.strictEqual(await S_('S.eqSeg'), 'tank');
    const segs = await p.evaluate(() => [...document.querySelectorAll('.eqrow')].map(r => EQUITIES.find(e => e.tk === r.dataset.v).seg));
    assert.ok(segs.every(x => x === 'tank'), segs.join(','));
  });
  await t('clear resets segment and search', async () => {
    await p.fill('#eqsearch', 'fro'); await p.waitForTimeout(160);
    await click('[data-act="eqclear"]');
    assert.strictEqual(await S_('S.eqSeg'), 'all');
    assert.strictEqual(await S_('S.eqQuery'), '');
  });
  await t('search narrows the basket', async () => {
    await p.fill('#eqsearch', 'nyse'); await p.waitForTimeout(180);
    const n = (await p.$$('.eqrow')).length;
    assert.ok(n > 0 && n < 23, `${n} rows`);
    await p.fill('#eqsearch', ''); await p.waitForTimeout(180);
  });
  await t('a column header sorts', async () => {
    await click('[data-act="eqsortcol"][data-v="yld"]');
    assert.strictEqual(await S_('S.eqSort'), 'yld');
    const y = await p.evaluate(() => [...document.querySelectorAll('.eqrow')].map(r => EQUITIES.find(e => e.tk === r.dataset.v).yld));
    assert.deepStrictEqual(y, [...y].sort((a, c) => c - a));
  });
  await t('the sort select agrees with the header', async () => {
    await p.selectOption('[data-bind="eqSort"]', 'mcap'); await p.waitForTimeout(140);
    assert.strictEqual(await S_('S.eqSort'), 'mcap');
  });
  await t('a bar filters to its segment', async () => {
    await click('.barhit[data-v="gas"]');
    assert.strictEqual(await S_('S.eqSeg'), 'gas');
    await click('[data-act="eqclear"]');
  });
  await t('a scatter mark opens the name', async () => {
    const tk = await p.evaluate(() => document.querySelector('.scatpt').dataset.v);
    await click(`.scatpt[data-v="${tk}"]`);
    assert.strictEqual(await S_('S.eqSel'), tk);
  });
  await t('every scatter mark carries a tooltip', async () => {
    const n = await p.evaluate(() => [...document.querySelectorAll('.scatpt')].filter(g => g.querySelector('title')).length);
    const all = (await p.$$('.scatpt')).length;
    assert.strictEqual(n, all);
  });
  await t('the scatter captions its quadrants', async () => {
    const caps = await p.evaluate(() => [...document.querySelectorAll('svg.chart text')].map(t => t.textContent));
    assert.ok(caps.some(c => /CHEAP/.test(c)) && caps.some(c => /EXPENSIVE/.test(c)), 'quadrant captions missing');
  });
  await t('Show all clears the selection', async () => {
    await click('[data-act="eqclearsel"]');
    assert.strictEqual(await S_('S.eqSel'), null);
  });
  await t('a peer jump selects that peer', async () => {
    await click('.eqrow[data-v="FRO"]');
    const tk = await p.evaluate(() => document.querySelector('.peer').dataset.v);
    await click(`.peer[data-v="${tk}"]`);
    assert.strictEqual(await S_('S.eqSel'), tk);
  });
  await t('the crossing opens the market', async () => {
    await click('.eqrow[data-v="FRO"]');
    await click('.crossing [data-act="gotomkt"]');
    assert.strictEqual(await S_('S.tab'), 'predict');
    await click('#nav-reports');
  });
  await t('the detail panel folds and unfolds', async () => {
    const before = await S_('S.eqPanel');
    await click('#eqpaneltoggle');
    assert.strictEqual(await S_('S.eqPanel'), !before);
    await click('#eqpaneltoggle');
  });
  await t('the basket is one tab stop', async () => {
    const n = await p.evaluate(() => [...document.querySelectorAll('.eqrow')].filter(r => r.tabIndex === 0).length);
    assert.strictEqual(n, 1);
  });
  await t('arrow keys move the roving tabindex without re-rendering', async () => {
    await p.evaluate(() => { S.eqSel = null; render(); });
    await p.waitForTimeout(120);
    await p.evaluate(() => document.querySelector('.eqrow[tabindex="0"]').focus());
    const first = await p.evaluate(() => document.activeElement.dataset.v);
    await p.keyboard.press('ArrowDown'); await p.waitForTimeout(60);
    const second = await p.evaluate(() => document.activeElement.dataset.v);
    assert.notStrictEqual(first, second);
    assert.strictEqual(await S_('S.eqSel'), null, 'arrow keys must not select');
    const n = await p.evaluate(() => [...document.querySelectorAll('.eqrow')].filter(r => r.tabIndex === 0).length);
    assert.strictEqual(n, 1, 'still one tab stop');
  });
  await t('End and Home reach the ends', async () => {
    await p.keyboard.press('End'); await p.waitForTimeout(60);
    const last = await p.evaluate(() => document.activeElement.dataset.v);
    const expectLast = await p.evaluate(() => [...document.querySelectorAll('.eqrow')].at(-1).dataset.v);
    assert.strictEqual(last, expectLast);
    await p.keyboard.press('Home'); await p.waitForTimeout(60);
    const first = await p.evaluate(() => document.activeElement.dataset.v);
    const expectFirst = await p.evaluate(() => document.querySelector('.eqrow').dataset.v);
    assert.strictEqual(first, expectFirst);
  });
  await t('Enter selects the focused row and keeps focus', async () => {
    const tk = await p.evaluate(() => document.activeElement.dataset.v);
    await p.keyboard.press('Enter'); await p.waitForTimeout(160);
    assert.strictEqual(await S_('S.eqSel'), tk);
    assert.strictEqual(await p.evaluate(() => document.activeElement.dataset.v), tk, 'focus was dropped');
  });
  await t('Escape clears the selection', async () => {
    await p.keyboard.press('Escape'); await p.waitForTimeout(140);
    assert.strictEqual(await S_('S.eqSel'), null);
  });
  await t('Escape clears the search first', async () => {
    await p.fill('#eqsearch', 'fro'); await p.waitForTimeout(180);
    await p.focus('#eqsearch');
    await p.keyboard.press('Escape'); await p.waitForTimeout(160);
    assert.strictEqual(await S_('S.eqQuery'), '');
  });
  await t('CSV export downloads what is on screen', async () => {
    await click('[data-act="eqseg"][data-v="car"]');
    const [dl] = await Promise.all([ p.waitForEvent('download', { timeout: 8000 }), p.click('[data-act="eqexport"]') ]);
    assert.match(dl.suggestedFilename(), /^affinity-shipping-basket-.*\.csv$/);
    const rows = await p.evaluate(() => eqCSV(eqShown()).split('\r\n').length - 1);
    assert.strictEqual(rows, (await p.$$('.eqrow')).length);
    await click('[data-act="eqclear"]');
  });

  /* ── theme ───────────────────────────────────────────────────── */
  await t('theme toggles and persists', async () => {
    const before = await S_('S.theme');
    await click('[data-act="theme"]');
    const after = await S_('S.theme');
    assert.notStrictEqual(before, after);
    assert.strictEqual(await p.evaluate(() => localStorage.getItem('affinity-ops-theme')), after);
    assert.strictEqual(await p.evaluate(() => document.documentElement.getAttribute('data-theme')), after);
  });

  await t('no page errors across the whole run', async () => assert.deepStrictEqual(p.__errs, [], p.__errs.join(' | ')));

  console.log(`interactions: ${pass}/${pass + fail.length}`);
  fail.forEach(f => console.log('  FAIL', f));
  await b.close();
  process.exit(fail.length ? 1 : 0);
})();
