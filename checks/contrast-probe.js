/* Injected into the page. Walks every rendered text run in the DOM and in the
   SVGs, composites the backgrounds it can, and returns a WCAG AA failure
   signature per run. Gradients cannot be composited from computed style, which
   is where this deck's long-standing false signatures come from — so this is
   read differentially, never absolutely. */
module.exports = () => {
  /* rgb(), rgba() and color(srgb r g b / a) with 0-1 floats — the last is what
     color-mix() computes to, and a parser that assumes rgb() reads those as
     near-black and reports confident nonsense. */
  const parse = str => {
    if(!str || str === 'transparent') return [0, 0, 0, 0];
    let m = str.match(/^rgba?\(([^)]+)\)$/);
    if(m){
      const v = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
    }
    m = str.match(/^color\(srgb\s+([^)]+)\)$/);
    if(m){
      const v = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1];
    }
    return null;
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const lum = c => {
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bgOf = el => {
    let stack = [], n = el;
    while(n && n.nodeType === 1){
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if(c && c[3] > 0) stack.push(c);
      if(c && c[3] === 1) break;
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    let out = [255, 255, 255, 1];
    for(let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
    return out;
  };
  const sigOf = el => {
    const parts = [];
    let n = el;
    for(let i = 0; n && n.nodeType === 1 && i < 4; i++, n = n.parentElement){
      parts.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string'
        ? '.' + n.className.trim().split(/\s+/).slice(0, 2).join('.') : ''));
    }
    return parts.join('>');
  };

  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for(let t = walk.nextNode(); t; t = walk.nextNode()){
    const txt = t.textContent.trim();
    if(!txt) continue;
    const el = t.parentElement;
    if(!el || el.closest('.ph')) continue;
    const cs = getComputedStyle(el);
    if(cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if(!r.width || !r.height) continue;
    const fg0 = parse(cs.color);
    if(!fg0) continue;
    const bg = bgOf(el);
    const fg = over(fg0, bg);
    const size = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if(cr < need - 0.005){
      const sig = `${sigOf(el)}|${size.toFixed(1)}|${weight}`;
      if(!seen.has(sig)){ seen.add(sig); out.push({ sig, cr: +cr.toFixed(2), need, txt: txt.slice(0, 28) }); }
    }
  }
  /* SVG text carries its paint in attributes, and its background is the panel
     it is drawn on rather than anything in its own tree */
  document.querySelectorAll('svg.chart text, svg text').forEach(t => {
    if(t.closest('.ph')) return;
    const txt = t.textContent.trim();
    if(!txt) return;
    const cs = getComputedStyle(t);
    if(cs.visibility === 'hidden' || +cs.opacity === 0) return;
    const fg0 = parse(cs.fill) || parse(cs.color);
    if(!fg0) return;
    const host = t.closest('svg').parentElement;
    const bg = bgOf(host);
    const fg = over(fg0, bg);
    const size = parseFloat(cs.fontSize);
    const weight = +cs.fontWeight || 400;
    const need = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    if(cr < need - 0.005){
      const sig = `svg:${sigOf(host)}|${size.toFixed(1)}|${weight}|${/^[\d.,+\-%×c]+$/.test(txt) ? '#' : txt.slice(0, 14)}`;
      if(!seen.has(sig)){ seen.add(sig); out.push({ sig, cr: +cr.toFixed(2), need, txt: txt.slice(0, 28) }); }
    }
  });
  return out;
};
