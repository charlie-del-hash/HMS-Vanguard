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
 * ── consent is a claim, and `verified` is the permission ──────────────
 * `subscribers.consent` records what the caller said. It cannot be more than
 * that: the endpoint is public, so a script can assert consent for an address
 * that never agreed. `verified` is the flag that authorises a send, nothing
 * here ever sets it, and `public.mailable_subscribers` (0010) exists so that
 * the query a mailer reaches for is already the correct one.
 */
import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL } from "astro:env/client";
import type { Database } from "../../lib/database.types";
/* The same id shape /api/track validates — imported rather than retyped. */
import { UUID } from "../../lib/track-validate";

export const prerender = false;

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

/* ── two callers, two shapes ──────────────────────────────────────────
 *
 * The island posts JSON. A reader with JavaScript off posts the form itself,
 * which is `application/x-www-form-urlencoded` — and this endpoint used to
 * `JSON.parse` everything, so that reader was navigated off the article to a
 * page of raw JSON and nothing was recorded. The component's own header
 * promised the fallback worked; it did not.
 *
 * What made it survive review is that the check asserted the form's `action`
 * and `method` ATTRIBUTES and never submitted it. A form can have both of
 * those and still be broken, which is the whole lesson: assert the behaviour.
 */
type Payload = { email?: unknown; anonId?: unknown; slug?: unknown; consent?: unknown };

function parseBody(raw: string, contentType: string): { body: Payload; fromForm: boolean } | null {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const f = new URLSearchParams(raw);
    return {
      fromForm: true,
      body: {
        email: f.get("email") ?? undefined,
        anonId: f.get("anonId") ?? undefined,
        slug: f.get("slug") ?? undefined,
        /* A checkbox is present-or-absent, never `false`. */
        consent: f.get("consent") !== null,
      },
    };
  }
  try {
    return { body: JSON.parse(raw) as Payload, fromForm: false };
  } catch {
    return null;
  }
}

/**
 * Answer a form post the way a browser expects: a redirect back to where they
 * were, with the outcome in the query string. Returning JSON to a navigation
 * replaces the article with a blob of text, which is the bug this fixes.
 */
function backToPage(ctx: Parameters<APIRoute>[0], status: "ok" | "bad", slug: unknown) {
  const referer = ctx.request.headers.get("referer");
  let to = "/";
  if (typeof slug === "string" && /^[a-z0-9-]+$/.test(slug)) to = `/reports/${slug}`;
  else if (referer) {
    /* Same-origin only — a Referer is attacker-influenceable and an open
       redirect out of a subscribe form is a phishing primitive. */
    try {
      const u = new URL(referer);
      if (u.origin === ctx.url.origin) to = u.pathname;
    } catch {
      /* keep the default */
    }
  }
  return ctx.redirect(`${to}?subscribed=${status}#subscribe`, 303);
}

export const POST: APIRoute = async (ctx) => {
  const contentType = ctx.request.headers.get("content-type") ?? "";
  const raw = await ctx.request.text().catch(() => "");
  if (!raw || raw.length > 4096) return json(400, { ok: false, message: "No." });

  const parsed = parseBody(raw, contentType);
  if (!parsed) return json(400, { ok: false, message: "That did not arrive as JSON." });
  const { body, fromForm } = parsed;

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  if (!EMAIL.test(email)) {
    if (fromForm) return backToPage(ctx, "bad", body.slug);
    return json(400, { ok: false, message: "That does not look like an email address." });
  }

  const { SUPABASE_SERVICE_ROLE_KEY: key } = await import("astro:env/server");
  if (!key || !PUBLIC_SUPABASE_URL) {
    if (fromForm) return backToPage(ctx, "bad", body.slug);
    return json(503, {
      ok: false,
      message: "Sign-up is not configured on this deployment yet. Nothing was recorded.",
    });
  }

  const anonId = typeof body.anonId === "string" && UUID.test(body.anonId) ? body.anonId : null;
  const slug = typeof body.slug === "string" ? body.slug.slice(0, 120) || null : null;

  /* ── consent is a CLAIM, and the column records the claim ────────────
   *
   * This endpoint is public and unauthenticated by necessity, so `consent`
   * arrives from the caller and a scripted caller can assert it for an address
   * that never agreed. No amount of origin-checking fixes that: a script sets
   * whatever headers it likes, and Astro's same-origin check only stops a form
   * on somebody else's site.
   *
   * So the fix is not to pretend this field is proof. It is to make sure
   * nothing downstream ever treats it as proof: `verified` is the flag that
   * authorises a send, this endpoint never sets it, and migration 0010 adds
   * `public.mailable_subscribers` so the correct query is the easy one. A
   * mailer written against `consent` alone would be the actual incident; this
   * column on its own is just a record of what was claimed. */
  const consentClaimed = body.consent === true;

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
    consent: consentClaimed,
    ...utm,
  });

  if (error) {
    /* Already subscribed is not a failure and must not read as one — and it
       must not confirm to a stranger that an address is on the list either, so
       both paths say the same thing. */
    if (/duplicate key|unique/i.test(error.message)) {
      if (fromForm) return backToPage(ctx, "ok", slug);
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
        consent: consentClaimed,
      });
      if (!retry) {
        if (fromForm) return backToPage(ctx, "ok", slug);
        return json(200, { ok: true, message: "You're on the list." });
      }
    }
    console.warn(`[subscribe] ${error.message}`);
    if (fromForm) return backToPage(ctx, "bad", slug);
    return json(500, { ok: false, message: "That did not save. Try again in a moment." });
  }

  if (fromForm) return backToPage(ctx, "ok", slug);
  return json(200, { ok: true, message: "You're on the list." });
};
