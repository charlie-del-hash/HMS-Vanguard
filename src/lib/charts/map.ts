/* An incident map, drawn like every other chart here rather than like a map.
 *
 * ── why this is not a tile layer ──────────────────────────────────────
 * A basemap means a third-party request on every report view. That is a
 * tracking surface the funnel does not want (first-party analytics, no consent
 * banner — the whole point), a dependency that can fail or change its terms,
 * and a licence to honour. The strait is a coastline and nine markers; the
 * coastline is data we can carry.
 *
 * ── why it lives in the chart layer ───────────────────────────────────
 * Because the guarantee has to hold here too. An SVG with a fixed viewBox
 * stretched to fit its box scales its text — 9px becomes 6px on a phone and
 * 14px on a desktop — which is exactly the failure the whole two-pass
 * arrangement exists to prevent. Drawing at the measured width instead means
 * the labels are the size they say they are, and ChartFrame's observer, theme
 * repaint and font-ready repaint all come for free.
 *
 * ── the projection ────────────────────────────────────────────────────
 * Equirectangular with the longitude axis compressed by cos(mid latitude), so
 * the strait is not stretched sideways. Fitted inside the frame rather than
 * filling it: a map that fills its box has been rescaled in one axis, and the
 * shape of a coastline is the one thing it has to get right.
 */
import type { Palette } from "./palette";
import { boxHitsBox, esc, textBox, type Box } from "./geometry";
import { textWidth } from "../text";

export interface MapMarker {
  lon: number;
  lat: number;
  title: string;
  /** Drawn as shape AND colour — never colour alone. */
  confidence: "confirmed" | "reported" | "unconfirmed";
  /** Short label placed beside the marker where there is room for it. */
  label?: string;
}

export interface MapPlace {
  lon: number;
  lat: number;
  text: string;
  anchor?: "start" | "middle" | "end";
}

export interface MapOptions {
  width: number;
  palette: Palette;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Polylines of "lon,lat lon,lat …", several separated by "|". */
  outline?: string;
  places?: MapPlace[];
  label?: string;
}

export const MAP_HEIGHT = 340;
const MIN_W = 200;

