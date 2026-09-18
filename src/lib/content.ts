/* Where a report's content comes from, and how it becomes renderable.
 *
 * ── the source is a decision, never an accident ───────────────────────
 * Report pages are prerendered, so the BUILD reads content. There are two
 * places it can come from, and the one thing this module must never do is
 * choose quietly:
 *
 *   configured    PUBLIC_SUPABASE_* are set → the database, and a failure to
 *                 reach it FAILS THE BUILD. It must not fall back, because a
 *                 deploy that silently served placeholder copy while believing
 *                 it was live is the worst outcome available here.
 *   unconfigured  no credentials → the committed seed, announced in the build
 *                 log. This is local work and a fresh clone, not production.
 *
 * The free tier pauses a project after about a week idle, and a paused
 * database is unreachable — which under a silent fallback would mean a deploy
 * quietly replacing live content with the seed. Under this arrangement it is a
 * red build, which is the correct and survivable failure.
 *
 * ── one resolver ──────────────────────────────────────────────────────
 * Both sources produce the same Bundle, and a single resolver turns a Bundle
 * into ResolvedBlocks. Two code paths that both "render a report" would drift
 * the first time one of them was fixed.
 */
import type {
  Lane,
  Payload,
  ReportMeta,
  ResolvedBlock,
  ResolvedKpi,
  Source,
  TimelineEvent,
} from "./blocks";
import { parsePayload } from "./blocks";
import type { ChartSpec } from "./charts/render";
import { isConfigured, publicClient, type Client } from "./supabase";
import { portalHref } from "./config";
import { EVENTS, SERIES, SOURCES, HORMUZ, type ReportSeed } from "../content/hormuz";

export type ContentSource = "database" | "seed";

interface SeriesData {
  key: string;
  name: string;
  unit: string | null;
  /** The source this series is assessed by. Carried here so the resolver never
      has to ask a different content source where a figure came from. */
  sourceKey: string | null;
  points: { ts: string; value: number | null }[];
}

interface StoredBlock {
  kind: string;
  ord: number;
  payload: unknown;
}

/**
 * Everything a block can reference. The public loader builds one of these per
 * build; the admin preview builds one per request from the signed-in user's
 * client. Exported so there is exactly one resolver — a second one written for
 * the editor would agree with this until the first time either was fixed.
 */
export interface DataContext {
  sources: Map<string, Source>;
  series: Map<string, SeriesData>;
  events: TimelineEvent[];
}

interface Bundle extends DataContext {
  source: ContentSource;
  reports: ReportMeta[];
  blocks: Map<string, StoredBlock[]>;
}

// ── the seed ────────────────────────────────────────────────────────────

function metaOf(r: ReportSeed): ReportMeta {
  return {
    slug: r.slug,
    kicker: r.kicker,
    title: r.title,
    dek: r.dek,
    summary: r.summary,
    publishedAt: r.published_at,
    author: r.author,
    region: r.region,
    tags: r.tags,
    readMinutes: r.read_minutes,
    ogImage: r.og_image,
  };
}

function seedBundle(): Bundle {
  const seeds = [HORMUZ].filter((r) => r.status === "published");
  return {
    source: "seed",
    reports: seeds.map(metaOf),
    blocks: new Map(
      seeds.map((r) => [r.slug, r.blocks.map((b, i) => ({ kind: b.kind, ord: i, payload: b.payload }))]),
    ),
    sources: new Map(
      SOURCES.map((s) => [
        s.key,
        {
          key: s.key,
          name: s.name,
          publisher: s.publisher,
          url: s.url,
          licence: s.licence,
          notes: s.notes,
          isIndicative: s.is_indicative,
        },
      ]),
    ),
    series: new Map(
      SERIES.map((s) => [
        s.key,
        { key: s.key, name: s.name, unit: s.unit, sourceKey: s.source_key, points: s.points },
      ]),
    ),
    events: EVENTS.map((e) => ({
      ts: e.ts,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      lat: e.lat,
      lon: e.lon,
      actor: e.actor,
      severity: e.severity,
      confidence: e.confidence,
      tags: e.tags,
    })),
  };
}

// ── the database ────────────────────────────────────────────────────────

/**
 * The tables a block can reference, read through whatever client is handed in.
 *
 * The public build passes the anonymous client; the admin preview passes the
 * signed-in user's. Same query, same mapping, so a chart resolves identically
 * in a draft preview and on the published page — which is the only reason the
 * preview is worth having.
 */
