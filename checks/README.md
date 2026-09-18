# Checks

Four suites. Three of them run in CI on every push and pull request
(`.github/workflows/checks.yml`); the fourth needs a credential and does not.

| Suite | Runner | Covers | In CI |
| --- | --- | --- | --- |
| **deck** | `npm test` | The ops deck at `public/ops-deck.html`, still published at `/ops-deck.html`. Also the proof that work on the site has not disturbed what was already live. | yes |
| **site** | `npm run check:site` | The built public site — the routing config, the share metadata, the charts, overflow and contrast. | yes |
| **admin** | `npm run check:admin` | The SSR routes: the auth guard, the two public API endpoints, and the admin's layout. | yes |
| **database** | `npm run check:db` (+ `checks/db-rls.sql`) | What a reader's key can and cannot reach in Supabase. | no — needs egress and a key |

Every count below came from a real run. If you change a check, re-run it and
update the number rather than leaving a figure that used to be true — a stale
number here is the same failure the suites themselves exist to catch.

```
npm install                        # once — pulls Playwright
npx playwright install chromium    # once — pulls the browser

npm run check:all                  # everything, database included
```

---

## The deck suite

`node checks/run.js` serves the deck on a loopback port and hands each check the
URL in `DECK_URL`. They read the **live DOM**, never the source — the only way
to test a deck whose layout is decided by container queries and whose charts are
measured at paint time.

```
npm test                           # all of them
node checks/run.js charts routing  # a subset
```

Playwright resolves through `require("playwright")`; set `PLAYWRIGHT_MODULE` to
an absolute path if it is installed globally, and `CHROMIUM_PATH` if the browser
is not where Playwright expects it.

| Check | What it drives, and what it must beat |
| --- | --- |
| `overflow` | 14 widths × 2 themes × 4 views, then the basket at every 4px from 320 to 1920 with the detail panel open and folded. No `.scroll` may scroll inside its own panel and the page may never scroll sideways. **112/112 and 802/802.** |
| `charts` | For every `svg.chart`: rendered width ÷ viewBox width, and every `font-size` × that scale. Plus `getBBox` pairwise overlap on every label. **196 charts, scale 1.000, 8.5–13px, 0 overlapping pairs.** |
| `index-labels` | Every label in the coverage basket and the side-panel chart against both series' stroked geometry, the rebase rule, the other labels and the frame — swept over every selection and every segment filter, because the overlay's shape *is* the selection. **357/357 renders clean.** |
| `index-anchors` | Placement may thin the middle but must never drop the first or last figure. **1786 chart instances, 0 dropped.** |
| `routing` | `#predict/7`, `#comms/3`, `#library`, `#equities/FRO`: the hash follows the view, a link beats the store, the store survives a reload, the back stack does not grow, and junk — an unknown ticker, markup in the hash, a hand-edited store — falls back rather than through. **16/16.** |
| `crosshair` | Each of the three charts lights, the readout plate stays inside its frame and is never narrower than its own text, moving between charts leaves exactly one lit, leaving them puts them all out. **9/9.** |
| `interact` | Trade, close, resolve, create, search, sort, filter, comms, report, and the basket's select / clear / chips / bar / scatter / peer / crossing / fold / roving tabindex / arrows / Home / End / Enter / Escape / CSV / live region / theme persistence. **47/47.** |
| `rest` | Touch targets ≥44pt under `pointer:coarse`, company-name reachability, reduced motion, print, and nine LMSR invariants. **4 documented target exceptions and 0 in the basket, 20/20 reachability, 0 animating, 13/13.** |
| `sourced` | `EQ_IR` and `EQ_FIN` ship empty, so the deck must be identical without them and correct with them. Both halves against an injected fixture, down to a `javascript:` URL being refused rather than rendered. **14/14.** |
| `splice` | Offline. The refresh script rewrites the deck in place, so this checks the round-trip, idempotency, that nothing outside the markers moves, and that a hostile provider value cannot escape the literal. **12/12.** The hostile fixture is what found the `</script>` bug. |
| `ciks` | Offline. A ticker can be reassigned, and a wrong CIK fetches another company's accounts under the right ticker rather than erroring — so the registrant-name check is the only thing between those two outcomes. Tested against the real registrant titles and against realistic collisions (`Frontline` must not match `Frontier Communications`). **27/27.** |
| `contrast` | WCAG AA over the rendered body, **differentially** — see the header of `contrast.js`. Not in `run.js`'s list: gradient backgrounds cannot be composited from computed style, so this carries standing artefact signatures and is read as a diff against a baseline rather than as a pass or a fail. The site's equivalent, `site-contrast`, *is* absolute — see below. |

