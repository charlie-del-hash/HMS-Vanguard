/* Sign out.
 *
 * POST only. A GET that destroys a session can be triggered by anything that
 * renders a URL — a prefetch, an image tag on another site, a link in an
 * email — so signing out becomes something other people can do to you. It is
 * a small annoyance rather than a breach, which is exactly why it gets skipped.
 */
import type { APIRoute } from "astro";
import { serverClient } from "../../lib/auth";

export const prerender = false;

export const POST: APIRoute = async (ctx) => {
  const db = serverClient(ctx);
  await db.auth.signOut();
  return ctx.redirect("/admin/login", 303);
};

export const GET: APIRoute = async (ctx) =>
  ctx.redirect("/admin", 303);
