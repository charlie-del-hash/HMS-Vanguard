/* Price chart for a binary market: dashed 50c parity line, tinted regions
 * above and below it, and a hover crosshair driven by its own data-pts.
 *
 * Ported from the ops deck (lines 2490–2542) unchanged apart from taking the
 * palette as an argument.
 */
import type { Palette } from "./palette";
import { attrJSON, esc, gradId, SVG_FONT, win } from "./geometry";
import { crosshairLayer } from "./basic";

export interface PricePoint {
  /** Price in cents, 0–100. */
  p: number;
  /** Tick label. */
  t: string;
}

export interface PriceOptions {
  width: number;
  palette: Palette;
  /** "open" leaves the line in the neutral token; a settled market colours it. */
  state?: "open" | "resolved";
  outcome?: "yes" | "no" | null;
  /** Cap on how many points are drawn. The deck keeps the last 24. */
  keep?: number;
}

const PC = { W: 460, H: 190, L: 32, R: 46, T: 20, B: 32 };

export function priceChart(hist: PricePoint[], o: PriceOptions): string {
  const { H, L, R, T, B } = PC;
  const C = o.palette;
  const W = Math.max(200, o.width || PC.W);
  const iw = W - L - R;
  const ih = H - T - B;
  const id = gradId();
  const rows = win(hist, o.keep ?? 24);
  if (!rows.length) return "";

  const xs = (i: number) => L + (rows.length < 2 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const ys = (v: number) => T + ih - (v / 100) * ih;
  const y50 = ys(50);
  const col = o.state === "resolved" ? (o.outcome === "yes" ? C.pos : C.neg) : C.line;

  const pts = rows.map((r, j) => ({
    x: +xs(j).toFixed(1),
    y: +ys(r.p).toFixed(1),
    p: r.p,
    t: r.t,
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const x0 = pts[0]!.x;
  const xN = pts.at(-1)!.x;
  const bw = Math.max(1, xN - x0);
  const area = `${line} L${xN} ${(T + ih).toFixed(1)} L${x0} ${(T + ih).toFixed(1)} Z`;

  const gridLines = [0, 50, 100]
    .map(
      (v) =>
        `<text x="${L - 9}" y="${(ys(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
           font-family="${SVG_FONT}" fill="${C.axis}">${v}</text>`,
    )
    .join("");

  const marks =
    rows.length <= 13
      ? pts
          .map(
            (p) =>
              `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="${C.marker}" stroke="${col}" stroke-width="1.8"/>`,
          )
          .join("")
      : `<circle cx="${xN}" cy="${pts.at(-1)!.y}" r="3.6" fill="${C.marker}" stroke="${col}" stroke-width="2"/>`;

  const last = pts.at(-1)!;
  /* The readout is phrased where the chart is, not in the handler — that is
     what lets three charts of different shapes share one crosshair. */
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
       aria-label="YES price history in cents, ${esc(rows[0]!.t)} to ${esc(rows.at(-1)!.t)}"
       data-pts='${attrJSON(pts.map((p) => ({ x: p.x, y: p.y, t: `${p.t} · ${p.p}c` })))}'>
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
      <rect x="${x0}" y="${T}" width="${bw.toFixed(1)}" height="${(y50 - T).toFixed(1)}"
            fill="${C.pos}" opacity=".05"/>
      <rect x="${x0}" y="${y50.toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ih - y50).toFixed(1)}"
            fill="${C.neg}" opacity=".04"/>
      <path d="${area}" fill="url(#${id})"/>
      <line x1="${L}" y1="${y50.toFixed(1)}" x2="${W - R + 6}" y2="${y50.toFixed(1)}"
            stroke="${C.rule}" stroke-width="1" stroke-dasharray="4 4"/>
      <line x1="${L}" y1="${T + ih}" x2="${W - R + 6}" y2="${T + ih}" stroke="${C.rule}" stroke-width="1"/>
      ${gridLines}
      <path d="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round"
            stroke-linecap="round"/>
      ${marks}
      <text x="${xN + 8}" y="${(last.y + 4).toFixed(1)}" font-size="12.5" font-weight="700"
            font-family="${SVG_FONT}" fill="${col}">${last.p}c</text>
      ${rows.length > 1 ? `
        <text x="${x0}" y="${H - 8}" text-anchor="start" font-size="9.5" font-family="${SVG_FONT}"
              fill="${C.axis}">${esc(rows[0]!.t)}</text>
        <text x="${xN}" y="${H - 8}" text-anchor="end" font-size="9.5" font-family="${SVG_FONT}"
              fill="${C.axis}">${esc(rows.at(-1)!.t)}</text>` : ""}
      ${crosshairLayer(T, ih, col, C)}
    </svg>`;
}
