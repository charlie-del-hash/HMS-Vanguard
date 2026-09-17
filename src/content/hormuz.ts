/* The first report, authored as data.
 *
 * ── what this file is, and what it is not ─────────────────────────────
 * Every figure here is INDICATIVE. It is shaped like the feed rather than
 * being it: plausible magnitudes, plausible moves, generated deterministically
 * so the page is the same on every build. Nothing in it is a real assessment
 * and nothing in it should be quoted.
 *
 * That is a sanctioned placeholder rather than a lapse — Phase 2 exists to
 * prove the reader end to end, and the alternative to labelled indicative data
 * is a page with no data on it, which proves nothing. What makes it honest is
 * that `sources.is_indicative` is true for every source it cites, the renderer
 * is required to say so wherever the figures are, and `checks/site-sourced.js`
 * fails the build if a figure appears without either a source or that flag.
 *
 * ── why a file as well as a database ──────────────────────────────────
 * This is the seed: `scripts/seed-db.mjs` pushes it into Supabase, and
 * src/lib/content.ts renders from it when the database is not configured. One
 * authored source, two consumers, so the two cannot disagree.
 *
 * From Phase 3 the admin writes to the database and the database is
 * authoritative; this file stays as the seed for a fresh project and stops
 * being the place to edit copy.
 */

export interface SourceSeed {
  key: string;
  name: string;
  publisher?: string;
  url?: string;
  licence?: string;
  notes?: string;
  is_indicative: boolean;
}

export interface SeriesSeed {
  key: string;
  name: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "irregular";
  source_key: string;
  notes?: string;
  points: { ts: string; value: number | null }[];
}

export interface EventSeed {
  ts: string;
  kind: string;
  title: string;
  summary?: string;
  lat?: number;
  lon?: number;
  actor?: string;
  severity?: number;
  confidence: "confirmed" | "reported" | "unconfirmed";
  source_key?: string;
  tags: string[];
}

export interface ReportSeed {
  slug: string;
  kicker?: string;
  title: string;
  dek?: string;
  summary?: string;
  status: "draft" | "scheduled" | "published" | "archived";
  published_at: string;
  author?: string;
  region?: string;
  tags: string[];
  read_minutes?: number;
  blocks: { kind: string; payload: Record<string, unknown> }[];
}

/* ── deterministic indicative series ───────────────────────────────────
   A fixed-seed generator rather than ninety hand-typed numbers, so the shape
   is reproducible and a rebuild never silently changes the chart. Seeded LCG,
   not Math.random: the same build must produce the same page. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const DAY = 86_400_000;
const START = Date.UTC(2026, 6, 20); // 20 Jul 2026, ~8 weeks before publication

function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => new Date(START + i * DAY).toISOString());
}

/**
 * A series that drifts, then steps on the escalation date and decays back
 * part of the way — the shape a risk premium actually makes. `gaps` drops
 * points entirely, because a gap is a fact and not a zero (0002_data.sql).
 */
function walk(opts: {
  seed: number;
  n: number;
  start: number;
  drift: number;
  vol: number;
  shockAt: number;
  shock: number;
  decay: number;
  gaps?: number[];
  round?: number;
}): { ts: string; value: number | null }[] {
  const rnd = lcg(opts.seed);
  const ts = days(opts.n);
  const out: { ts: string; value: number | null }[] = [];
  let v = opts.start;
  let extra = 0;
  for (let i = 0; i < opts.n; i++) {
    v += opts.drift + (rnd() - 0.5) * opts.vol;
    if (i === opts.shockAt) extra = opts.shock;
    extra *= opts.decay;
    const r = opts.round ?? 1;
    /* toFixed after the rounding, because 0.41 is not representable and
       Math.round(x / 0.01) * 0.01 lands on 0.41000000000000003 — which then
       goes into the database, onto a chart label, and into anything that
       compares two of these for equality. */
    const snapped = Number((Math.round((v + extra) / r) * r).toFixed(6));
    const value = opts.gaps?.includes(i) ? null : snapped;
    out.push({ ts: ts[i], value });
  }
  return out;
}

const N = 58; // 20 Jul → 15 Sep
const SHOCK = 44; // 1 Sep, the first strike in the timeline

export const SOURCES: SourceSeed[] = [
  {
    key: "affinity-indicative",
    name: "Affinity indicative series",
    publisher: "Affinity Research",
    licence: "Internal",
    notes:
      "Generated placeholder shaped like the live feed. Not an assessment, not a price, " +
      "and not to be quoted. Replaced by the licensed assessment when the ingestion lands.",
    is_indicative: true,
  },
  {
    key: "affinity-incident-log",
    name: "Affinity incident log (indicative)",
    publisher: "Affinity Research",
    licence: "Internal",
    notes:
      "Placeholder incident records with realistic coordinates and confidence values. " +
      "Every entry is illustrative; none is a report of a real event.",
    is_indicative: true,
  },
];

