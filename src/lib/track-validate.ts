/* What /api/track will accept, as a pure function.
 *
 * It lives here rather than inline in the route for one reason: the route
 * answers 204 to everything, deliberately — a beacon has nobody to report an
 * error to, and an endpoint whose status varies with the input is an oracle for
 * whoever is probing it. Which means none of this validation is observable from
 * outside, and a check that POSTs rubbish and gets 204 proves only that the
 * server is running.
 *
 * As a function it can be tested directly, and the allowlist stops being a
 * comment about intent. checks/site-funnel.js does exactly that.
 */

/** The events the beacon sends. Anything else is dropped rather than stored. */
export const KINDS = new Set([
  "pageview",
  "scroll_25",
  "scroll_50",
  "scroll_75",
  "scroll_100",
  "read_time",
  "cta_impression",
  "cta_click",
  "outbound_portal",
  "deck_open",
  "subscribe",
  "chart_view",
]);

export const MAX_EVENTS = 40;
export const MAX_BODY = 16 * 1024;

/**
 * The shape of an anon id, in one place.
 *
 * /api/subscribe carried a byte-identical copy of this until an audit found
 * the pair. Two regexes for one concept drift the first time either is fixed,
 * and the drift is invisible: both endpoints keep working, on slightly
 * different definitions of the same id.
 */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICES = ["phone", "tablet", "desktop", "other"];
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

export interface CleanEvent {
  kind: string;
  slug?: string;
  ts?: string;
  meta?: Record<string, string | number | boolean>;
}

export interface Beacon {
  anonId: string;
  visitor: Record<string, string>;
  events: CleanEvent[];
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * A flat object of short scalars, or nothing.
 *
 * Nested structures are dropped rather than walked: a payload that can nest
 * arbitrarily is a payload somebody will put a megabyte of nonsense in, and
 * `meta` is for a scroll percentage and a number of seconds.
 */
export function sanitiseMeta(v: unknown): Record<string, string | number | boolean> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 12) break;
    const key = k.slice(0, 40);
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "boolean") out[key] = raw;
    else if (typeof raw === "string") out[key] = raw.slice(0, 200);
    else continue;
    n++;
  }
  return n ? out : undefined;
}

/**
 * Parse a beacon body.
 *
 * Returns null for anything that should be silently dropped — an oversized
 * body, unparseable JSON, a missing or malformed id, or a batch with no
 * recognised event left in it after filtering.
 *
 * `country` comes from the edge header, never from the body: the browser
 * cannot know it reliably and a client-supplied one is a client-chosen one.
 */
export function parseBeacon(raw: string, country = ""): Beacon | null {
  if (!raw || raw.length > MAX_BODY) return null;

  let body: { anonId?: unknown; visitor?: unknown; events?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }

  const anonId = typeof body.anonId === "string" && UUID.test(body.anonId) ? body.anonId : null;
  if (!anonId) return null;

  const incoming = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events: CleanEvent[] = incoming
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e?.kind === "string" && KINDS.has(e.kind))
    .map((e) => ({
      kind: e.kind as string,
      slug: str(e.slug, 120),
      ts: str(e.ts, 40),
      meta: sanitiseMeta(e.meta),
    }));

  if (events.length === 0) return null;

  const visitor: Record<string, string> = {};
  const v = body.visitor;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const src = v as Record<string, unknown>;
    const referrer = str(src.referrer, 500);
    if (referrer) visitor.referrer = referrer;
    for (const k of UTM) {
      const val = str(src[k], 120);
      if (val) visitor[k] = val;
    }
    const d = str(src.device, 10);
    if (d && DEVICES.includes(d)) visitor.device = d;
  }
  if (/^[A-Z]{2}$/.test(country)) visitor.country = country.toUpperCase();

  return { anonId, visitor, events };
}