export async function dataFrom(db: Client): Promise<DataContext> {
  const [sources, series, points, events] = await Promise.all([
    db.from("sources").select("*"),
    db.from("series").select("*"),
    db.from("series_points").select("*").order("ts", { ascending: true }),
    db.from("events").select("*").order("ts", { ascending: true }),
  ]);

  for (const [what, res] of Object.entries({ sources, series, points, events })) {
    if (res.error) {
      throw new Error(
        `content: reading ${what} from Supabase failed — ${res.error.message}. ` +
          `The build reads content, so this is fatal rather than something to render around. ` +
          `A paused free-tier project looks exactly like this.`,
      );
    }
  }

  const pointsBySeries = new Map<string, { ts: string; value: number | null }[]>();
  for (const p of points.data ?? []) {
    const list = pointsBySeries.get(p.series_id) ?? [];
    list.push({ ts: p.ts, value: p.value });
    pointsBySeries.set(p.series_id, list);
  }
  const sourceKeyById = new Map((sources.data ?? []).map((s) => [s.id, s.key]));

  return {
    sources: new Map(
      (sources.data ?? []).map((s) => [
        s.key,
        {
          key: s.key,
          name: s.name,
          publisher: s.publisher,
          url: s.url,
          licence: s.licence,
          notes: s.notes,
          isIndicative: s.is_indicative,
        },
      ]),
    ),
    series: new Map(
      (series.data ?? []).map((s) => [
        s.key,
        {
          key: s.key,
          name: s.name,
          unit: s.unit,
          sourceKey: s.source_id ? (sourceKeyById.get(s.source_id) ?? null) : null,
          points: pointsBySeries.get(s.id) ?? [],
        },
      ]),
    ),
    events: (events.data ?? []).map((e) => ({
      ts: e.ts,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      lat: e.lat,
      lon: e.lon,
      actor: e.actor,
      severity: e.severity,
      confidence: e.confidence,
      sourceUrl: e.source_url,
      tags: e.tags,
    })),
  };
}


async function dbBundle(): Promise<Bundle> {
  const db = publicClient();

  /* Every failure here throws. RLS already restricts anon to published
     reports, so this is not filtering for safety — it is filtering so the
     query says what it means. */
  const [reports, blocks] = await Promise.all([
    db.from("reports").select("*").eq("status", "published").order("published_at", { ascending: false }),
    db.from("report_blocks").select("*").order("ord", { ascending: true }),
  ]);

  for (const [what, res] of Object.entries({ reports, blocks })) {
    if (res.error) {
      throw new Error(
        `content: reading ${what} from Supabase failed — ${res.error.message}. ` +
          `The build reads content, so this is fatal rather than something to render around. ` +
          `A paused free-tier project looks exactly like this.`,
      );
    }
  }

  const byId = new Map((reports.data ?? []).map((r) => [r.id, r.slug]));
  const blocksBySlug = new Map<string, StoredBlock[]>();
  for (const b of blocks.data ?? []) {
    const slug = byId.get(b.report_id);
    if (!slug) continue; // a draft's blocks; RLS should already have hidden them
    const list = blocksBySlug.get(slug) ?? [];
    list.push({ kind: b.kind, ord: b.ord, payload: b.payload });
    blocksBySlug.set(slug, list);
  }

  const data = await dataFrom(db);

  return {
    ...data,
    source: "database",
    reports: (reports.data ?? []).map((r) => ({
      slug: r.slug,
      kicker: r.kicker,
      title: r.title,
      dek: r.dek,
      summary: r.summary,
      publishedAt: r.published_at!,
      author: r.author,
      region: r.region,
      tags: r.tags,
      readMinutes: r.read_minutes,
      ogImage: r.og_image,
    })),
    blocks: blocksBySlug,
  };
}

let cached: Promise<Bundle> | null = null;

/* An explicit way to say "use the seed" while credentials are present.
 *
 * The development sandbox this repo is worked on in has no egress to the
 * Supabase host, so `isConfigured()` is true and every build fails. The wrong
 * fixes are deleting your credentials (which breaks `npm run check:db`) and
 * catching the error to fall back (which is the silent failure this module
 * exists to prevent).
 *
 * So the override is a decision someone types, and it announces itself on
 * every build. It is readable in production too, and that is deliberate rather
 * than overlooked: if somebody sets it on a deployment the build log says so,
 * the landing page prints the content source in its footer, and every figure
 * on the site already carries the indicative chip. Loud beats forbidden. */
