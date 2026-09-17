/* One door to the admin, and it is shut by default.
 *
 * Guarding in each page would work right up until somebody adds a page and
 * forgets — and the failure mode of forgetting is an unprotected editor, which
 * is not a mistake that announces itself. A prefix match here means a new route
 * under /admin is protected by existing, and unprotecting one is a visible edit
 * to this file.
 *
 * The public site is prerendered and never reaches this: middleware runs on
 * rendered routes, and /, /reports and /reports/[slug] are all static files by
 * the time a reader asks for them. So this costs the funnel nothing.
 */
import { defineMiddleware } from "astro:middleware";
import { access } from "./lib/auth";

/** Reachable without a session. Everything else under /admin is not. */
const OPEN = ["/admin/login", "/admin/auth/callback", "/admin/signout"];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname.replace(/\/+$/, "") || "/";

  if (!path.startsWith("/admin")) return next();
  if (OPEN.some((p) => path === p || path.startsWith(`${p}/`))) return next();

  const who = await access(ctx);

  /* Every state but `staff` is refused, including `unavailable`. Failing open
     when the database cannot be reached would mean a paused project — which
     the free tier does after about a week idle — leaves the editor standing
     open to anyone who knows the URL. */
  if (who.state !== "staff") {
    const to = new URL("/admin/login", ctx.url);
    /* Where they were going, so the login can send them back. Path only: an
       absolute URL here is an open-redirect handed to whoever crafts the
       link. */
    if (path !== "/admin") to.searchParams.set("next", path);
    if (who.state === "signed-in-not-staff") to.searchParams.set("why", "not-staff");
    if (who.state === "unavailable") to.searchParams.set("why", "unavailable");
    return ctx.redirect(to.pathname + to.search, 303);
  }

  /* Handed to the page so it does not ask a second time — one round trip to
     the auth server per request, not one per component that wonders. */
  ctx.locals.staff = who.staff;
  return next();
});