---

## The site suite

`npm run check:site` builds, then `checks/run-site.js` serves
**`.vercel/output/static`** on a loopback port and hands each check the URL in
`SITE_URL`.

That path matters. It served `dist/` until the admin added the first
server-rendered page, at which point Astro restructured the output into
`dist/client/` and every request started 404ing — and `site-overflow` reported
**196/196 clean**, because a 404 page does not scroll sideways either.
`.vercel/output/static` is the artifact that actually deploys, and it does not
move when the rendering mode changes. The runner now also refuses to start
without an `index.html`, and every page assertion checks for a 200.

```
npm run check:site
node checks/run-site.js site-charts   # a subset, against the last build
```

| Check | What it drives, and what it must beat |
| --- | --- |
| `vercel-output` | Offline, against the build output. Every finding of the hosting audit as an assertion, and they share a shape: the thing looked configured and was not. `vercel.json`'s `headers` are **not** merged by the Astro adapter, so they are spliced into `.vercel/output/config.json` by `scripts/vercel-config.mjs`; this asserts they arrived, landed before `handle: filesystem`, and carry `continue`. It also validates the whole config against **Vercel's own schema** — one foreign key in a route object failed every deployment for a week while every check here passed. Plus: the mirror redirect fires for a mirror's production domain and nothing else, no public page pulls in a framework runtime, and nothing from the repository is on the domain. **18/18.** |
| `site-meta` | Can this be found and shared? Asserts **agreement**, not presence: `og:url` must equal the canonical, every page must name the same origin, a card image must resolve inside the build, the sitemap must list exactly the indexable pages, and `robots.txt` must not `Disallow` what the sitemap submits. **12/12.** |
| `site-report` | The report page end to end: blocks, sources, provenance, the indicative labelling. **26/26.** |
| `site-beacon` | What the analytics actually does, in a real browser: no request to a third party the privacy page does not name, no user-agent or IP or fingerprint in the payload, and Do Not Track meaning **no beacon and no identifier** rather than merely no report. **21/21.** |
| `site-charts` | The chart guarantee, plus the two things server rendering adds: that the server's frame is really in the HTML — asserted with **JavaScript disabled**, so it is the crawler's view — and that the client's second pass *corrects* the frame rather than replacing it. **6 charts / 116 labels with JS off; 252 charts at scale 1.000, 8.5–13px, 0 overlapping pairs; identical labels before and after hydration.** |
| `site-overflow` | Nothing scrolls sideways, and every page really loaded. 8 pages × 2 themes × 14 widths. **224/224.** |
| `site-contrast` | WCAG AA over the site, using the deck's probe. **Absolute, not differential**: nothing on this site puts a gradient behind text, so every signature is a real one and this fails outright. It found two on its first run — a separator coloured with a *border* token at 1.29:1, and `--small` on the dark insight panel at 2.09:1. **36 page-renders, 0 failing text runs.** |

---

## The admin suite

`npm run check:admin` starts a real dev server — `/admin/*` is server-rendered,
so there is no file to serve — and runs three checks against it. It picks a
random port and **refuses to run if anything is already listening**: a stale
daemon from a previous run once answered the checks on code from before the edit
under test, and a deliberately broken auth guard passed all fifteen assertions.

