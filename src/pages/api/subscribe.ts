/* Optional email. Never a wall.
 *
 * The whole funnel decision was that content is free and analytics is the
 * growth instrument, so this endpoint exists to be easy to ignore. Nothing on
 * the site is gated behind it and nothing here tries to make it feel that way.
 *
 * ── what it records, and why the id matters ───────────────────────────
 * The address, the report that produced it, and the first-touch attribution
 * already pinned to that visitor. That is the point of carrying an anon_id at
 * all: a signup attributes back to the report and the channel that earned it
 * rather than to whatever page happened to be open.
 *
 * ── consent is opt-in and it means it ─────────────────────────────────
 * `subscribers.consent` defaults to false in the schema, and this only sets it
 * true when the box was actually ticked. An unticked box still records the
 * address — it just records that nobody agreed to be emailed, which is the
 * honest state and the one the sending code must check.
 */
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";
import type { Database } from "../../lib/database.types";

export const prerender = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* Mirrors `subscribers_email_shape`, so a bad address is refused with a
   sentence rather than a constraint name. The database still has the final
   say, which is the point of having it there too. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async (ctx) => {
  const raw = await ctx.request.text().catch(() => "");
  if (!raw || raw.length > 4096) return json(400, { ok: false, message: "No." });

  let body: { email?: unknown; anonId?: unknown; slug?: unknown; consent?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, message: "That did not arrive as JSON." });
  }

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  if (!EMAIL.test(email)) {
    return json(400, { ok: false, message: "That does not look like an email address." });
  }

  const { SUPABASE_SERVICE_ROLE_KEY: key } = await import("astro:env/server");
  if (!key || !PUBLIC_SUPABASE_URL) {
    return json(503, {
      ok: false,
      message: "Sign-up is not configured on this deployment yet. Nothing was recorded.",
    });
  }

  const anonId = typeof body.anonId === "string" && UUID.test(body.anonId) ? body.anonId : null;
  const slug = typeof body.slug === "string" ? body.slug.slice(0, 120) || null : null;

  const db = createClient<Database>(PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-affinity-client": "subscribe" } },
  });

  /* The attribution is whatever was pinned to this visitor on their FIRST hit,
     read back rather than taken from the request — a client could otherwise
     claim any channel it liked, and the whole value of the number is that
     nobody chose it. */
  let utm: Record<string, string | null> = {};
  if (anonId) {
    const { data } = await db
      .from("visitors")
      .select("utm_source, utm_medium, utm_campaign, utm_content, utm_term")
      .eq("anon_id", anonId)
      .maybeSingle();
    if (data) utm = data;
  }

  const { error } = await db.from("subscribers").insert({
    email,
    anon_id: anonId,
    source_report: slug,
    consent: body.consent === true,
    ...utm,
  });

  if (error) {
    /* Already subscribed is not a failure and must not read as one — and it
       must not confirm to a stranger that an address is on the list either, so
       both paths say the same thing. */
    if (/duplicate key|unique/i.test(error.message)) {
      return json(200, { ok: true, message: "You're on the list." });
    }
    /* A foreign key failure means the visitor row does not exist, which
       happens when Do Not Track stopped the beacon. The signup is still
       perfectly valid; it just has no attribution. */
    if (/foreign key/i.test(error.message)) {
      const { error: retry } = await db.from("subscribers").insert({
        email,
        anon_id: null,
        source_report: slug,
        consent: body.consent === true,
      });
      if (!retry) return json(200, { ok: true, message: "You're on the list." });
    }
    console.warn(`[subscribe] ${error.message}`);
    return json(500, { ok: false, message: "That did not save. Try again in a moment." });
  }

  return json(200, { ok: true, message: "You're on the list." });
};
