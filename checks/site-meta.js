/* Can this site be found, and can a link to it be shared?
 *
 * Phases 0–4 built a publication whose entire growth plan is that somebody
 * pastes a report into a Slack channel — and there was not one og: tag, no
 * sitemap, no robots.txt and no feed in the whole repository. Every link
 * rendered as a bare URL.
 *
 * These assertions are deliberately about AGREEMENT rather than presence,
 * because presence is what the rest of this audit kept catching:
 *
 *   - og:url must equal the page's own canonical. Two tags that both claim to
 *     be "the URL of this page" are two chances to be wrong.
 *   - every card image must resolve inside the build. A card image that 404s is
 *     cached as a failure by the platforms and is worse than no image.
 *   - the sitemap must list exactly the indexable pages — no more (a noindex
 *     page submitted to Google is a contradiction it resolves in its favour,
 *     not ours) and no fewer.
 *   - robots.txt must not Disallow anything the sitemap lists. That pair is the
 *     single most common way a site asks to be indexed and forbids it in the
 *     same breath.
 *
 * Offline, against the build output. No browser, no network.
 *
 *   npm run build && node checks/site-meta.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".vercel", "output");
const STATIC = path.join(OUT, "static");

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n          ${e.message}`);
  }
}

if (!fs.existsSync(STATIC)) {
  console.error("no .vercel/output/static — run `npm run build` first");
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push("/" + path.relative(STATIC, p).split(path.sep).join("/"));
  }
})(STATIC);

const read = (url) => fs.readFileSync(path.join(STATIC, url.slice(1)), "utf8");

/* /404.html is never listed in a sitemap and /ops-deck.html is a file copied
   from public/ rather than a page this site renders — it is handled by a header
   route instead, and there is an assertion for that below. */
const PAGES = files.filter(
  (f) => f.endsWith(".html") && f !== "/404.html" && f !== "/ops-deck.html",
);

const metaOf = (html) => {
  const tags = [];
  for (const m of html.matchAll(/<meta\s[^>]*>/g)) {
    const name = /(?:name|property)="([^"]+)"/.exec(m[0]);
    const content = /content="([^"]*)"/.exec(m[0]);
    if (name) tags.push([name[1], content ? content[1] : ""]);
  }
  return new Map(tags);
};
const canonicalOf = (html) => {
  const m = /<link\s[^>]*rel="canonical"[^>]*>/.exec(html);
  return m ? (/href="([^"]+)"/.exec(m[0]) ?? [])[1] : undefined;
};

const pages = PAGES.map((f) => {
  const html = read(f);
  const meta = metaOf(html);
  return {
    f,
    html,
    meta,
    canonical: canonicalOf(html),
    noindex: /noindex/.test(meta.get("robots") ?? ""),
  };
});
const indexable = pages.filter((p) => !p.noindex);

assert.ok(indexable.length > 0, "no indexable page in the build; nothing below would mean anything");

console.log("a link to this site renders as a card");

t("every indexable page carries the share tags", () => {
  const need = ["og:type", "og:title", "og:url", "og:site_name", "twitter:card"];
  const bad = [];
  for (const p of indexable) {
    const missing = need.filter((k) => !p.meta.get(k));
    if (missing.length) bad.push(`${p.f} — missing ${missing.join(", ")}`);
  }
  assert.strictEqual(bad.length, 0, bad.join("\n          "));
});

t("og:url and the canonical are the same URL", () => {
  const bad = [];
  for (const p of pages) {
    if (!p.canonical || !p.meta.get("og:url")) continue;
    if (p.canonical !== p.meta.get("og:url")) {
      bad.push(`${p.f} — canonical ${p.canonical} vs og:url ${p.meta.get("og:url")}`);
    }
  }
  assert.strictEqual(bad.length, 0, `two claims about the same page's URL disagree:\n          ${bad.join("\n          ")}`);
});