export const SERIES: SeriesSeed[] = [
  {
    key: "hormuz-vlcc-tce",
    name: "VLCC AG–East round-trip TCE",
    unit: "USD/day",
    frequency: "daily",
    source_key: "affinity-indicative",
    notes: "Indicative. Shaped like a Baltic-style round-trip assessment.",
    points: walk({
      seed: 11, n: N, start: 38_000, drift: 90, vol: 3_600,
      shockAt: SHOCK, shock: 34_000, decay: 0.93, round: 500,
    }),
  },
  {
    key: "hormuz-war-risk",
    name: "Hull war-risk premium, Gulf transit",
    unit: "% of hull value",
    frequency: "daily",
    source_key: "affinity-indicative",
    notes: "Indicative. Per-transit additional premium, not an annual rate.",
    points: walk({
      seed: 29, n: N, start: 0.42, drift: 0.001, vol: 0.03,
      shockAt: SHOCK, shock: 1.15, decay: 0.965, round: 0.01,
    }),
  },
  {
    key: "hormuz-daily-transits",
    name: "Laden tanker transits, Strait of Hormuz",
    unit: "vessels/day",
    frequency: "daily",
    source_key: "affinity-indicative",
    notes: "Indicative. Laden movements only; ballast legs excluded.",
    points: walk({
      seed: 7, n: N, start: 47, drift: -0.02, vol: 5,
      shockAt: SHOCK, shock: -14, decay: 0.9, round: 1,
      /* Real gaps: days with no assessment published. They are carried as
         nulls and drawn as breaks, never as zeros — 0002_data.sql is explicit
         that a gap is a fact about the world and interpolating it is
         inventing. The area chart is the one generator that handles them, and
         the loader refuses to hand a gapped series to one that does not. */
      gaps: [12, 33, 48],
    }),
  },
];

/* Coordinates are real places in and around the strait; the incidents are not.
   Confidence varies on purpose — a map that draws `confirmed` and
   `unconfirmed` identically asserts something the desk does not know. */
export const EVENTS: EventSeed[] = [
  {
    ts: "2026-09-01T03:20:00Z", kind: "strike", title: "Product tanker struck off Bandar Abbas",
    summary: "Engine room flooded; crew of 22 taken off by a passing bulker. No pollution reported.",
    lat: 27.18, lon: 56.28, actor: "Unattributed", severity: 4, confidence: "confirmed",
    source_key: "affinity-incident-log", tags: ["hormuz", "strike", "tanker"],
  },
  {
    ts: "2026-09-02T19:05:00Z", kind: "seizure", title: "Chemical tanker boarded near Qeshm",
    summary: "Vessel diverted to an anchorage under escort. Released after 31 hours.",
    lat: 26.95, lon: 56.27, actor: "State forces", severity: 3, confidence: "confirmed",
    source_key: "affinity-incident-log", tags: ["hormuz", "seizure"],
  },
  {
    ts: "2026-09-04T11:40:00Z", kind: "drone", title: "UAV intercepted over the inbound lane",
    summary: "Interception reported by two operators in the traffic separation scheme. No damage.",
    lat: 26.62, lon: 56.52, actor: "Unattributed", severity: 2, confidence: "reported",
    source_key: "affinity-incident-log", tags: ["hormuz", "drone"],
  },
  {
    ts: "2026-09-06T05:55:00Z", kind: "mine", title: "Limpet device found on a VLCC hull",
    summary: "Device located during an underwater inspection at Fujairah. Made safe alongside.",
    lat: 25.12, lon: 56.36, actor: "Unattributed", severity: 4, confidence: "reported",
    source_key: "affinity-incident-log", tags: ["hormuz", "mine", "tanker"],
  },
  {
    ts: "2026-09-07T22:10:00Z", kind: "gps", title: "Sustained GPS interference, outbound lane",
    summary: "Position jumps of 4–9 nm reported by eleven vessels over roughly six hours.",
    lat: 26.48, lon: 56.70, actor: "Unattributed", severity: 2, confidence: "reported",
    source_key: "affinity-incident-log", tags: ["hormuz", "gps"],
  },
  {
    ts: "2026-09-09T14:25:00Z", kind: "strike", title: "Second tanker hit south of Larak",
    summary: "Fire contained by the crew. Vessel proceeded to an anchorage under her own power.",
    lat: 26.85, lon: 56.36, actor: "Unattributed", severity: 4, confidence: "confirmed",
    source_key: "affinity-incident-log", tags: ["hormuz", "strike", "tanker"],
  },
  {
    ts: "2026-09-11T08:00:00Z", kind: "advisory", title: "Two flag states advise against night transit",
    summary: "Advisory covers laden tankers above 80,000 dwt. Not a prohibition.",
    lat: 26.57, lon: 56.25, actor: "Flag administrations", severity: 1, confidence: "confirmed",
    source_key: "affinity-incident-log", tags: ["hormuz", "advisory"],
  },
  {
    ts: "2026-09-13T16:45:00Z", kind: "strike", title: "Explosion reported near a laden Suezmax",
    summary: "One outlet reports a near-miss; no operator has confirmed damage or casualties.",
    lat: 26.30, lon: 56.60, actor: "Unattributed", severity: 2, confidence: "unconfirmed",
    source_key: "affinity-incident-log", tags: ["hormuz", "strike"],
  },
];

