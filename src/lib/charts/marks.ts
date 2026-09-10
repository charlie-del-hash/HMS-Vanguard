/* Marks for the scatter.
 *
 * Six shapes at roughly equal visual weight, so a category is carried by shape
 * as well as hue. That redundancy is not decoration: the palette's two accepted
 * contrast warnings are legal only while a category is never shown as colour
 * alone, and a scatter is the one place with no label beside the mark.
 *
 * Ported unchanged from the ops deck (line 2284).
 */

export type MarkShape = "circle" | "square" | "diamond" | "up" | "down" | "cross";

/** The shapes in the order the six categorical slots take them. */
export const MARK_SHAPES: MarkShape[] = ["circle", "square", "diamond", "up", "down", "cross"];

export function eqMark(
  shape: MarkShape,
  cx: number,
  cy: number,
  r: number,
  fill: string,
): string {
  const p = (d: string) => `<path d="${d}" fill="${fill}"/>`;
  const x = +cx.toFixed(1);
  const y = +cy.toFixed(1);
  switch (shape) {
    case "square": {
      const h = r * 0.89;
      return `<rect x="${(x - h).toFixed(1)}" y="${(y - h).toFixed(1)}" width="${(h * 2).toFixed(1)}"
                    height="${(h * 2).toFixed(1)}" rx="1.2" fill="${fill}"/>`;
    }
    case "diamond": {
      const d = r * 1.26;
      return p(
        `M${x} ${(y - d).toFixed(1)}L${(x + d).toFixed(1)} ${y}L${x} ${(y + d).toFixed(1)}L${(x - d).toFixed(1)} ${y}Z`,
      );
    }
    case "up": {
      const w = r * 1.17;
      const h = r * 1.35;
      return p(
        `M${x} ${(y - h).toFixed(1)}L${(x + w).toFixed(1)} ${(y + h * 0.72).toFixed(1)}L${(x - w).toFixed(1)} ${(y + h * 0.72).toFixed(1)}Z`,
      );
    }
    case "down": {
      const w = r * 1.17;
      const h = r * 1.35;
      return p(
        `M${x} ${(y + h).toFixed(1)}L${(x + w).toFixed(1)} ${(y - h * 0.72).toFixed(1)}L${(x - w).toFixed(1)} ${(y - h * 0.72).toFixed(1)}Z`,
      );
    }
    case "cross": {
      const a = r * 1.25;
      const t = r * 0.42;
      return p(
        `M${(x - t).toFixed(1)} ${(y - a).toFixed(1)}H${(x + t).toFixed(1)}V${(y - t).toFixed(1)}` +
          `H${(x + a).toFixed(1)}V${(y + t).toFixed(1)}H${(x + t).toFixed(1)}V${(y + a).toFixed(1)}` +
          `H${(x - t).toFixed(1)}V${(y + t).toFixed(1)}H${(x - a).toFixed(1)}V${(y - t).toFixed(1)}` +
          `H${(x - t).toFixed(1)}Z`,
      );
    }
    default:
      return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${fill}"/>`;
  }
}