t("every page names the same origin as its canonical", () => {
  /* Two Vercel projects build this repo. When `site` was each project's own
     production domain, the two builds were internally consistent and
     collectively wrong — two domains, two sets of canonicals, each claiming to
     be the original. This cannot see across two builds, but it can see a page
     that disagrees with its neighbours inside one, which is the same class of
     fault and the one a future per-page override would introduce. */
  const origins = new Map();
  for (const p of pages) {
    if (!p.canonical) continue;
    const o = new URL(p.canonical).origin;
    if (!origins.has(o)) origins.set(o, p.f);
  }
  assert.ok(origins.size > 0, "not one page has a canonical link");
  assert.strictEqual(
    origins.size,
    1,
    `this build serves ${origins.size} origins at once: ` +
      [...origins].map(([o, f]) => `${o} (${f})`).join(", "),
  );
});

t("no card points at an image that is not there", () => {
  const origin = new URL(indexable[0].canonical).origin;
  const bad = [];
  for (const p of pages) {
    for (const key of ["og:image", "twitter:image"]) {
      const v = p.meta.get(key);
      if (!v) continue;
      let u;
      try {
        u = new URL(v);
      } catch {
        bad.push(`${p.f} — ${key} is not an absolute URL: ${v}`);
        continue;
      }
      if (u.protocol !== "https:" && u.origin !== origin) {
        bad.push(`${p.f} — ${key} is not https: ${v}`);
      }
      /* Only a same-origin image can be checked from here; an off-site one is
         somebody else's 404 to have. */
      if (u.origin === origin && !files.includes(u.pathname)) {
        bad.push(`${p.f} — ${key} is ${u.pathname}, which is not in the build`);
      }
    }
  }
  assert.strictEqual(bad.length, 0, bad.join("\n          "));
});

t("the large-card layout is claimed only when there is an image", () => {
  const bad = [];
  for (const p of indexable) {
    const large = p.meta.get("twitter:card") === "summary_large_image";
    const hasImage = Boolean(p.meta.get("og:image") || p.meta.get("twitter:image"));
    if (large !== hasImage) {
      bad.push(
        `${p.f} — twitter:card=${p.meta.get("twitter:card")} with ${hasImage ? "an" : "no"} image` +
          (large ? " (X renders an empty grey slab)" : ""),
      );
    }
  }
  assert.strictEqual(bad.length, 0, bad.join("\n          "));
});

t("a report page is an article, and says when it was published", () => {
  const reports = indexable.filter((p) => /^\/reports\/[^/]+\/index\.html$/.test(p.f));
  assert.ok(reports.length > 0, "no report page in the build to check");
  for (const p of reports) {
    assert.strictEqual(p.meta.get("og:type"), "article", `${p.f} is og:type=${p.meta.get("og:type")}`);
    const when = p.meta.get("article:published_time");
    assert.ok(when, `${p.f} has no article:published_time`);
    assert.ok(!Number.isNaN(Date.parse(when)), `${p.f} published_time is unparseable: ${when}`);
  }
});

console.log("a crawler is told what to read");

const sitemapIndex = "/sitemap-index.xml";

t("the sitemap exists and lists exactly the indexable pages", () => {
  assert.ok(files.includes(sitemapIndex), "no /sitemap-index.xml in the build");

  const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const parts = locs(read(sitemapIndex)).map((u) => new URL(u).pathname);
  assert.ok(parts.length > 0, "the sitemap index names no sitemap");

  const listed = new Set();
  for (const part of parts) {
    assert.ok(files.includes(part), `the index names ${part}, which is not in the build`);
    for (const u of locs(read(part))) listed.add(new URL(u).pathname);
  }

  /* A sitemap URL is a directory; the file behind it is its index.html. */
  const fileFor = (p) => (p.endsWith("/") ? `${p}index.html` : p);
  const wanted = new Set(indexable.map((p) => p.f));

  const extra = [...listed].filter((p) => !wanted.has(fileFor(p)));
  assert.strictEqual(
    extra.length,
    0,
    `submitted to search engines but not indexable (or not in the build): ${extra.join(", ")}`,
  );

  const missing = [...wanted].filter((f) => {
    const dir = f.replace(/index\.html$/, "");
    return !listed.has(dir) && !listed.has(f);
  });
  assert.strictEqual(missing.length, 0, `indexable but absent from the sitemap: ${missing.join(", ")}`);
});

