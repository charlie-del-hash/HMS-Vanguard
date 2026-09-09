/* spark, areaChart, barChart and the crosshair layer.
 *
 * Ported from the ops deck (lines 1884–2032) with the arithmetic unchanged.
 * The one structural change is that the palette arrives as an argument
 * instead of a module global, because these now run on the server too, where
 * there is no document to read it from.
 *
 * The deck idiom throughout: label the data, drop the axis furniture, keep one
 * baseline. Inline SVG, no libraries.
 */
import type { Palette } from "./palette";
import { boxHitsBox, clamp, esc, gradId, niceMax, SVG_FONT, textBox, type Box } from "./geometry";
import { textWidth } from "../text";

/* A guard against a degenerate measurement (a slot measured before layout),
   not a design minimum. It used to be 260, which is wider than the slot a
   chart actually gets at 320px inside an article column with panel padding —
   and a viewBox wider than its box is drawn SCALED, which is the one thing
   this whole layer exists to prevent. Below this the charts thin themselves;
   they do not shrink. */
const MIN_W = 200;

export interface ChartOptions {
  /** The width the chart will actually be displayed at. Not a viewBox ratio. */
  width: number;
  palette: Palette;
}

/* ── sparkline ─────────────────────────────────────────────────────── */

export function spark(
  vals: number[],
  color: string,
  tip?: string,
  { w = 78, h = 24 }: { w?: number; h?: number } = {},
): string {
  const iw = w - 3;
  const d = vals.length < 2 ? [vals[0]!, vals[0]!] : vals;
  const mn = Math.min(...d);
  const mx = Math.max(...d);
  const sp = mx - mn || 1;
  const pt = d.map((v, i): [number, number] => [
    (i / (d.length - 1)) * iw,
    h - 3 - ((v - mn) / sp) * (h - 6),
  ]);
  const line = pt.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const [lx, ly] = pt.at(-1)!;
  return `<svg width="${w}" height="${h}" role="img" aria-label="${esc(tip || "price history")}">
      ${tip ? `<title>${esc(tip)}</title>` : ""}
      <path d="${line} L${iw} ${h} L0 ${h} Z" fill="${color}" opacity=".13"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linejoin="round"/>
      <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2" fill="${color}"/>
    </svg>`;
}

/* ── area chart, with a dashed mean reference ──────────────────────── */

