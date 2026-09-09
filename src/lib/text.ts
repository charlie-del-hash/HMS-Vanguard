/* Text measurement and layout.
 *
 * ── why this file exists ──────────────────────────────────────────────
 * The charts place every label against a collision set, so a label's width
 * is load-bearing geometry rather than a detail. The deck learned that the
 * hard way: it estimated labels at "5.75px a character" on the grounds that
 * one face makes the estimate safe. It was not safe — the tickers measure
 * 5.8 to 7.9 per character, up to 37% wider — it was merely invisible,
 * because the whole frame was being scaled down and two labels on top of
 * each other at 4.7px look like texture. See HANDOFF.md.
 *
 * ── the three backends ────────────────────────────────────────────────
 * canvas    single-line width on the client. The browser's own font engine,
 *           exact, and faster than anything else for a short label.
 * pretext   @chenglou/pretext. Real line breaking: multiline height, wrapped
 *           lines, variable-width line routing, and correct handling of
 *           emoji, bidi and scripts a naive measureText gets wrong. That is
 *           where it wins, so that is where it is used — routing every short
 *           ASCII label through a segmenter would be slower and no more
 *           accurate, since Pretext uses the same canvas as ground truth.
 * estimate  the server. There is no canvas in Node, so widths come from a
 *           measured per-character table (see below). It only has to be
 *           SAFE, never exact: the client pass re-measures and redraws, and
 *           an over-estimate places fewer labels while an under-estimate
 *           puts two on top of each other.
 *
 * Pretext is 0.0.9 and pinned exactly. Everything reaches it through this
 * file, so if it regresses the fallbacks below are already the whole of the
 * recovery.
 */

export type Engine = "pretext" | "canvas" | "estimate";

/** Must match --font / --num in tokens.css. */
export const SANS =
  `'Segoe UI','Segoe UI Variable Text',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif`;

/* ── the measured table ────────────────────────────────────────────────
   Advance width as a fraction of font size, for printable ASCII 32–126.
   Measured in Chromium at 200px across Segoe UI's whole declared stack plus
   Arial, Helvetica, Liberation Sans, DejaVu Sans, Verdana, Tahoma and the
   generic sans-serif/system-ui, at weights 400/600/700 — the MAX seen for
   each character, because the estimate must never come in under the real
   face. Regenerate by measuring, not by editing a number. */
const ASCII = [
  348, 456, 555, 838, 696, 1002, 872, 306, 457, 457, 523, 838, 380, 415, 380, 365,
  696, 696, 696, 696, 696, 696, 696, 696, 696, 696, 400, 400, 838, 838, 838, 611,
  1015, 774, 762, 734, 830, 683, 683, 821, 837, 389, 556, 778, 667, 995, 837, 850,
  733, 850, 770, 720, 682, 812, 774, 1103, 771, 724, 725, 457, 365, 457, 838, 556,
  500, 675, 716, 593, 716, 678, 435, 716, 712, 343, 343, 665, 343, 1042, 712, 687,
  716, 716, 493, 595, 478, 712, 652, 924, 645, 652, 582, 712, 365, 712, 838,
];

/* Anything outside ASCII — accented Latin, CJK, an emoji — is not in the
   table and must not be guessed low. CJK is full-width and emoji wider
   still, so this is deliberately generous. */
const WIDE_DEFAULT = 1.0;

/* Rounding in the table, plus faces nobody here can install to check. The
   probes it was calibrated against sat within 1.5%. */
const SAFETY = 1.04;

/**
 * The server's answer, exported because it is also the safe upper bound — a
 * caller reserving space before it can measure wants this, and /dev/text
 * checks it against the real face rather than trusting the table.
 */
export function safeEstimateWidth(t: string, px: number, tracking = 0): number {
  let ratio = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0)!;
    ratio += c >= 32 && c <= 126 ? ASCII[c - 32]! / 1000 : WIDE_DEFAULT;
  }
  return ratio * px * SAFETY + t.length * tracking;
}

/* ── backend selection ─────────────────────────────────────────────── */

