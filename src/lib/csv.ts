/* Pasted CSV into rows, with the repo's rules intact at the point of import.
 *
 * Two of them matter here, and both are about not inventing:
 *
 *   an empty value is a GAP, not a zero. 0002_data.sql says a gap is a fact
 *   about the world — no print that day, a holiday, a suspended assessment —
 *   and `Number("")` is 0, so a parser that is not deliberate about this turns
 *   every missing day into a collapse to the baseline. The area chart draws
 *   gaps properly and the loader refuses to hand a gapped series to a chart
 *   that cannot; none of that helps if the gap was destroyed on the way in.
 *
 *   confidence defaults to `reported`, not `confirmed`. `reported` is the
 *   honest answer when nobody has said otherwise — one outlet carried it and
 *   nobody has denied it. Defaulting the other way would mark every imported
 *   row as on-the-record.
 */

const CONFIDENCE = ["confirmed", "reported", "unconfirmed"] as const;
type Confidence = (typeof CONFIDENCE)[number];

/** Split one CSV line, honouring double quotes around commas. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function lines(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(splitLine);
}

/**
 * A date to an ISO timestamp.
 *
 * A bare date means midnight UTC, stated rather than left to whatever timezone
 * the server happens to be in — a series point landing a day either side of
 * where the author meant it is invisible until it is on a chart.
 */
function toIso(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00.000Z`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface PointRow {
  ts: string;
  value: number | null;
}

/** `date,value` per line. A header row is skipped. */
export function parsePoints(csv: string): PointRow[] {
  const out: PointRow[] = [];
  for (const [i, cells] of lines(csv).entries()) {
    const ts = toIso(cells[0] ?? "");
    if (!ts) {
      /* The first line failing to parse as a date is a header, which is a
         normal thing to paste. Any other line is a mistake worth stopping on
         rather than skipping quietly. */
      if (i === 0) continue;
      throw new Error(`line ${i + 1}: "${cells[0]}" is not a date`);
    }
    const raw = (cells[1] ?? "").trim();
    if (raw === "" || raw === "-" || raw === "–" || /^(na|n\/a|null)$/i.test(raw)) {
      out.push({ ts, value: null }); // a gap, deliberately
      continue;
    }
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) throw new Error(`line ${i + 1}: "${raw}" is not a number`);
    out.push({ ts, value: n });
  }
  return out;
}

export interface EventRow {
  ts: string;
  kind: string;
  title: string;
  summary: string | null;
  lat: number | null;
  lon: number | null;
  actor: string | null;
  severity: number | null;
  confidence: Confidence;
  tags: string[];
}

const EVENT_COLUMNS = [
  "ts", "kind", "title", "summary", "lat", "lon", "actor", "severity", "confidence", "tags",
];

/** One event per line, in EVENT_COLUMNS order. A header row is skipped. */
export function parseEvents(csv: string): EventRow[] {
  const rows = lines(csv);
  const out: EventRow[] = [];

  for (const [i, cells] of rows.entries()) {
    if (i === 0 && cells[0]?.toLowerCase() === "ts") continue; // header
    const ts = toIso(cells[0] ?? "");
    if (!ts) throw new Error(`line ${i + 1}: "${cells[0]}" is not a date`);

    const kind = (cells[1] ?? "").trim();
    const title = (cells[2] ?? "").trim();
    if (!kind || !title) throw new Error(`line ${i + 1}: kind and title are both required`);

    const num = (v: string | undefined) => {
      const t = (v ?? "").trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };

    const lat = num(cells[4]);
    const lon = num(cells[5]);
    /* Half a coordinate is not a location, and it plots at the equator — the
       same rule `events_coords_are_a_pair` states as a CHECK. Caught here so
       the message names the line. */
    if ((lat === null) !== (lon === null)) {
      throw new Error(`line ${i + 1}: needs both lat and lon, or neither`);
    }

    const conf = (cells[8] ?? "").trim().toLowerCase();
    if (conf && !CONFIDENCE.includes(conf as Confidence)) {
      throw new Error(`line ${i + 1}: confidence "${conf}" must be one of ${CONFIDENCE.join(", ")}`);
    }

    const severity = num(cells[7]);
    if (severity !== null && (severity < 1 || severity > 5)) {
      throw new Error(`line ${i + 1}: severity ${severity} is outside 1–5`);
    }

    out.push({
      ts,
      kind,
      title,
      summary: (cells[3] ?? "").trim() || null,
      lat,
      lon,
      actor: (cells[6] ?? "").trim() || null,
      severity,
      confidence: (conf as Confidence) || "reported",
      tags: (cells[9] ?? "")
        .split("|")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return out;
}

export { EVENT_COLUMNS };
