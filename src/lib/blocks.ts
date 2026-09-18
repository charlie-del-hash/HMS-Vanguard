/* The eleven block kinds: what is stored, and what a component receives.
 *
 * 0001_content.sql says "payload shape varies by kind; see src/lib/blocks.ts".
 * This is that file, and it is the contract in both directions — the admin
 * writes these shapes, the renderer reads them.
 *
 * ── stored vs resolved ────────────────────────────────────────────────
 * A payload REFERENCES data rather than copying it. A chart block names series
 * keys, a timeline names tags, a KPI cites a source key. That is why `series`,
 * `events` and `sources` are tables rather than more jsonb: a figure lives in
 * one place, and a report that prints it points at it.
 *
 * The loader turns a stored payload into a ResolvedBlock by fetching what it
 * names. Components only ever see resolved blocks, so no component talks to
 * the database and every component can be rendered from a literal in a test.
 *
 * ── a bad payload fails the build ─────────────────────────────────────
 * `parsePayload` throws. It would be easy to skip a block that does not parse
 * and carry on, and that is the wrong behaviour for research: a published
 * report silently missing its methodology box is worse than a build that
 * stopped. The deck's rule is that a missing figure renders as a dash and a
 * failed fetch keeps the old value — neither of those is "pretend the section
 * was never commissioned".
 */
import type { ChartSpec } from "./charts/render";
import type { Database } from "./database.types";

export type BlockKind = Database["public"]["Enums"]["block_kind"];
export type Confidence = Database["public"]["Enums"]["event_confidence"];

/* Domain types, not table rows.
 *
 * A component takes one of these, and both content sources — the database and
 * the committed seed — map into them. Reusing the generated Row types would
 * mean the seed fabricating uuids and created_at stamps it does not have, to
 * satisfy a shape no component reads. The enums still come from the generated
 * types, because those are a real contract with the database. */
export interface Source {
  key: string;
  name: string;
  publisher?: string | null;
  url?: string | null;
  licence?: string | null;
  notes?: string | null;
  /** Shaped like the feed rather than being it. The renderer must say so. */
  isIndicative: boolean;
}

export interface TimelineEvent {
  ts: string;
  kind: string;
  title: string;
  summary?: string | null;
  lat?: number | null;
  lon?: number | null;
  actor?: string | null;
  severity?: number | null;
  confidence: Confidence;
  sourceUrl?: string | null;
  tags: string[];
}

/** A report without its blocks — enough for an index card or a <head>. */
export interface ReportMeta {
  slug: string;
  kicker?: string | null;
  title: string;
  dek?: string | null;
  summary?: string | null;
  publishedAt: string;
  author?: string | null;
  region?: string | null;
  tags: string[];
  readMinutes?: number | null;
  /**
   * The share card. `reports.og_image` has existed since 0001 and nothing read
   * it, so every link posted to Slack or X rendered as a bare URL. Absolute
   * https URL or nothing — a relative one resolves against the crawler's idea
   * of the origin, not ours, and a card image that 404s is worse than none.
   */
  ogImage?: string | null;
}

/** Which grid lane a block occupies. Matches `.article` in base.css. */
export type Lane = "content" | "wide" | "full";

// ── stored payloads ─────────────────────────────────────────────────────

export interface ProsePayload {
  paragraphs: string[];
  /** Larger type for a standfirst. One per report, at the top. */
  lead?: boolean;
  /**
   * A pull-figure the prose flows around. This is what Pretext's variable-width
   * line routing is for — the text narrows beside it rather than stopping.
   */
  inset?: { label: string; value: string; note?: string; side?: "left" | "right" };
}

export interface KpiItem {
  label: string;
  value: string;
  unit?: string;
  /** Signed change, rendered with the deck's --pos/--neg. */
  delta?: string;
  note?: string;
  /** A key into `sources`. Absent means the item must set `indicative`. */
  sourceKey?: string;
  indicative?: boolean;
}
export interface KpiRowPayload {
  items: KpiItem[];
}

export interface ChartPayload {
  /** Series to draw, by `series.key`. */
  seriesKeys: string[];
  /* Named chartKind rather than kind because the block discriminant is already
     `kind: "chart"`, and two fields of that name in one object is the sort of
     thing that type-checks in one direction and not the other. */
  chartKind: "area" | "index" | "bar";
  label?: string;
  /** Index charts rebase to this value; null means "first point". */
  base?: number | null;
  caption?: string;
  lane?: Lane;
}