function forcedSource(): ContentSource | null {
  const v = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.CONTENT_SOURCE;
  return v === "seed" || v === "database" ? v : null;
}

/** The bundle, fetched once per build. */
export function bundle(): Promise<Bundle> {
  if (cached) return cached;
  cached = (async () => {
    const forced = forcedSource();

    if (forced === "seed") {
      const b = seedBundle();
      console.log(
        `[content] CONTENT_SOURCE=seed — rendering the committed seed ` +
          `(${b.reports.length} report(s)) even though credentials are present.`,
      );
      return b;
    }

    if (forced === "database" && !isConfigured()) {
      throw new Error(
        "CONTENT_SOURCE=database but PUBLIC_SUPABASE_* are not set. Asking for the " +
          "database and not saying where it is cannot be resolved by guessing.",
      );
    }

    if (isConfigured()) {
      const b = await dbBundle();
      console.log(`[content] ${b.reports.length} published report(s) from Supabase`);
      return b;
    }

    const b = seedBundle();
    console.log(
      `[content] PUBLIC_SUPABASE_* are not set — rendering the committed seed ` +
        `(${b.reports.length} report(s)). Set them to build against the database.`,
    );
    return b;
  })();
  return cached;
}

// ── resolution ──────────────────────────────────────────────────────────

/** A short axis label. Daily series get "3 Sep"; anything longer gets a month. */
function axisLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

/**
 * Rebase a series to 100 at its first real point, which is what an index chart
 * of two series in different units is for: the comparison is the shape, and
 * the shapes are only comparable once the levels are removed.
 */
function rebase(points: { ts: string; value: number | null }[]): { t: string; v: number }[] {
  const anchor = points.find((p) => p.value !== null && p.value !== 0)?.value;
  if (anchor === undefined || anchor === null) return [];
  return points
    .filter((p): p is { ts: string; value: number } => p.value !== null)
    .map((p) => ({ t: axisLabel(p.ts), v: Math.round((p.value / anchor) * 1000) / 10 }));
}

/* Overlay colours come from the palette the charts already read, by token
   name, so a second series never introduces a hue the design system has not
   validated in both themes. */
const OVERLAY_COLOUR = "#2F6FD0";

function chartSpecFor(
  p: Extract<Payload, { kind: "chart" }>,
  series: Map<string, SeriesData>,
  ord: number,
): { spec: ChartSpec; sources: string[] } {
  const found = p.seriesKeys.map((k) => {
    const s = series.get(k);
    if (!s) {
      throw new Error(
        `block ${ord} (chart): no series with key "${k}". A chart names its data rather than ` +
          `carrying it, so a missing key is a missing figure — which this repo does not invent.`,
      );
    }
    return s;
  });

  /* areaChart carries gaps; the others read Number(null) as 0 and would draw a
     day with no assessment as a collapse to the baseline. Rather than quietly
     dropping the gap, refuse. */
  if (p.chartKind !== "area") {
    for (const s of found) {
      if (s.points.some((pt) => pt.value === null)) {
        throw new Error(
          `block ${ord} (chart): series "${s.key}" has gaps, and only the area chart draws them ` +
            `as gaps. Use chartKind "area", or fill the series — but do not let a ${p.chartKind} ` +
            `chart plot a missing day as zero.`,
        );
      }
    }
  }

  const sources = found.map((s) => s.key);

  if (p.chartKind === "index") {
    const [first, second] = found;
    return {
      spec: {
        kind: "index",
        rows: rebase(first.points),
        xk: "t",
        yk: "v",
        base: 100,
        label: p.label ?? first.name,
        overlay: second
          ? { rows: rebase(second.points), name: second.name, color: OVERLAY_COLOUR }
          : null,
      },
      sources,
    };
  }

  const only = found[0];
  const rows = only.points.map((pt) => ({ t: axisLabel(pt.ts), v: pt.value }));

  if (p.chartKind === "bar") {
    return {
      spec: { kind: "bar", rows, xk: "t", yk: "v", label: p.label ?? only.name },
      sources,
    };
  }
  return { spec: { kind: "area", rows, xk: "t", yk: "v", label: p.label ?? only.name }, sources };
}