export function mapChart(markers: MapMarker[], o: MapOptions): string {
  const W = Math.max(MIN_W, o.width || 680);
  const H = MAP_HEIGHT;
  const PAD = 14;
  const BOTTOM = 26; // the legend sits here

  const [west, south, east, north] = o.bbox;
  const midLat = (south + north) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);

  const geoW = (east - west) * kx;
  const geoH = north - south;
  const iw = W - PAD * 2;
  const ih = H - PAD - BOTTOM;

  /* Fit, never fill. The smaller scale wins so the whole bbox is visible and
     the aspect ratio is the real one. */
  const s = Math.min(iw / geoW, ih / geoH);
  const cx = PAD + iw / 2;
  const cy = PAD + ih / 2;
  const midLon = (west + east) / 2;

  const X = (lon: number) => cx + (lon - midLon) * kx * s;
  const Y = (lat: number) => cy - (lat - midLat) * s;

  const C = o.palette;

  /* ── land ──────────────────────────────────────────────────────────
     Drawn as an open polyline, not a filled polygon: this is a coastline
     fragment rather than a country, and closing it would invent a border. */
  const coast = (o.outline ?? "")
    .split("|")
    .filter(Boolean)
    .map((run) => {
      const d = run
        .trim()
        .split(/\s+/)
        .map((pair, i) => {
          const [lon, lat] = pair.split(",").map(Number);
          return `${i ? "L" : "M"}${X(lon).toFixed(1)} ${Y(lat).toFixed(1)}`;
        })
        .join(" ");
      return `<path d="${d}" fill="none" stroke="${C.rule}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");

  /* ── placed text, with the same collision discipline as the charts ──
     Every label takes the first free position from a set, measured against
     what is already down. A label that cannot be placed is DROPPED, not
     shrunk — a 6px place name is not a smaller label, it is an unreadable
     one. */
  const placed: Box[] = [];

  const placeNames = (o.places ?? [])
    .map((p) => {
      const px = 10;
      const anchor = p.anchor ?? "middle";
      const x = X(p.lon);
      const y = Y(p.lat);
      const w = textWidth(p.text, px, 600, 1.6);
      const b = textBox(x, y, w, px, anchor);
      if (placed.some((q) => boxHitsBox(b, q))) return "";
      placed.push(b);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${px}"
        font-weight="600" letter-spacing="1.6" fill="${C.axis}" opacity=".75">${esc(p.text)}</text>`;
    })
    .join("");

  /* Markers are placed before their labels, so a label never lands on another
     incident's marker. */
  for (const m of markers) {
    const x = X(m.lon);
    const y = Y(m.lat);
    placed.push({ x1: x - 7, y1: y - 7, x2: x + 7, y2: y + 7 });
  }

  const dots = markers
    .map((m) => {
      const x = X(m.lon);
      const y = Y(m.lat);
      const common = `cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"`;
      const t = esc(m.title);
      /* Shape carries confidence. Colour repeats it; it never carries it
         alone, which is the palette validator's standing rule. */
      if (m.confidence === "confirmed") {
        return `<g><title>${t}</title>
          <circle ${common} r="5.5" fill="${C.line}" stroke="${C.marker}" stroke-width="1.5"/></g>`;
      }
      if (m.confidence === "reported") {
        return `<g><title>${t}</title>
          <circle ${common} r="5" fill="${C.marker}" stroke="${C.line}" stroke-width="2"/></g>`;
      }
      return `<g><title>${t}</title>
        <circle ${common} r="5" fill="none" stroke="${C.axis}" stroke-width="1.5" stroke-dasharray="2.5 2.5"/></g>`;
    })
    .join("");

  const labels = markers
    .map((m) => {
      if (!m.label) return "";
      const px = 9.5;
      const x = X(m.lon);
      const y = Y(m.lat);
      const w = textWidth(m.label, px, 400, 0.6);
      /* Four positions, tried in order: right, left, above, below. */
      const cands: { x: number; y: number; anchor: "start" | "end" | "middle" }[] = [
        { x: x + 9, y: y + 3.4, anchor: "start" },
        { x: x - 9, y: y + 3.4, anchor: "end" },
        { x, y: y - 10, anchor: "middle" },
        { x, y: y + 14, anchor: "middle" },
      ];
      for (const c of cands) {
        const b = textBox(c.x, c.y, w, px, c.anchor);
        if (b.x1 < 2 || b.x2 > W - 2 || b.y1 < 2 || b.y2 > H - BOTTOM) continue;
        if (placed.some((q) => boxHitsBox(b, q))) continue;
        placed.push(b);
        return `<text x="${c.x.toFixed(1)}" y="${c.y.toFixed(1)}" text-anchor="${c.anchor}"
          font-size="${px}" fill="${C.label}">${esc(m.label)}</text>`;
      }
      return ""; // nowhere free — thin rather than overlap
    })
    .join("");

  /* ── legend ────────────────────────────────────────────────────────
     The key to the shapes, which is the only thing making this map honest
     about what it does and does not know. */
  const ly = H - 8;
  const key: [string, string][] = [
    ["confirmed", "Confirmed"],
    ["reported", "Reported"],
    ["unconfirmed", "Unconfirmed"],
  ];
  let lx = PAD;
  const legend = key
    .map(([k, text]) => {
      const cxp = lx + 5;
      const mark =
        k === "confirmed"
          ? `<circle cx="${cxp}" cy="${ly - 3.5}" r="4.5" fill="${C.line}"/>`
          : k === "reported"
            ? `<circle cx="${cxp}" cy="${ly - 3.5}" r="4" fill="${C.marker}" stroke="${C.line}" stroke-width="1.6"/>`
            : `<circle cx="${cxp}" cy="${ly - 3.5}" r="4" fill="none" stroke="${C.axis}" stroke-width="1.3" stroke-dasharray="2.5 2.5"/>`;
      const tx = cxp + 8;
      const w = textWidth(text, 9.5, 400, 0.8);
      const out = `${mark}<text x="${tx.toFixed(1)}" y="${ly}" font-size="9.5" letter-spacing=".8"
        fill="${C.axis}">${esc(text)}</text>`;
      lx = tx + w + 16;
      /* Past the right edge it is dropped rather than wrapped — the legend is
         three words and a narrow phone gets the two that fit. */
      return lx > W - PAD + 16 ? "" : out;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
      aria-label="${esc(o.label || "Incident map")}">
      <rect x="0" y="0" width="${W}" height="${H}" fill="none"/>
      ${coast}${placeNames}${dots}${labels}${legend}</svg>`;
}