export interface TimelinePayload {
  tags: string[];
  limit?: number;
  caption?: string;
}

export interface MapPayload {
  tags: string[];
  caption?: string;
  /** Bounding box the plot is drawn in: [west, south, east, north]. */
  bbox?: [number, number, number, number];
  /** Coastline/landmark strokes, as an SVG path in bbox coordinates. */
  outline?: string;
  labels?: { lat: number; lon: number; text: string; anchor?: "start" | "middle" | "end" }[];
}

export interface TableColumn {
  key: string;
  label: string;
  /** Figures right-align and get tabular numerals; text does not. */
  numeric?: boolean;
  /** Dropped first when the panel is too narrow. Lower survives longer. */
  priority?: number;
}
export interface TablePayload {
  columns: TableColumn[];
  rows: Record<string, string | number | null>[];
  caption?: string;
  sourceKey?: string;
  indicative?: boolean;
}

export interface CalloutPayload {
  tone: "note" | "risk" | "method";
  title?: string;
  body: string[];
}

export interface QuotePayload {
  text: string;
  who?: string;
  role?: string;
}

export interface SourceboxPayload {
  sourceKeys: string[];
  note?: string;
}

export interface CtaPayload {
  headline: string;
  body?: string;
  label: string;
  /** Omitted means the configured portal URL. */
  href?: string;
}

export interface EmbedPayload {
  url: string;
  title: string;
  height?: number;
}

export type Payload =
  | ({ kind: "prose" } & ProsePayload)
  | ({ kind: "kpi_row" } & KpiRowPayload)
  | ({ kind: "chart" } & ChartPayload)
  | ({ kind: "timeline" } & TimelinePayload)
  | ({ kind: "map" } & MapPayload)
  | ({ kind: "table" } & TablePayload)
  | ({ kind: "callout" } & CalloutPayload)
  | ({ kind: "quote" } & QuotePayload)
  | ({ kind: "sourcebox" } & SourceboxPayload)
  | ({ kind: "cta" } & CtaPayload)
  | ({ kind: "embed" } & EmbedPayload);

// ── resolved blocks ─────────────────────────────────────────────────────

/** A KPI item with its source row attached. */
export interface ResolvedKpi extends KpiItem {
  source?: Source;
}

export type ResolvedBlock =
  | { kind: "prose"; ord: number; payload: ProsePayload }
  | { kind: "kpi_row"; ord: number; items: ResolvedKpi[] }
  | {
      kind: "chart";
      ord: number;
      spec: ChartSpec;
      caption?: string;
      lane: Lane;
      sources: Source[];
      indicative: boolean;
    }
  | { kind: "timeline"; ord: number; events: TimelineEvent[]; caption?: string }
  | {
      kind: "map";
      ord: number;
      events: TimelineEvent[];
      caption?: string;
      bbox: [number, number, number, number];
      outline?: string;
      labels: NonNullable<MapPayload["labels"]>;
    }
  | { kind: "table"; ord: number; payload: TablePayload; source?: Source }
  | { kind: "callout"; ord: number; payload: CalloutPayload }
  | { kind: "quote"; ord: number; payload: QuotePayload }
  | { kind: "sourcebox"; ord: number; sources: Source[]; note?: string }
  | { kind: "cta"; ord: number; payload: CtaPayload; href: string }
  | { kind: "embed"; ord: number; payload: EmbedPayload };

// ── parsing ─────────────────────────────────────────────────────────────

class BlockError extends Error {
  constructor(kind: string, ord: number, what: string) {
    super(`block ${ord} (${kind}): ${what}`);
    this.name = "BlockError";
  }
}

function strArray(v: unknown, kind: string, ord: number, field: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new BlockError(kind, ord, `${field} must be an array of strings`);
  }
  if (v.length === 0) throw new BlockError(kind, ord, `${field} is empty`);
  return v as string[];
}

function str(v: unknown, kind: string, ord: number, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new BlockError(kind, ord, `${field} must be a non-empty string`);
  }
  return v;
}

/**
 * Validate one stored row into a typed payload.
 *
 * Throws on anything malformed. The caller is a build, so the failure lands in
 * front of whoever is publishing rather than in front of a reader.
 */
