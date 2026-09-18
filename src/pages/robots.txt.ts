/* robots.txt, generated rather than committed.
 *
 * It has to name the sitemap by absolute URL, and this site's origin is not
 * known at authoring time — it comes from PUBLIC_SITE_URL or the Vercel
 * production domain (see astro.config.mjs). A file in public/ would have to
 * hard-code one, which is the same mistake as a hard-coded canonical: correct
 * on the day it is written and silently wrong after the domain changes.
 *
 * What is NOT excluded here matters as much as what is. /ops-deck.html is
 * linked from the landing page, so disallowing it would leave it indexable
 * from that link while stopping any crawler from reading the noindex that
 * would have settled it. It is kept crawlable and answered with an
 * `X-Robots-Tag: noindex, follow` header instead — see vercel.json.
 */
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? `Sitemap: ${new URL("/sitemap-index.xml", site).href}\n` : "";

  const body = `User-agent: *
Allow: /

# Nothing here is for a reader. /admin is behind Supabase Auth and would answer
# a crawler with a sign-in page; /api is a beacon endpoint and a subscribe
# endpoint, neither of which has anything to index.
Disallow: /admin
Disallow: /api/

# Component sheets used while building the site. They carry noindex as well.
Disallow: /dev/

${sitemap}`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
