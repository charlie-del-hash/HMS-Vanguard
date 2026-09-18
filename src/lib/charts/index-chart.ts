/* The index chart.
 *
 * A rebased series lives in a narrow band around its base, so areaChart's zero
 * baseline would spend the whole frame on empty air. This one pads the
 * observed range instead and keeps the rebase line as the single reference,
 * which is the level a reader actually compares against.
 *
 * Ported from the ops deck (lines 2062–2248). The arithmetic and the placement
 * order are unchanged: checks/index-labels.js holds 357 renders with no text
 * on a line, no text on text and nothing out of frame, and
 * checks/index-anchors.js holds 1,786 chart instances with no first-or-last
 * figure dropped. Both of those results are properties of the exact ordering
 * below, so it is left alone.
 */
import type { Palette } from "./palette";
import {
  attrJSON, boxHitsBox, clamp, esc, gradId, segHitsBox, textBox,
  type Box, type Point,
  labelStep, showsLabel,
} from "./geometry";
import { crosshairLayer } from "./basic";
import { textWidth } from "../text";

export interface IndexGeom {
  W: number;
  H: number;
  L: number;
  R: number;
  T: number;
  B: number;
}

export interface Overlay<T> {
  rows: T[];
  name: string;
  color: string;
}

export interface IndexOptions<T> {
  palette: Palette;
  /** Frame geometry. Use idxGeom() unless you have a reason not to. */
  box?: IndexGeom;
  /** The rebase level, or null for none. */
  base?: number | null;
  label?: string;
  /** An optional second series on the same rebase. */
  overlay?: Overlay<T> | null;
}

/**
 * The index chart in its two homes. Both take their width from the slot that
 * measured itself, so the only difference left is the right margin: a full
 * panel has room to caption the rebase line, a side panel does not, and below
 * about 620px neither does — the caption drops to the bare number and the
 * margin comes back as plot.
 */
export const idxGeom = (w: number, side = false): IndexGeom => {
  /* No rounding and a low floor. Rounding a fractional slot width up makes the
     viewBox wider than the box it is drawn in, and the browser then SCALES it
     — which breaks the one guarantee this layer exists to give. */
  const W = Math.max(200, w);
  return side
    ? { W, H: 200, L: 16, R: 16, T: 30, B: 28 }
    : { W, H: 210, L: 18, R: Math.round(clamp(W * 0.11, 42, 76)), T: 30, B: 30 };
};