export function areaChart<T extends Record<string, any>>(
  rows: T[],
  xk: keyof T & string,
  yk: keyof T & string,
  label: string,
  { width, palette: C }: ChartOptions,
): string {
  const W = Math.max(MIN_W, width || 680);
  const H = 210;
  const T = 30;
  const B = 30;
  const L = 18;
  const R = clamp(W * 0.1, 44, 66);
  const iw = W - L - R;
  const ih = H - T - B;
  const id = gradId();

  /* Drawn at true size, so crowding is real. Where the points sit closer than
     a label is wide the labels thin out rather than shrink — a 6px figure is
     not a smaller label, it is an unreadable one. */
  const gap = rows.length > 1 ? iw / (rows.length - 1) : iw;
  const allVals = gap >= 40;
  const xEvery = gap < 30 ? 2 : 1;

  const vals = rows.map((r) => Number(r[yk]));
  const max = niceMax(Math.max(...vals));
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const xs = (i: number) => L + (rows.length < 2 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const ys = (v: number) => T + ih - (v / max) * ih;

  const line = rows
    .map((r, j) => `${j ? "L" : "M"}${xs(j).toFixed(1)} ${ys(Number(r[yk])).toFixed(1)}`)
    .join(" ");
  const area =
    `${line} L${xs(rows.length - 1).toFixed(1)} ${ys(0).toFixed(1)}` +
    ` L${xs(0).toFixed(1)} ${ys(0).toFixed(1)} Z`;
  const last = rows.length - 1;

  /* The mean caption sits in the right margin, at a fixed spot, while the
     value labels are parked above their points — so nothing was stopping the
     last value and the caption occupying the same pixels. In the deck's own
     column widths they cleared each other by a few px and the case never
     showed; in a narrower one "339.1" lands on "302".

     The caption is the droppable half: the dashed rule still reads as a mean
     with or without its number, and a value label is a fact about a point.
     So it is measured against every label that will be drawn, and left off
     where it would collide — thinning rather than overlapping, like
     everything else here. */
  const capTxt = `${R < 60 ? "" : "MEAN "}${mean.toFixed(1)}`;
  const capY = ys(mean) + 3.5;
  const capBox = textBox(W - 6, capY, textWidth(capTxt, 9.5, 400, 1), 9.5, "end");
  const labelBoxes: Box[] = [];
  rows.forEach((r, j) => {
    if (allVals || j === 0 || j === rows.length - 1) {
      const t = String(r[yk]);
      labelBoxes.push(textBox(xs(j), ys(Number(r[yk])) - 13, textWidth(t, 13, 700), 13));
    }
    if (j % xEvery === 0 || j === rows.length - 1) {
      labelBoxes.push(textBox(xs(j), H - 9, textWidth(String(r[xk]), 11.5, 400), 11.5));
    }
  });
  const showCap = !labelBoxes.some((b) => boxHitsBox(capBox, b));

  const marks = rows
    .map((r, j) => {
      const x = xs(j).toFixed(1);
      const y = ys(Number(r[yk]));
      const showV = allVals || j === 0 || j === last;
      const showX = j % xEvery === 0 || j === last;
      return `<circle cx="${x}" cy="${y.toFixed(1)}" r="4" fill="${C.marker}" stroke="${C.line}" stroke-width="2"/>
      ${showV ? `<text x="${x}" y="${(y - 13).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700"
            fill="${C.label}">${esc(r[yk])}</text>` : ""}
      ${showX ? `<text x="${x}" y="${H - 9}" text-anchor="middle" font-size="11.5" fill="${C.axis}">${esc(r[xk])}</text>` : ""}`;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label || "")}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${C.line}" stop-opacity=".24"/>
        <stop offset="100%" stop-color="${C.line}" stop-opacity=".01"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})"/>
      <line x1="${L}" y1="${ys(0).toFixed(1)}" x2="${W - R + 8}" y2="${ys(0).toFixed(1)}"
            stroke="${C.rule}" stroke-width="1"/>
      <line x1="${L}" y1="${ys(mean).toFixed(1)}" x2="${W - R + 8}" y2="${ys(mean).toFixed(1)}"
            stroke="${C.axis}" stroke-width="1" stroke-dasharray="4 4"/>
      ${showCap ? `<text x="${W - 6}" y="${capY.toFixed(1)}" text-anchor="end" font-size="9.5"
            letter-spacing="1" fill="${C.axis}">${esc(capTxt)}</text>` : ""}
      <path d="${line}" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linejoin="round"/>
      ${marks}</svg>`;
}

/* ── bar chart: leader picked out, direct labels, baseline only ────── */

export interface BarOptions extends ChartOptions {
  /**
   * Optional key holding how many things each bar averages. Six segment
   * returns read very differently once you can see that one of them is four
   * names and another is five, and the bar chart is the only place that fits.
   */
  countKey?: string;
  /** Makes the bars a way into a filter. Needs a `k` on each row. */
  act?: string;
}

export function barChart<T extends Record<string, any>>(
  rows: T[],
  xk: keyof T & string,
  yk: keyof T & string,
  label: string,
  { width, palette: C, countKey: nk, act }: BarOptions,
): string {
  const W = Math.max(MIN_W, width || 680);
  const H = 210;
  const L = 16;
  const R = 16;
  const T = 30;
  const iw = W - L - R;
  const vals = rows.map((r) => Number(r[yk]));
  const max = niceMax(Math.max(...vals));
  const step = iw / rows.length;
  const bw = Math.min(24, step * 0.52);

  /* At true size a label has to fit the step it sits under, and "Car carriers"
     does not fit a 50px column at 11px. A name wraps over more lines first,
     because that keeps the type at full size; only then does the size come
     down, and never below 8.5px — under that it stops being a label.

     Widths are MEASURED. The deck estimated them at 0.55 of the type size per
     character, which is the same class of shortcut that put two scatter
     tickers on top of each other: real strings run from 0.34 ("l") to 1.10
     ("W") per character, so a six-letter word can be 40% wider or narrower
     than the estimate says. At the deck's own column widths the estimate
     happened to hold; one column narrower and "Suezmax" lands on "Aframax". */
  const AVAIL = step - 4;
  const fitLabel = (t: unknown) => {
    const words = String(t).split(" ");
    // Greedy wrap at the full type size, measured.
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, 11, 400) > AVAIL) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);

    // The widest line decides the size. Advance is near enough linear in the
    // type size over this range, so one measurement scales.
    const widest = Math.max(...lines.map((l) => textWidth(l, 11, 400)));
    const fs = clamp(widest > 0 ? (11 * AVAIL) / widest : 11, 8.5, 11);
    return { lines, fs };
  };
  const fits = rows.map((r) => fitLabel(r[xk]));
  const maxLines = Math.max(...fits.map((f) => f.lines.length));

  /* The frame gives back exactly the room the labels turned out to need. */
  const LINE = 13;
  const B = 22 + maxLines * LINE + (nk ? 11 : 0);

  /* "4 NAMES" is 43px with its letter-spacing and does not fit a 46px column,
     so where the step is tight the count says the same thing in a third of the
     room. It is never the only thing identifying the bar — the segment name is
     directly above it. */
  const cntTxt = (n: number) => (step - 4 >= 50 ? `${n} NAME${n === 1 ? "" : "S"}` : `n=${n}`);
  const ih = H - T - B;

  const bars = rows
    .map((r, j) => {
      const bh = Math.max(2, (Number(r[yk]) / max) * ih);
      const x = L + step * j + (step - bw) / 2;
      const by = T + ih - bh;
      /* The hue belongs to the entity, so re-sorting or filtering never
         repaints the survivors — it used to mark whichever bar was tallest. */
      const fill = C.cats[j % C.cats.length]!;
      /* Rounded cap, square where it meets the baseline. */
      const cr = Math.min(4, bh / 2, bw / 2);
      const cap =
        `M${x.toFixed(1)} ${(by + bh).toFixed(1)} L${x.toFixed(1)} ${(by + cr).toFixed(1)}` +
        ` Q${x.toFixed(1)} ${by.toFixed(1)} ${(x + cr).toFixed(1)} ${by.toFixed(1)}` +
        ` L${(x + bw - cr).toFixed(1)} ${by.toFixed(1)}` +
        ` Q${(x + bw).toFixed(1)} ${by.toFixed(1)} ${(x + bw).toFixed(1)} ${(by + cr).toFixed(1)}` +
        ` L${(x + bw).toFixed(1)} ${(by + bh).toFixed(1)} Z`;
      const mid = (x + bw / 2).toFixed(1);
      const g =
        act && r.k
          ? `<g class="barhit" data-act="${esc(act)}" data-v="${esc(r.k)}"><title>${esc(r[xk])}: filter to this segment</title>`
          : "<g>";
      const f = fits[j]!;
      const labelTop = H - B + 14;
      return `${g}<path d="${cap}" fill="${fill}"/>
      <text x="${mid}" y="${(by - 9).toFixed(1)}" text-anchor="middle" font-size="13"
            font-weight="700" fill="${C.label}">${esc(r[yk])}</text>
      ${f.lines
        .map(
          (ln, k) => `<text x="${mid}" y="${(labelTop + k * LINE).toFixed(1)}" text-anchor="middle"
            font-size="${f.fs.toFixed(1)}" fill="${C.axis}">${esc(ln)}</text>`,
        )
        .join("")}
      ${nk ? `<text x="${mid}" y="${(labelTop + maxLines * LINE + 1).toFixed(1)}" text-anchor="middle"
            font-size="8.5" letter-spacing="${step - 4 >= 50 ? ".9" : "0"}" fill="${C.axis}">${cntTxt(Number(r[nk]))}</text>` : ""}
      ${act && r.k ? `<rect x="${(L + step * j).toFixed(1)}" y="${T}" width="${step.toFixed(1)}"
            height="${ih.toFixed(1)}" fill="transparent"/>` : ""}
      </g>`;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
      ${bars}
      <line x1="${L}" y1="${T + ih}" x2="${W - R}" y2="${T + ih}" stroke="${C.rule}" stroke-width="1"/>
    </svg>`;
}

