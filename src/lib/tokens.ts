/* Reads the design tokens back out of tokens.css at build time.
 *
 * Parsed rather than transcribed, and deliberately so: a hand-kept list of
 * token names is a second copy of the palette, and a second copy of the
 * palette is how a swatch sheet comes to show a colour the site stopped
 * using. The stylesheet is the only source.
 *
 * Imported with Vite's ?raw rather than read off disk: the page is bundled
 * before it is prerendered, so import.meta.url points at the chunk and a
 * relative readFileSync misses. ?raw inlines the real file at build time and
 * behaves the same in dev, build and SSR.
 */
import tokensCss from "../styles/tokens.css?raw";

export interface Token {
  name: string;
  value: string;
  /** Whether the dark block redefines this token. */
  dark: boolean;
}
export interface TokenGroup {
  title: string;
  tokens: Token[];
}

const DECL = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);/i;
const HEADING = /\/\*\s*(.+?)\s*\*\//;

export function readTokens(): { groups: TokenGroup[]; lightCount: number; darkCount: number } {
  const css = tokensCss;
  const darkStart = css.indexOf("@media screen{");
  const root = css.slice(css.indexOf(":root{"), darkStart);
  const dark = css.slice(darkStart);

  const darkNames = new Set(
    dark.split("\n").map((l) => l.match(DECL)?.[1]).filter((n): n is string => !!n),
  );

  const groups: TokenGroup[] = [];
  let current: TokenGroup | null = null;
  for (const line of root.split("\n")) {
    const decl = line.match(DECL);
    if (decl) {
      current ??= { title: "structure", tokens: [] };
      if (!groups.includes(current)) groups.push(current);
      current.tokens.push({ name: decl[1]!, value: decl[2]!.trim(), dark: darkNames.has(decl[1]!) });
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) current = { title: heading[1]!, tokens: [] };
  }

  const filled = groups.filter((g) => g.tokens.length);
  return {
    groups: filled,
    lightCount: filled.reduce((n, g) => n + g.tokens.length, 0),
    darkCount: darkNames.size,
  };
}

/** A token whose value is a flat colour we can paint a swatch with. */
export function isSwatchable(value: string): boolean {
  return /^#|^rgb|^hsl|^color-mix|^oklch/i.test(value);
}
