/* The chart layer.
 *
 * Every generator is a pure function of (data, options) returning an SVG
 * string, so the same code draws on the server and in the browser. Two rules
 * hold the whole thing together and neither is negotiable:
 *
 * 1. A chart is drawn at the size it is DISPLAYED, never scaled to it. viewBox
 *    width equals CSS width, scale is 1.000, and font-size="9.5" means 9.5
 *    real pixels at every viewport. A font-size inside a scaled viewBox is not
 *    a size, it is a ratio — which is how the deck once rendered labels at
 *    4.7px on a phone and 20.3px on a tablet from the same source.
 *
 * 2. Because the size is real, crowding is real. Each chart therefore THINS
 *    its own labels rather than shrinking them: a 6px figure is not a smaller
 *    label, it is an unreadable one.
 *
 * See ChartFrame for how (1) survives server rendering.
 */
export type { Palette, Theme } from "./palette";
export { LIGHT, DARK, paletteFor, readPalette, currentTheme, CAT_TOKENS } from "./palette";

export type { Box, Point } from "./geometry";
export {
  clamp, esc, niceMax, gradId, resetGradIds, segHitsBox, boxHitsBox, textBox,
  attrJSON, SVG_FONT, win,
} from "./geometry";

export type { ChartOptions, BarOptions } from "./basic";
export { spark, areaChart, barChart, crosshairLayer } from "./basic";

export type { IndexGeom, IndexOptions, Overlay } from "./index-chart";
export { indexChart, idxGeom } from "./index-chart";

export type { MarkShape } from "./marks";
export { eqMark, MARK_SHAPES } from "./marks";

export type { ScatterPoint, ScatterOptions } from "./scatter";
export { scatterChart } from "./scatter";

export type { PricePoint, PriceOptions } from "./price";
export { priceChart } from "./price";

export type { MapMarker, MapPlace, MapOptions } from "./map";
export { mapChart, MAP_HEIGHT } from "./map";
