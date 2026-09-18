/* Which domain this site is published at, and which ones merely build it.
 *
 * ── the problem this file exists for ──────────────────────────────────
 * Two Vercel projects build this repository — `hms-vanguard` and `affinity` —
 * both rooted at the repo root, and Vercel builds every branch on both. That
 * was free while the repo was one self-contained HTML file. It stopped being
 * free the moment the repo had a build: each project canonicalises to its own
 * production domain, so two domains serve the same site, each claiming to be
 * the original, and a search engine picks one.
 *
 * That is the same failure `.github/workflows/static.yml` was retired for.
 * Retiring Pages moved it rather than solving it.
 *
 * ── why a committed constant, when a committed constant caused a bug ──
 * A hard-coded production URL is exactly what went wrong once before: a
 * constant naming `affinity` was deciding every canonical link on the site
 * while `hms-vanguard` was production, and nothing made that visible.
 *
 * The difference is not that this one is right. It is that this one is
 * *checkable*: it is declared once, in a file named for the job, every
 * consumer reads it from here, `PUBLIC_SITE_URL` overrides it without a code
 * change, and checks/vercel-output.js asserts the behaviour it produces.
 *
 * ── and why MIRROR_HOSTS is an allowlist, not "anything else" ─────────
 * The redirect below could have been "if this build is not the canonical host,
 * send everyone to the canonical host". That version fails catastrophically:
 * rename the production project, and PRODUCTION starts 308ing to a domain that
 * no longer exists. Naming the mirrors explicitly means the same mistake
 * degrades to "no redirect happens" — a stale canonical, visible in the build
 * output and in these checks, rather than a site that redirects itself off the
 * internet.
 */

/** The one domain this site is published at. `PUBLIC_SITE_URL` overrides it. */
export const CANONICAL_HOST = "hms-vanguard.vercel.app";

/**
 * Other Vercel projects that build this same repository and must not serve a
 * second copy of the site at their own production domain.
 *
 * Removing a name here stops that project redirecting. Adding one starts it.
 * Nothing is inferred.
 */
export const MIRROR_HOSTS = ["affinity-wine.vercel.app"];

const strip = (u) => u.replace(/\/+$/, "");

/** Where canonical links, the sitemap and the feed all point. */
export function canonicalOrigin(env = process.env) {
  if (env.PUBLIC_SITE_URL) return strip(env.PUBLIC_SITE_URL);
  return `https://${CANONICAL_HOST}`;
}

/**
 * `site` for astro.config.
 *
 * On Vercel this is the canonical origin whichever project is building and
 * whether it is a production or a preview deployment — a preview that
 * canonicalises to itself is a second site too, just a shorter-lived one.
 * Off Vercel it is localhost, so a local build is obviously local.
 */
export function siteUrl(env = process.env) {
  if (env.PUBLIC_SITE_URL) return strip(env.PUBLIC_SITE_URL);
  if (env.VERCEL || env.VERCEL_PROJECT_PRODUCTION_URL) return canonicalOrigin(env);
  return "http://localhost:4321";
}

/**
 * The origin this build should 308 everything to, or null to serve normally.
 *
 * Production deployments of a named mirror only. Previews are left alone so
 * they stay useful for reviewing a branch, and a mirror's preview is not a
 * public URL competing for the same readers.
 */
export function redirectTarget(env = process.env) {
  if (env.VERCEL_ENV !== "production") return null;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!host || !MIRROR_HOSTS.includes(host)) return null;
  const target = canonicalOrigin(env);
  /* Pinning PUBLIC_SITE_URL to the mirror itself means somebody has decided
     the mirror IS production; redirecting it to itself would be a loop. */
  return target === `https://${host}` ? null : target;
}