export function parsePayload(kind: BlockKind, ord: number, raw: unknown): Payload {
  const p = (raw ?? {}) as Record<string, unknown>;

  switch (kind) {
    case "prose":
      return { kind, paragraphs: strArray(p.paragraphs, kind, ord, "paragraphs"), lead: !!p.lead, inset: p.inset as ProsePayload["inset"] };

    case "kpi_row": {
      const items = p.items;
      if (!Array.isArray(items) || items.length === 0) {
        throw new BlockError(kind, ord, "items must be a non-empty array");
      }
      for (const [i, it] of items.entries()) {
        const item = it as KpiItem;
        str(item.label, kind, ord, `items[${i}].label`);
        str(item.value, kind, ord, `items[${i}].value`);
        /* The provenance rule, enforced rather than documented: a figure on a
           report page either cites a source or admits it is indicative. */
        if (!item.sourceKey && !item.indicative) {
          throw new BlockError(
            kind,
            ord,
            `items[${i}] ("${item.label}") has neither sourceKey nor indicative:true — ` +
              `every figure must say where it came from or that it is shaped like the feed ` +
              `rather than being it`,
          );
        }
      }
      return { kind, items: items as KpiItem[] };
    }

    case "chart": {
      const seriesKeys = strArray(p.seriesKeys, kind, ord, "seriesKeys");
      const ck = p.chartKind;
      if (ck !== "area" && ck !== "index" && ck !== "bar") {
        throw new BlockError(kind, ord, `chartKind must be area | index | bar, got ${String(ck)}`);
      }
      const lane = p.lane;
      if (lane !== undefined && lane !== "content" && lane !== "wide" && lane !== "full") {
        throw new BlockError(kind, ord, `lane must be content | wide | full, got ${String(lane)}`);
      }
      return {
        kind,
        seriesKeys,
        chartKind: ck,
        label: p.label as string | undefined,
        base: (p.base ?? null) as number | null,
        caption: p.caption as string | undefined,
        lane: lane as Lane | undefined,
      };
    }

    case "timeline":
      return { kind, tags: strArray(p.tags, kind, ord, "tags"), limit: p.limit as number | undefined, caption: p.caption as string | undefined };

    case "map":
      return {
        kind,
        tags: strArray(p.tags, kind, ord, "tags"),
        caption: p.caption as string | undefined,
        bbox: p.bbox as MapPayload["bbox"],
        outline: p.outline as string | undefined,
        labels: (p.labels ?? []) as MapPayload["labels"],
      };

    case "table": {
      const columns = p.columns;
      if (!Array.isArray(columns) || columns.length === 0) {
        throw new BlockError(kind, ord, "columns must be a non-empty array");
      }
      if (!Array.isArray(p.rows)) throw new BlockError(kind, ord, "rows must be an array");
      if (!p.sourceKey && !p.indicative) {
        throw new BlockError(
          kind,
          ord,
          "a table prints figures, so it needs sourceKey or indicative:true",
        );
      }
      return {
        kind,
        columns: columns as TableColumn[],
        rows: p.rows as TablePayload["rows"],
        caption: p.caption as string | undefined,
        sourceKey: p.sourceKey as string | undefined,
        indicative: !!p.indicative,
      };
    }

    case "callout": {
      const tone = p.tone;
      if (tone !== "note" && tone !== "risk" && tone !== "method") {
        throw new BlockError(kind, ord, `tone must be note | risk | method, got ${String(tone)}`);
      }
      return { kind, tone, title: p.title as string | undefined, body: strArray(p.body, kind, ord, "body") };
    }

    case "quote":
      return { kind, text: str(p.text, kind, ord, "text"), who: p.who as string | undefined, role: p.role as string | undefined };

    case "sourcebox":
      return { kind, sourceKeys: strArray(p.sourceKeys, kind, ord, "sourceKeys"), note: p.note as string | undefined };

    case "cta":
      return {
        kind,
        headline: str(p.headline, kind, ord, "headline"),
        body: p.body as string | undefined,
        label: str(p.label, kind, ord, "label"),
        href: p.href as string | undefined,
      };

    case "embed": {
      const url = str(p.url, kind, ord, "url");
      /* https, or same-origin. A root-relative path cannot carry a scheme, so
         it cannot carry javascript: — and the most useful thing this site has
         to embed is its own ops deck. Anything else must be https. */
      if (!/^https:\/\//.test(url) && !/^\/[^/]/.test(url)) {
        throw new BlockError(kind, ord, `url must be https:// or a root-relative path, got ${url}`);
      }
      return { kind, url, title: str(p.title, kind, ord, "title"), height: p.height as number | undefined };
    }
  }
}
