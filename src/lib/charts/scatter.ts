/* Relative value scatter.
 *
 * The x axis runs on a LOG scale because it plots a ratio — 0.5x and 2x are the
 * same distance from parity, and a linear axis squashes twenty names into the
 * left third to make room for two outliers. The parity line is the reference.
 *
 * Ported from the ops deck (lines 2306–2474). The placement algorithm is
 * unchanged — checks/rest.js holds 23 of 23 labels placed with 0 overlapping
 * pairs, 0 sitting on a mark and 0 out of frame — but the data shape is
 * generalised: the deck read `pnav(r)`, `r.yld`, `r.tk`, `r.seg` off its
 * equities array directly, and a report needs to plot something else. Callers
 * normalise into ScatterPoint and the geometry is untouched.
 */
import type { Palette } from "./palette";
import { esc, niceMax, textBox, type Box } from "./geometry";
import { eqMark, type MarkShape } from "./marks";
import { textWidth } from "../text";

export interface ScatterPoint {
  /** Short label drawn beside the mark. A ticker, a country code, a code. */
  id: string;
  /** Full sentence for the tooltip and the accessible name. */
  title: string;
  /** Plotted on the log axis. Must be > 0. */
  x: number;
  /** Plotted linearly from zero. */
  y: number;
  /** Which of the six validated categorical slots this point belongs to. */
  group: number;
  shape: MarkShape;
}

export interface ScatterOptions {
  width: number;
  palette: Palette;
  /** id of the selected point, or null for "show all at full strength". */
  selected?: string | null;
  /** Reference value on the log axis. 1 for a ratio; null for none. */
  parity?: number | null;
  parityLabel?: string;
  xLabel?: string;
  yLabel?: string;
  /** The two quadrant captions, low-x-high-y first. */
  quadrants?: [string, string];
  quadrantsTerse?: [string, string];
  /** Interaction hook, emitted as data-act on each point group. */
  act?: string;
}

const SC = { H: 310, L: 34, R: 22, T: 22, B: 46 };

