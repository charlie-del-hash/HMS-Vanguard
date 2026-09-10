# Checks

Three suites live here now.

| Suite | Runner | What it covers |
| --- | --- | --- |
| **deck** | `node checks/run.js` | The published ops deck at `public/ops-deck.html`. Unchanged, and the proof that work on the site has not disturbed what is already live. |
| **site** | `npm run build && node checks/run-site.js` | The Astro build in `dist/`. Chart guarantee and overflow across the new pages. |
| **database** | `node checks/db-rls.js` (+ `checks/db-rls.sql`) | What a reader's key can and cannot reach in Supabase. |

The rest of this file documents the deck suite; the other two are described at
the bottom.

Headless-Chromium checks for the deck. They drive a served copy
of the deck and read the **live DOM**, never the source — which is the only way
to test a deck whose layout is decided by container queries and whose charts are
measured at paint time.

These are development files. The Pages workflow copies only the deck itself into
the site artifact, so nothing here is published there.

## Running them

```
node checks/run.js                 # all of them
node checks/run.js charts routing  # a subset
```

`run.js` serves the deck on a loopback port and hands each check the URL in
`DECK_URL`. Playwright resolves through `require("playwright")`; set
`PLAYWRIGHT_MODULE` to an absolute path if it is installed globally, and
`CHROMIUM_PATH` if the browser is not where Playwright expects it.

## What each one asserts

| Check | What it drives, and what it must beat |
| --- | --- |
| `overflow` | 14 widths × 2 themes × 4 views, then the basket at every 4px from 320 to 1920 with the detail panel open and folded. No `.scroll` may scroll inside its own panel and the page may never scroll sideways. **112/112 and 802/802.** |
| `charts` | For every `svg.chart`: rendered width ÷ viewBox width, and every `font-size` × that scale. Plus `getBBox` pairwise overlap on every label. **Scale 1.000, 8.5–13px, 0 overlapping pairs.** |
| `index-labels` | Every label in the coverage basket and the side-panel chart against both series' stroked geometry, the rebase rule, the other labels and the frame — swept over every selection and every segment filter, because the overlay's shape *is* the selection. **0 hits in 429 renders.** |
| `index-anchors` | Placement may thin the middle but must never drop the first or last figure. 19 widths × 2 themes × 24 selections. **0 dropped in 1786 chart instances.** |
| `routing` | `#predict/7`, `#comms/3`, `#library`, `#equities/FRO`: the hash follows the view, a link beats the store, the store survives a reload, the back stack does not grow, and junk — an unknown ticker, module or market, markup in the hash, a hand-edited store — falls back rather than through. **16/16.** |
| `crosshair` | Each of the three charts lights, the readout plate stays inside its frame and is never narrower than its own text, moving between charts leaves exactly one lit, leaving them puts them all out. **9/9.** |
| `interact` | Trade, close, resolve, create, search, sort, filter, comms, report, and the basket's select / clear / chips / bar / scatter / peer / crossing / fold / roving tabindex / arrows / Home / End / Enter / Escape / CSV / live region / theme persistence. **47/47.** |
| `rest` | Touch targets ≥44pt under `pointer:coarse`, company-name reachability, reduced motion, print, and nine LMSR invariants. **3 documented target exceptions and 0 in the basket, 20/20 reachability, 0 animating, 13/13.** |
| `sourced` | `EQ_IR` and `EQ_FIN` ship empty, so the deck must be identical without them and correct with them. Both halves against an injected fixture: the block appears only when data exists, figures scale, a loss is coloured, nulls render as a dash, the Source row switches from tab-wide to per-name, and every outbound link is https with `rel="noopener"` — a `javascript:` URL is refused rather than rendered. **14/14.** |
| `splice` | Offline. The refresh script rewrites the deck in place, so this checks the round-trip, idempotency, that nothing outside the markers moves, and that a hostile provider value cannot escape the literal — then loads the rewritten deck and asserts the figures reach the panel. **12/12.** The hostile fixture is what found the `</script>` bug. |
| `ciks` | Offline. Nobody types a CIK, so the resolver reads the SEC's ticker map — but a ticker can be reassigned, and a wrong CIK fetches another company's accounts under the right ticker rather than erroring. The registrant-name check is the only thing standing between those two outcomes, so it is tested against the thirteen real registrant titles and against realistic collisions (`Frontline` must not match `Frontier Communications`). Plus: sources.json covers every name in `EQUITIES`, hasn't drifted from it, and holds no malformed CIK. **25/25.** |
| `contrast` | WCAG AA over the rendered body, **differentially** — see the header of `contrast.js`. Gradient backgrounds cannot be composited from computed style, so this kind of checker carries standing artefact signatures; what matters is that the set does not grow. |

