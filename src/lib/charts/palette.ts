/* The chart palette.
 *
 * SVG cannot inherit a CSS custom property through a `fill` attribute, so the
 * colours have to reach JS as values. On the client that is a read of the
 * computed style, exactly as the deck's readPalette() does — ask the document,
 * never the source, so the charts follow the theme.
 *
 * The server has no document. Rather than hand-copying eleven hex values into
 * a second place (which is how a palette comes to disagree with itself), the
 * light and dark defaults are PARSED out of tokens.css at build time. There is
 * still one source for every colour in this codebase.
 */
import tokensCss from "../../styles/tokens.css?raw";

export interface Palette {
  label: string;
  line: string;
  axis: string;
  rule: string;
  marker: string;
  bar: string;
  barTop: string;
  pos: string;
  neg: string;
  /** Fixed order. A bar keeps its hue whatever it ranks — see below. */
  cats: string[];
}

export type Theme = "light" | "dark";

/* The six categorical slots, in the order they were VALIDATED in.
 *
 * The palette check runs on adjacent pairs, so this order is part of the
 * result rather than a listing convention: Ports is orange specifically so it
 * never sits next to Tankers' blue. Reordering these re-opens the checks.
 * Both accepted contrast warnings are legal only while a category is never
 * shown as colour alone — every mark carries its name in text beside it. */
export const CAT_TOKENS = [
  "--c-ffa",
  "--c-dry",
  "--c-tank",
  "--c-port",
  "--c-new",
  "--c-int",
] as const;

const CHART_TOKENS = {
  label: "--chart-label",
  line: "--chart-line",
  axis: "--chart-axis",
  rule: "--chart-rule",
  marker: "--chart-marker",
  bar: "--chart-bar",
  barTop: "--chart-bar-top",
  pos: "--chart-pos",
  neg: "--chart-neg",
} as const;

/* ── parsed defaults, for the server ───────────────────────────────── */

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*(.+?);/i);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

function build(): { light: Palette; dark: Palette } {
  const darkStart = tokensCss.indexOf("@media screen{");
  const lightDecls = declarations(tokensCss.slice(tokensCss.indexOf(":root{"), darkStart));
  const darkDecls = declarations(tokensCss.slice(darkStart));

  const make = (decls: Map<string, string>, fallback?: Palette): Palette => {
    const v = (token: string, fb: string) => decls.get(token) ?? fb;
    return {
      label: v(CHART_TOKENS.label, fallback?.label ?? "#0E4152"),
      line: v(CHART_TOKENS.line, fallback?.line ?? "#196579"),
      axis: v(CHART_TOKENS.axis, fallback?.axis ?? "#5F6E74"),
      rule: v(CHART_TOKENS.rule, fallback?.rule ?? "#C6D9E0"),
      marker: v(CHART_TOKENS.marker, fallback?.marker ?? "#FFFFFF"),
      bar: v(CHART_TOKENS.bar, fallback?.bar ?? "#196579"),
      barTop: v(CHART_TOKENS.barTop, fallback?.barTop ?? "#0E4152"),
      pos: v(CHART_TOKENS.pos, fallback?.pos ?? "#1F7A4C"),
      neg: v(CHART_TOKENS.neg, fallback?.neg ?? "#C0392B"),
      cats: CAT_TOKENS.map((t, i) => v(t, fallback?.cats[i] ?? "#196579")),
    };
  };

  const light = make(lightDecls);
  // Dark only redefines what changes, so anything it omits falls back to light.
  return { light, dark: make(darkDecls, light) };
}

const PALETTES = build();

export const LIGHT: Palette = PALETTES.light;
export const DARK: Palette = PALETTES.dark;

export function paletteFor(theme: Theme): Palette {
  return theme === "dark" ? DARK : LIGHT;
}

/* ── the client's answer ───────────────────────────────────────────── */

/**
 * Lift the live custom properties into a Palette. This is the theme bridge:
 * it must run after the theme attribute is set and before a chart is drawn,
 * and it must run again when the theme changes.
 */
export function readPalette(root: HTMLElement = document.documentElement): Palette {
  const cs = getComputedStyle(root);
  const v = (token: string, fb: string) => cs.getPropertyValue(token).trim() || fb;
  return {
    label: v(CHART_TOKENS.label, LIGHT.label),
    line: v(CHART_TOKENS.line, LIGHT.line),
    axis: v(CHART_TOKENS.axis, LIGHT.axis),
    rule: v(CHART_TOKENS.rule, LIGHT.rule),
    marker: v(CHART_TOKENS.marker, LIGHT.marker),
    bar: v(CHART_TOKENS.bar, LIGHT.bar),
    barTop: v(CHART_TOKENS.barTop, LIGHT.barTop),
    pos: v(CHART_TOKENS.pos, LIGHT.pos),
    neg: v(CHART_TOKENS.neg, LIGHT.neg),
    cats: CAT_TOKENS.map((t, i) => v(t, LIGHT.cats[i]!)),
  };
}

/** The theme currently stamped on the document, for a server/client match. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  return root.dataset.theme === "dark" ? "dark" : "light";
}
