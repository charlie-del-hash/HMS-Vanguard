/* Which domain this site is published at.
 *
 * ── the problem this file exists for ──────────────────────────────────
 * This repository was once built by two Vercel projects at once — `affinity`
 * and `hms-vanguard` — both rooted at the repo root. Each project canonicalises
 * to its own production domain, so two domains served the same site, each
 * claiming to be the original, and a search engine picked one. That is the same
 * failure `.github/workflows/static.yml` was retired for; retiring Pages moved
 * it rather than solving it.
 *
 * It is solved now by there being one project. `hms-vanguard` has been deleted
 * and `affinity` is the only publisher, so there is no second copy to redirect
 * and no mirror allowlist to keep honest. If a second project is ever added,
 * the answer is to delete it, not to reintroduce a redirect.
 *
 * ── why a committed constant, when a committed constant caused a bug ──
 * A hard-coded production URL is exactly what went wrong once before: a
 * constant naming `affinity` was deciding every canonical link on the site
 * while `hms-vanguard` was production, and nothing made that visible.
 *
 * The difference is not that this one is right. It is that this one is
 * *checkable*: it is declared once, in a file named for the job, every
 * consumer reads it from here, `PUBLIC_SITE_URL` overrides it without a code
 * change, and checks/vercel-output.js asserts that the build ships no redirect
 * off its own origin.
 */

/** The one domain this site is published at. `PUBLIC_SITE_URL` overrides it. */
export const CANONICAL_HOST = "affinity-wine.vercel.app";

const strip = (u) => u.replace(/\/+$/, "");

/** Where canonical links, the sitemap and the feed all point. */
export function canonicalOrigin(env = process.env) {
  if (env.PUBLIC_SITE_URL) return strip(env.PUBLIC_SITE_URL);
  return `https://${CANONICAL_HOST}`;
}

/**
 * `site` for astro.config.
 *
 * On Vercel this is the canonical origin whether it is a production or a
 * preview deployment — a preview that canonicalises to itself is a second site
 * too, just a shorter-lived one. Off Vercel it is localhost, so a local build
 * is obviously local.
 */
export function siteUrl(env = process.env) {
  if (env.PUBLIC_SITE_URL) return strip(env.PUBLIC_SITE_URL);
  if (env.VERCEL || env.VERCEL_PROJECT_PRODUCTION_URL) return canonicalOrigin(env);
  return "http://localhost:4321";
}