const hasDom = typeof document !== "undefined";
let measureCtx: CanvasRenderingContext2D | null = null;
let resolvedFamily: string | null = null;

/** The stack the document actually resolved, not the one we declared. */
function family(): string {
  if (!hasDom) return SANS;
  resolvedFamily ??= getComputedStyle(document.body).fontFamily || SANS;
  return resolvedFamily;
}

function ctx(): CanvasRenderingContext2D | null {
  if (!hasDom) return null;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  return measureCtx;
}

/* Outside Latin Extended-B, general punctuation and currency: emoji, CJK,
   Arabic, Hebrew, combining marks. Canvas measureText is liable to get the
   advance wrong on these on its own; Pretext segments them properly. */
const COMPLEX = /[^ -ɏ -⁯₠-₿]/;

function isComplex(t: string): boolean {
  return COMPLEX.test(t);
}

export function currentEngine(): Engine {
  if (!hasDom) return "estimate";
  return pretext ? "pretext" : "canvas";
}

/* ── single-line width ─────────────────────────────────────────────── */

const cache = new Map<string, number>();

/**
 * Width of one line of text, in px, at the size it will actually be drawn.
 * Signature and memoisation match the deck's textWidth() so the ported chart
 * code calls it unchanged.
 */
export function textWidth(t: string, px: number, weight = 600, tracking = 0): number {
  const key = `${weight}|${px}|${tracking}|${t}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const c = ctx();
  let w: number;
  if (!c) {
    w = safeEstimateWidth(t, px, tracking);
  } else if (isComplex(t)) {
    w = pretextWidth(t, px, weight, tracking) ?? measureOnCanvas(c, t, px, weight, tracking);
  } else {
    w = measureOnCanvas(c, t, px, weight, tracking);
  }

  cache.set(key, w);
  return w;
}

function measureOnCanvas(
  c: CanvasRenderingContext2D,
  t: string,
  px: number,
  weight: number,
  tracking: number,
): number {
  c.font = `${weight} ${px}px ${family()}`;
  return c.measureText(t).width + t.length * tracking;
}

/** Drop memoised widths. Call after a webfont lands or the face changes. */
export function resetTextCache(): void {
  cache.clear();
  resolvedFamily = null;
}

/* ── Pretext, loaded only where it earns its place ─────────────────── */

type Pretext = typeof import("@chenglou/pretext");
let pretext: Pretext | null = null;
let pretextFailed = false;

/**
 * Pretext needs Intl.Segmenter and a Canvas 2D context, so it is a browser
 * capability rather than a dependency we can assume. Load it on the client
 * the first time anything wants line breaking; never on the server.
 */
export async function loadPretext(): Promise<Pretext | null> {
  if (pretext || pretextFailed) return pretext;
  if (!hasDom || typeof Intl?.Segmenter !== "function") {
    pretextFailed = true;
    return null;
  }
  try {
    pretext = await import("@chenglou/pretext");
  } catch {
    pretextFailed = true;
  }
  return pretext;
}

function fontString(px: number, weight: number): string {
  return `${weight} ${px}px ${family()}`;
}

/** Natural single-line width via Pretext, if it is already loaded. */
function pretextWidth(t: string, px: number, weight: number, tracking: number): number | null {
  if (!pretext) {
    void loadPretext(); // warm it for next time; this call falls back
    return null;
  }
  try {
    const prepared = pretext.prepareWithSegments(t, fontString(px, weight), {
      letterSpacing: tracking || undefined,
    });
    return pretext.measureNaturalWidth(prepared);
  } catch {
    return null;
  }
}

/* ── multiline ─────────────────────────────────────────────────────── */

export interface WrapOptions {
  px: number;
  weight?: number;
  tracking?: number;
  maxWidth: number;
  /** Defaults to 1.35 x px. */
  lineHeight?: number;
}

export interface WrappedText {
  lines: string[];
  /** Width of the widest line, not the width asked for. */
  width: number;
  height: number;
  lineCount: number;
  /** False when this came from the fallback rather than real line breaking. */
  exact: boolean;
}

/**
 * Break text to a width. Pretext where it is available, and a word-greedy
 * fallback measured with textWidth() where it is not — which is the server,
 * and which only has to be safe for the same reason the estimate does.
 */
export function wrapText(t: string, o: WrapOptions): WrappedText {
  const { px, weight = 400, tracking = 0, maxWidth } = o;
  const lineHeight = o.lineHeight ?? px * 1.35;

  if (pretext) {
    try {
      const prepared = pretext.prepareWithSegments(t, fontString(px, weight), {
        letterSpacing: tracking || undefined,
      });
      const res = pretext.layoutWithLines(prepared, maxWidth, lineHeight);
      return {
        lines: res.lines.map((l) => l.text),
        width: res.lines.reduce((m, l) => Math.max(m, l.width), 0),
        height: res.height,
        lineCount: res.lineCount,
        exact: true,
      };
    } catch {
      /* fall through to the greedy path */
    }
  }

  // Greedy by word. Enough to reserve space; never claims to be exact.
  const lines: string[] = [];
  let line = "";
  let widest = 0;
  for (const word of t.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, px, weight, tracking) > maxWidth) {
      widest = Math.max(widest, textWidth(line, px, weight, tracking));
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
    widest = Math.max(widest, textWidth(line, px, weight, tracking));
  }
  return {
    lines,
    width: widest,
    height: Math.max(1, lines.length) * lineHeight,
    lineCount: Math.max(1, lines.length),
    exact: false,
  };
}

/** Height only — the cheap path, for reserving space before drawing. */
export function measureHeight(t: string, o: WrapOptions): number {
  if (pretext) {
    try {
      const prepared = pretext.prepare(t, fontString(o.px, o.weight ?? 400), {
        letterSpacing: o.tracking || undefined,
      });
      return pretext.layout(prepared, o.maxWidth, o.lineHeight ?? o.px * 1.35).height;
    } catch {
      /* fall through */
    }
  }
  return wrapText(t, o).height;
}

export interface FlowedLine {
  text: string;
  width: number;
  /** Width this line was routed into, which is not the width it used. */
  maxWidth: number;
  y: number;
}

/**
 * Variable-width line routing: each line asks how much room it has at its own
 * vertical position, so prose can narrow around an inset map or a pull-figure
 * and reopen underneath it.
 *
 * This is the one thing here with no fallback worth the name — without real
 * line breaking you cannot ask "what fits on the line at y?" — so it returns
 * null rather than pretending, and the caller keeps a rectangular column.
 * Await loadPretext() before calling it.
 */
export function flowText(
  t: string,
  o: Omit<WrapOptions, "maxWidth">,
  widthAt: (lineIndex: number, y: number) => number,
): { lines: FlowedLine[]; height: number } | null {
  if (!pretext) return null;
  const { px, weight = 400, tracking = 0 } = o;
  const lineHeight = o.lineHeight ?? px * 1.35;

  try {
    const prepared = pretext.prepareWithSegments(t, fontString(px, weight), {
      letterSpacing: tracking || undefined,
    });
    const lines: FlowedLine[] = [];
    let cursor = { segmentIndex: 0, graphemeIndex: 0 };
    let y = 0;
    // Bounded: a pathological widthAt returning ~0 would otherwise spin.
    for (let i = 0; i < 5000; i++) {
      const maxWidth = Math.max(1, widthAt(i, y));
      const range = pretext.layoutNextLineRange(prepared, cursor, maxWidth);
      if (!range) break;
      const line = pretext.materializeLineRange(prepared, range);
      lines.push({ text: line.text, width: line.width, maxWidth, y });
      if (
        range.end.segmentIndex === cursor.segmentIndex &&
        range.end.graphemeIndex === cursor.graphemeIndex
      ) {
        break; // no progress; a width nothing fits into
      }
      cursor = range.end;
      y += lineHeight;
    }
    return { lines, height: y };
  } catch {
    return null;
  }
}