/* ── the hover readout layer ───────────────────────────────────────── */

/**
 * A chart opts into the hover readout by carrying `data-pts` and one of these
 * layers.
 *
 * Both hooks used to be ids in the deck — `#pricechart` and `#ph` — which is
 * exactly why the coverage basket and the side-panel chart had no readout: two
 * ids cannot coexist in one document, so only the price chart could ever have
 * one. They are classes, and the geometry travels with the chart, so the
 * handler reads the frame it is actually drawn in.
 */
export function crosshairLayer(
  T: number,
  ih: number,
  col: string,
  C: Palette,
  col2?: string,
): string {
  return `<g class="ph" opacity="0" pointer-events="none">
      <line class="ph-line" y1="${T}" y2="${(T + ih).toFixed(1)}" stroke="${C.axis}" stroke-width="1" stroke-dasharray="3 3"/>
      ${col2 ? `<circle class="ph-dot2" r="3.4" fill="${col2}" stroke="${C.marker}" stroke-width="1.6"/>` : ""}
      <circle class="ph-dot" r="4" fill="${col}" stroke="${C.marker}" stroke-width="1.6"/>
      <rect class="ph-box" y="${T - 4}" height="16" rx="3" fill="${C.label}" opacity=".92"/>
      <text class="ph-lab" y="${T + 7.5}" text-anchor="middle" font-size="9.5" font-weight="700"
            font-family="${SVG_FONT}" fill="${C.marker}"></text>
    </g>`;
}