t("robots.txt names the sitemap, at this site's own origin", () => {
  assert.ok(files.includes("/robots.txt"), "no /robots.txt in the build");
  const txt = read("/robots.txt");
  const m = /^Sitemap:\s*(\S+)$/m.exec(txt);
  assert.ok(m, "robots.txt does not name a sitemap");
  const named = new URL(m[1]);
  assert.strictEqual(named.pathname, sitemapIndex, `robots.txt points at ${named.pathname}`);

  const origin = new URL(indexable[0].canonical).origin;
  assert.strictEqual(
    named.origin,
    origin,
    `robots.txt sends crawlers to ${named.origin} while every canonical says ${origin}`,
  );
});

t("robots.txt does not forbid what the sitemap submits", () => {
  const txt = read("/robots.txt");
  const disallow = [...txt.matchAll(/^Disallow:\s*(\S+)$/gm)].map((m) => m[1]).filter((v) => v !== "/");
  assert.ok(disallow.length > 0, "robots.txt disallows nothing at all — /admin should not be crawled");
  assert.ok(
    disallow.some((d) => d.startsWith("/admin")),
    `/admin is crawlable: ${disallow.join(", ")}`,
  );

  const bad = [];
  for (const p of indexable) {
    const url = new URL(p.canonical).pathname;
    const hit = disallow.find((d) => url.startsWith(d));
    if (hit) bad.push(`${url} is in the sitemap and matches "Disallow: ${hit}"`);
  }
  assert.strictEqual(bad.length, 0, bad.join("\n          "));
});

t("the deck is kept out of the index by a header, not by robots.txt", () => {
  /* /ops-deck.html is linked from the landing page. A robots.txt Disallow on a
     LINKED url is the wrong tool — the crawler is told not to fetch it, so it
     never reads the noindex, and the URL can still be indexed from the link
     with no description under it. The header is read on the response itself. */
  assert.ok(files.includes("/ops-deck.html"), "the deck is not in the build");

  const linked = pages.some((p) => p.html.includes('href="/ops-deck.html"'));
  const txt = files.includes("/robots.txt") ? read("/robots.txt") : "";
  const disallowed = /^Disallow:\s*\/ops-deck\.html\s*$/m.test(txt);
  assert.ok(
    !(linked && disallowed),
    "the deck is linked from a page AND disallowed in robots.txt — the noindex can never be read",
  );

  const config = JSON.parse(fs.readFileSync(path.join(OUT, "config.json"), "utf8"));
  const route = config.routes.find(
    (r) => r && typeof r.src === "string" && /ops-deck/.test(r.src) && r.headers,
  );
  assert.ok(route, "no route in the deployed config sets headers on /ops-deck.html");
  const tag = Object.entries(route.headers).find(([k]) => k.toLowerCase() === "x-robots-tag");
  assert.ok(tag, `the deck's route sets ${Object.keys(route.headers).join(", ")} but no X-Robots-Tag`);
  assert.match(tag[1], /noindex/, `X-Robots-Tag on the deck is "${tag[1]}"`);
});

console.log("a reader can subscribe without handing over an address");

t("the feed exists, and every page links to it", () => {
  assert.ok(files.includes("/rss.xml"), "no /rss.xml in the build");
  const bad = indexable.filter((p) => !/rel="alternate"[^>]*application\/rss\+xml|application\/rss\+xml[^>]*rel="alternate"/.test(p.html));
  assert.strictEqual(bad.length, 0, `no feed link in: ${bad.map((p) => p.f).join(", ")}`);
});

t("the feed carries every report, with links that work off-site", () => {
  const xml = read("/rss.xml");
  const links = [...xml.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]);
  /* The first <link> is the channel's; the rest are items. */
  const items = links.slice(1);
  const reports = indexable
    .filter((p) => /^\/reports\/[^/]+\/index\.html$/.test(p.f))
    .map((p) => new URL(p.canonical).pathname);

  assert.strictEqual(
    items.length,
    reports.length,
    `${reports.length} report page(s) in the build, ${items.length} item(s) in the feed`,
  );

  const origin = new URL(indexable[0].canonical).origin;
  for (const l of links) {
    const u = new URL(l); // throws on a relative link, which is the point
    assert.strictEqual(
      u.origin,
      origin,
      `the feed points at ${u.origin}; a feed outlives the deployment that served it`,
    );
  }
  for (const r of reports) {
    assert.ok(
      items.some((l) => new URL(l).pathname === r),
      `${r} is published but not in the feed`,
    );
  }
});

console.log(`\nsite-meta: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
