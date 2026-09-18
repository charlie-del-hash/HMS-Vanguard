/* The privacy page, turned into assertions.
 *
 * /privacy makes four claims about code in this repository. A privacy page
 * that describes an intention rather than an implementation is the same class
 * of fault as a config file that validates and does nothing — worse, because
 * nobody re-reads it.
 *
 * So each claim is checked against a real browser loading the real build:
 *
 *   no third parties     nothing on a reader-facing page contacts anyone but us
 *   Do Not Track         no request AND no identifier — un-recorded, not merely
 *                        un-reported, which is a different promise
 *   no fingerprint       the payload carries an id, events and referrer, and
 *                        nothing that describes the browser or the person
 *   no wall              the email form is optional and works with JS off
 *
 * The endpoint 404s here — run-site.js serves static files — which is fine:
 * what is under test is what the browser SENDS, not what the server does with
 * it. checks/site-funnel.js covers the other half.
 *
 *   node checks/run-site.js site-beacon
 */
const assert = require("assert");
const { browser, newPage } = require("./lib");

const BASE = process.env.SITE_URL || "http://127.0.0.1:4321";
const REPORT = "/reports/hormuz-strikes-tanker-economics/";
const KEY = "affinity-anon-id";

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

/** What the config enables, and what the privacy page admits to. */
async function disclosure() {
  const fs = require("fs");
  const path = require("path");
  const root = path.resolve(__dirname, "..");
  const config = fs.readFileSync(path.join(root, "astro.config.mjs"), "utf8");
  const privacy = fs.readFileSync(path.join(root, "src", "pages", "privacy.astro"), "utf8");
  return {
    enabledInConfig: /webAnalytics:\s*\{\s*enabled:\s*true/.test(config),
    vercel: /Vercel Web Analytics/.test(privacy),
  };
}

/** Load a page and collect every beacon body it tried to send. */
async function watch(ctx, path, { dnt = false } = {}) {
  const page = await ctx.newPage();
  const sent = [];
  const hosts = new Set();

  if (dnt) {
    /* Set before any script runs, so the beacon sees it on its first line. */
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "doNotTrack", { get: () => "1", configurable: true });
    });
  }

  /* Paths this site actually serves. Anything else is somebody else's, even
     when it is proxied onto our own domain — which is exactly how Vercel Web
     Analytics hid from the previous version of this check. */
  const OURS = [/^\/$/, /^\/reports/, /^\/privacy/, /^\/dev\//, /^\/_astro\//, /^\/api\//,
                /^\/favicon/, /^\/ops-deck\.html/, /^\/404/];
  const thirdParty = new Set();

  page.on("request", (r) => {
    const url = r.url();
    try {
      const u = new URL(url);
      hosts.add(u.host);
      if (!OURS.some((re) => re.test(u.pathname))) thirdParty.add(url);
    } catch {
      /* data: and blob: urls have no host */
    }
    if (url.includes("/api/track")) sent.push(r.postData() || "");
  });

  await page.goto(BASE + path, { waitUntil: "networkidle" });
  /* The beacon batches on a timer; scroll to provoke depth events too. */
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3200);

  const stored = await page.evaluate((k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }, KEY);

  await page.close();
  return { sent, hosts, stored, thirdParty: [...thirdParty] };
}