function sourcesFor(keys: string[], all: Map<string, Source>, ord: number, kind: string): Source[] {
  return keys.map((k) => {
    const s = all.get(k);
    if (!s) {
      throw new Error(
        `block ${ord} (${kind}): no source with key "${k}". Every figure cites a source row; ` +
          `a citation pointing at nothing is worse than none.`,
      );
    }
    return s;
  });
}

function matches(e: TimelineEvent, tags: string[]): boolean {
  return tags.some((t) => e.tags.includes(t));
}

const DEFAULT_BBOX: [number, number, number, number] = [55.6, 25.4, 57.3, 27.6];

export function resolveBlocks(
  stored: StoredBlock[],
  b: DataContext,
  slug: string,
): ResolvedBlock[] {
  return stored
    .slice()
    .sort((x, y) => x.ord - y.ord)
    .map((row): ResolvedBlock => {
      const p = parsePayload(row.kind as Payload["kind"], row.ord, row.payload);
      const ord = row.ord;

      switch (p.kind) {
        case "prose":
          return { kind: "prose", ord, payload: p };

        case "kpi_row": {
          const items: ResolvedKpi[] = p.items.map((it) => ({
            ...it,
            source: it.sourceKey ? sourcesFor([it.sourceKey], b.sources, ord, "kpi_row")[0] : undefined,
          }));
          return { kind: "kpi_row", ord, items };
        }

        case "chart": {
          const { spec, sources } = chartSpecFor(p, b.series, ord);
          /* A chart's provenance is the provenance of the series it draws, so
             it is looked up rather than restated on the block — one figure,
             one place. */
          const seriesSources = sources
            .map((k) => b.series.get(k))
            .map((s) => (s?.sourceKey ? b.sources.get(s.sourceKey) : undefined))
            .filter((s): s is Source => !!s);
          const uniq = [...new Map(seriesSources.map((s) => [s.key, s])).values()];
          return {
            kind: "chart",
            ord,
            spec,
            caption: p.caption,
            lane: (p.lane ?? "wide") as Lane,
            sources: uniq,
            indicative: uniq.some((s) => s.isIndicative),
          };
        }

        case "timeline": {
          const events = b.events
            .filter((e) => matches(e, p.tags))
            .sort((x, y) => x.ts.localeCompare(y.ts));
          return { kind: "timeline", ord, events: p.limit ? events.slice(0, p.limit) : events, caption: p.caption };
        }

        case "map": {
          const events = b.events.filter((e) => matches(e, p.tags) && e.lat != null && e.lon != null);
          return {
            kind: "map",
            ord,
            events,
            caption: p.caption,
            bbox: p.bbox ?? DEFAULT_BBOX,
            outline: p.outline,
            labels: p.labels ?? [],
          };
        }

        case "table":
          return {
            kind: "table",
            ord,
            payload: p,
            source: p.sourceKey ? sourcesFor([p.sourceKey], b.sources, ord, "table")[0] : undefined,
          };

        case "callout":
          return { kind: "callout", ord, payload: p };

        case "quote":
          return { kind: "quote", ord, payload: p };

        case "sourcebox":
          return {
            kind: "sourcebox",
            ord,
            sources: sourcesFor(p.sourceKeys, b.sources, ord, "sourcebox"),
            note: p.note,
          };

        case "cta": {
          const href = p.href ?? portalHref(slug) ?? "";
          return { kind: "cta", ord, payload: p, href };
        }

        case "embed":
          return { kind: "embed", ord, payload: p };
      }
    });
}

export interface LoadedReport {
  meta: ReportMeta;
  blocks: ResolvedBlock[];
  source: ContentSource;
}

/** Every published report, newest first. */
export async function listReports(): Promise<{ reports: ReportMeta[]; source: ContentSource }> {
  const b = await bundle();
  const reports = [...b.reports].sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
  return { reports, source: b.source };
}

/** One report with its blocks resolved, or null when there is no such slug. */
export async function loadReport(slug: string): Promise<LoadedReport | null> {
  const b = await bundle();
  const meta = b.reports.find((r) => r.slug === slug);
  const stored = b.blocks.get(slug);
  if (!meta || !stored) return null;
  return { meta, blocks: resolveBlocks(stored, b, slug), source: b.source };
}

/** True when every source the site cites is indicative — the pre-launch state. */
export async function allIndicative(): Promise<boolean> {
  const b = await bundle();
  const all = [...b.sources.values()];
  return all.length > 0 && all.every((s) => s.isIndicative);
}
