/* Save a report's blocks.
 *
 * ── why an endpoint rather than writing from the browser ──────────────
 * The session cookies are httpOnly, so a browser-side Supabase client cannot
 * read them. That is a feature: making them readable so the island could write
 * directly would put the access token inside reach of any script on the page.
 *
 * Going through the server keeps the token where it is AND buys the more
 * useful half — the payloads are run through `parsePayload` here, so a
 * malformed block is refused before it reaches the database rather than
 * throwing during the next build. The parser is the contract; this is the one
 * place every write passes through, so this is where the contract is enforced.
 *
 * Authorization is still the database's. This runs as the signed-in user, and
 * `save_report_blocks` is SECURITY INVOKER, so a non-staff caller who got past
 * the middleware somehow is refused by the policies anyway.
 */
import type { APIRoute } from "astro";
import { serverClient } from "../../../../lib/auth";
import type { Json } from "../../../../lib/database.types";
import { parsePayload, type BlockKind } from "../../../../lib/blocks";
import { BLOCK_KINDS } from "../../../../lib/admin";

export const prerender = false;

interface Incoming {
  blocks?: { kind?: string; payload?: unknown }[];
  note?: string;
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async (ctx) => {
  const id = ctx.params.id;
  if (!id) return bad("no report id");

  let body: Incoming;
  try {
    body = (await ctx.request.json()) as Incoming;
  } catch {
    return bad("body was not JSON");
  }

  const incoming = body.blocks;
  if (!Array.isArray(incoming)) return bad("blocks must be an array");

  /* Validate everything BEFORE writing anything. Validating as we go would
     leave a half-saved report when block nine is the bad one, and the whole
     point of the RPC below is that a save is all or nothing. */
  const blocks: { ord: number; kind: BlockKind; payload: Record<string, unknown> }[] = [];
  for (const [i, b] of incoming.entries()) {
    const kind = b?.kind as BlockKind;
    if (!BLOCK_KINDS.includes(kind)) return bad(`block ${i}: unknown kind ${String(b?.kind)}`);
    try {
      /* parsePayload returns the payload WITH a discriminant; the column holds
         it without one, exactly as the seed and the renderer expect. */
      const parsed = parsePayload(kind, i, b?.payload) as unknown as Record<string, unknown>;
      const { kind: _drop, ...stored } = parsed;
      blocks.push({ ord: i, kind, payload: stored });
    } catch (e) {
      return bad(e instanceof Error ? e.message : `block ${i} is not valid`);
    }
  }

  const db = serverClient(ctx);
  const { data, error } = await db.rpc("save_report_blocks", {
    p_report_id: id,
    /* The RPC's argument is jsonb, typed as Json by the generated types. The
       array is structurally that already; the cast only tells TypeScript so. */
    p_blocks: blocks as unknown as Json,
    /* Omitted rather than null: the generated signature has p_note optional,
       and passing null where undefined is expected is a different call. */
    ...(body.note ? { p_note: body.note } : {}),
  });

  if (error) {
    /* A policy refusal and a bad id are different problems for the person
       reading this, so they are not flattened into "save failed". */
    const denied = /permission denied|violates row-level security/i.test(error.message);
    return bad(
      denied
        ? "The database refused the write. This account is signed in but not staff."
        : error.message,
      denied ? 403 : 400,
    );
  }

  return new Response(JSON.stringify({ ok: true, written: data }), {
    headers: { "content-type": "application/json" },
  });
};
