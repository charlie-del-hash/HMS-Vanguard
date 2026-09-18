/* Where the emailed link lands.
 *
 * Supabase sends the reader back here with a one-time `code`. Exchanging it
 * sets the session cookies through the same cookie plumbing every other
 * request uses, and then the visitor goes where they were headed.
 *
 * The exchange happens on the SERVER. The alternative — letting the browser
 * pick the token out of the URL fragment — leaves the session in JavaScript's
 * reach, which is the thing httpOnly cookies exist to prevent.
 */
import type { APIRoute } from "astro";
import { serverClient } from "../../../lib/auth";

export const prerender = false;

export const GET: APIRoute = async (ctx) => {
  const code = ctx.url.searchParams.get("code");

  /* Same rule as the login form: a path on this site, never an absolute URL.
     An open redirect behind a login is worth more to an attacker than one in
     front of it, because the link looks legitimate to the person clicking. */
  const raw = ctx.url.searchParams.get("next") ?? "/admin";
  const next = /^\/admin(\/|$)/.test(raw) ? raw : "/admin";

  if (!code) {
    return ctx.redirect("/admin/login?why=no-code", 303);
  }

  const db = serverClient(ctx);
  const { error } = await db.auth.exchangeCodeForSession(code);

  if (error) {
    /* An expired or already-used link is the common case and is not an error
       worth alarming anybody about — ask for another one. */
    const why = /expired|invalid|used/i.test(error.message) ? "link-expired" : "exchange-failed";
    return ctx.redirect(`/admin/login?why=${why}`, 303);
  }

  return ctx.redirect(next, 303);
};