export function scatterChart(rows: ScatterPoint[], o: ScatterOptions): string {
  const { H, L, R, T, B } = SC;
  const C = o.palette;
  const W = Math.max(200, o.width || 680);
  const iw = W - L - R;
  const ih = H - T - B;
  if (!rows.length) return "";

  const parity = o.parity ?? 1;
  const sel = o.selected ?? null;

  /* Labels used to be forced on: when the placement ran out of room it dropped
     the ticker at its first candidate anyway, which was fine while the whole
     frame was scaled down to illegibility and invisible. Drawn at true size
     that becomes two labels on top of each other, which is worse than one
     missing. So a label is drawn if a free position exists and left off if it
     does not — the count degrades with the frame instead of the type size.
     Nothing is lost: the mark keeps its shape and hue, the legend keeps the
     category, and the tooltip and the tap both give the name. The selected
     point is placed first, so the plot always has one anchor. */
  const xv = rows.map((r) => Math.log10(r.x)).concat(parity == null ? [] : [Math.log10(parity)]);
  const yv = rows.map((r) => r.y);
  const xlo0 = Math.min(...xv);
  const xhi0 = Math.max(...xv);
  const xpad = Math.max((xhi0 - xlo0) * 0.1, 0.03);
  const xlo = xlo0 - xpad;
  const xhi = xhi0 + xpad;
  const ymax = niceMax(Math.max(...yv, 1));
  const xs = (v: number) => L + ((Math.log10(v) - xlo) / (xhi - xlo)) * iw;
  const ys = (v: number) => T + ih - (v / ymax) * ih;

  const xTicks = (W < 430 ? [0.5, 1, 2] : [0.5, 0.75, 1, 1.5, 2, 3]).filter(
    (v) => Math.log10(v) >= xlo && Math.log10(v) <= xhi,
  );
  const yTicks = [0, ymax / 2, ymax];

  const grid =
    yTicks
      .map(
        (v) => `
    <line x1="${L}" y1="${ys(v).toFixed(1)}" x2="${W - R}" y2="${ys(v).toFixed(1)}"
          stroke="${C.rule}" stroke-width="1"${v ? ' stroke-dasharray="3 4"' : ""}/>
    <text x="${L - 7}" y="${(ys(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="9.5"
          fill="${C.axis}">${v % 1 ? v.toFixed(1) : v.toFixed(0)}</text>`,
      )
      .join("") +
    xTicks
      .map(
        (v) => `
    <text x="${xs(v).toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="9.5"
          fill="${C.axis}">${v}×</text>`,
      )
      .join("");

  /* Every point keeps its label where one fits, and the placement does the
     work: right of the mark, else left, else above or below, else nudged
     clear. Marks go into the same collision set as the labels, so a label
     never lands on a point. Widths are measured, never estimated. */
  const LH = 11.5;
  const lw = (t: string) => textWidth(t, 9.5, 600) + 3;
  const boxes: Box[] = rows.map((r) => {
    const cx = xs(r.x);
    const cy = ys(r.y);
    return { x1: cx - 7, x2: cx + 7, y1: cy - 7, y2: cy + 7 };
  });

  /* The quadrant captions say on the plot what a sentence underneath it used
     to say, and used to get backwards: cheap is a low multiple, so it is to
     the left, and paying is a high yield, so it is up. These go into the
     collision set before any label is placed. */
  const terse = W < 430;
  const [q1, q2] = terse
    ? (o.quadrantsTerse ?? o.quadrants ?? ["", ""])
    : (o.quadrants ?? ["", ""]);
  const quads = [
    { t: q1, x: L + 2, y: T + 10, anchor: "start" as const },
    { t: q2, x: W - R - 2, y: T + ih - 5, anchor: "end" as const },
  ].filter((q) => q.t);

  /* Measured with its letter-spacing, not guessed — the old estimate ran about
     10px short, which let a label be placed into a caption that was really
     there. The parity caption goes in too, and a quadrant caption that would
     land on it steps down a line. */
  const capBox = (q: (typeof quads)[number], dy = 0): Box => {
    const w = textWidth(q.t, 8.5, 400, 1.1) + 4;
    const y = q.y + dy;
    return {
      x1: q.anchor === "end" ? q.x - w : q.x,
      x2: q.anchor === "end" ? q.x : q.x + w,
      y1: y - 9,
      y2: y + 3,
    };
  };
  if (parity != null) {
    boxes.push({ x1: xs(parity) + 3, x2: xs(parity) + 30, y1: T, y2: T + 12 });
  }
  quads.forEach((q) => {
    let bx = capBox(q);
    for (const dy of [0, 13, 26]) {
      bx = capBox(q, dy);
      if (!boxes.some((b) => bx.x1 < b.x2 && bx.x2 > b.x1 && bx.y1 < b.y2 && bx.y2 > b.y1)) {
        q.y += dy;
        break;
      }
    }
    boxes.push(bx);
  });
  const clash = (a: Box) =>
    boxes.some((b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1);

  /* Densest first: the crowded middle gets the good positions, and the names
     out on their own are still easy to place with what is left. */
  const order = rows
    .map((_r, i) => i)
    .sort((a, c) => {
      /* The selected point is the one label the plot must not lose. */
      const selA = !!sel && rows[a]!.id === sel;
      const selC = !!sel && rows[c]!.id === sel;
      if (selA !== selC) return selA ? -1 : 1;
      const near = (i: number) =>
        rows.reduce((n, other) => {
          const dx = xs(other.x) - xs(rows[i]!.x);
          const dy = ys(other.y) - ys(rows[i]!.y);
          return n + (dx * dx + dy * dy < 3600 ? 1 : 0);
        }, 0);
      return near(c) - near(a);
    });

  interface Placed {
    r: ScatterPoint;
    cx: number;
    cy: number;
    on: boolean;
    hide?: boolean;
    lx?: number;
    ly?: number;
    anchor?: "start" | "middle" | "end";
  }
  const pts: Placed[] = [];
  order.forEach((i) => {
    const r = rows[i]!;
    const cx = xs(r.x);
    const cy = ys(r.y);
    const on = !!sel && r.id === sel;
    const w = lw(r.id);
    const cands = [
      { lx: cx + 8, anchor: "start" as const, x1: cx + 8, dy: 3.4 },
      { lx: cx - 8, anchor: "end" as const, x1: cx - 8 - w, dy: 3.4 },
      { lx: cx, anchor: "middle" as const, x1: cx - w / 2, dy: -9 },
      { lx: cx, anchor: "middle" as const, x1: cx - w / 2, dy: 15 },
    ];
    let best: (typeof cands)[number] & { y: number; bx: Box } | null = null;
    outer: for (const nudge of [0, -LH, LH, -2 * LH, 2 * LH, -3 * LH, 3 * LH]) {
      for (const c of cands) {
        const y = cy + c.dy + nudge;
        const bx = { x1: c.x1, x2: c.x1 + w, y1: y - 8.5, y2: y + 3 };
        if (bx.x1 < 2 || bx.x2 > W - 2 || bx.y1 < T - 8 || bx.y2 > T + ih + 8) continue;
        if (clash(bx)) continue;
        best = { ...c, y, bx };
        break outer;
      }
    }
    if (!best) {
      pts.push({ r, cx, cy, on, hide: true });
      return;
    }
    boxes.push(best.bx);
    pts.push({ r, cx, cy, lx: best.lx, ly: best.y, anchor: best.anchor, on });
  });

  const named = pts.filter((p) => !p.hide).length;
  const marks = pts
    .map((p) => {
      const fill = C.cats[p.r.group % C.cats.length] || C.line;
      /* Only the dimming is written down. With nothing selected there is no
         opacity attribute at all, which is what "all of them at full strength"
         should look like in the DOM as well as on screen. */
      const hook = o.act ? ` data-act="${esc(o.act)}" data-v="${esc(p.r.id)}"` : "";
      return `<g class="scatpt"${hook}${!p.on && sel ? ` opacity="0.55"` : ""}>
      <title>${esc(p.r.title)}</title>
      ${p.on ? `<circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="11"
                        fill="none" stroke="${fill}" stroke-width="1.6" opacity=".55"/>` : ""}
      ${eqMark(p.r.shape, p.cx, p.cy, 5.6, fill)}
      ${p.hide ? "" : `<text x="${p.lx!.toFixed(1)}" y="${p.ly!.toFixed(1)}" text-anchor="${p.anchor}" font-size="9.5"
            font-weight="${p.on ? 700 : 600}" fill="${p.on ? C.label : C.axis}">${esc(p.r.id)}</text>`}
      <circle cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="9" fill="transparent"/>
    </g>`;
    })
    .join("");

  const label =
    `${o.xLabel ?? "x"} against ${o.yLabel ?? "y"}, ${rows.length} points, marked and shaped by category` +
    (named === rows.length
      ? ", each labelled"
      : `, ${named} of them labelled; the rest carry their name on the mark`);

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(label)}">
      ${grid}
      ${parity == null ? "" : `
      <line x1="${xs(parity).toFixed(1)}" y1="${T}" x2="${xs(parity).toFixed(1)}" y2="${T + ih}"
            stroke="${C.axis}" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${(xs(parity) + 5).toFixed(1)}" y="${T + 9}" font-size="9.5" letter-spacing="1"
            fill="${C.axis}">${esc(o.parityLabel ?? "PARITY")}</text>`}
      ${marks}
      ${quads
        .map(
          (q) => `<text x="${q.x.toFixed(1)}" y="${q.y.toFixed(1)}" text-anchor="${q.anchor}"
            font-size="8.5" letter-spacing="1.1" fill="${C.axis}">${esc(q.t)}</text>`,
        )
        .join("")}
      <text x="${L}" y="${H - 6}" font-size="9.5" letter-spacing=".8" fill="${C.axis}">${esc(o.xLabel ?? "")} →</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="9.5" letter-spacing=".8"
            fill="${C.axis}">↑ ${esc(o.yLabel ?? "")}</text>
    </svg>`;
}
