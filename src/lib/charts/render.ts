/* One entry point that both the server and the browser call.
 *
 * A chart spec is JSON: kind, data, options. The server renders it at a
 * declared width so the SVG is in the HTML for crawlers and for readers with
 * no JavaScript; the browser re-renders the same spec at the width the slot
 * turned out to be. Same function, same arithmetic, two widths — which is what
 * makes the second pass a correction rather than a different chart.
 */
import type { Palette } from "./palette";
import { areaChart, barChart, spark } from "./basic";
import { indexChart, idxGeom, type Overlay } from "./index-chart";
import { scatterChart, type ScatterPoint } from "./scatter";
import { priceChart, type PricePoint } from "./price";
import { mapChart, MAP_HEIGHT, type MapMarker, type MapPlace } from "./map";

export type ChartSpec =
  | {
      kind: "area";
      rows: Record<string, any>[];
      xk: string;
      yk: string;
      label?: string;
    }
  | {
      kind: "bar";
      rows: Record<string, any>[];
      xk: string;
      yk: string;
      label?: string;
      countKey?: string;
      act?: string;
    }
  | {
      kind: "index";
      rows: Record<string, any>[];
      xk: string;
      yk: string;
      base?: number | null;
      label?: string;
      overlay?: Overlay<Record<string, any>> | null;
      /** The side-panel geometry: narrower margins, no rebase caption. */
      side?: boolean;
    }
  | {
      kind: "scatter";
      points: ScatterPoint[];
      selected?: string | null;
      parity?: number | null;
      parityLabel?: string;
      xLabel?: string;
      yLabel?: string;
      quadrants?: [string, string];
      quadrantsTerse?: [string, string];
      act?: string;
    }
  | {
      kind: "price";
      hist: PricePoint[];
      state?: "open" | "resolved";
      outcome?: "yes" | "no" | null;
      keep?: number;
    }
  | {
      kind: "map";
      markers: MapMarker[];
      bbox: [number, number, number, number];
      outline?: string;
      places?: MapPlace[];
      label?: string;
    }
  | {
      kind: "spark";
      values: number[];
      color: string;
      tip?: string;
      w?: number;
      h?: number;
    };

export function renderChart(spec: ChartSpec, width: number, palette: Palette): string {
  switch (spec.kind) {
    case "area":
      return areaChart(spec.rows, spec.xk, spec.yk, spec.label ?? "", { width, palette });
    case "bar":
      return barChart(spec.rows, spec.xk, spec.yk, spec.label ?? "", {
        width,
        palette,
        countKey: spec.countKey,
        act: spec.act,
      });
    case "index":
      return indexChart(spec.rows, spec.xk, spec.yk, {
        palette,
        box: idxGeom(width, spec.side),
        base: spec.base ?? null,
        label: spec.label ?? "",
        overlay: spec.overlay ?? null,
      });
    case "scatter":
      return scatterChart(spec.points, {
        width,
        palette,
        selected: spec.selected ?? null,
        parity: spec.parity,
        parityLabel: spec.parityLabel,
        xLabel: spec.xLabel,
        yLabel: spec.yLabel,
        quadrants: spec.quadrants,
        quadrantsTerse: spec.quadrantsTerse,
        act: spec.act,
      });
    case "price":
      return priceChart(spec.hist, {
        width,
        palette,
        state: spec.state,
        outcome: spec.outcome,
        keep: spec.keep,
      });
    case "map":
      return mapChart(spec.markers, {
        width,
        palette,
        bbox: spec.bbox,
        outline: spec.outline,
        places: spec.places,
        label: spec.label,
      });
    case "spark":
      return spark(spec.values, spec.color, spec.tip, { w: spec.w, h: spec.h });
  }
}

/**
 * The height a chart will take at a given width. Charts are fixed-height by
 * design — only the width varies — so this lets the server reserve exactly the
 * right box and the second pass causes no layout shift.
 */
export function chartHeight(spec: ChartSpec): number {
  switch (spec.kind) {
    case "area":
    case "bar":
      return 210;
    case "index":
      return spec.side ? 200 : 210;
    case "scatter":
      return 310;
    case "map":
      return MAP_HEIGHT;
    case "price":
      return 190;
    case "spark":
      return spec.h ?? 24;
  }
}
