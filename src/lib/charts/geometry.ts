/* Shared chart primitives, ported from the ops deck.
 *
 * These are the pieces the label placement is built on. They are ported
 * unchanged from a heavily-checked original — checks/index-labels.js,
 * checks/index-anchors.js and checks/charts.js all measure the results these
 * produce — so the arithmetic is deliberately left exactly as it was.
 */

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape for interpolation into markup. Every label goes through this. */
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Axis rounding: 1 / 1.5 / 2 / 3 / 5 / 7.5 / 10 times a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 5 ? 5 : n <= 7.5 ? 7.5 : 10;
  return m * p;
}

/* Gradient ids have to be unique within a document, and a page can now carry
   several charts from several islands. A module counter is enough on the
   client; on the server each render gets its own module instance per request,
   so a prefix keeps a hydrating chart from colliding with the markup it is
   replacing. */
let gradSeq = 0;
export const gradId = (prefix = "g"): string => `${prefix}${++gradSeq}`;
export const resetGradIds = (): void => {
  gradSeq = 0;
};

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export type Point = [number, number];

/**
 * Does a line segment cross an axis-aligned box? Used to keep a chart's
 * figures off the lines they describe. Cheap enough to run per candidate
 * position: four corner crossings plus the two containment cases.
 */
export function segHitsBox(p: Point, q: Point, r: Box): boolean {
  const inside = (t: Point) => t[0] >= r.x1 && t[0] <= r.x2 && t[1] >= r.y1 && t[1] <= r.y2;
  if (inside(p) || inside(q)) return true;
  const ccw = (a: Point, b: Point, c: Point) =>
    (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0]);
  const cross = (a: Point, b: Point, c: Point, d: Point) =>
    ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  const k: Point[] = [
    [r.x1, r.y1],
    [r.x2, r.y1],
    [r.x2, r.y2],
    [r.x1, r.y2],
  ];
  for (let i = 0; i < 4; i++) if (cross(p, q, k[i]!, k[(i + 1) % 4]!)) return true;
  return false;
}

export const boxHitsBox = (a: Box, b: Box): boolean =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

/**
 * getBBox on a <text> returns the em box, not the ink: measured across this
 * deck's face it runs 0.96x the font size above the baseline and 0.24x below.
 * Placement uses the same box the checks measure, so the two cannot disagree.
 */
export const textBox = (
  x: number,
  y: number,
  w: number,
  px: number,
  anchor: "middle" | "start" | "end" = "middle",
): Box => ({
  x1: anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2,
  x2: anchor === "end" ? x : anchor === "start" ? x + w : x + w / 2,
  y1: y - px * 0.96,
  y2: y + px * 0.24,
});

/**
 * The payload for the hover readout rides in a single-quoted attribute, so
 * the quote and the two characters that could end the attribute or open a tag
 * are escaped.
 */
export const attrJSON = (o: unknown): string =>
  JSON.stringify(o).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");

/** Chart figures ride the same sans as the rest of the site. */
export const SVG_FONT =
  "Segoe UI,Segoe UI Variable Text,system-ui,-apple-system,Helvetica Neue,Arial,sans-serif";


/* ── x-axis label thinning ────────────────────────────────────────────
 *
 * Both time-series charts used `gap < 30 ? 2 : 1`, which caps thinning at
 * every-other-point. That holds for the deck's own series — a dozen to a
 * couple of dozen points — and falls apart the moment a chart is handed a
 * daily series: 58 points in a 320px column is a 5px gap, and every other
 * label still overlaps the next four.
 *
 * The step is therefore derived from the width the labels actually measure,
 * which is the same lesson as the "5.75px a character" bug in HANDOFF.md:
 * a constant that happens to suit the data in front of you is not a rule.
 */

/** How many points to skip between x labels so they cannot touch. */
export function labelStep(gap: number, maxLabelW: number, pad = 9): number {
  if (!Number.isFinite(gap) || gap <= 0) return 1;
  return Math.max(1, Math.ceil((maxLabelW + pad) / gap));
}

/**
 * Whether index `j` carries a label.
 *
 * The last point always does — it is the one a reader looks for. Which means
 * the one before it must be far enough away: labelling on `j % step` alone
 * puts a label right beside the final one whenever the count is not a multiple
 * of the step, and that pair is exactly the collision nobody notices in a
 * gallery and everybody sees in an article.
 */
export function showsLabel(j: number, lastIdx: number, step: number): boolean {
  if (j === lastIdx) return true;
  return j % step === 0 && lastIdx - j >= step;
}

/** Last n items, or all of them. */
export const win = <T,>(a: T[], n: number): T[] => (a.length > n ? a.slice(-n) : a);