## Two things that have caught people out

`const S` at the top level of a classic script is a global **lexical** binding,
not a property of `window`, so a check reaches it by name (`new Function("return S.eqSel")()`)
rather than off `window`.

`color-mix()` computes to `color(srgb 0.94 …)` with 0–1 floats, not `rgb()` with
0–255. A parser that assumes `rgb()` reads those as near-black and reports
confident nonsense — it once claimed 1.89:1 on a tile that measures 4.78:1.


## The site suite

`checks/run-site.js` serves `dist/` on a loopback port — the real build output,
never the source — and hands each check the URL in `SITE_URL`.

```
npm run build && node checks/run-site.js
node checks/run-site.js site-charts        # a subset
```

| Check | What it drives, and what it must beat |
| --- | --- |
| `vercel-output` | Offline, against the build output. Every finding of the hosting audit as an assertion, and they share a shape: the thing looked configured and was not. **vercel.json's `headers` are not merged by the Astro adapter** — it reads that file only to warn about `trailingSlash` — so they are spliced into `.vercel/output/config.json` by `scripts/vercel-config.mjs`, and this asserts they arrived, landed *before* `handle: filesystem`, and carry `continue`. Plus: every `dest` the config routes to exists (the config routed misses to a `/404.html` that did not), the deck is byte-identical in the output, no client bundle is unreferenced (a registered-but-unused React integration shipped 188KB nothing loaded), and nothing from the repository is on the domain. **10/10.** |
| `site-charts` | The same guarantee `charts` holds for the deck, plus the two things server rendering adds. That the server's frame is really in the HTML — asserted with **JavaScript disabled**, so it is the crawler's view rather than a hydrated one. That scale is 1.000 and rendered type lands in 8.5–13px with 0 overlapping pairs, over 14 widths × 2 themes. And that the client's second pass **corrects** the frame rather than replacing it: the same charts, in the same order, with the same labels, before and after hydration. **168 instances, scale 1.000, 8.5–13px, 0 pairs.** |
| `site-overflow` | Nothing scrolls sideways: 3 pages × 2 themes × 14 widths, page and every element, ignoring only elements that opt into their own scroller. **84/84.** |

## The database suite

Two files, and they are companions rather than alternatives.

`checks/db-rls.js` is the honest one: it uses the real publishable key over the
real API, which is exactly what a reader holds. Reads `.env`.

```
node checks/db-rls.js
```

**It proves the host is reachable before it asserts anything**, and exits `2`
without running the suite if it is not. That is not politeness — every
assertion in the file reads "refused" as a pass, and a request that never left
the machine is also refused. The first time it ran, from a sandbox whose egress
allowlist did not include the project, it reported twelve passes for a database
it could not see. Exit `2` means *could not test*; exit `1` means *failed*.

`checks/db-rls.sql` runs the same assertions inside the database, using
`set local role` so the policies are evaluated for real as `anon` and as a
signed-in non-staff account. It needs no egress, so it covers the gap when the
JS check cannot connect — but it cannot see anything PostgREST layers on top,
which is why it is the companion and not the replacement. It builds its own
fixtures and rolls them back.

```
psql "$DATABASE_URL" -f checks/db-rls.sql     # or the Supabase SQL editor
```

**32/32.** Between them they hold: a published report is visible and a draft is
not; a draft's blocks do not leak without the draft; the data tables behind the
reports are readable; the analytics tables are *unreachable* rather than merely
empty; and a signed-in account that is not staff — which holds every table
grant, so RLS is the only thing in its way — cannot insert, update or **delete**
a report. That last one matters: an earlier draft of these policies would have
let the delete through, because `DELETE` has no `WITH CHECK` to catch it.