(async () => {
  const b = await browser();
  const ctx = await b.newContext();

  console.log("every third party on the page is one the privacy page names");
  {
    const { hosts, thirdParty } = await watch(ctx, REPORT);
    const ours = new URL(BASE).host;

    /* Host is not the question, and asking it was the bug.
     *
     * This compared `new URL(url).host !== ours` and reported a clean bill of
     * health while Vercel Web Analytics shipped on every page — because the
     * platform proxies it at the SAME-ORIGIN path /_vercel/insights/, so the
     * host matched ours on localhost and would have matched in production too.
     * The privacy page's "nothing makes a request to anyone but us" was
     * enforced by a check that could not see the counter-example.
     *
     * So: destination. A request to a path we do not serve ourselves is a third
     * party regardless of whose domain it wears. */
    const foreignHosts = [...hosts].filter((h) => h && h !== ours);
    t("no request to another domain", foreignHosts.length === 0, `contacted ${foreignHosts.join(", ")}`);

    /* Vercel Web Analytics is currently ON by deliberate decision. The rule is
       not "no third parties" — it is "no UNDISCLOSED third parties". */
    const disclosed = await disclosure();
    for (const url of thirdParty) {
      const named = /_vercel\/insights/.test(url) && disclosed.vercel;
      t(
        `${url.replace(BASE, "")} is disclosed on /privacy`,
        named,
        named ? "" : `this reaches a third party and /privacy does not say so`,
      );
    }
    t(
      "the config and the privacy page agree about Vercel analytics",
      disclosed.enabledInConfig === disclosed.vercel,
      disclosed.enabledInConfig
        ? "webAnalytics is enabled in astro.config.mjs but /privacy does not name Vercel"
        : "/privacy names Vercel Web Analytics but it is not enabled in astro.config.mjs",
    );
  }

  console.log("the beacon measures, and says what it measures");
  {
    const { sent, stored } = await watch(ctx, REPORT);
    t("a beacon was sent", sent.length > 0, "nothing was posted to /api/track");
    t("an identifier was stored", !!stored && /^[0-9a-f-]{36}$/i.test(stored || ""), `stored ${stored}`);

    const payload = sent.join("\n");
    let parsed = null;
    try {
      parsed = JSON.parse(sent[0]);
    } catch {
      /* reported below */
    }
    t("the payload is JSON", !!parsed);
    t(
      "it carries the id it stored",
      !!parsed && parsed.anonId === stored,
      parsed ? `sent ${parsed.anonId}, stored ${stored}` : "",
    );
    t(
      "a pageview is among the events",
      !!parsed && (parsed.events || []).some((e) => e.kind === "pageview"),
    );

    /* The four things /privacy says are NOT collected. Checked as substrings of
       the whole payload rather than by key, because the promise is about what
       leaves the browser, not about what this version happens to name. */
    const banned = [
      ["user-agent string", /Mozilla\/|Chrome\/|AppleWebKit/],
      ["IP address", /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
      ["screen or fingerprint data", /"(screen|canvas|fonts|hardwareConcurrency|timezone|platform)"/i],
      ["cookie contents", /document\.cookie|"cookie"/i],
    ];
    for (const [what, re] of banned) {
      t(`no ${what} in the payload`, !re.test(payload), `matched ${re}`);
    }
  }

  console.log("Do Not Track means un-recorded, not merely un-reported");
  {
    const fresh = await b.newContext(); // a context with no id already stored
    const { sent, stored } = await watch(fresh, REPORT, { dnt: true });
    t("no beacon is sent", sent.length === 0, `${sent.length} request(s) went anyway`);
    t(
      "and no identifier is generated",
      stored === null,
      `stored "${stored}" — respecting DNT after creating the id is a gesture, not a choice`,
    );
    await fresh.close();
  }

  console.log("email is optional and never a wall");
  {
    const p = await newPage(b, { w: 1280, h: 1200, url: BASE + REPORT });
    const form = await p.evaluate(() => {
      const box = document.querySelector("[data-subscribe]");
      if (!box) return null;
      const f = box.querySelector("form");
      const consent = box.querySelector('input[name="consent"]');
      return {
        action: f?.getAttribute("action") || "",
        method: (f?.getAttribute("method") || "").toUpperCase(),
        consentChecked: consent ? consent.checked : null,
        /* Nothing may sit over the article. A modal, a scroll trap or a
           full-screen overlay would be a wall by another name. */
        overlays: [...document.querySelectorAll("body *")].filter((el) => {
          const s = getComputedStyle(el);
          return (
            (s.position === "fixed" || s.position === "sticky") &&
            el.getBoundingClientRect().height > window.innerHeight * 0.6
          );
        }).length,
      };
    });

    t("there is a subscribe form", !!form);
    t("it is declared as a real POST form", !!form && form.action === "/api/subscribe" && form.method === "POST",
      form ? `action="${form.action}" method="${form.method}"` : "");
    t("consent is not pre-ticked", !form || form.consentChecked === false,
      "marketing consent that defaults to on is not consent");
    t("nothing covers the article", !form || form.overlays === 0,
      form ? `${form.overlays} large fixed element(s)` : "");

    /* The article is readable without ever touching the form. */
    const words = await p.evaluate(() => (document.querySelector("article")?.innerText || "").split(/\s+/).length);
    t("the whole report is readable regardless", words > 500, `${words} words`);
    await p.close();
  }

  /* The real submission is tested in site-funnel.js, against the SSR server.
     It cannot live here: run-site.js serves the STATIC build, where /api/*
     does not exist as a file, so every post would 404 regardless of whether
     the form works. What this file can pin down is that the form sends what
     that test replicates — the encoding and the field names. */
  {
    const p = await newPage(b, { w: 1280, h: 900, url: BASE + REPORT });
    const shape = await p.evaluate(() => {
      const f = document.querySelector("[data-subscribe] form");
      if (!f) return null;
      return {
        enctype: f.enctype || "application/x-www-form-urlencoded",
        fields: [...f.querySelectorAll("input,button")].map((e) => e.getAttribute("name")).filter(Boolean),
      };
    });
    t(
      "it posts urlencoded, which is what the endpoint must accept",
      !!shape && shape.enctype === "application/x-www-form-urlencoded",
      shape ? `enctype ${shape.enctype}` : "no form",
    );
    t(
      "it sends the fields the endpoint reads",
      !!shape && shape.fields.includes("email") && shape.fields.includes("consent"),
      shape ? `fields: ${shape.fields.join(", ")}` : "",
    );
    await p.close();
  }

  await ctx.close();
  await b.close();
  console.log(`\nsite-beacon: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