export function indexChart<T extends Record<string, any>>(
  rows: T[],
  xk: keyof T & string,
  yk: keyof T & string,
  { palette: C, box, base = null, label = "", overlay = null }: IndexOptions<T>,
): string {
  /* The side panel is half the width of a full panel, so a shared viewBox
     would render this type at half the size. The geometry travels with the
     caller instead, and the labels stay the same on screen either way. */
  const { W, H, L, R, T, B } = box ?? { W: 680, H: 210, L: 18, R: 76, T: 30, B: 30 };
  const iw = W - L - R;
  const ih = H - T - B;
  const id = gradId();

  /* The same thinning rule the area chart uses: at true size the labels crowd
     for real, so they drop out rather than shrink. The step comes from the
     width the labels measure — see labelStep in geometry.ts for why a constant
     was not enough once a daily series arrived. */
  const gap = rows.length > 1 ? iw / (rows.length - 1) : iw;
  const allVals = gap >= 40;
  const lastIdx = rows.length - 1;
  const xLabelW = Math.max(...rows.map((r) => textWidth(String(r[xk]), 11.5, 400)), 1);
  const xStep = labelStep(gap, xLabelW);
  const showsX = (j: number) => showsLabel(j, lastIdx, xStep);

  /* An optional second series on the same rebase — the selected name against
     the basket it belongs to. It has to share the scale, so its values go into
     the range before the padding is worked out, not after. */
  const ovr = overlay && overlay.rows.length === rows.length ? overlay : null;
  const vals = rows
    .map((r) => Number(r[yk]))
    .concat(base == null ? [] : [base])
    .concat(ovr ? ovr.rows.map((r) => Number(r[yk])) : []);
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const pad = Math.max((hi0 - lo0) * 0.22, 0.5);
  const lo = lo0 - pad;
  const hi = hi0 + pad;

  const xs = (i: number) => L + (rows.length < 2 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const ys = (v: number) => T + ih - ((v - lo) / (hi - lo)) * ih;

  /* Measured against the rebase where there is one, otherwise against where
     the window opened — either way the whole window, not the last tick, so the
     fill does not flip on a single down week. */
  const col =
    Number(rows.at(-1)![yk]) >= (base == null ? Number(rows[0]![yk]) : base) ? C.pos : C.neg;
  const dp = Math.abs(hi0) >= 1000 ? 0 : 1;

  const pt: Point[] = rows.map((r, j) => [xs(j), ys(Number(r[yk]))]);
  const opt: Point[] | null = ovr ? ovr.rows.map((r, j) => [xs(j), ys(Number(r[yk]))]) : null;
  const line = pt.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area =
    `${line} L${xs(lastIdx).toFixed(1)} ${(T + ih).toFixed(1)}` +
    ` L${xs(0).toFixed(1)} ${(T + ih).toFixed(1)} Z`;

  /* The rebase rule stops short of its own caption rather than running under
     it. The caption is measured, not assumed: at the widest right margin
     "REBASE 100" is wider than the margin itself, so a fixed end put the rule
     through the word. */
  const capTxt = base == null ? "" : `${R < 62 ? "" : "REBASE "}${base}`;
  const capW = capTxt ? textWidth(capTxt, 9.5, 400, 1) : 0;
  const baseY = base == null ? 0 : ys(base);
  const ruleX2 = Math.max(L + 12, Math.min(W - R + 8, W - 6 - capW - 6));

  /* Everything a figure must not land on, collected before a single figure is
     placed: both series, the rebase rule, every mark, the x labels, the rebase
     caption and the overlay's ticker. A fixed 13px above the mark was right
     for one line and wrong the moment a second shared the frame — with a name
     overlaid on the basket, 102.9, 102.8, 104.6 and 106.2 all sat on its line,
     and the first figure hung off the left edge of the frame. */
  const segs: [Point, Point][] = [];
  const boxes: Box[] = [];
  const addSegs = (ps: Point[]) => {
    for (let i = 0; i < ps.length - 1; i++) segs.push([ps[i]!, ps[i + 1]!]);
  };
  addSegs(pt);
  if (opt) addSegs(opt);
  if (base != null) segs.push([[L, baseY], [ruleX2, baseY]]);
  pt.forEach(([x, y]) => boxes.push({ x1: x - 5.5, x2: x + 5.5, y1: y - 5.5, y2: y + 5.5 }));
  rows.forEach((r, j) => {
    if (showsX(j)) {
      boxes.push(textBox(xs(j), H - 9, textWidth(String(r[xk]), 11.5, 400), 11.5));
    }
  });
  if (capTxt) boxes.push(textBox(W - 6, baseY + 3.5, capW, 9.5, "end"));

  /* Nothing is placed below this: the x labels own the bottom band, and a
     figure that reached it would be read as one of them. */
  const floorY = H - 9 - 11.5 * 0.96 - 1;
  const free = (bx: Box): boolean => {
    if (bx.x1 < 2 || bx.x2 > W - 2 || bx.y1 < 3 || bx.y2 > floorY) return false;
    /* The lines are stroked, so a box that only just clears the centreline
       still touches the stroke. Two pixels covers the widest of them. */
    const wide = { x1: bx.x1 - 2, x2: bx.x2 + 2, y1: bx.y1 - 2, y2: bx.y2 + 2 };
    return !segs.some(([p, q]) => segHitsBox(p, q, wide)) && !boxes.some((b) => boxHitsBox(bx, b));
  };

  /* The overlay is the quiet one: a thinner line, no fill and no per-point
     figures, so the basket keeps the reading and the name is the comparison
     rather than a competing series. It carries its ticker at its own end, and
     that ticker is set in the text token, not in the segment hue: the six
     category colours are validated as marks and four of the six go under AA
     the moment they are used as small text. The end dot is the mark and wears
     the hue; the label beside it is the name.

     Where the ticker goes is measured, not assumed. It used to be parked at
     the dot's right shoulder, which is wider than the margin it sits in for
     any ticker longer than about five characters — MAERSK-B measures 61px
     against a 42px margin at 320, and ran off the frame. So it takes the
     shoulder where the shoulder fits, and otherwise sits above the dot,
     right-aligned to the frame, stepping until it is clear of the basket line
     and the REBASE caption. */
  let ovLayer = "";
  if (ovr && opt) {
    const oline = opt.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const [ex, ey] = opt[lastIdx]!;
    const otw = textWidth(ovr.name, 10.5, 700);
    boxes.push({ x1: ex - 4.5, x2: ex + 4.5, y1: ey - 4.5, y2: ey + 4.5 });
    type Cand = { x: number; a: "start" | "end"; dy: number };
    const cands: Cand[] =
      ex + 7 + otw <= W - 3
        ? [
            { x: ex + 7, a: "start", dy: 3.4 },
            { x: ex + 7, a: "start", dy: -11 },
            { x: ex + 7, a: "start", dy: 16 },
          ]
        : [
            { x: W - 3, a: "end", dy: -12 },
            { x: W - 3, a: "end", dy: 17 },
            { x: W - 3, a: "end", dy: -25 },
            { x: W - 3, a: "end", dy: 30 },
          ];
    let put: (Cand & { y: number; bx: Box }) | null = null;
    for (const c of cands) {
      const y = clamp(ey + c.dy, T + 8, T + ih + 9);
      const bx = textBox(c.x, y, otw, 10.5, c.a);
      if (!free(bx)) continue;
      put = { ...c, y, bx };
      break;
    }
    /* The second series has to be named, so the last resort is the first
       candidate pulled inside the frame rather than no label at all. */
    if (!put) {
      const c = cands[0]!;
      const y = clamp(ey + c.dy, T + 12, floorY - 3);
      const x = c.a === "end" ? clamp(c.x, otw + 3, W - 3) : clamp(c.x, 3, W - 3 - otw);
      put = { ...c, x, y, bx: textBox(x, y, otw, 10.5, c.a) };
    }
    boxes.push(put.bx);
    ovLayer = `<path d="${oline}" fill="none" stroke="${ovr.color}" stroke-width="1.8"
        stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="3.2" fill="${ovr.color}"/>
      <text x="${put.x.toFixed(1)}" y="${put.y.toFixed(1)}" text-anchor="${put.a}" font-size="10.5" font-weight="700"
            fill="${C.label}">${esc(ovr.name)}</text>`;
  }

  /* Which side the figures sit on is decided once for the whole series so they
     read as a set: with a second line running above the basket they go below
     it, and the other way round. A figure whose place is taken — by a crossing
     line, the frame, a mark or a figure already down — steps further out on
     the same side before it changes sides, because two depths on one side
     still read as a set and one figure alone on the other does not. It is left
     off only once the frame has genuinely run out of room. Ends first: the two
     figures a reader compares are the ones the window opened and closed at. */
  const ovAbove = opt ? opt.filter(([, y], j) => y < pt[j]![1]).length > rows.length / 2 : false;
  const dys = ovAbove ? [18, 31, 44, -13, -26] : [-13, -26, -39, 18, 31];
  const order = [lastIdx, 0].concat(rows.map((_r, j) => j).filter((j) => j !== 0 && j !== lastIdx));
  const placed: ({ t: string; x: number; y: number } | null)[] = new Array(rows.length).fill(null);
  order.forEach((j) => {
    if (!(allVals || j === 0 || j === lastIdx)) return;
    const t = Number(rows[j]![yk]).toFixed(dp);
    const tw = textWidth(t, 12.5, 700);
    const cx = clamp(pt[j]![0], tw / 2 + 3, W - 3 - tw / 2);
    for (const dy of dys) {
      const y = pt[j]![1] + dy;
      const bx = textBox(cx, y, tw, 12.5);
      if (!free(bx)) continue;
      boxes.push(bx);
      placed[j] = { t, x: cx, y };
      break;
    }
  });

  const marks = rows
    .map((r, j) => {
      const [px, py] = pt[j]!;
      const v = placed[j];
      const showX = showsX(j);
      return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${C.marker}" stroke="${col}" stroke-width="2"/>
      ${v ? `<text x="${v.x.toFixed(1)}" y="${v.y.toFixed(1)}" text-anchor="middle" font-size="12.5" font-weight="700"
            fill="${C.label}">${v.t}</text>` : ""}
      ${showX ? `<text x="${px.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="11.5" fill="${C.axis}">${esc(r[xk])}</text>` : ""}`;
    })
    .join("");

  /* The readout names the week and the level, and where a second series shares
     the frame it names both — reading one name against the basket at a given
     week is the whole point of overlaying them. Below about 380px the frame is
     narrower than that sentence, so it drops back to the basket alone. */
  const phPts = rows.map((r, j) => ({
    x: +pt[j]![0].toFixed(1),
    y: +pt[j]![1].toFixed(1),
    oy: opt ? +opt[j]![1].toFixed(1) : null,
    t:
      `${r[xk]} · ${Number(r[yk]).toFixed(dp)}` +
      (ovr && W >= 380 ? ` · ${ovr.name} ${Number(ovr.rows[j]![yk]).toFixed(dp)}` : ""),
  }));

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || "")}"
       data-pts='${attrJSON(phPts)}'>
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${col}" stop-opacity=".01"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      ${base == null ? "" : `
        <line x1="${L}" y1="${baseY.toFixed(1)}" x2="${ruleX2.toFixed(1)}" y2="${baseY.toFixed(1)}"
              stroke="${C.axis}" stroke-width="1" stroke-dasharray="4 4"/>
        <text x="${W - 6}" y="${(baseY + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
              letter-spacing="1" fill="${C.axis}">${capTxt}</text>`}
      ${ovLayer}
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round"/>
      ${marks}
      ${crosshairLayer(T, ih, col, C, ovr?.color)}</svg>`;
}