```
npm run check:admin
```

| Check | What it drives, and what it must beat |
| --- | --- |
| `site-admin` | Every guarded route refuses a stranger, including the save endpoint and `/admin/analytics`, which reads the subscriber list. The assertion that matters is that a session the database **cannot verify** is refused exactly like an anonymous one: a guard that fails open when the database has a bad minute leaves the editor open to anyone with the URL, and a free-tier project pauses after a week idle. **27/27.** |
| `site-funnel` | `/api/track` answers 204 to everything by design, so none of its validation is observable over HTTP — the validation is a pure function and is tested directly. Plus the subscribe form with JavaScript off, and the body cap, which is asserted by counting how much of the stream was actually pulled rather than by checking the answer. **32/32.** |
| `admin-overflow` | The admin's layout at 14 widths in both themes. Without a staff session it can reach **1 of 6 routes** — the rest correctly redirect to the login — so it prints `1/6` and names the five it could not measure rather than reporting a clean sweep. Set `ADMIN_SESSION_COOKIE` to a real staff session and it sweeps them all. **28/28 clean on what it can reach.** |

---

## The database suite

Two files, companions rather than alternatives.

`checks/db-rls.js` is the honest one: the real publishable key over the real
API, which is exactly what a reader holds. Reads `.env`.

```
npm run check:db
```

**It proves the host is reachable before it asserts anything**, and exits `2`
without running the suite if it is not. That is not politeness — every assertion
reads "refused" as a pass, and a request that never left the machine is also
refused. The first time it ran, from a sandbox whose egress allowlist did not
include the project, it reported twelve passes for a database it could not see.
Exit `2` means *could not test*; exit `1` means *failed*. That is also why it is
not in CI.

`checks/db-rls.sql` runs the same assertions **inside** the database, using
`set local role` and a `request.jwt.claims` fixture so the policies are
evaluated for real as `anon`, as a signed-in non-staff account, and as staff. It
needs no egress, so it covers the gap when the JS check cannot connect — but it
cannot see anything PostgREST layers on top, which is why it is the companion
and not the replacement. It builds its own fixtures, including a fixture
`auth.users` row, and rolls everything back.

```
psql "$DATABASE_URL" -f checks/db-rls.sql     # or the Supabase SQL editor
```

**48/48.** Between them they hold: a published report is visible and a draft is
not; a draft's blocks do not leak without the draft; the funnel tables are
*unreachable* rather than merely empty; a signed-in account that is not staff —
which holds every table grant, so RLS is the only thing in its way — cannot
read the funnel tables and cannot insert, update or **delete** a report; staff
*can* read them; and `record_events` is not callable by `anon`.

Two of those exist because running this found the bug: `mailable_subscribers`
was readable by the anonymous role through Supabase's default privileges on a
new view, and an assertion that counted every `report_blocks` row had been
passing only because the table used to be empty.

---

## Two things that have caught people out

`const S` at the top level of a classic script is a global **lexical** binding,
not a property of `window`, so a check reaches it by name
(`new Function("return S.eqSel")()`) rather than off `window`.

`color-mix()` computes to `color(srgb 0.94 …)` with 0–1 floats, not `rgb()` with
0–255. A parser that assumes `rgb()` reads those as near-black and reports
confident nonsense — it once claimed 1.89:1 on a tile that measures 4.78:1.

## And the rule the whole suite is built on

**A check you cannot make fail has not been verified.** Four checks in this
project passed while measuring the wrong thing: `site-overflow` reported 196/196
against a site of 404s, the admin's fail-closed assertion tested the anonymous
path and never reached the network, the no-third-party assertion compared
request *hosts* while the third party was served from a same-origin path, and
the no-JS form assertion read two HTML attributes without ever submitting the
form — which was broken. Every one was found by trying to make it fail. Do that
to anything you add here.
