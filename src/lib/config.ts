/* The handful of values that differ between one deployment and another.
 *
 * The portal URL is the one that matters. This whole site is an attention
 * funnel for the real Affinity research portal, so the CTA at the end of every
 * report is the point of the exercise — and it is the one thing this repo
 * cannot know. It is a config value, deliberately, and until it is set the CTA
 * says so rather than shipping a link that goes nowhere.
 *
 * A placeholder href would be worse than no href: a dead link on a research
 * page costs more trust than a missing one, and it is invisible in review
 * because it looks exactly like a working link.
 */
import { PUBLIC_PORTAL_URL } from "astro:env/client";

/** Where the research portal lives, or null when nobody has said yet. */
export const PORTAL_URL: string | null =
  PUBLIC_PORTAL_URL && /^https:\/\//.test(PUBLIC_PORTAL_URL) ? PUBLIC_PORTAL_URL : null;

/**
 * The portal link with attribution attached, so a click that starts on a
 * report can be told apart from one that starts on the landing page. Returns
 * null when the portal is not configured — callers must handle that rather
 * than falling back to a guess.
 */
export function portalHref(from: string): string | null {
  if (!PORTAL_URL) return null;
  const u = new URL(PORTAL_URL);
  u.searchParams.set("utm_source", "vanguard");
  u.searchParams.set("utm_medium", "referral");
  u.searchParams.set("utm_campaign", from);
  return u.href;
}

/** Shown wherever the site names itself. */
export const SITE_NAME = "Affinity Research";
export const SITE_TAGLINE = "Special reports on shipping, energy and the chokepoints between them";