/* A coarse outline of the strait, in longitude/latitude pairs, drawn as two
   coastlines rather than a basemap. A tile layer would mean a third-party
   request on every report view, which is a tracking surface the funnel does
   not need and a dependency the page does not want. */
const IRAN_COAST =
  "56.90,27.45 56.60,27.20 56.30,27.05 56.05,26.90 55.80,26.75 55.95,26.60 " +
  "56.25,26.62 56.55,26.78 56.85,26.95 57.05,27.15 57.15,27.40";
const OMAN_COAST =
  "56.45,25.55 56.35,25.80 56.28,26.05 56.32,26.25 56.45,26.35 56.62,26.30 " +
  "56.75,26.10 56.80,25.85 56.72,25.60";

export const HORMUZ: ReportSeed = {
  slug: "hormuz-strikes-tanker-economics",
  kicker: "Chokepoints",
  title: "A fortnight of strikes in Hormuz, and what it cost to move a barrel",
  dek:
    "Eight incidents in thirteen days moved war-risk premiums further than they moved freight. " +
    "The gap between the two is where the trade was.",
  summary:
    "Indicative reconstruction of how a fortnight of incidents in the Strait of Hormuz " +
    "repriced war risk, tanker earnings and transit counts — and why the three did not move together.",
  status: "published",
  published_at: "2026-09-15T06:00:00Z",
  author: "Affinity Research",
  region: "Arabian Gulf",
  tags: ["hormuz", "tankers", "war-risk", "chokepoints"],
  blocks: [
    {
      kind: "prose",
      payload: {
        lead: true,
        paragraphs: [
          "Between 1 and 13 September, eight separate incidents were logged in and around the " +
            "Strait of Hormuz — two confirmed strikes on laden tankers, a boarding, a limpet device " +
            "found alongside at Fujairah, and a sustained run of GPS interference in the outbound lane. " +
            "The market repriced risk immediately. It repriced *freight* more slowly, and by less.",
          "That gap is the interesting part. War-risk premium on a Gulf transit roughly tripled inside " +
            "a week. VLCC round-trip earnings rose sharply too, but from a base that had been drifting " +
            "up all summer, and they gave back a third of the move within ten days. Transits fell — " +
            "but they fell by about a quarter, not by half, and they were recovering before the last " +
            "incident on the list.",
        ],
      },
    },
    {
      kind: "kpi_row",
      payload: {
        items: [
          { label: "Incidents logged", value: "8", note: "1–13 Sep", sourceKey: "affinity-incident-log" },
          { label: "War-risk premium, peak", value: "1.61", unit: "% of hull", delta: "+1.19", sourceKey: "affinity-indicative" },
          { label: "VLCC TCE, peak", value: "76,500", unit: "USD/day", delta: "+34,000", sourceKey: "affinity-indicative" },
          { label: "Transits, trough", value: "31", unit: "vessels/day", delta: "−14", sourceKey: "affinity-indicative" },
        ],
      },
    },
    {
      kind: "map",
      payload: {
        tags: ["hormuz"],
        caption:
          "Incident locations, 1–13 September. Shape shows confidence: a filled marker is confirmed, " +
          "an open one reported, a dashed one unconfirmed.",
        bbox: [55.6, 25.4, 57.3, 27.6],
        outline: `${IRAN_COAST}|${OMAN_COAST}`,
        labels: [
          { lat: 27.35, lon: 56.35, text: "IRAN", anchor: "middle" },
          { lat: 25.62, lon: 56.55, text: "OMAN", anchor: "middle" },
          { lat: 26.60, lon: 56.45, text: "Strait of Hormuz", anchor: "middle" },
        ],
      },
    },
    {
      kind: "chart",
      payload: {
        seriesKeys: ["hormuz-war-risk", "hormuz-vlcc-tce"],
        chartKind: "index",
        label: "Rebased to 1 September = 100",
        lane: "wide",
        caption:
          "Premium and earnings, rebased. The premium moves first and further; earnings follow " +
          "and retrace. Both series are indicative.",
      },
    },
    {
      kind: "prose",
      payload: {
        paragraphs: [
          "Rebasing both series to the day of the first strike makes the asymmetry plain. The premium " +
            "is priced per transit and can be rewritten overnight; the freight rate is the outcome of " +
            "a fixture market where most of the tonnage for the next fortnight was already committed.",
          "So the premium is the faster instrument and the noisier one. It moved on the *unconfirmed* " +
            "13 September report almost as much as on the confirmed strike on the 9th — which is worth " +
            "remembering before treating it as a measure of what actually happened.",
        ],
      },
    },
    {
      kind: "timeline",
      payload: {
        tags: ["hormuz"],
        caption: "Every logged incident, with the desk's confidence in it.",
      },
    },
    {
      kind: "callout",
      payload: {
        tone: "method",
        title: "How to read the confidence flags",
        body: [
          "**Confirmed** means an operator, a flag state or a naval authority has said so on the record. " +
            "**Reported** means one credible outlet carried it and nobody has denied it. " +
            "**Unconfirmed** means it is circulating and we have not been able to stand it up.",
          "They are not stages of the same thing. An unconfirmed report that turns out to be wrong " +
            "never becomes confirmed — it disappears, and the premium it moved does not come back on its own.",
        ],
      },
    },
    {
      kind: "chart",
      payload: {
        seriesKeys: ["hormuz-daily-transits"],
        chartKind: "area",
        label: "Laden tanker transits per day",
        lane: "wide",
        caption:
          "Transits fell about a quarter and were recovering before the last incident. Gaps are days " +
          "with no assessment, left as gaps rather than interpolated.",
      },
    },
    {
      kind: "table",
      payload: {
        caption: "Indicative earnings impact by vessel class, peak versus the August mean.",
        sourceKey: "affinity-indicative",
        columns: [
          { key: "class", label: "Class", priority: 0 },
          { key: "aug", label: "Aug mean", numeric: true, priority: 2 },
          { key: "peak", label: "Peak", numeric: true, priority: 1 },
          { key: "chg", label: "Change", numeric: true, priority: 0 },
          { key: "retrace", label: "Retraced by 15 Sep", numeric: true, priority: 3 },
        ],
        rows: [
          { class: "VLCC", aug: "41,200", peak: "76,500", chg: "+86%", retrace: "−32%" },
          { class: "Suezmax", aug: "33,800", peak: "58,100", chg: "+72%", retrace: "−28%" },
          { class: "Aframax", aug: "29,400", peak: "46,900", chg: "+60%", retrace: "−24%" },
          { class: "LR2 (clean)", aug: "26,700", peak: "48,300", chg: "+81%", retrace: "−35%" },
          { class: "MR (clean)", aug: "18,900", peak: "27,400", chg: "+45%", retrace: "−19%" },
        ],
      },
    },
    {
      kind: "quote",
      payload: {
        text:
          "The premium is a price for uncertainty, not a measure of danger. It goes up when we stop " +
          "knowing what is happening — which is not the same day the dangerous thing happens.",
        who: "Placeholder attribution",
        role: "Illustrative only — not a real quotation",
      },
    },
    {
      kind: "prose",
      payload: {
        paragraphs: [
          "The practical read for anyone fixing tonnage through the rest of the quarter: the premium " +
            "is already priced for a repeat, and the freight market is not. If incidents stop, the " +
            "premium decays faster than earnings do. If they continue at this rate, earnings have " +
            "further to go than premiums do.",
          "Neither of those is a forecast. They are the two ways the gap closes, and the gap is the " +
            "thing to watch.",
        ],
      },
    },
    {
      kind: "embed",
      payload: {
        url: "/ops-deck.html",
        title: "The Affinity ops deck — the desk view these figures come from",
        height: 620,
      },
    },
    {
      kind: "sourcebox",
      payload: {
        sourceKeys: ["affinity-indicative", "affinity-incident-log"],
        note:
          "Every figure on this page is indicative: shaped like the live assessment rather than being it. " +
          "The licensed series and the incident feed replace them without changing this page.",
      },
    },
    {
      kind: "cta",
      payload: {
        headline: "The full assessment lives in the Affinity research portal",
        body:
          "Daily war-risk and freight assessments, the incident log with sources attached, and the " +
          "fixture-level detail behind these averages.",
        label: "Open the research portal",
      },
    },
  ],
};

export const SEED = { sources: SOURCES, series: SERIES, events: EVENTS, reports: [HORMUZ] };
