/* Editor-side helpers: slugs, and what a new block starts as.
 *
 * Shared by the server pages and the React island, so the two cannot disagree
 * about what a block of a given kind looks like.
 */
import type { BlockKind, Payload } from "./blocks";
import type { Client } from "./supabase";

/* ── slugs ──────────────────────────────────────────────────────────── */

/**
 * A title to a slug the database will accept.
 *
 * `reports_slug_is_kebab` is a CHECK, not a convention, so this has to produce
 * `^[a-z0-9]+(-[a-z0-9]+)*$` or the insert fails — and an editor typing a
 * perfectly good title should never see a constraint name.
 */
export function slugify(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents rather than drop the letter
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  /* A title of only punctuation or non-Latin script leaves nothing. A slug is
     required and unique, so it gets a stable, obviously-temporary one rather
     than a failed insert. */
  return s || `untitled-${Date.now().toString(36)}`;
}

/**
 * A slug nothing else is using.
 *
 * Checks, then suffixes. There is a race here — two editors creating the same
 * title in the same second — and the unique index is what actually decides;
 * this only keeps the common case from ever reaching it.
 */
export async function newReportSlug(db: Client, title: string): Promise<string> {
  const base = slugify(title);
  const { data } = await db.from("reports").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/* ── block kinds ────────────────────────────────────────────────────── */

export const BLOCK_KINDS: BlockKind[] = [
  "prose", "kpi_row", "chart", "timeline", "map", "table",
  "callout", "quote", "sourcebox", "cta", "embed",
];

export const BLOCK_LABEL: Record<BlockKind, string> = {
  prose: "Prose",
  kpi_row: "KPI row",
  chart: "Chart",
  timeline: "Timeline",
  map: "Map",
  table: "Table",
  callout: "Callout",
  quote: "Quote",
  sourcebox: "Sources",
  cta: "Call to action",
  embed: "Embed",
};

export const BLOCK_HINT: Record<BlockKind, string> = {
  prose: "Body copy. **bold**, *italic*, `code`, #{figures} and [links](https://…).",
  kpi_row: "The figures a reader takes away if they read nothing else.",
  chart: "Draws named series. The series must exist before the chart can.",
  timeline: "Pulls events by tag, newest last, with their confidence.",
  map: "Plots the same events geographically. Needs coordinates on them.",
  table: "Rows you type. Columns drop by priority as the panel narrows.",
  callout: "An aside that changes how the rest should be read.",
  quote: "A pulled quotation. Say if it is illustrative.",
  sourcebox: "The provenance ledger, printed. Every report ends with one.",
  cta: "The way through to the portal. Goes last.",
  embed: "An https page or a path on this site, in a sandboxed frame.",
};

/**
 * What a newly-added block contains.
 *
 * Every one of these must satisfy `parsePayload`, because that function throws
 * rather than skipping — so a default that did not parse would break the
 * preview the instant somebody added a block, and the error would point at the
 * renderer rather than at this list.
 *
 * The KPI and table defaults carry `indicative: true` for the same reason the
 * parser demands it: a figure with no stated provenance should be uncomfortable
 * to leave that way, and starting honest is easier than being corrected.
 */
export function blankPayload(kind: BlockKind): Extract<Payload, { kind: typeof kind }> {
  switch (kind) {
    case "prose":
      return { kind, paragraphs: ["Write the paragraph here."] } as never;
    case "kpi_row":
      return {
        kind,
        items: [{ label: "Label", value: "0", indicative: true }],
      } as never;
    case "chart":
      return { kind, seriesKeys: [], chartKind: "area", lane: "wide" } as never;
    case "timeline":
      return { kind, tags: ["hormuz"] } as never;
    case "map":
      return { kind, tags: ["hormuz"] } as never;
    case "table":
      return {
        kind,
        columns: [
          { key: "name", label: "Name", priority: 0 },
          { key: "value", label: "Value", numeric: true, priority: 1 },
        ],
        rows: [{ name: "A row", value: "0" }],
        indicative: true,
      } as never;
    case "callout":
      return { kind, tone: "note", title: "", body: ["The aside goes here."] } as never;
    case "quote":
      return { kind, text: "The quotation goes here.", who: "", role: "" } as never;
    case "sourcebox":
      return { kind, sourceKeys: [] } as never;
    case "cta":
      return {
        kind,
        headline: "The full assessment lives in the Affinity research portal",
        label: "Open the research portal",
      } as never;
    case "embed":
      return { kind, url: "/ops-deck.html", title: "The Affinity ops deck" } as never;
  }
}

/** What goes in the database: the payload without its discriminant.
 *
 * The cast goes via `unknown` because Payload is a discriminated union of
 * interfaces, and TypeScript will not widen one of those to an index signature
 * directly — the members have no index signature, which is exactly what makes
 * them useful everywhere else. */
export function toStored(p: Payload): Record<string, unknown> {
  const { kind: _kind, ...rest } = p as unknown as Record<string, unknown> & { kind: string };
  return rest;
}

/* ── status ─────────────────────────────────────────────────────────── */

export type Status = "draft" | "scheduled" | "published" | "archived";

/**
 * Whether a status change is allowed, and why not.
 *
 * The database has the same rule as two CHECK constraints
 * (`reports_published_needs_a_date`, `reports_scheduled_needs_a_date`) and will
 * refuse regardless. This exists so the refusal arrives as a sentence in the
 * editor instead of a constraint name in a toast.
 */
export function statusProblem(next: Status, publishedAt: string | null): string | null {
  if ((next === "published" || next === "scheduled") && !publishedAt) {
    return next === "published"
      ? "A published report needs a date. Undated research is worthless — a reader cannot tell whether it is current."
      : "A schedule with no time is not a schedule. Set the date first.";
  }
  if (next === "scheduled" && publishedAt && new Date(publishedAt) <= new Date()) {
    return "That time has passed. Either publish it now or pick a future time.";
  }
  return null;
}
