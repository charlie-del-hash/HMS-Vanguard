/* The funnel's write path, and the only one.
 *
 * ── why an endpoint at all ────────────────────────────────────────────
 * 0004 explains it: the country on a visitor row is derived from the request
 * IP, the IP is deliberately never stored, and the browser cannot know its own
 * country reliably. So a server has to be in the path regardless — and once it
 * is, granting anon a public INSERT would be pure extra surface. The funnel
 * tables carry RLS with no write policy for any role; this holds the service
 * role, which bypasses it.
 *
 * ── it always answers 204 ─────────────────────────────────────────────
 * A beacon has nobody to report an error to and no sensible way to retry. An
 * endpoint that returns 500 when the database is paused turns a quiet outage
 * into a console full of red on a reader's screen, and one whose status varies
 * with the input tells whoever is probing it which requests hurt. Failures go
 * to the log, where somebody can act on them.
 *
 * That also means none of the validation is visible from outside, which is why
 * it lives in src/lib/track-validate.ts as a pure function with its own tests
 * rather than inline here where nothing could reach it.
 */
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";
import type { Database, Json } from "../../lib/database.types";
import { MAX_BODY, parseBeacon } from "../../lib/track-validate";
import { readCapped } from "../../lib/http-body";

export const prerender = false;

/** Nothing here is worth telling a caller about. */
const noContent = () => new Response(null, { status: 204 });

export const POST: APIRoute = async (ctx) => {
  /* Capped as it arrives, not after. `request.text()` buffers the whole body
     first, so MAX_BODY was being consulted about bytes this function had
     already been allocated. `parseBeacon` still checks the length too — that
     is the pure function's own contract, and it is tested on its own. */
  const raw = await readCapped(ctx.request, MAX_BODY);
  if (raw === null) return noContent();

  /* The country is resolved at the edge, so the IP never enters this function
     at all — a stronger guarantee than resolving it here and choosing not to
     write it down. */
  const country = ctx.request.headers.get("x-vercel-ip-country") || "";

  const beacon = parseBeacon(raw, country);
  if (!beacon) return noContent();

  const { SUPABASE_SERVICE_ROLE_KEY: key } = await import("astro:env/server");
  if (!key || !PUBLIC_SUPABASE_URL) {
    /* Said once per cold start rather than once per pageview, because a log
       line per reader is its own outage. */
    warnOnce(
      "[track] SUPABASE_SERVICE_ROLE_KEY is not set, so nothing is being recorded. " +
        "The funnel tables have no write policy for any role by design; this endpoint is the only writer.",
    );
    return noContent();
  }

  try {
    const db = createClient<Database>(PUBLIC_SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-affinity-client": "track" } },
    });
    const { error } = await db.rpc("record_events", {
      p_anon_id: beacon.anonId,
      p_visitor: beacon.visitor as unknown as Json,
      p_events: beacon.events as unknown as Json,
    });
    if (error) console.warn(`[track] ${error.message}`);
  } catch (e) {
    console.warn(`[track] ${e instanceof Error ? e.message : String(e)}`);
  }

  return noContent();
};

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(message);
}

/** A GET here is somebody poking at it, not a reader. */
export const GET: APIRoute = () => noContent();
