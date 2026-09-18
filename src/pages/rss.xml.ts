/* The feed, because email should not be the only way to subscribe.
 *
 * A publication with no feed asks every reader who wants to follow it to hand
 * over an address first. That is exactly the wall this funnel was designed not
 * to be: the reports are free and open, and following them should be too.
 *
 * Built from the same `listReports()` the index page uses, so a report cannot
 * be in one and missing from the other.
 */
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { listReports } from "../lib/content";
import { plain } from "../lib/inline";
import { SITE_NAME, SITE_TAGLINE } from "../lib/config";

export const GET: APIRoute = async (ctx) => {
  const { reports } = await listReports();

  return rss({
    title: SITE_NAME,
    description: SITE_TAGLINE,
    /* `ctx.site` is astro.config's `site`, which is the production domain on a
       preview build too — see the note there. A feed is copied into readers'
       clients and outlives the deployment that served it, so a preview URL
       baked into one would go on 404ing long after the preview was gone. */
    site: ctx.site!,
    /* en-GB rather than en-US: the whole site is spelled that way, and a
       reader's client uses this to pick a date format. */
    customData: "<language>en-gb</language>",
    items: reports.map((r) => ({
      title: r.title,
      link: `/reports/${r.slug}`,
      pubDate: new Date(r.publishedAt),
      /* The stored summary, with the inline markup taken out — a feed reader
         renders `description` as text or as HTML depending on the reader, and
         asterisks showing through in half of them is worse than plain prose in
         all of them. */
      description: plain(r.summary ?? r.dek ?? ""),
      categories: r.tags,
      ...(r.author ? { author: r.author } : {}),
    })),
  });
};
