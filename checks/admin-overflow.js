/* The admin's layout, at every width, in both themes — and an honest account
 * of the part of it that cannot be measured from here.
 *
 * ── what this can reach ───────────────────────────────────────────────
 * site-overflow sweeps the STATIC build, so it structurally cannot see an
 * SSR route: there is no file for it. That left the admin — the most complex
 * layout in the project, a two-column grid with a sticky 900px preview frame
 * and a column of 12px textareas — with no layout coverage at any width.
 *
 * This runs against the live dev server, so it can reach SSR routes. What it
 * cannot do is sign in: this sandbox has no egress to Supabase, `access()`
 * returns `unavailable`, and the guard refuses every state but `staff` — which
 * is the correct behaviour and is asserted by checks/site-admin.js.
 *
 * So the editor itself is NOT measured here, and this check says so out loud
 * rather than printing a clean line that means "we looked at the login page".
 * A sweep that reports 100% while silently measuring one page is the exact
 * failure this audit was called to fix: site-overflow once reported 196/196
 * clean against a site where every page was a 404.
 *
 * With ADMIN_SESSION_COOKIE set to a real staff session (from a browser signed
 * in to a deployment), every guarded route becomes reachable and is swept for
 * real. That is how the editor gets measured, and it needs a person.
 *
 *   ADMIN_URL=http://127.0.0.1:4421 node checks/admin-overflow.js
 */
const { browser, newPage, WIDTHS } = require("./lib");

const BASE = process.env.ADMIN_URL || "http://127.0.0.1:4399";
const COOKIE = process.env.ADMIN_SESSION_COOKIE || "";

/* An id that cannot exist, so a route that DOES render reaches its own
   not-found path rather than someone's real report. */
const NOPE = "00000000-0000-4000-8000-000000000000";

const PAGES = [
  "/admin/login",
  "/admin",
  "/admin/analytics",
  "/admin/data",
  `/admin/reports/${NOPE}`,
  `/admin/preview/${NOPE}`,
];

(async () => {
  const b = await browser();

  /* The cookie has to be in place before the first navigation, so the context
     is built here rather than left to newPage — which navigates as soon as it
     has a page. */
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  if (COOKIE) {
    const [name, ...rest] = COOKIE.split("=");
    await ctx.addCookies([
      { name: name.trim(), value: rest.join("=").trim(), domain: "127.0.0.1", path: "/" },
    ]);
  }

  const p = await newPage(b, { ctx, url: `${BASE}/admin/login` });

  let n = 0;
  const bad = [];
  const unmeasured = [];

  for (const page of PAGES) {
    /* One probe before the sweep: is this page actually rendering, or is the
       guard sending us to the login? Sweeping the login six times over and
       calling it six pages is the thing this check exists not to do. */
    const probe = await p.goto(BASE + page, { waitUntil: "domcontentloaded" });
    const landed = new URL(p.url()).pathname;
    if (!probe) {
      bad.push(`${page}: no response`);
      continue;
    }
    if (probe.status() >= 500) {
      bad.push(`${page}: server returned ${probe.status()}`);
      continue;
    }
    if (landed !== page && landed.startsWith("/admin/login")) {
      unmeasured.push(page);
      continue;
    }

    for (const theme of ["light", "dark"]) {
      for (const w of WIDTHS) {
        await p.setViewportSize({ width: w, height: 1000 });
        const nav = await p.goto(BASE + page, { waitUntil: "networkidle" });
        if (!nav || nav.status() >= 400) {
          bad.push(`${page} ${theme} ${w}: returned ${nav ? nav.status() : "no response"}`);
          n++;
          continue;
        }
        await p.evaluate((th) => {
          document.documentElement.dataset.theme = th;
        }, theme);
        await p.waitForTimeout(150);
        const res = await p.evaluate(() => {
          const d = document.documentElement;
          const out = { page: d.scrollWidth - d.clientWidth, els: [] };
          for (const el of document.querySelectorAll("*")) {
            if (el.scrollWidth > el.clientWidth + 1) {
              const cs = getComputedStyle(el);
              if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
              if (cs.overflowX === "clip" || cs.overflowX === "hidden") continue;
              out.els.push(
                `${el.tagName.toLowerCase()}.${el.className || "?"} ${el.scrollWidth}>${el.clientWidth}`,
              );
            }
          }
          return out;
        });
        n++;
        if (res.page > 1) bad.push(`${page} ${theme} ${w}: page scrolls ${res.page}px`);
        res.els.slice(0, 3).forEach((e) => bad.push(`${page} ${theme} ${w}: ${e}`));
      }
    }
  }

  await b.close();

  const swept = PAGES.length - unmeasured.length;
  console.log(
    `admin-overflow: ${n - bad.length}/${n} clean ` +
      `(${swept}/${PAGES.length} admin pages x 2 themes x ${WIDTHS.length} widths)`,
  );
  bad.slice(0, 20).forEach((x) => console.log("  ", x));

  if (unmeasured.length) {
    console.log(
      `  NOT MEASURED — the guard sent these to the login, which is correct ` +
        `without a session:\n     ${unmeasured.join("\n     ")}`,
    );
    console.log(
      `     Set ADMIN_SESSION_COOKIE to a real staff session to sweep them. ` +
        `Until then the editor's layout is unchecked, and saying so is the point.`,
    );
  }

  /* An empty sweep is a failure. If the guard is working and there is no
     session, the login alone must still be measured — and if even that stopped
     rendering, this would otherwise print "0/0 clean" and exit 0. */
  if (swept === 0) {
    console.log("  FAIL  not one admin page rendered, so nothing above means anything");
    process.exit(1);
  }
  process.exit(bad.length ? 1 : 0);
})();
